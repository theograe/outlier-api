import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { LlmProviderConfig, PromptSourceVideo } from "@openoutlier/core";
import { config } from "../config.js";
import { db } from "../db.js";
import { AiService } from "../services/ai-service.js";
import { GoogleImageService } from "../services/google-image-service.js";

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function loadSourceVideos(videoIds: string[]): PromptSourceVideo[] {
  if (videoIds.length === 0) {
    return [];
  }

  const placeholders = videoIds.map(() => "?").join(", ");
  return db
    .prepare(`
      SELECT
        videos.id AS videoId,
        videos.title,
        channels.name AS channelName,
        videos.views,
        videos.outlier_score AS outlierScore,
        videos.view_velocity AS viewVelocity,
        videos.published_at AS publishedAt,
        COALESCE(json_group_array(DISTINCT lists.name) FILTER (WHERE lists.name IS NOT NULL), '[]') AS lists
      FROM videos
      INNER JOIN channels ON channels.id = videos.channel_id
      LEFT JOIN list_channels ON list_channels.channel_id = channels.id
      LEFT JOIN lists ON lists.id = list_channels.list_id
      WHERE videos.id IN (${placeholders})
      GROUP BY videos.id
    `)
    .all(...videoIds)
    .map((row: unknown) => ({
      ...(row as Omit<PromptSourceVideo, "lists"> & { lists: string }),
      lists: parseJson((row as { lists: string }).lists, [] as string[]),
    }));
}

function getActiveProvider(providerId?: number): LlmProviderConfig | null {
  if (providerId) {
    return (db.prepare("SELECT * FROM llm_providers WHERE id = ?").get(providerId) as LlmProviderConfig | undefined) ?? null;
  }

  const activeProvider = (db.prepare("SELECT * FROM llm_providers WHERE is_active = 1 ORDER BY id DESC LIMIT 1").get() as LlmProviderConfig | undefined) ?? null;
  if (activeProvider) {
    return activeProvider;
  }

  if (config.openAiApiKey) {
    return {
      id: 0,
      name: "OpenAI env",
      provider: "openai",
      mode: "api_key",
      apiKey: config.openAiApiKey,
      oauthConfigJson: null,
      model: config.defaultLlmModel,
      isActive: 1,
    } as LlmProviderConfig;
  }

  return null;
}

export async function registerResearchRoutes(app: FastifyInstance): Promise<void> {
  const ai = new AiService();
  const imageService = new GoogleImageService();

  app.post("/api/character-profiles", async (request, reply) => {
    const isMultipart = typeof (request as { isMultipart?: () => boolean }).isMultipart === "function"
      ? (request as { isMultipart: () => boolean }).isMultipart()
      : false;

    if (!isMultipart) {
      return reply.badRequest("Send character profiles as multipart/form-data.");
    }

    const parts = request.parts();
    const images: Array<{ buffer: Buffer; mimeType: string; angleLabel?: string | null }> = [];
    let name = "";
    let description: string | null = null;

    for await (const part of parts) {
      if (part.type === "file") {
        images.push({
          buffer: await part.toBuffer(),
          mimeType: part.mimetype,
          angleLabel: part.fieldname,
        });
      } else if (part.fieldname === "name") {
        name = String(part.value);
      } else if (part.fieldname === "description") {
        description = String(part.value);
      }
    }

    if (!name.trim()) {
      return reply.badRequest("Character profile name is required.");
    }
    if (images.length === 0) {
      return reply.badRequest("Upload at least one face image.");
    }

    const profile = await imageService.createCharacterProfile({ name, description, images });
    reply.code(201);
    return profile;
  });

  app.get("/api/saved-outliers", async () => {
    const rows = db
      .prepare(`
        SELECT
          saved_outliers.id,
          saved_outliers.video_id AS videoId,
          saved_outliers.notes,
          saved_outliers.tags_json AS tagsJson,
          saved_outliers.created_at AS createdAt,
          videos.title,
          videos.thumbnail_url AS thumbnailUrl,
          videos.outlier_score AS outlierScore,
          channels.name AS channelName
        FROM saved_outliers
        INNER JOIN videos ON videos.id = saved_outliers.video_id
        INNER JOIN channels ON channels.id = videos.channel_id
        ORDER BY saved_outliers.created_at DESC
      `)
      .all() as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      ...row,
      tags: parseJson(String(row.tagsJson), [] as string[]),
    }));
  });

  app.post("/api/saved-outliers", async (request, reply) => {
    const body = z.object({
      videoId: z.string(),
      notes: z.string().optional().nullable(),
      tags: z.array(z.string()).default([]),
      listId: z.number().int().optional().nullable(),
    }).parse(request.body);

    const result = db
      .prepare(`
        INSERT INTO saved_outliers (video_id, notes, tags_json, list_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(workspace_id, video_id) DO UPDATE SET
          notes = excluded.notes,
          tags_json = excluded.tags_json,
          list_id = excluded.list_id
      `)
      .run(body.videoId, body.notes ?? null, JSON.stringify(body.tags), body.listId ?? null);

    reply.code(201);
    return { id: Number(result.lastInsertRowid), ...body };
  });

  app.get("/api/boards", async (request) => {
    const query = z.object({ projectId: z.coerce.number().int().optional() }).parse(request.query ?? {});
    const boards = db
      .prepare(`
        SELECT boards.*, COUNT(board_items.id) AS itemCount
        FROM boards
        LEFT JOIN board_items ON board_items.board_id = boards.id
        ${query.projectId ? "WHERE boards.project_id = ?" : ""}
        GROUP BY boards.id
        ORDER BY boards.created_at DESC
      `)
      .all(...(query.projectId ? [query.projectId] : []));
    return boards;
  });

  app.get("/api/boards/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const board = db.prepare("SELECT * FROM boards WHERE id = ?").get(id);
    if (!board) {
      return reply.notFound("Board not found.");
    }

    const items = db
      .prepare(`
        SELECT
          board_items.id,
          board_items.note,
          videos.id AS videoId,
          videos.title,
          videos.thumbnail_url AS thumbnailUrl,
          videos.outlier_score AS outlierScore,
          channels.name AS channelName
        FROM board_items
        LEFT JOIN videos ON videos.id = board_items.video_id
        LEFT JOIN channels ON channels.id = videos.channel_id
        WHERE board_items.board_id = ?
        ORDER BY board_items.created_at DESC
      `)
      .all(id);

    return { ...board, items };
  });

  app.post("/api/boards", async (request, reply) => {
    const body = z.object({
      projectId: z.number().int().optional().nullable(),
      name: z.string().min(1),
      description: z.string().optional().nullable(),
    }).parse(request.body);
    const result = db.prepare("INSERT INTO boards (project_id, name, description) VALUES (?, ?, ?)").run(body.projectId ?? null, body.name, body.description ?? null);
    reply.code(201);
    return { id: Number(result.lastInsertRowid), ...body };
  });

  app.post("/api/boards/:id/items", async (request, reply) => {
    const boardId = Number((request.params as { id: string }).id);
    const body = z.object({ videoId: z.string(), note: z.string().optional().nullable() }).parse(request.body);
    const result = db.prepare("INSERT INTO board_items (board_id, video_id, note) VALUES (?, ?, ?)").run(boardId, body.videoId, body.note ?? null);
    reply.code(201);
    return { id: Number(result.lastInsertRowid), ...body };
  });

  app.get("/api/ideas", async (request) => {
    const query = z.object({ projectId: z.coerce.number().int().optional() }).parse(request.query ?? {});
    const rows = db
      .prepare(query.projectId
        ? "SELECT * FROM concept_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 100"
        : "SELECT * FROM concept_runs ORDER BY created_at DESC LIMIT 100")
      .all(...(query.projectId ? [query.projectId] : [])) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...row,
      sourceReferenceIds: parseJson(String(row.source_reference_ids_json), [] as number[]),
      sourceVideoIds: parseJson(String(row.source_video_ids_json), [] as string[]),
      result: parseJson(String(row.result_json), {}),
    }));
  });

  app.post("/api/ideas/generate", async (request, reply) => {
    const body = z.object({
      sourceVideoIds: z.array(z.string()).min(1),
      context: z.string().optional(),
      providerId: z.number().int().optional(),
      title: z.string().optional(),
    }).parse(request.body);
    const provider = getActiveProvider(body.providerId);
    const videos = loadSourceVideos(body.sourceVideoIds);
    const result = await ai.generate({ kind: "idea", provider, videos, context: body.context });
    const record = db.prepare(`
      INSERT INTO idea_runs (kind, title, prompt_context, provider_id, model, source_video_ids_json, result_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("idea", body.title ?? "Idea generation", body.context ?? null, body.providerId ?? null, result.model, JSON.stringify(body.sourceVideoIds), result.output);
    reply.code(201);
    return { id: Number(record.lastInsertRowid), ...result };
  });

  app.post("/api/titles/generate", async (request, reply) => {
    const body = z.object({
      sourceVideoIds: z.array(z.string()).min(1),
      context: z.string().optional(),
      providerId: z.number().int().optional(),
    }).parse(request.body);
    const provider = getActiveProvider(body.providerId);
    const videos = loadSourceVideos(body.sourceVideoIds);
    const result = await ai.generate({ kind: "title_set", provider, videos, context: body.context });
    const record = db.prepare(`
      INSERT INTO idea_runs (kind, title, prompt_context, provider_id, model, source_video_ids_json, result_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("title_set", "Title set", body.context ?? null, body.providerId ?? null, result.model, JSON.stringify(body.sourceVideoIds), result.output);
    reply.code(201);
    return { id: Number(record.lastInsertRowid), ...result };
  });

  app.post("/api/thumbnails/generate-brief", async (request, reply) => {
    const body = z.object({
      sourceVideoIds: z.array(z.string()).min(1),
      context: z.string().optional(),
      providerId: z.number().int().optional(),
    }).parse(request.body);
    const provider = getActiveProvider(body.providerId);
    const videos = loadSourceVideos(body.sourceVideoIds);
    const result = await ai.generate({ kind: "thumbnail_brief", provider, videos, context: body.context });
    const record = db.prepare(`
      INSERT INTO idea_runs (kind, title, prompt_context, provider_id, model, source_video_ids_json, result_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("thumbnail_brief", "Thumbnail brief", body.context ?? null, body.providerId ?? null, result.model, JSON.stringify(body.sourceVideoIds), result.output);
    reply.code(201);
    return { id: Number(record.lastInsertRowid), ...result };
  });

  app.get("/api/thumbnails/generations", async (request) => {
    const query = z.object({ projectId: z.coerce.number().int().optional() }).parse(request.query ?? {});
    return imageService.listGenerations(query.projectId);
  });

  app.get("/api/thumbnails/generations/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    try {
      const row = imageService.getGeneration(id);
      return {
        ...row,
        sourceVideoIds: parseJson(row.source_video_ids_json, [] as string[]),
        resultUrls: parseJson(row.result_urls_json, [] as string[]),
        downloadUrls: parseJson(row.download_urls_json, [] as string[]),
      };
    } catch {
      return reply.notFound("Thumbnail generation not found.");
    }
  });

  app.post("/api/thumbnails/generate", async (request, reply) => {
    const body = z.object({
      sourceVideoIds: z.array(z.string()).min(1),
      prompt: z.string().min(1),
      context: z.string().optional(),
      characterProfileId: z.number().int().optional().nullable(),
      size: z.enum(["16:9", "1:1", "3:2", "2:3"]).default("16:9"),
    }).parse(request.body);

    const defaultProfileRow = db.prepare("SELECT value FROM settings WHERE key = 'default_character_profile_id'").get() as
      | { value?: string }
      | undefined;
    const defaultProfileId = defaultProfileRow?.value ? Number(defaultProfileRow.value) : null;

    const generation = await imageService.generateThumbnail({
      projectId: null,
      prompt: body.prompt,
      sourceVideoIds: body.sourceVideoIds,
      promptContext: body.context,
      characterProfileId: body.characterProfileId ?? defaultProfileId,
      size: body.size,
    });

    reply.code(201);
    return {
      ...generation,
      sourceVideoIds: parseJson(generation.source_video_ids_json, [] as string[]),
      resultUrls: parseJson(generation.result_urls_json, [] as string[]),
      downloadUrls: parseJson(generation.download_urls_json, [] as string[]),
    };
  });

  app.get("/api/character-profiles", async () => imageService.listCharacterProfiles());

  app.get("/api/character-profiles/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    try {
      return imageService.getCharacterProfile(id);
    } catch {
      return reply.notFound("Character profile not found.");
    }
  });

  app.post("/api/character-profiles/:id/default", async (request) => {
    const id = Number((request.params as { id: string }).id);
    imageService.setDefaultCharacterProfile(id);
    return { defaultCharacterProfileId: id };
  });

  app.post("/api/character-profiles/:id/generate-face-sheet", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const profile = await imageService.generateFaceSheet(id);
    reply.code(201);
    return profile;
  });

  app.get("/api/alerts", async () => {
    return db.prepare("SELECT * FROM alerts ORDER BY created_at DESC").all();
  });

  app.post("/api/alerts", async (request, reply) => {
    const body = z.object({
      listId: z.number().int().optional(),
      channelId: z.string().optional(),
      type: z.enum(["new_outlier", "channel_upload", "trend_watch"]),
      minOutlierScore: z.number().optional(),
    }).parse(request.body);
    const result = db
      .prepare("INSERT INTO alerts (list_id, channel_id, type, min_outlier_score) VALUES (?, ?, ?, ?)")
      .run(body.listId ?? null, body.channelId ?? null, body.type, body.minOutlierScore ?? null);
    reply.code(201);
    return { id: Number(result.lastInsertRowid), ...body };
  });

  app.get("/api/notifications", async () => {
    const rows = db.prepare("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100").all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...row,
      metadata: parseJson(String(row.metadata_json), {}),
    }));
  });
}
