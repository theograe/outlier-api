import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { YoutubeClient } from "../services/youtube.js";

const listSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
});

const addChannelSchema = z.object({
  channelUrl: z.string().optional(),
  channelId: z.string().optional(),
  handle: z.string().optional(),
});

export async function registerListRoutes(app: FastifyInstance): Promise<void> {
  const youtube = new YoutubeClient();

  app.post("/api/lists", async (request, reply) => {
    const input = listSchema.parse(request.body);
    const result = db
      .prepare("INSERT INTO lists (name, description, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)")
      .run(input.name, input.description ?? null);

    reply.code(201);
    return { id: result.lastInsertRowid, ...input };
  });

  app.get("/api/lists", async () => {
    return db
      .prepare(`
        SELECT lists.id, lists.name, lists.description, lists.created_at, lists.updated_at, COUNT(list_channels.channel_id) AS channel_count
        FROM lists
        LEFT JOIN list_channels ON list_channels.list_id = lists.id
        GROUP BY lists.id
        ORDER BY lists.name
      `)
      .all();
  });

  app.get("/api/lists/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const list = db.prepare("SELECT * FROM lists WHERE id = ?").get(id);
    if (!list) {
      return reply.notFound("List not found.");
    }

    const channels = db
      .prepare(`
        SELECT channels.id, channels.name, channels.handle, channels.subscriber_count, channels.thumbnail_url, channels.median_views, channels.last_scanned_at
        FROM channels
        INNER JOIN list_channels ON list_channels.channel_id = channels.id
        WHERE list_channels.list_id = ?
        ORDER BY channels.name
      `)
      .all(id);

    return { ...list, channels };
  });

  app.put("/api/lists/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const input = listSchema.parse(request.body);
    const result = db
      .prepare("UPDATE lists SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(input.name, input.description ?? null, id);

    if (result.changes === 0) {
      return reply.notFound("List not found.");
    }

    return { id, ...input };
  });

  app.delete("/api/lists/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const result = db.prepare("DELETE FROM lists WHERE id = ?").run(id);

    if (result.changes === 0) {
      return reply.notFound("List not found.");
    }

    reply.code(204);
    return null;
  });

  app.post("/api/lists/:id/channels", async (request, reply) => {
    const listId = Number((request.params as { id: string }).id);
    const list = db.prepare("SELECT id FROM lists WHERE id = ?").get(listId);
    if (!list) {
      return reply.notFound("List not found.");
    }

    const input = addChannelSchema.parse(request.body);
    const channelInput = input.channelUrl ?? input.channelId ?? input.handle;
    if (!channelInput) {
      return reply.badRequest("Provide channelUrl, channelId, or handle.");
    }

    const channel = await youtube.resolveChannel(channelInput);

    db.prepare(`
      INSERT INTO channels (id, name, handle, subscriber_count, thumbnail_url, uploads_playlist_id)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        handle = excluded.handle,
        subscriber_count = excluded.subscriber_count,
        thumbnail_url = excluded.thumbnail_url,
        uploads_playlist_id = excluded.uploads_playlist_id
    `).run(
      channel.channelId,
      channel.channelName,
      channel.handle,
      channel.subscriberCount,
      channel.thumbnailUrl,
      channel.uploadsPlaylistId,
    );

    db.prepare(`
      INSERT INTO list_channels (list_id, channel_id)
      VALUES (?, ?)
      ON CONFLICT(list_id, channel_id) DO NOTHING
    `).run(listId, channel.channelId);

    reply.code(201);
    return channel;
  });

  app.delete("/api/lists/:id/channels/:channelId", async (request, reply) => {
    const { id, channelId } = request.params as { id: string; channelId: string };
    const result = db.prepare("DELETE FROM list_channels WHERE list_id = ? AND channel_id = ?").run(Number(id), channelId);

    if (result.changes === 0) {
      return reply.notFound("Channel not found on this list.");
    }

    reply.code(204);
    return null;
  });
}
