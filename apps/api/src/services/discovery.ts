import { computeMomentumScore, getScoreBand, parseDurationToSeconds, similarityScore, titleFormat } from "@openoutlier/core";
import { db, getSetting } from "../db.js";
import { EmbeddingsService } from "./embeddings-service.js";
import { GoogleImageService } from "./google-image-service.js";

export type DiscoverQuery = {
  listId?: number;
  projectId?: number;
  sourceSetId?: number;
  minScore?: number;
  maxScore?: number;
  days: number;
  sort: "score" | "views" | "date" | "velocity" | "momentum";
  order: "asc" | "desc";
  page: number;
  limit: number;
  channelId?: string;
  search?: string;
  contentType?: "all" | "long" | "short";
  minSubscribers?: number;
  maxSubscribers?: number;
  minViews?: number;
  maxViews?: number;
  minVelocity?: number;
  maxVelocity?: number;
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
};

const embeddingsService = new EmbeddingsService();
const thumbnailService = new GoogleImageService();
const orderMap = {
  asc: "ASC",
  desc: "DESC",
} as const;

export function listDiscoverOutliers(query: DiscoverQuery) {
  const threshold = Number(getSetting("default_outlier_threshold") ?? 3);
  const minScore = query.minScore ?? threshold;
  const offset = (query.page - 1) * query.limit;
  const publishedAfter = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000).toISOString();
  const sortMap = {
    score: "videos.outlier_score",
    views: "videos.views",
    date: "videos.published_at",
    velocity: "videos.view_velocity",
    momentum: "videos.momentum_score",
  } as const;

  const whereClauses = [
    "videos.outlier_score >= @minScore",
    "videos.published_at >= @publishedAfter",
  ];
  const params: Record<string, string | number> = {
    minScore,
    publishedAfter,
  };

  if (query.maxScore !== undefined) {
    whereClauses.push("videos.outlier_score <= @maxScore");
    params.maxScore = query.maxScore;
  }
  if (query.listId !== undefined) {
    whereClauses.push("list_channels.list_id = @listId");
    params.listId = query.listId;
  }
  if (query.channelId) {
    whereClauses.push("videos.channel_id = @channelId");
    params.channelId = query.channelId;
  }
  if (query.search) {
    whereClauses.push("(videos.title LIKE @search OR channels.name LIKE @search OR channels.handle LIKE @search)");
    params.search = `%${query.search}%`;
  }
  if (query.contentType && query.contentType !== "all") {
    whereClauses.push("videos.content_type = @contentType");
    params.contentType = query.contentType;
  }
  if (query.minSubscribers !== undefined) {
    whereClauses.push("channels.subscriber_count >= @minSubscribers");
    params.minSubscribers = query.minSubscribers;
  }
  if (query.maxSubscribers !== undefined) {
    whereClauses.push("channels.subscriber_count <= @maxSubscribers");
    params.maxSubscribers = query.maxSubscribers;
  }
  if (query.minViews !== undefined) {
    whereClauses.push("videos.views >= @minViews");
    params.minViews = query.minViews;
  }
  if (query.maxViews !== undefined) {
    whereClauses.push("videos.views <= @maxViews");
    params.maxViews = query.maxViews;
  }
  if (query.minVelocity !== undefined) {
    whereClauses.push("videos.view_velocity >= @minVelocity");
    params.minVelocity = query.minVelocity;
  }
  if (query.maxVelocity !== undefined) {
    whereClauses.push("videos.view_velocity <= @maxVelocity");
    params.maxVelocity = query.maxVelocity;
  }
  if (query.minDurationSeconds !== undefined) {
    whereClauses.push("videos.duration_seconds >= @minDurationSeconds");
    params.minDurationSeconds = query.minDurationSeconds;
  }
  if (query.maxDurationSeconds !== undefined) {
    whereClauses.push("videos.duration_seconds <= @maxDurationSeconds");
    params.maxDurationSeconds = query.maxDurationSeconds;
  }

  const whereSql = whereClauses.join(" AND ");

  const totalRow = db
    .prepare(`
      SELECT COUNT(DISTINCT videos.id) AS total
      FROM videos
      INNER JOIN channels ON channels.id = videos.channel_id
      LEFT JOIN list_channels ON list_channels.channel_id = channels.id
      WHERE ${whereSql}
    `)
    .get(params) as { total: number };

  const videos = db
    .prepare(`
      SELECT
        videos.id AS videoId,
        videos.title,
        channels.name AS channelName,
        channels.id AS channelId,
        channels.handle AS channelHandle,
        channels.subscriber_count AS channelSubscribers,
        channels.median_views AS channelMedianViews,
        videos.views,
        videos.likes,
        videos.comments,
        videos.published_at AS publishedAt,
        videos.thumbnail_url AS thumbnailUrl,
        'https://youtube.com/watch?v=' || videos.id AS videoUrl,
        videos.outlier_score AS outlierScore,
        videos.momentum_score AS momentumScore,
        videos.view_velocity AS viewVelocity,
        videos.engagement_ratio AS engagementRatio,
        videos.duration,
        videos.duration_seconds AS durationSeconds,
        videos.content_type AS contentType,
        videos.scanned_at AS scannedAt,
        MAX(project_references.id) AS projectReferenceId,
        COALESCE(json_group_array(DISTINCT lists.name) FILTER (WHERE lists.name IS NOT NULL), '[]') AS lists
      FROM videos
      INNER JOIN channels ON channels.id = videos.channel_id
      LEFT JOIN list_channels ON list_channels.channel_id = channels.id
      LEFT JOIN lists ON lists.id = list_channels.list_id
      LEFT JOIN project_references ON project_references.video_id = videos.id
      WHERE ${whereSql}
      GROUP BY videos.id
      ORDER BY ${sortMap[query.sort]} ${orderMap[query.order]}, videos.published_at DESC
      LIMIT @limit OFFSET @offset
    `)
    .all({ ...params, limit: query.limit, offset }) as Array<Record<string, unknown>>;

  return {
    total: totalRow.total,
    page: query.page,
    limit: query.limit,
    videos: videos.map((video) => ({
      ...video,
      scoreBand: getScoreBand(Number(video.outlierScore)),
      lists: JSON.parse(String(video.lists)),
    })),
  };
}

export async function getSimilarTopics(videoId: string, limit = 12) {
  const seed = db.prepare("SELECT id, title, channel_id FROM videos WHERE id = ?").get(videoId) as
    | { id: string; title: string; channel_id: string }
    | undefined;
  if (!seed) {
    return null;
  }

  const candidates = db
    .prepare(`
      SELECT
        videos.id AS videoId,
        videos.title,
        channels.name AS channelName,
        videos.outlier_score AS outlierScore,
        videos.view_velocity AS viewVelocity,
        videos.thumbnail_url AS thumbnailUrl
      FROM videos
      INNER JOIN channels ON channels.id = videos.channel_id
      WHERE videos.id != ?
      ORDER BY videos.outlier_score DESC
      LIMIT 250
    `)
    .all(videoId) as Array<Record<string, unknown>>;

  const candidateIds = candidates.map((candidate) => String(candidate.videoId));
  const embeddingScores = await embeddingsService.getSimilarityScores(videoId, candidateIds);

  return candidates
    .map((candidate) => {
      const lexical = similarityScore(seed.title, String(candidate.title));
      const embedding = embeddingScores?.get(String(candidate.videoId));
      return {
        ...candidate,
        mode: embeddingScores ? "embedding" : "lexical",
        similarity: embedding !== undefined ? Number(embedding.toFixed(4)) : lexical,
        lexicalSimilarity: lexical,
      };
    })
    .filter((candidate) => candidate.similarity > 0)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, limit);
}

export async function getSimilarThumbnails(videoId: string, limit = 12) {
  const seed = db.prepare("SELECT id, title, thumbnail_url, content_type FROM videos WHERE id = ?").get(videoId) as
    | { id: string; title: string; thumbnail_url: string | null; content_type: string }
    | undefined;
  if (!seed) {
    return null;
  }

  const candidates = db
    .prepare(`
      SELECT
        videos.id AS videoId,
        videos.title,
        videos.thumbnail_url AS thumbnailUrl,
        videos.content_type AS contentType,
        videos.outlier_score AS outlierScore,
        channels.name AS channelName
      FROM videos
      INNER JOIN channels ON channels.id = videos.channel_id
      WHERE videos.id != ?
      ORDER BY videos.outlier_score DESC
      LIMIT 250
    `)
    .all(videoId) as Array<Record<string, unknown>>;

  const candidateIds = candidates.map((candidate) => String(candidate.videoId));
  const imageScores = await thumbnailService.getThumbnailSimilarity(videoId, candidateIds);

  return {
    mode: imageScores ? "perceptual-hash" : "heuristic",
    items: candidates
      .map((candidate) => ({
        ...candidate,
        similarity:
          imageScores?.get(String(candidate.videoId)) ??
          (similarityScore(seed.title, String(candidate.title)) +
            (seed.content_type === candidate.contentType ? 0.25 : 0)),
      }))
      .filter((candidate) => candidate.similarity > 0.1)
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, limit),
  };
}

export function getNiches(days: number, limit = 25) {
  const rows = db
    .prepare(`
      SELECT videos.title, videos.outlier_score, channels.name AS channelName
      FROM videos
      INNER JOIN channels ON channels.id = videos.channel_id
      WHERE videos.published_at >= ?
      ORDER BY videos.outlier_score DESC
      LIMIT 500
    `)
    .all(new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()) as Array<{
    title: string;
    outlier_score: number;
    channelName: string;
  }>;

  const topicMap = new Map<string, { count: number; avgScore: number; channels: Set<string> }>();
  for (const row of rows) {
    const tokenized = row.title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 3);
    for (const token of tokenized) {
      const current = topicMap.get(token) ?? { count: 0, avgScore: 0, channels: new Set<string>() };
      current.count += 1;
      current.avgScore += row.outlier_score;
      current.channels.add(row.channelName);
      topicMap.set(token, current);
    }
  }

  return [...topicMap.entries()]
    .filter(([, value]) => value.count >= 2)
    .map(([topic, value]) => ({
      topic,
      count: value.count,
      averageOutlierScore: Number((value.avgScore / value.count).toFixed(2)),
      channelCount: value.channels.size,
      opportunity: value.count * (value.avgScore / value.count),
    }))
    .sort((left, right) => right.opportunity - left.opportunity)
    .slice(0, limit);
}

export function getChannelPatterns(channelId: string) {
  const rows = db
    .prepare("SELECT title FROM videos WHERE channel_id = ? ORDER BY outlier_score DESC LIMIT 40")
    .all(channelId) as Array<{ title: string }>;

  const formatMap = new Map<string, number>();
  for (const row of rows) {
    const format = titleFormat(row.title);
    formatMap.set(format, (formatMap.get(format) ?? 0) + 1);
  }

  return [...formatMap.entries()]
    .map(([format, count]) => ({ format, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);
}

export function getRelatedChannels(channelId: string) {
  const rows = db
    .prepare(`
      SELECT id, title
      FROM videos
      WHERE channel_id = ?
      ORDER BY outlier_score DESC
      LIMIT 20
    `)
    .all(channelId) as Array<{ id: string; title: string }>;

  const otherChannels = db
    .prepare(`
      SELECT DISTINCT channels.id, channels.name, channels.handle, channels.subscriber_count AS subscriberCount
      FROM channels
      WHERE channels.id != ?
      ORDER BY channels.subscriber_count DESC
      LIMIT 50
    `)
    .all(channelId) as Array<{ id: string; name: string; handle: string | null; subscriberCount: number }>;

  return otherChannels
    .map((channel) => {
      const candidateTitles = db
        .prepare("SELECT title FROM videos WHERE channel_id = ? ORDER BY outlier_score DESC LIMIT 20")
        .all(channel.id) as Array<{ title: string }>;
      const similarity = candidateTitles.reduce((best, item) => {
        for (const source of rows) {
          best = Math.max(best, similarityScore(source.title, item.title));
        }
        return best;
      }, 0);
      return { ...channel, similarity };
    })
    .filter((channel) => channel.similarity > 0.08)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, 8);
}

export function normalizeScannedVideo(row: {
  title: string;
  duration: string | null;
  views: number;
  viewVelocity: number;
  outlierScore: number;
  channelSubscribers: number;
  channelMedianViews: number;
}) {
  const durationSeconds = parseDurationToSeconds(row.duration);
  return {
    durationSeconds,
    momentumScore: computeMomentumScore(
      row.outlierScore,
      row.viewVelocity,
      row.channelSubscribers,
      row.channelMedianViews,
    ),
  };
}
