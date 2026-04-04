import fs from "node:fs/promises";
import path from "node:path";
import imghash from "imghash";
import { config } from "../config.js";
import { db, getSetting, upsertSetting } from "../db.js";

type GeneratedImage = {
  mimeType: string;
  buffer: Buffer;
};

type CharacterProfile = {
  id: number;
  name: string;
  description: string | null;
  face_sheet_media_path: string | null;
};

type ThumbnailGenerationRecord = {
  id: number;
  project_id?: number | null;
  status: string;
  prompt: string;
  source_video_ids_json: string;
  prompt_context: string | null;
  provider: string;
  model: string | null;
  size: string;
  variant_count: number;
  result_urls_json: string;
  download_urls_json: string;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
};

type KieTaskResponse = {
  code?: number;
  msg?: string;
  data?: {
    taskId?: string;
    state?: string;
    resultJson?: string;
    failMsg?: string;
    failCode?: string;
  };
};

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function fileExtensionFromMime(mimeType: string): string {
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return ".jpg";
  return ".bin";
}

function toPublicMediaUrl(relativePath: string): string {
  return `/api/media/${relativePath.replace(/\\/g, "/")}`;
}

function hammingDistance(left: string, right: string): number {
  const leftBinary = BigInt(`0x${left}`).toString(2).padStart(left.length * 4, "0");
  const rightBinary = BigInt(`0x${right}`).toString(2).padStart(right.length * 4, "0");
  let distance = 0;
  for (let index = 0; index < Math.min(leftBinary.length, rightBinary.length); index += 1) {
    if (leftBinary[index] !== rightBinary[index]) {
      distance += 1;
    }
  }
  return distance;
}

export class GoogleImageService {
  private getApiKey(): string | null {
    return getSetting("kie_api_key") ?? getSetting("google_image_api_key") ?? config.kieApiKey ?? null;
  }

  private getModel(): string {
    return getSetting("kie_image_model") ?? getSetting("google_image_model") ?? config.kieImageModel;
  }

  private getHeaders(): Record<string, string> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error("Kie image API key is not configured.");
    }

    return {
      Authorization: `Bearer ${apiKey}`,
    };
  }

  async saveImage(relativePath: string, buffer: Buffer): Promise<string> {
    const absolutePath = path.join(config.mediaRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, buffer);
    return absolutePath;
  }

  getAbsoluteMediaPath(relativePath: string): string {
    return path.join(config.mediaRoot, relativePath);
  }

  private async uploadReferenceImage(image: { mimeType: string; buffer: Buffer }): Promise<string> {
    const response = await fetch("https://kieai.redpandaai.co/api/file-base64-upload", {
      method: "POST",
      headers: {
        ...this.getHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        base64Data: `data:${image.mimeType};base64,${image.buffer.toString("base64")}`,
        uploadPath: "openoutlier-references",
      }),
    });

    const json = (await response.json()) as {
      success?: boolean;
      code?: number;
      msg?: string;
      data?: string | { url?: string; fileUrl?: string; downloadUrl?: string };
    };

    if (!response.ok || json.code !== 200) {
      throw new Error(json.msg ?? "Kie reference image upload failed.");
    }

    if (typeof json.data === "string") {
      return json.data;
    }
    const url = json.data?.fileUrl ?? json.data?.url ?? json.data?.downloadUrl;
    if (!url) {
      throw new Error("Kie reference image upload returned no URL.");
    }

    return url;
  }

  private async waitForTask(taskId: string): Promise<string[]> {
    const timeoutAt = Date.now() + 10 * 60 * 1000;
    let delay = 2000;

    while (Date.now() < timeoutAt) {
      const response = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
        headers: this.getHeaders(),
      });
      const json = (await response.json()) as KieTaskResponse;

      if (!response.ok || json.code !== 200) {
        throw new Error(json.msg ?? "Failed to fetch Kie task status.");
      }

      const state = json.data?.state ?? "waiting";
      if (state === "success") {
        const parsed = parseJson<{ resultUrls?: string[]; data?: string[] }>(json.data?.resultJson, {});
        const resultUrls = parsed.resultUrls ?? parsed.data ?? [];
        if (resultUrls.length === 0) {
          throw new Error("Kie task completed without result URLs.");
        }
        return resultUrls;
      }

      if (state === "fail") {
        throw new Error(json.data?.failMsg ?? json.data?.failCode ?? "Kie image generation failed.");
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay + 1000, 8000);
    }

    throw new Error("Kie image generation timed out.");
  }

  private async getDownloadUrl(url: string): Promise<string> {
    const response = await fetch("https://api.kie.ai/api/v1/common/download-url", {
      method: "POST",
      headers: {
        ...this.getHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    });
    const json = (await response.json()) as {
      code?: number;
      msg?: string;
      data?: string;
    };

    if (!response.ok || json.code !== 200 || !json.data) {
      throw new Error(json.msg ?? "Failed to create Kie download URL.");
    }

    return json.data;
  }

  async generateImages(
    prompt: string,
    inlineImages: Array<{ mimeType: string; buffer: Buffer }>,
    options?: { aspectRatio?: "16:9" | "3:2" | "1:1" | "2:3"; imageSize?: "1K" | "2K" },
  ): Promise<GeneratedImage[]> {
    const fileUrls = await Promise.all(inlineImages.map((image) => this.uploadReferenceImage(image)));

    const response = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
      method: "POST",
      headers: {
        ...this.getHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.getModel(),
        input: {
          prompt,
          image_input: fileUrls,
          aspect_ratio: options?.aspectRatio ?? "16:9",
          resolution: options?.imageSize ?? "2K",
          output_format: "jpg",
          google_search: false,
        },
      }),
    });

    const json = (await response.json()) as KieTaskResponse;

    if (!response.ok || json.code !== 200 || !json.data?.taskId) {
      throw new Error(json.msg ?? "Kie image generation failed.");
    }

    const resultUrls = await this.waitForTask(json.data.taskId);
    const generated: GeneratedImage[] = [];

    for (const resultUrl of resultUrls) {
      const downloadUrl = await this.getDownloadUrl(resultUrl);
      const imageResponse = await fetch(downloadUrl);
      if (!imageResponse.ok) {
        throw new Error("Failed to download Kie-generated image.");
      }

      generated.push({
        mimeType: imageResponse.headers.get("content-type") ?? "image/png",
        buffer: Buffer.from(await imageResponse.arrayBuffer()),
      });
    }

    if (generated.length === 0) {
      throw new Error("Kie image generation returned no image.");
    }

    return generated;
  }

  async createCharacterProfile(input: {
    name: string;
    description?: string | null;
    images: Array<{ buffer: Buffer; mimeType: string; angleLabel?: string | null }>;
  }) {
    const insert = db.prepare("INSERT INTO character_profiles (name, description) VALUES (?, ?)").run(input.name, input.description ?? null);
    const profileId = Number(insert.lastInsertRowid);

    for (let index = 0; index < input.images.length; index += 1) {
      const image = input.images[index];
      const extension = fileExtensionFromMime(image.mimeType);
      const relativePath = path.join("profiles", String(profileId), "sources", `${index + 1}${extension}`);
      await this.saveImage(relativePath, image.buffer);
      db.prepare(`
        INSERT INTO character_profile_images (profile_id, angle_label, media_path, mime_type)
        VALUES (?, ?, ?, ?)
      `).run(profileId, image.angleLabel ?? null, relativePath, image.mimeType);
    }

    const generation = await this.generateFaceSheet(profileId);
    return generation;
  }

  async generateFaceSheet(profileId: number) {
    const profile = db.prepare("SELECT * FROM character_profiles WHERE id = ?").get(profileId) as CharacterProfile | undefined;
    if (!profile) {
      throw new Error("Character profile not found.");
    }

    const images = db
      .prepare("SELECT angle_label, media_path, mime_type FROM character_profile_images WHERE profile_id = ? ORDER BY id ASC")
      .all(profileId) as Array<{ angle_label: string | null; media_path: string; mime_type: string }>;

    if (images.length === 0) {
      throw new Error("Upload at least one source face image first.");
    }

    const inlineImages = await Promise.all(
      images.map(async (image) => ({
        mimeType: image.mime_type,
        buffer: await fs.readFile(this.getAbsoluteMediaPath(image.media_path)),
      })),
    );

    const prompt = [
      "Use every attached image as identity reference for the same person.",
      "Create one high-resolution photorealistic studio face reference sheet for consistent thumbnail generation.",
      "Preserve exact facial identity, skin tone, hairline, eye color, nose shape, jawline, and age.",
      "Neutral expression, soft gray background, even beauty lighting, sharp focus, realistic skin texture.",
      "Show front, left three-quarter, right three-quarter, left profile, right profile, and one subtle expressive portrait in one clean sheet.",
      "No stylization, no text, no dramatic makeup, no identity drift, and no extra accessories unless present in most references.",
    ].join(" ");

    const [generated] = await this.generateImages(prompt, inlineImages, { aspectRatio: "3:2", imageSize: "2K" });
    const relativePath = path.join("profiles", String(profileId), `face-sheet${fileExtensionFromMime(generated.mimeType)}`);
    await this.saveImage(relativePath, generated.buffer);

    db.prepare(`
      UPDATE character_profiles
      SET face_sheet_media_path = ?, face_sheet_prompt = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(relativePath, prompt, profileId);

    return this.getCharacterProfile(profileId);
  }

  async generateThumbnail(params: {
    projectId?: number | null;
    prompt: string;
    sourceVideoIds: string[];
    promptContext?: string;
    characterProfileId?: number | null;
    size?: "16:9" | "3:2" | "1:1" | "2:3";
  }) {
    const profile = params.characterProfileId
      ? (db.prepare("SELECT * FROM character_profiles WHERE id = ?").get(params.characterProfileId) as CharacterProfile | undefined)
      : undefined;

    const insert = db.prepare(`
      INSERT INTO thumbnail_generations (project_id, character_profile_id, status, prompt, source_video_ids_json, prompt_context, provider, model, size, variant_count)
      VALUES (?, ?, 'running', ?, ?, ?, 'kie-nano-banana-2', ?, ?, 1)
    `).run(
      params.projectId ?? null,
      params.characterProfileId ?? null,
      params.prompt,
      JSON.stringify(params.sourceVideoIds),
      params.promptContext ?? null,
      this.getModel(),
      params.size ?? "16:9",
    );
    const generationId = Number(insert.lastInsertRowid);

    try {
      const referenceImages: Array<{ mimeType: string; buffer: Buffer }> = [];

      if (profile?.face_sheet_media_path) {
        referenceImages.push({
          mimeType: profile.face_sheet_media_path.endsWith(".png") ? "image/png" : "image/jpeg",
          buffer: await fs.readFile(this.getAbsoluteMediaPath(profile.face_sheet_media_path)),
        });
      }

      const sourceRows = db
        .prepare(`SELECT thumbnail_url FROM videos WHERE id IN (${params.sourceVideoIds.map(() => "?").join(", ")})`)
        .all(...params.sourceVideoIds) as Array<{ thumbnail_url: string | null }>;

      for (const row of sourceRows.slice(0, 2)) {
        if (!row.thumbnail_url) continue;
        try {
          const response = await fetch(row.thumbnail_url);
          const buffer = Buffer.from(await response.arrayBuffer());
          referenceImages.push({ mimeType: "image/jpeg", buffer });
        } catch {
          // Keep going with other references.
        }
      }

      const prompt = [
        params.prompt,
        params.promptContext ?? null,
        profile
          ? `Use the attached face sheet as the identity anchor for ${profile.name}. Keep the face highly consistent with the reference sheet.`
          : null,
        "Design a photorealistic high-CTR YouTube thumbnail with strong lighting, clear focal hierarchy, premium contrast, and native YouTube packaging.",
        "Keep the composition legible at small sizes and avoid generic stock-photo framing.",
      ]
        .filter(Boolean)
        .join(" ");

      const [generated] = await this.generateImages(prompt, referenceImages, {
        aspectRatio: params.size ?? "16:9",
        imageSize: "2K",
      });

      const relativePath = path.join("generated-thumbnails", `${generationId}${fileExtensionFromMime(generated.mimeType)}`);
      await this.saveImage(relativePath, generated.buffer);

      db.prepare(`
        UPDATE thumbnail_generations
        SET status = 'completed',
          result_urls_json = ?,
          download_urls_json = ?,
          completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(JSON.stringify([toPublicMediaUrl(relativePath)]), JSON.stringify([toPublicMediaUrl(relativePath)]), generationId);
    } catch (error) {
      db.prepare(`
        UPDATE thumbnail_generations
        SET status = 'failed',
          error_message = ?,
          completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(error instanceof Error ? error.message : "Kie image generation failed.", generationId);
      throw error;
    }

    return this.getGeneration(generationId);
  }

  async ensureThumbnailHashes(videoIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(videoIds)];
    const placeholders = uniqueIds.map(() => "?").join(", ");
    const existing = db
      .prepare(`SELECT video_id FROM video_thumbnail_features WHERE video_id IN (${placeholders})`)
      .all(...uniqueIds) as Array<{ video_id: string }>;
    const existingIds = new Set(existing.map((row) => row.video_id));

    const missing = db
      .prepare(`SELECT id, thumbnail_url FROM videos WHERE id IN (${placeholders})`)
      .all(...uniqueIds)
      .filter((row) => !existingIds.has((row as { id: string }).id)) as Array<{ id: string; thumbnail_url: string | null }>;

    for (const item of missing) {
      if (!item.thumbnail_url) continue;
      try {
        const response = await fetch(item.thumbnail_url);
        const hash = await imghash.hash(Buffer.from(await response.arrayBuffer()), 16, "hex");
        db.prepare(`
          INSERT INTO video_thumbnail_features (video_id, algorithm, perceptual_hash, updated_at)
          VALUES (?, 'imghash', ?, CURRENT_TIMESTAMP)
          ON CONFLICT(video_id) DO UPDATE SET perceptual_hash = excluded.perceptual_hash, updated_at = CURRENT_TIMESTAMP
        `).run(item.id, hash);
      } catch {
        // Fallback handled elsewhere.
      }
    }
  }

  async getThumbnailSimilarity(seedVideoId: string, candidateIds: string[]): Promise<Map<string, number> | null> {
    await this.ensureThumbnailHashes([seedVideoId, ...candidateIds]);
    const placeholders = [seedVideoId, ...candidateIds].map(() => "?").join(", ");
    const rows = db
      .prepare(`SELECT video_id, perceptual_hash FROM video_thumbnail_features WHERE video_id IN (${placeholders})`)
      .all(seedVideoId, ...candidateIds) as Array<{ video_id: string; perceptual_hash: string }>;

    const map = new Map(rows.map((row) => [row.video_id, row.perceptual_hash]));
    const seed = map.get(seedVideoId);
    if (!seed) return null;

    const scores = new Map<string, number>();
    for (const candidateId of candidateIds) {
      const value = map.get(candidateId);
      if (!value) continue;
      const distance = hammingDistance(seed, value);
      const maxBits = Math.max(seed.length, value.length) * 4;
      scores.set(candidateId, 1 - distance / maxBits);
    }
    return scores;
  }

  listGenerations(projectId?: number): Array<Record<string, unknown>> {
    const rows = projectId
      ? db.prepare("SELECT * FROM thumbnail_generations WHERE project_id = ? ORDER BY created_at DESC LIMIT 100").all(projectId) as ThumbnailGenerationRecord[]
      : db.prepare("SELECT * FROM thumbnail_generations ORDER BY created_at DESC LIMIT 100").all() as ThumbnailGenerationRecord[];
    return rows.map((row) => ({
      ...row,
      projectId: row.project_id ?? null,
      sourceVideoIds: parseJson(row.source_video_ids_json, [] as string[]),
      resultUrls: parseJson(row.result_urls_json, [] as string[]),
      downloadUrls: parseJson(row.download_urls_json, [] as string[]),
    }));
  }

  getGeneration(id: number): ThumbnailGenerationRecord {
    const row = db.prepare("SELECT * FROM thumbnail_generations WHERE id = ?").get(id) as ThumbnailGenerationRecord | undefined;
    if (!row) {
      throw new Error("Thumbnail generation not found.");
    }
    return row;
  }

  listCharacterProfiles() {
    const rows = db.prepare("SELECT * FROM character_profiles ORDER BY updated_at DESC, created_at DESC").all() as Array<Record<string, unknown>>;
    const defaultProfileId = Number(getSetting("default_character_profile_id") ?? 0);
    return rows.map((row) => ({
      ...row,
      isDefault: Number(row.id) === defaultProfileId,
      faceSheetUrl: row.face_sheet_media_path ? toPublicMediaUrl(String(row.face_sheet_media_path)) : null,
    }));
  }

  getCharacterProfile(profileId: number) {
    const profile = db.prepare("SELECT * FROM character_profiles WHERE id = ?").get(profileId) as Record<string, unknown> | undefined;
    if (!profile) {
      throw new Error("Character profile not found.");
    }

    const sourceImages = db
      .prepare("SELECT id, angle_label AS angleLabel, media_path AS mediaPath, mime_type AS mimeType FROM character_profile_images WHERE profile_id = ? ORDER BY id ASC")
      .all(profileId) as Array<Record<string, unknown>>;

    const defaultProfileId = Number(getSetting("default_character_profile_id") ?? 0);
    return {
      ...profile,
      isDefault: Number(profile.id) === defaultProfileId,
      faceSheetUrl: profile.face_sheet_media_path ? toPublicMediaUrl(String(profile.face_sheet_media_path)) : null,
      sourceImages: sourceImages.map((image) => ({
        ...image,
        url: toPublicMediaUrl(String(image.mediaPath)),
      })),
    };
  }

  setDefaultCharacterProfile(profileId: number) {
    upsertSetting("default_character_profile_id", String(profileId));
  }
}

export function publicMediaUrl(relativePath: string): string {
  return toPublicMediaUrl(relativePath);
}
