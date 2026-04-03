import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db, getSetting } from "../db.js";
import { tokenizeTitle } from "../utils.js";

function analyzeTitleTokens(titles: string[]): Array<{ topic: string; count: number }> {
  const counts = new Map<string, number>();

  for (const title of titles) {
    for (const token of tokenizeTitle(title)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 20);
}

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/agent/top-outliers", async (request) => {
    const query = z
      .object({
        niche: z.string().optional(),
        days: z.coerce.number().int().min(1).default(30),
        limit: z.coerce.number().int().min(1).max(100).default(10),
      })
      .parse(request.query);

    const publishedAfter = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000).toISOString();
    const threshold = Number(getSetting("default_outlier_threshold") ?? 3);
    const nicheClause = query.niche ? "AND videos.title LIKE @niche" : "";

    return db
      .prepare(`
        SELECT
          videos.title,
          channels.name AS channel,
          videos.outlier_score AS outlierScore,
          videos.views,
          'https://youtube.com/watch?v=' || videos.id AS url
        FROM videos
        INNER JOIN channels ON channels.id = videos.channel_id
        WHERE videos.published_at >= @publishedAfter
          AND videos.outlier_score >= @threshold
          ${nicheClause}
        ORDER BY videos.outlier_score DESC
        LIMIT @limit
      `)
      .all({
        publishedAfter,
        threshold,
        niche: `%${query.niche ?? ""}%`,
        limit: query.limit,
      });
  });

  app.get("/api/agent/channel-analysis/:channelId", async (request) => {
    const channelId = (request.params as { channelId: string }).channelId;
    const channel = db.prepare("SELECT * FROM channels WHERE id = ?").get(channelId) as Record<string, unknown> | undefined;
    if (!channel) {
      throw app.httpErrors.notFound("Channel not found.");
    }

    const topOutliers = db
      .prepare(`
        SELECT id AS videoId, title, views, outlier_score AS outlierScore, published_at AS publishedAt
        FROM videos
        WHERE channel_id = ?
        ORDER BY outlier_score DESC
        LIMIT 5
      `)
      .all(channelId);

    const trend = db
      .prepare(`
        SELECT
          AVG(CASE WHEN published_at >= datetime('now', '-30 day') THEN views END) AS avgRecentViews,
          AVG(CASE WHEN published_at < datetime('now', '-30 day') THEN views END) AS avgOlderViews,
          COUNT(CASE WHEN published_at >= datetime('now', '-30 day') THEN 1 END) AS recentVideoCount
        FROM videos
        WHERE channel_id = ?
      `)
      .get(channelId) as {
      avgRecentViews: number | null;
      avgOlderViews: number | null;
      recentVideoCount: number;
    };

    const titles = db
      .prepare("SELECT title FROM videos WHERE channel_id = ? ORDER BY outlier_score DESC LIMIT 20")
      .all(channelId) as Array<{ title: string }>;

    return {
      channel: {
        id: channel.id,
        name: channel.name,
        handle: channel.handle,
        subscriberCount: channel.subscriber_count,
        medianViews: channel.median_views,
        lastScannedAt: channel.last_scanned_at,
      },
      topOutliers,
      recentPerformanceTrend: {
        recentAverageViews: Math.round(trend.avgRecentViews ?? 0),
        olderAverageViews: Math.round(trend.avgOlderViews ?? 0),
        direction:
          (trend.avgRecentViews ?? 0) >= (trend.avgOlderViews ?? 0)
            ? "up"
            : "down",
        recentVideoCount: trend.recentVideoCount,
      },
      contentPatterns: analyzeTitleTokens(titles.map((item) => item.title)).slice(0, 10),
    };
  });

  app.get("/api/agent/trending-topics", async (request) => {
    const query = z
      .object({
        days: z.coerce.number().int().min(1).default(30),
      })
      .parse(request.query);

    const rows = db
      .prepare("SELECT title FROM videos WHERE published_at >= ? ORDER BY outlier_score DESC LIMIT 500")
      .all(new Date(Date.now() - query.days * 24 * 60 * 60 * 1000).toISOString()) as Array<{ title: string }>;

    return {
      days: query.days,
      topics: analyzeTitleTokens(rows.map((row) => row.title)),
    };
  });

  app.get("/api/agent/suggest-topics", async (request, reply) => {
    const query = z
      .object({
        based_on: z.string(),
      })
      .parse(request.query);

    const channel = db.prepare("SELECT id, name FROM channels WHERE id = ?").get(query.based_on);
    if (!channel) {
      return reply.notFound("Channel not found.");
    }

    const rows = db
      .prepare(`
        SELECT title
        FROM videos
        WHERE channel_id = ?
        ORDER BY outlier_score DESC, views DESC
        LIMIT 25
      `)
      .all(query.based_on) as Array<{ title: string }>;

    return {
      basedOnChannelId: query.based_on,
      suggestedTopics: analyzeTitleTokens(rows.map((row) => row.title)).slice(0, 12),
    };
  });
}
