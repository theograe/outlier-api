import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("app auth and legacy list routes", () => {
  let tempDir: string;
  let databasePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openoutlier-app-test-"));
    databasePath = path.join(tempDir, "test.db");

    process.env.YOUTUBE_API_KEY = "test-youtube";
    process.env.API_KEY = "test-api-key";
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.DATABASE_PATH = databasePath;

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("Unexpected network request in app test.");
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("requires an API key for protected routes", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/lists",
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: "UnauthorizedError",
      });
    } finally {
      await app.close();
    }
  }, 15000);

  it("serves health without auth and protects settings", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();

    try {
      const health = await app.inject({
        method: "GET",
        url: "/api/health",
      });
      expect(health.statusCode).toBe(200);

      const blocked = await app.inject({
        method: "GET",
        url: "/api/settings",
      });

      expect(blocked.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  }, 15000);

  it("removes a channel from a list using the legacy compatibility route", async () => {
    const { buildApp } = await import("../src/app.js");
    const { db } = await import("../src/db.js");
    const app = buildApp();

    try {
      const createList = await app.inject({
        method: "POST",
        url: "/api/lists",
        headers: { "x-api-key": "test-api-key" },
        payload: {
          name: "Editors",
        },
      });

      expect(createList.statusCode).toBe(201);
      const list = createList.json();

      db.prepare(`
        INSERT INTO channels (id, name, handle, subscriber_count, thumbnail_url, uploads_playlist_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run("UC_edit_test_01", "Editing Test", "@editingtest", 1200, null, "UU_edit_test_01");
      db.prepare("INSERT INTO list_channels (list_id, channel_id) VALUES (?, ?)").run(list.id, "UC_edit_test_01");

      const remove = await app.inject({
        method: "DELETE",
        url: `/api/lists/${list.id}/channels/UC_edit_test_01`,
        headers: { "x-api-key": "test-api-key" },
      });

      expect(remove.statusCode).toBe(204);

      const row = db.prepare("SELECT 1 FROM list_channels WHERE list_id = ? AND channel_id = ?").get(list.id, "UC_edit_test_01");
      expect(row).toBeUndefined();
    } finally {
      await app.close();
    }
  }, 15000);
});
