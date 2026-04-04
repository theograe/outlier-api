import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { getChannelPatterns, getRelatedChannels } from "../services/discovery.js";

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

    const projects = db
      .prepare(`
        SELECT projects.id, projects.name, project_channels.relationship
        FROM projects
        INNER JOIN project_channels ON project_channels.project_id = projects.id
        WHERE project_channels.channel_id = ?
        ORDER BY projects.name
      `)
      .all(id);

    const sourceSets = db
      .prepare(`
        SELECT source_sets.id, source_sets.name, source_sets.role, source_set_channels.relationship
        FROM source_sets
        INNER JOIN source_set_channels ON source_set_channels.source_set_id = source_sets.id
        WHERE source_set_channels.channel_id = ?
        ORDER BY source_sets.name
      `)
      .all(id);

    return {
      ...channel,
      projects,
      sourceSets,
      patternSummary: getChannelPatterns(id),
      relatedChannels: getRelatedChannels(id),
    };
  });

  app.get("/api/channels/:id/videos", async (request, reply) => {
    const paramsSchema = z.object({
      sort: z.enum(["score", "views", "date", "velocity", "momentum"]).default("score"),
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
      momentum: "videos.momentum_score",
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
