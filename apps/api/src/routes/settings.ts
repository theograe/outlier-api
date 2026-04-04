import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { getSetting, upsertSetting } from "../db.js";
import type { ScanService } from "../services/scan-service.js";

export async function registerSettingsRoutes(app: FastifyInstance, scanService: ScanService): Promise<void> {
  app.get("/api/settings", async () => {
    return {
      productName: "OpenOutlier",
      scanSchedule: getSetting("scan_schedule") ?? config.scanSchedule,
      defaultOutlierThreshold: Number(getSetting("default_outlier_threshold") ?? config.defaultOutlierThreshold),
      embeddingsModel: getSetting("embeddings_model") ?? config.defaultEmbeddingsModel,
      youtubeApiKeyConfigured: Boolean(process.env.YOUTUBE_API_KEY),
      apiKeyConfigured: Boolean(process.env.API_KEY),
      openAiApiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
    };
  });

  app.put("/api/settings/scan-schedule", async (request) => {
    const schema = z.object({
      cron: z.string().min(1),
    });

    const body = schema.parse(request.body);
    scanService.updateSchedule(body.cron);
    return { scanSchedule: body.cron };
  });

  app.put("/api/settings", async (request) => {
    const schema = z.object({
      defaultOutlierThreshold: z.number().positive().optional(),
      embeddingsModel: z.string().min(1).optional(),
    });

    const body = schema.parse(request.body);
    if (body.defaultOutlierThreshold !== undefined) {
      upsertSetting("default_outlier_threshold", String(body.defaultOutlierThreshold));
    }
    if (body.embeddingsModel !== undefined) {
      upsertSetting("embeddings_model", body.embeddingsModel);
    }

    return {
      productName: "OpenOutlier",
      scanSchedule: getSetting("scan_schedule") ?? config.scanSchedule,
      defaultOutlierThreshold: Number(getSetting("default_outlier_threshold") ?? config.defaultOutlierThreshold),
      embeddingsModel: getSetting("embeddings_model") ?? config.defaultEmbeddingsModel,
      youtubeApiKeyConfigured: Boolean(process.env.YOUTUBE_API_KEY),
      apiKeyConfigured: Boolean(process.env.API_KEY),
      openAiApiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
    };
  });
}
