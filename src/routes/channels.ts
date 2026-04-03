import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db } from "../db.js";

export async function registerChannelRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/channels/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const channel = db
      .prepare(`
        SELECT channels.*,
          COUNT(videos.id) AS video_count,
          MAX(videos.outlier_score) AS top_outlier_score,
          AVG(videos.views) AS average_views
        FROM channels
        LEFT JOIN videos ON videos.channel_id = channels.id
        WHERE channels.id = ?
        GROUP BY channels.id
      `)
      .get(id);

    if (!channel) {
      return reply.notFound("Channel not found.");
    }

    const lists = db
      .prepare(`
        SELECT lists.id, lists.name
        FROM lists
        INNER JOIN list_channels ON list_channels.list_id = lists.id
        WHERE list_channels.channel_id = ?
        ORDER BY lists.name
      `)
      .all(id);

    return { ...channel, lists };
  });

  app.get("/api/channels/:id/videos", async (request, reply) => {
    const paramsSchema = z.object({
      sort: z.enum(["score", "views", "date", "velocity"]).default("score"),
      order: z.enum(["asc", "desc"]).default("desc"),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    });

    const id = (request.params as { id: string }).id;
    const query = paramsSchema.parse(request.query);
    const sortMap = {
      score: "videos.outlier_score",
      views: "videos.views",
      date: "videos.published_at",
      velocity: "videos.view_velocity",
    } as const;

    const channelExists = db.prepare("SELECT 1 FROM channels WHERE id = ?").get(id);
    if (!channelExists) {
      return reply.notFound("Channel not found.");
    }

    const totalRow = db.prepare("SELECT COUNT(*) AS total FROM videos WHERE channel_id = ?").get(id) as { total: number };
    const offset = (query.page - 1) * query.limit;

    const videos = db
      .prepare(`
        SELECT *
        FROM videos
        WHERE channel_id = ?
        ORDER BY ${sortMap[query.sort]} ${query.order.toUpperCase()}
        LIMIT ? OFFSET ?
      `)
      .all(id, query.limit, offset);

    return {
      total: totalRow.total,
      page: query.page,
      limit: query.limit,
      videos,
    };
  });
}
