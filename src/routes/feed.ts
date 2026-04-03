import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db, getSetting } from "../db.js";

export async function registerFeedRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/feed", async (request) => {
    const querySchema = z.object({
      listId: z.coerce.number().int().optional(),
      minScore: z.coerce.number().optional(),
      maxScore: z.coerce.number().optional(),
      days: z.coerce.number().int().min(1).default(365),
      sort: z.enum(["score", "views", "date", "velocity"]).default("score"),
      order: z.enum(["asc", "desc"]).default("desc"),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      channelId: z.string().optional(),
      search: z.string().optional(),
    });

    const query = querySchema.parse(request.query);
    const threshold = Number(getSetting("default_outlier_threshold") ?? 3);
    const minScore = query.minScore ?? threshold;
    const offset = (query.page - 1) * query.limit;
    const publishedAfter = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000).toISOString();
    const sortMap = {
      score: "videos.outlier_score",
      views: "videos.views",
      date: "videos.published_at",
      velocity: "videos.view_velocity",
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
      whereClauses.push("videos.title LIKE @search");
      params.search = `%${query.search}%`;
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
          videos.view_velocity AS viewVelocity,
          videos.engagement_ratio AS engagementRatio,
          videos.scanned_at AS scannedAt,
          COALESCE(json_group_array(DISTINCT lists.name) FILTER (WHERE lists.name IS NOT NULL), '[]') AS lists
        FROM videos
        INNER JOIN channels ON channels.id = videos.channel_id
        LEFT JOIN list_channels ON list_channels.channel_id = channels.id
        LEFT JOIN lists ON lists.id = list_channels.list_id
        WHERE ${whereSql}
        GROUP BY videos.id
        ORDER BY ${sortMap[query.sort]} ${query.order.toUpperCase()}
        LIMIT @limit OFFSET @offset
      `)
      .all({ ...params, limit: query.limit, offset }) as Array<Record<string, unknown>>;

    return {
      total: totalRow.total,
      page: query.page,
      limit: query.limit,
      videos: videos.map((video) => ({
        ...video,
        lists: JSON.parse(String(video.lists)),
      })),
    };
  });
}
