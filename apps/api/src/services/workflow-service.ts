import { getContentType, parseDurationToSeconds } from "@openoutlier/core";
import { db } from "../db.js";
import { listDiscoverOutliers, type DiscoverQuery } from "./discovery.js";
import { YoutubeClient, type ResolvedChannel } from "./youtube.js";
import type { ScanService } from "./scan-service.js";

type ProjectRecord = {
  id: number;
  name: string;
  niche: string | null;
  primary_channel_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type SourceSetRecord = {
  id: number;
  project_id: number;
  backing_list_id: number | null;
  name: string;
  role: string;
  discovery_mode: string;
  created_at: string;
  updated_at: string;
};

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    if (url.hostname.includes("youtube.com")) {
      return url.searchParams.get("v");
    }
    if (url.hostname.includes("youtu.be")) {
      return url.pathname.replace(/^\/+/, "").split("/")[0] ?? null;
    }
  } catch {
    return null;
  }

  return null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export class WorkflowService {
  private readonly youtube = new YoutubeClient();

  constructor(_unusedScanService?: ScanService) {
    void _unusedScanService;
  }

  listProjects() {
    const rows = db.prepare(`
      SELECT
        projects.*,
        channels.name AS primaryChannelName,
        COUNT(DISTINCT source_sets.id) AS sourceSetCount,
        COUNT(DISTINCT project_references.id) AS referenceCount
      FROM projects
      LEFT JOIN channels ON channels.id = projects.primary_channel_id
      LEFT JOIN source_sets ON source_sets.project_id = projects.id
      LEFT JOIN project_references ON project_references.project_id = projects.id
      GROUP BY projects.id
      ORDER BY projects.updated_at DESC, projects.created_at DESC
    `).all() as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      niche: row.niche ? String(row.niche) : null,
      status: String(row.status),
      primaryChannelId: row.primary_channel_id ? String(row.primary_channel_id) : null,
      primaryChannelName: row.primaryChannelName ? String(row.primaryChannelName) : null,
      sourceSetCount: Number(row.sourceSetCount ?? 0),
      referenceCount: Number(row.referenceCount ?? 0),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  async createProjectAsync(input: {
    name: string;
    niche?: string | null;
    primaryChannelInput?: string | null;
    competitorSourceSetName?: string | null;
  }) {
    let primaryChannel: ResolvedChannel | null = null;
    if (input.primaryChannelInput?.trim()) {
      primaryChannel = await this.youtube.resolveChannel(input.primaryChannelInput.trim());
      this.persistChannel(primaryChannel);
    }

    const slugBase = slugify(input.name);
    const slug = `${slugBase || "project"}-${Date.now().toString().slice(-6)}`;
    const result = db.prepare(`
      INSERT INTO projects (name, slug, niche, primary_channel_id, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(input.name, slug, input.niche ?? null, primaryChannel?.channelId ?? null);

    const projectId = Number(result.lastInsertRowid);
    this.createSourceSet(projectId, {
      name: input.competitorSourceSetName ?? "Tracked Channels",
      role: "competitors",
      discoveryMode: "manual",
    });

    return this.getProject(projectId);
  }

  getProject(projectId: number) {
    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as ProjectRecord | undefined;
    if (!project) {
      throw new Error("Project not found.");
    }

    const sourceSets = db.prepare(`
      SELECT
        source_sets.*,
        COUNT(source_set_channels.channel_id) AS channelCount
      FROM source_sets
      LEFT JOIN source_set_channels ON source_set_channels.source_set_id = source_sets.id
      WHERE source_sets.project_id = ?
      GROUP BY source_sets.id
      ORDER BY source_sets.created_at ASC
    `).all(projectId) as Array<Record<string, unknown>>;

    const references = db.prepare(`
      SELECT
        project_references.id,
        project_references.video_id AS videoId,
        project_references.kind,
        project_references.notes,
        project_references.tags_json AS tagsJson,
        project_references.created_at AS createdAt,
        videos.title,
        videos.outlier_score AS outlierScore,
        videos.view_velocity AS viewVelocity,
        videos.views,
        channels.name AS channelName
      FROM project_references
      INNER JOIN videos ON videos.id = project_references.video_id
      INNER JOIN channels ON channels.id = videos.channel_id
      WHERE project_references.project_id = ?
      ORDER BY project_references.created_at DESC
      LIMIT 40
    `).all(projectId) as Array<Record<string, unknown>>;

    return {
      id: project.id,
      name: project.name,
      niche: project.niche,
      primaryChannelId: project.primary_channel_id,
      status: project.status,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      sourceSets: sourceSets.map((row) => ({
        id: Number(row.id),
        name: String(row.name),
        role: String(row.role),
        discoveryMode: String(row.discovery_mode),
        backingListId: row.backing_list_id ? Number(row.backing_list_id) : null,
        channelCount: Number(row.channelCount ?? 0),
      })),
      references: references.map((row) => ({
        id: Number(row.id),
        videoId: String(row.videoId),
        title: String(row.title),
        channelName: String(row.channelName),
        outlierScore: Number(row.outlierScore ?? 0),
        viewVelocity: Number(row.viewVelocity ?? 0),
        views: Number(row.views ?? 0),
        kind: String(row.kind),
        notes: row.notes ? String(row.notes) : null,
        tags: parseJson(String(row.tagsJson), [] as string[]),
        createdAt: String(row.createdAt),
      })),
    };
  }

  createSourceSet(projectId: number, input: { name: string; role?: string; discoveryMode?: string }) {
    const project = db.prepare("SELECT name FROM projects WHERE id = ?").get(projectId) as { name: string } | undefined;
    if (!project) {
      throw new Error("Project not found.");
    }

    const listResult = db.prepare(`
      INSERT INTO lists (name, description, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `).run(`${project.name}: ${input.name}`, `Backing list for source set ${input.name}`);

    const sourceSetResult = db.prepare(`
      INSERT INTO source_sets (project_id, backing_list_id, name, role, discovery_mode, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(projectId, Number(listResult.lastInsertRowid), input.name, input.role ?? "competitors", input.discoveryMode ?? "manual");

    return this.getSourceSet(Number(sourceSetResult.lastInsertRowid));
  }

  listSourceSets(projectId: number) {
    return db.prepare(`
      SELECT
        source_sets.*,
        COUNT(source_set_channels.channel_id) AS channelCount
      FROM source_sets
      LEFT JOIN source_set_channels ON source_set_channels.source_set_id = source_sets.id
      WHERE source_sets.project_id = ?
      GROUP BY source_sets.id
      ORDER BY source_sets.created_at ASC
    `).all(projectId).map((row) => ({
      id: Number((row as Record<string, unknown>).id),
      name: String((row as Record<string, unknown>).name),
      role: String((row as Record<string, unknown>).role),
      discoveryMode: String((row as Record<string, unknown>).discovery_mode),
      backingListId: (row as Record<string, unknown>).backing_list_id ? Number((row as Record<string, unknown>).backing_list_id) : null,
      channelCount: Number((row as Record<string, unknown>).channelCount ?? 0),
    }));
  }

  getSourceSet(sourceSetId: number) {
    const sourceSet = db.prepare("SELECT * FROM source_sets WHERE id = ?").get(sourceSetId) as SourceSetRecord | undefined;
    if (!sourceSet) {
      throw new Error("Source set not found.");
    }

    const channels = db.prepare(`
      SELECT channels.id, channels.name, channels.handle, channels.subscriber_count AS subscriberCount
      FROM channels
      INNER JOIN source_set_channels ON source_set_channels.channel_id = channels.id
      WHERE source_set_channels.source_set_id = ?
      ORDER BY channels.subscriber_count DESC, channels.name ASC
    `).all(sourceSetId);

    return {
      id: sourceSet.id,
      projectId: sourceSet.project_id,
      backingListId: sourceSet.backing_list_id,
      name: sourceSet.name,
      role: sourceSet.role,
      discoveryMode: sourceSet.discovery_mode,
      channels,
      createdAt: sourceSet.created_at,
      updatedAt: sourceSet.updated_at,
    };
  }

  async addChannelToSourceSet(sourceSetId: number, input: { channelUrl?: string; channelId?: string; handle?: string; relationship?: string }) {
    const sourceSet = db.prepare("SELECT * FROM source_sets WHERE id = ?").get(sourceSetId) as SourceSetRecord | undefined;
    if (!sourceSet) {
      throw new Error("Source set not found.");
    }

    const channelInput = input.channelUrl ?? input.channelId ?? input.handle;
    if (!channelInput) {
      throw new Error("Provide channelUrl, channelId, or handle.");
    }

    const channel = await this.youtube.resolveChannel(channelInput);
    this.persistChannel(channel);
    this.attachChannelToSourceSet(sourceSet, channel.channelId, input.relationship ?? "competitor");
    return channel;
  }

  async discoverChannels(sourceSetId: number, input: { query?: string; niche?: string; limit?: number; autoAttach?: boolean }) {
    const sourceSet = db.prepare("SELECT * FROM source_sets WHERE id = ?").get(sourceSetId) as SourceSetRecord | undefined;
    if (!sourceSet) {
      throw new Error("Source set not found.");
    }

    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(sourceSet.project_id) as ProjectRecord | undefined;
    const searchQuery = input.query?.trim() || input.niche?.trim() || project?.niche || sourceSet.name;
    if (!searchQuery) {
      throw new Error("Provide a discovery query or niche.");
    }

    const existingIds = new Set(
      (db.prepare("SELECT channel_id FROM source_set_channels WHERE source_set_id = ?").all(sourceSetId) as Array<{ channel_id: string }>).map((row) => row.channel_id),
    );

    const suggestions = (await this.youtube.searchChannels(searchQuery, input.limit ?? 10))
      .filter((channel) => !existingIds.has(channel.channelId))
      .map((channel) => ({
        channelId: channel.channelId,
        channelName: channel.channelName,
        handle: channel.handle,
        subscriberCount: channel.subscriberCount,
      }));

    if (input.autoAttach) {
      for (const suggestion of suggestions) {
        const channel = await this.youtube.fetchChannelById(suggestion.channelId);
        this.persistChannel(channel);
        this.attachChannelToSourceSet(sourceSet, channel.channelId, "discovered");
      }
    }

    return {
      sourceSetId,
      query: searchQuery,
      suggestions,
      attachedCount: input.autoAttach ? suggestions.length : 0,
    };
  }

  searchReferences(projectId: number, input: Partial<DiscoverQuery> & { sourceSetId?: number; saveTop?: number }) {
    const sourceSet = input.sourceSetId
      ? (db.prepare("SELECT backing_list_id FROM source_sets WHERE id = ? AND project_id = ?").get(input.sourceSetId, projectId) as { backing_list_id: number | null } | undefined)
      : (db.prepare("SELECT backing_list_id FROM source_sets WHERE project_id = ? ORDER BY id ASC LIMIT 1").get(projectId) as { backing_list_id: number | null } | undefined);

    const result = listDiscoverOutliers({
      listId: sourceSet?.backing_list_id ?? undefined,
      days: input.days ?? 365,
      sort: input.sort ?? "momentum",
      order: input.order ?? "desc",
      page: input.page ?? 1,
      limit: input.limit ?? 25,
      search: input.search,
      contentType: input.contentType ?? "all",
      minScore: input.minScore,
      maxScore: input.maxScore,
      minSubscribers: input.minSubscribers,
      maxSubscribers: input.maxSubscribers,
      minViews: input.minViews,
      maxViews: input.maxViews,
      minVelocity: input.minVelocity,
      maxVelocity: input.maxVelocity,
      minDurationSeconds: input.minDurationSeconds,
      maxDurationSeconds: input.maxDurationSeconds,
      channelId: input.channelId,
      projectId,
      sourceSetId: input.sourceSetId,
    });

    const savedReferenceIds: number[] = [];
    const topToSave = Math.max(0, input.saveTop ?? 0);
    for (const video of result.videos.slice(0, topToSave) as Array<Record<string, unknown>>) {
      const saved = this.saveReference(projectId, {
        sourceSetId: input.sourceSetId ?? null,
        videoId: String(video.videoId),
        kind: "outlier",
        tags: ["saved-from-search"],
      });
      savedReferenceIds.push(saved.id);
    }

    return {
      ...result,
      savedReferenceIds,
    };
  }

  saveReference(projectId: number, input: { sourceSetId?: number | null; videoId: string; kind?: string; notes?: string | null; tags?: string[] }) {
    const result = db.prepare(`
      INSERT INTO project_references (project_id, source_set_id, video_id, kind, notes, tags_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, video_id) DO UPDATE SET
        source_set_id = excluded.source_set_id,
        kind = excluded.kind,
        notes = excluded.notes,
        tags_json = excluded.tags_json
      RETURNING id
    `).get(projectId, input.sourceSetId ?? null, input.videoId, input.kind ?? "outlier", input.notes ?? null, JSON.stringify(input.tags ?? [])) as { id: number };

    return { id: Number(result.id), videoId: input.videoId };
  }

  listReferences(projectId: number) {
    const rows = db.prepare(`
      SELECT
        project_references.id,
        project_references.source_set_id AS sourceSetId,
        project_references.video_id AS videoId,
        project_references.kind,
        project_references.notes,
        project_references.tags_json AS tagsJson,
        project_references.created_at AS createdAt,
        videos.title,
        videos.outlier_score AS outlierScore,
        videos.view_velocity AS viewVelocity,
        videos.views,
        videos.published_at AS publishedAt,
        channels.name AS channelName
      FROM project_references
      INNER JOIN videos ON videos.id = project_references.video_id
      INNER JOIN channels ON channels.id = videos.channel_id
      WHERE project_references.project_id = ?
      ORDER BY project_references.created_at DESC
    `).all(projectId) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: Number(row.id),
      sourceSetId: row.sourceSetId ? Number(row.sourceSetId) : null,
      videoId: String(row.videoId),
      title: String(row.title),
      channelName: String(row.channelName),
      kind: String(row.kind),
      notes: row.notes ? String(row.notes) : null,
      tags: parseJson(String(row.tagsJson), [] as string[]),
      outlierScore: Number(row.outlierScore ?? 0),
      viewVelocity: Number(row.viewVelocity ?? 0),
      views: Number(row.views ?? 0),
      publishedAt: row.publishedAt ? String(row.publishedAt) : null,
      createdAt: String(row.createdAt),
    }));
  }

  async importReferenceVideo(projectId: number, sourceSetId: number | null, videoInput: string) {
    const videoId = extractVideoId(videoInput);
    if (!videoId) {
      throw new Error("Invalid video URL or video ID.");
    }

    const sourceSet = sourceSetId
      ? (db.prepare("SELECT * FROM source_sets WHERE id = ?").get(sourceSetId) as SourceSetRecord | undefined)
      : undefined;

    const [video] = await this.youtube.fetchVideos([videoId]);
    if (!video) {
      throw new Error("Video not found on YouTube.");
    }

    if (!video.channelId) {
      throw new Error("Video channel could not be resolved.");
    }

    const channel = await this.youtube.fetchChannelById(video.channelId);
    this.persistChannel(channel);
    if (sourceSet) {
      this.attachChannelToSourceSet(sourceSet, channel.channelId, "reference_source");
    }

    const channelRow = db.prepare("SELECT median_views, subscriber_count FROM channels WHERE id = ?").get(channel.channelId) as
      | { median_views: number | null; subscriber_count: number | null }
      | undefined;
    const medianViews = Math.max(channelRow?.median_views ?? 0, 1);
    const safeMedian = medianViews > 1 ? medianViews : Math.max(video.views, 1);
    const daysSincePublished = Math.max(
      (Date.now() - new Date(video.publishedAt ?? new Date().toISOString()).getTime()) / (1000 * 60 * 60 * 24),
      1,
    );
    const outlierScore = Number((video.views / safeMedian).toFixed(4));
    const viewVelocity = Number((video.views / daysSincePublished).toFixed(4));
    const momentumScore = Number((outlierScore + viewVelocity / 100).toFixed(4));
    const engagementRatio = video.views > 0 ? Number(((video.likes + video.comments) / video.views).toFixed(4)) : 0;

    const durationSeconds = parseDurationToSeconds(video.duration);
    db.prepare(`
      INSERT INTO videos (
        id, channel_id, title, published_at, thumbnail_url, views, likes, comments, duration,
        duration_seconds, content_type, outlier_score, momentum_score, view_velocity, engagement_ratio, scanned_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        channel_id = excluded.channel_id,
        title = excluded.title,
        published_at = excluded.published_at,
        thumbnail_url = excluded.thumbnail_url,
        views = excluded.views,
        likes = excluded.likes,
        comments = excluded.comments,
        duration = excluded.duration,
        duration_seconds = excluded.duration_seconds,
        content_type = excluded.content_type,
        outlier_score = excluded.outlier_score,
        momentum_score = excluded.momentum_score,
        view_velocity = excluded.view_velocity,
        engagement_ratio = excluded.engagement_ratio,
        scanned_at = CURRENT_TIMESTAMP
    `).run(
      video.id,
      channel.channelId,
      video.title,
      video.publishedAt,
      video.thumbnailUrl,
      video.views,
      video.likes,
      video.comments,
      video.duration,
      durationSeconds,
      getContentType(durationSeconds),
      outlierScore,
      momentumScore,
      viewVelocity,
      engagementRatio,
    );

    const reference = this.saveReference(projectId, {
      sourceSetId,
      videoId: video.id,
      kind: "imported_video",
      tags: ["seed-video"],
    });

    return {
      id: reference.id,
      videoId: video.id,
      channelId: channel.channelId,
    };
  }

  private persistChannel(channel: ResolvedChannel) {
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
  }

  private attachChannelToSourceSet(sourceSet: SourceSetRecord, channelId: string, relationship: string) {
    db.prepare(`
      INSERT INTO source_set_channels (source_set_id, channel_id, relationship)
      VALUES (?, ?, ?)
      ON CONFLICT(source_set_id, channel_id) DO UPDATE SET relationship = excluded.relationship
    `).run(sourceSet.id, channelId, relationship);

    db.prepare(`
      INSERT INTO project_channels (project_id, channel_id, relationship)
      VALUES (?, ?, ?)
      ON CONFLICT(project_id, channel_id) DO UPDATE SET relationship = excluded.relationship
    `).run(sourceSet.project_id, channelId, relationship);

    if (sourceSet.backing_list_id) {
      db.prepare(`
        INSERT INTO list_channels (list_id, channel_id)
        VALUES (?, ?)
        ON CONFLICT(list_id, channel_id) DO NOTHING
      `).run(sourceSet.backing_list_id, channelId);
    }
  }
}
