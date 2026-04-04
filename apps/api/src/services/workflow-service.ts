import { config } from "../config.js";
import { db } from "../db.js";
import { listDiscoverOutliers, type DiscoverQuery } from "./discovery.js";
import { AiService } from "./ai-service.js";
import { GoogleImageService } from "./google-image-service.js";
import { YoutubeClient, type ResolvedChannel } from "./youtube.js";
import type { ScanService } from "./scan-service.js";
import { getContentType, parseDurationToSeconds, type LlmProviderConfig, type PromptSourceVideo } from "@openoutlier/core";

type JsonRecord = Record<string, unknown>;

type WorkflowStageKey =
  | "source_discovery"
  | "reference_research"
  | "concept_adaptation"
  | "thumbnail_creation"
  | "completed";

type WorkflowMode = "auto" | "copilot" | "manual";

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

type WorkflowRunRecord = {
  id: number;
  project_id: number;
  source_set_id: number | null;
  mode: WorkflowMode;
  status: string;
  current_stage: WorkflowStageKey;
  target_niche: string | null;
  target_channel_id: string | null;
  input_json: string;
  output_json: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type WorkflowRunView = {
  id: number;
  projectId: number;
  sourceSetId: number | null;
  mode: WorkflowMode;
  status: string;
  currentStage: WorkflowStageKey;
  targetNiche: string | null;
  targetChannelId: string | null;
  input: JsonRecord;
  output: JsonRecord;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  stages: Array<{
    id: number;
    stageKey: string;
    status: string;
    input: JsonRecord;
    output: JsonRecord;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
  }>;
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

function stageOrder(stage: WorkflowStageKey): number {
  return {
    source_discovery: 0,
    reference_research: 1,
    concept_adaptation: 2,
    thumbnail_creation: 3,
    completed: 4,
  }[stage];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function mapProvider(row: Record<string, unknown> | null | undefined): LlmProviderConfig | null {
  if (!row) {
    if (!config.openAiApiKey) return null;
    return {
      id: 0,
      name: "OpenAI env",
      provider: "openai",
      mode: "api_key",
      apiKey: config.openAiApiKey,
      oauthConfigJson: null,
      model: config.defaultLlmModel,
      isActive: 1,
    };
  }

  return {
    id: Number(row.id),
    name: String(row.name),
    provider: String(row.provider) as LlmProviderConfig["provider"],
    mode: String(row.mode) as LlmProviderConfig["mode"],
    apiKey: row.api_key ? String(row.api_key) : null,
    oauthConfigJson: row.oauth_config_json ? String(row.oauth_config_json) : null,
    model: row.model ? String(row.model) : null,
    isActive: Number(row.is_active ?? 0),
  };
}

export class WorkflowService {
  private readonly youtube = new YoutubeClient();
  private readonly ai = new AiService();
  private readonly images = new GoogleImageService();

  constructor(private readonly scanService: ScanService) {}

  listProjects() {
    const rows = db.prepare(`
      SELECT
        projects.*,
        channels.name AS primaryChannelName,
        COUNT(DISTINCT source_sets.id) AS sourceSetCount,
        COUNT(DISTINCT project_references.id) AS referenceCount,
        COUNT(DISTINCT workflow_runs.id) AS workflowRunCount
      FROM projects
      LEFT JOIN channels ON channels.id = projects.primary_channel_id
      LEFT JOIN source_sets ON source_sets.project_id = projects.id
      LEFT JOIN project_references ON project_references.project_id = projects.id
      LEFT JOIN workflow_runs ON workflow_runs.project_id = projects.id
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
      workflowRunCount: Number(row.workflowRunCount ?? 0),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  createProject(input: {
    name: string;
    niche?: string | null;
    primaryChannelInput?: string | null;
    competitorSourceSetName?: string | null;
  }) {
    let primaryChannel: ResolvedChannel | null = null;
    if (input.primaryChannelInput?.trim()) {
      primaryChannel = this.youtube.resolveChannel(input.primaryChannelInput.trim()) as unknown as ResolvedChannel;
    }

    const resolvedPrimary = primaryChannel instanceof Promise ? null : primaryChannel;
    if (resolvedPrimary) {
      this.persistChannel(resolvedPrimary);
    }

    const slugBase = slugify(input.name);
    const slug = `${slugBase || "project"}-${Date.now().toString().slice(-6)}`;
    const result = db.prepare(`
      INSERT INTO projects (name, slug, niche, primary_channel_id, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(input.name, slug, input.niche ?? null, resolvedPrimary?.channelId ?? null);

    const projectId = Number(result.lastInsertRowid);
    this.createSourceSet(projectId, {
      name: input.competitorSourceSetName ?? "Competitor Sources",
      role: "competitors",
      discoveryMode: "manual",
    });

    return this.getProject(projectId);
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
      name: input.competitorSourceSetName ?? "Competitor Sources",
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
        videos.thumbnail_url AS thumbnailUrl,
        videos.outlier_score AS outlierScore,
        channels.name AS channelName
      FROM project_references
      INNER JOIN videos ON videos.id = project_references.video_id
      INNER JOIN channels ON channels.id = videos.channel_id
      WHERE project_references.project_id = ?
      ORDER BY project_references.created_at DESC
      LIMIT 20
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
        thumbnailUrl: row.thumbnailUrl ? String(row.thumbnailUrl) : null,
        outlierScore: Number(row.outlierScore ?? 0),
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
      SELECT channels.id, channels.name, channels.handle, channels.subscriber_count AS subscriberCount, channels.thumbnail_url AS thumbnailUrl
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
        ...channel,
        alreadyTracked: existingIds.has(channel.channelId),
      }));

    if (input.autoAttach) {
      for (const suggestion of suggestions) {
        this.persistChannel(suggestion);
        this.attachChannelToSourceSet(sourceSet, suggestion.channelId, "discovered");
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
    });

    const savedReferenceIds: number[] = [];
    const topToSave = Math.max(0, input.saveTop ?? 0);
    for (const video of result.videos.slice(0, topToSave) as Array<Record<string, unknown>>) {
      const saved = this.saveReference(projectId, {
        sourceSetId: input.sourceSetId ?? null,
        videoId: String(video.videoId),
        kind: "outlier",
        tags: ["auto-saved", "research"],
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
        videos.thumbnail_url AS thumbnailUrl,
        videos.outlier_score AS outlierScore,
        videos.view_velocity AS viewVelocity,
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
      thumbnailUrl: row.thumbnailUrl ? String(row.thumbnailUrl) : null,
      channelName: String(row.channelName),
      kind: String(row.kind),
      notes: row.notes ? String(row.notes) : null,
      tags: parseJson(String(row.tagsJson), [] as string[]),
      outlierScore: Number(row.outlierScore ?? 0),
      viewVelocity: Number(row.viewVelocity ?? 0),
      createdAt: String(row.createdAt),
    }));
  }

  async generateConcept(projectId: number, input: { referenceIds?: number[]; context?: string; providerId?: number }) {
    const references = this.resolveReferenceVideos(projectId, input.referenceIds);
    if (references.length === 0) {
      throw new Error("Save or select at least one reference first.");
    }

    const providerRow =
      input.providerId !== undefined
        ? (db.prepare("SELECT * FROM llm_providers WHERE id = ?").get(input.providerId) as Record<string, unknown> | undefined)
        : (db.prepare("SELECT * FROM llm_providers WHERE is_active = 1 ORDER BY id DESC LIMIT 1").get() as Record<string, unknown> | undefined);

    const provider = mapProvider(providerRow);
    const idea = await this.ai.generate({ kind: "idea", provider, videos: references, context: input.context });
    const titles = await this.ai.generate({ kind: "title_set", provider, videos: references, context: input.context });
    const thumbnailBrief = await this.ai.generate({ kind: "thumbnail_brief", provider, videos: references, context: input.context });

    const concept = {
      idea: parseJson<JsonRecord>(idea.output, { raw: idea.output }),
      titles: parseJson<JsonRecord>(titles.output, { raw: titles.output }),
      thumbnailBrief: parseJson<JsonRecord>(thumbnailBrief.output, { raw: thumbnailBrief.output }),
      sourceVideoIds: references.map((video) => video.videoId),
      sourceReferenceIds: (input.referenceIds ?? []).map(Number),
    };

    const result = db.prepare(`
      INSERT INTO concept_runs (project_id, status, title, prompt_context, provider_id, model, source_reference_ids_json, source_video_ids_json, result_json)
      VALUES (?, 'completed', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      projectId,
      "Concept adaptation",
      input.context ?? null,
      input.providerId ?? null,
      idea.model,
      JSON.stringify(input.referenceIds ?? []),
      JSON.stringify(references.map((video) => video.videoId)),
      JSON.stringify(concept),
    );

    return {
      id: Number(result.lastInsertRowid),
      model: idea.model,
      concept,
    };
  }

  listConceptRuns(projectId: number) {
    const rows = db.prepare(`
      SELECT id, title, prompt_context AS promptContext, model, source_reference_ids_json AS sourceReferenceIdsJson,
        source_video_ids_json AS sourceVideoIdsJson, result_json AS resultJson, created_at AS createdAt
      FROM concept_runs
      WHERE project_id = ?
      ORDER BY created_at DESC
    `).all(projectId) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: Number(row.id),
      title: row.title ? String(row.title) : null,
      promptContext: row.promptContext ? String(row.promptContext) : null,
      model: row.model ? String(row.model) : null,
      sourceReferenceIds: parseJson(String(row.sourceReferenceIdsJson), [] as number[]),
      sourceVideoIds: parseJson(String(row.sourceVideoIdsJson), [] as string[]),
      result: parseJson(String(row.resultJson), {}),
      createdAt: String(row.createdAt),
    }));
  }

  async generateProjectThumbnail(projectId: number, input: {
    referenceIds?: number[];
    prompt?: string;
    context?: string;
    characterProfileId?: number | null;
    size?: "16:9" | "3:2" | "1:1" | "2:3";
  }) {
    const references = this.resolveReferenceVideos(projectId, input.referenceIds);
    if (references.length === 0) {
      throw new Error("Select at least one reference.");
    }

    const concept = this.listConceptRuns(projectId)[0];
    const thumbnailBrief = concept?.result && typeof concept.result === "object" && "thumbnailBrief" in (concept.result as Record<string, unknown>)
      ? JSON.stringify((concept.result as Record<string, unknown>).thumbnailBrief)
      : null;

    const generation = await this.images.generateThumbnail({
      projectId,
      prompt: input.prompt ?? thumbnailBrief ?? `Create a thumbnail inspired by these references for ${references[0].channelName}.`,
      promptContext: input.context ?? "Transform the reference packaging into a distinct but clearly inspired thumbnail for the target niche.",
      sourceVideoIds: references.map((video) => video.videoId),
      characterProfileId: input.characterProfileId ?? null,
      size: input.size ?? "16:9",
    });

    return {
      ...generation,
      sourceVideoIds: parseJson(generation.source_video_ids_json, [] as string[]),
      resultUrls: parseJson(generation.result_urls_json, [] as string[]),
      downloadUrls: parseJson(generation.download_urls_json, [] as string[]),
    };
  }

  listWorkflowRuns(projectId: number) {
    const rows = db.prepare(`
      SELECT id, mode, status, current_stage AS currentStage, target_niche AS targetNiche, target_channel_id AS targetChannelId,
        input_json AS inputJson, output_json AS outputJson, last_error AS lastError, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt
      FROM workflow_runs
      WHERE project_id = ?
      ORDER BY updated_at DESC, created_at DESC
    `).all(projectId) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: Number(row.id),
      mode: String(row.mode),
      status: String(row.status),
      currentStage: String(row.currentStage),
      targetNiche: row.targetNiche ? String(row.targetNiche) : null,
      targetChannelId: row.targetChannelId ? String(row.targetChannelId) : null,
      input: parseJson(String(row.inputJson), {} as JsonRecord),
      output: parseJson(String(row.outputJson), {} as JsonRecord),
      lastError: row.lastError ? String(row.lastError) : null,
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
      completedAt: row.completedAt ? String(row.completedAt) : null,
    }));
  }

  async createWorkflowRunAsync(input: {
    projectId: number;
    sourceSetId?: number | null;
    mode?: WorkflowMode;
    targetNiche?: string | null;
    targetChannelId?: string | null;
    input?: JsonRecord;
    startStage?: Exclude<WorkflowStageKey, "completed">;
    stopAfterStage?: Exclude<WorkflowStageKey, "completed"> | null;
    referenceIds?: number[];
    seedVideoId?: string | null;
    seedVideoUrl?: string | null;
  }) {
    const sourceSetId = input.sourceSetId ?? this.defaultSourceSetId(input.projectId);
    const seedVideoInput = input.seedVideoId ?? input.seedVideoUrl ?? null;
    const seededReferenceIds = [...(input.referenceIds ?? [])];
    if (seedVideoInput) {
      const seeded = await this.importReferenceVideo(input.projectId, sourceSetId, seedVideoInput);
      seededReferenceIds.push(seeded.id);
    }

    const inferredStartStage =
      input.startStage ??
      (seededReferenceIds.length > 0 ? "concept_adaptation" : "source_discovery");

    const workflowInput = {
      ...(input.input ?? {}),
      ...(seededReferenceIds.length > 0 ? { referenceIds: seededReferenceIds } : {}),
      ...(input.stopAfterStage ? { stopAfterStage: input.stopAfterStage } : {}),
    };

    const result = db.prepare(`
      INSERT INTO workflow_runs (project_id, source_set_id, mode, status, current_stage, target_niche, target_channel_id, input_json, output_json, updated_at)
      VALUES (?, ?, ?, 'draft', 'source_discovery', ?, ?, ?, '{}', CURRENT_TIMESTAMP)
    `).run(
      input.projectId,
      sourceSetId,
      input.mode ?? "copilot",
      input.targetNiche ?? null,
      input.targetChannelId ?? null,
      JSON.stringify(workflowInput),
    );

    const workflowRunId = Number(result.lastInsertRowid);
    for (const stage of ["source_discovery", "reference_research", "concept_adaptation", "thumbnail_creation"] as const) {
      db.prepare(`
        INSERT INTO workflow_stage_runs (workflow_run_id, stage_key, status, input_json, output_json)
        VALUES (?, ?, 'pending', '{}', '{}')
      `).run(workflowRunId, stage);
    }

    for (const stage of ["source_discovery", "reference_research", "concept_adaptation", "thumbnail_creation"] as const) {
      if (stageOrder(stage) < stageOrder(inferredStartStage)) {
        db.prepare(`
          UPDATE workflow_stage_runs
          SET status = 'completed', input_json = ?, output_json = ?, updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP
          WHERE workflow_run_id = ? AND stage_key = ?
        `).run(JSON.stringify({ skipped: true }), JSON.stringify({ skipped: true }), workflowRunId, stage);
      }
    }

    db.prepare(`
      UPDATE workflow_runs
      SET current_stage = ?, input_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(inferredStartStage, JSON.stringify(workflowInput), workflowRunId);

    return this.getWorkflowRun(workflowRunId);
  }

  getWorkflowRun(workflowRunId: number): WorkflowRunView {
    const run = db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(workflowRunId) as WorkflowRunRecord | undefined;
    if (!run) {
      throw new Error("Workflow run not found.");
    }

    const stages = db.prepare(`
      SELECT id, stage_key AS stageKey, status, input_json AS inputJson, output_json AS outputJson, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt
      FROM workflow_stage_runs
      WHERE workflow_run_id = ?
      ORDER BY id ASC
    `).all(workflowRunId) as Array<Record<string, unknown>>;

    return {
      id: run.id,
      projectId: run.project_id,
      sourceSetId: run.source_set_id,
      mode: run.mode,
      status: run.status,
      currentStage: run.current_stage,
      targetNiche: run.target_niche,
      targetChannelId: run.target_channel_id,
      input: parseJson(run.input_json, {} as JsonRecord),
      output: parseJson(run.output_json, {} as JsonRecord),
      lastError: run.last_error,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      completedAt: run.completed_at,
      stages: stages.map((stage) => ({
        id: Number(stage.id),
        stageKey: String(stage.stageKey),
        status: String(stage.status),
        input: parseJson(String(stage.inputJson), {} as JsonRecord),
        output: parseJson(String(stage.outputJson), {} as JsonRecord),
        createdAt: String(stage.createdAt),
        updatedAt: String(stage.updatedAt),
        completedAt: stage.completedAt ? String(stage.completedAt) : null,
      })),
    };
  }

  async advanceWorkflowRun(workflowRunId: number, input?: JsonRecord): Promise<WorkflowRunView> {
    const run = db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(workflowRunId) as WorkflowRunRecord | undefined;
    if (!run) {
      throw new Error("Workflow run not found.");
    }

    const stage = run.current_stage;
    const stageInput = { ...parseJson(run.input_json, {} as JsonRecord), ...(input ?? {}) };
    const stopAfterStage =
      typeof stageInput.stopAfterStage === "string" && stageInput.stopAfterStage !== "completed"
        ? (stageInput.stopAfterStage as Exclude<WorkflowStageKey, "completed">)
        : null;

    try {
      let stageOutput: JsonRecord;
      let nextStage: WorkflowStageKey = "completed";

      if (stage === "source_discovery") {
        stageOutput = await this.runSourceDiscoveryStage(run, stageInput);
        nextStage = "reference_research";
      } else if (stage === "reference_research") {
        stageOutput = this.runReferenceResearchStage(run, stageInput);
        nextStage = "concept_adaptation";
      } else if (stage === "concept_adaptation") {
        stageOutput = await this.runConceptAdaptationStage(run, stageInput);
        nextStage = "thumbnail_creation";
      } else if (stage === "thumbnail_creation") {
        stageOutput = await this.runThumbnailCreationStage(run, stageInput);
        nextStage = "completed";
      } else {
        return this.getWorkflowRun(workflowRunId);
      }

      const shouldStopAfterStage = stopAfterStage === stage;
      this.completeStage(workflowRunId, stage, stageInput, stageOutput);
      db.prepare(`
        UPDATE workflow_runs
        SET status = ?, current_stage = ?, input_json = ?, output_json = json_patch(output_json, ?), updated_at = CURRENT_TIMESTAMP, completed_at = ?
        WHERE id = ?
      `).run(
        nextStage === "completed" || shouldStopAfterStage ? "completed" : run.mode === "auto" ? "running" : "awaiting_review",
        shouldStopAfterStage ? "completed" : nextStage,
        JSON.stringify(stageInput),
        JSON.stringify({ [stage]: stageOutput }),
        nextStage === "completed" || shouldStopAfterStage ? new Date().toISOString() : null,
        workflowRunId,
      );

      if (run.mode === "auto" && nextStage !== "completed" && !shouldStopAfterStage) {
        return this.advanceWorkflowRun(workflowRunId, stageInput);
      }

      return this.getWorkflowRun(workflowRunId);
    } catch (error) {
      db.prepare(`
        UPDATE workflow_runs
        SET status = 'failed', last_error = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(error instanceof Error ? error.message : "Workflow failed.", workflowRunId);
      throw error;
    }
  }

  private async runSourceDiscoveryStage(run: WorkflowRunRecord, input: JsonRecord) {
    const sourceSetId = run.source_set_id ?? this.defaultSourceSetId(run.project_id);
    const sourceSet = db.prepare("SELECT * FROM source_sets WHERE id = ?").get(sourceSetId) as SourceSetRecord;
    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(run.project_id) as ProjectRecord;

    if (typeof input.primaryChannelInput === "string" && input.primaryChannelInput.trim()) {
      const channel = await this.youtube.resolveChannel(input.primaryChannelInput.trim());
      this.persistChannel(channel);
      db.prepare("UPDATE projects SET primary_channel_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(channel.channelId, run.project_id);
      db.prepare(`
        INSERT INTO project_channels (project_id, channel_id, relationship)
        VALUES (?, ?, 'primary')
        ON CONFLICT(project_id, channel_id) DO UPDATE SET relationship = 'primary'
      `).run(run.project_id, channel.channelId);
    }

    const manualCompetitors = Array.isArray(input.competitorInputs) ? input.competitorInputs.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : [];
    const attachedChannels: string[] = [];
    for (const competitor of manualCompetitors) {
      const channel = await this.youtube.resolveChannel(competitor);
      this.persistChannel(channel);
      this.attachChannelToSourceSet(sourceSet, channel.channelId, "competitor");
      attachedChannels.push(channel.channelId);
    }

    const discovered = await this.discoverChannels(sourceSet.id, {
      query: typeof input.discoveryQuery === "string" ? input.discoveryQuery : undefined,
      niche: typeof input.targetNiche === "string" ? input.targetNiche : project.niche ?? undefined,
      limit: typeof input.discoveryLimit === "number" ? input.discoveryLimit : 8,
      autoAttach: Boolean(input.autoAttachSuggestions),
    });

    if (Boolean(input.runScan) && sourceSet.backing_list_id) {
      await this.scanService.triggerScan(sourceSet.backing_list_id);
    }

    return {
      projectId: run.project_id,
      sourceSetId: sourceSet.id,
      attachedChannelIds: attachedChannels,
      trackedChannels: this.getSourceSet(sourceSet.id).channels,
      discoveredSuggestions: discovered.suggestions,
      scanStatus: this.scanService.getStatus(),
    };
  }

  private runReferenceResearchStage(run: WorkflowRunRecord, input: JsonRecord) {
    const sourceSetId = run.source_set_id ?? this.defaultSourceSetId(run.project_id);
    const result = this.searchReferences(run.project_id, {
      sourceSetId,
      days: typeof input.days === "number" ? input.days : 365,
      sort: typeof input.sort === "string" ? (input.sort as DiscoverQuery["sort"]) : "momentum",
      order: typeof input.order === "string" ? (input.order as DiscoverQuery["order"]) : "desc",
      search: typeof input.search === "string" ? input.search : undefined,
      contentType: typeof input.contentType === "string" ? (input.contentType as DiscoverQuery["contentType"]) : "all",
      minScore: typeof input.minScore === "number" ? input.minScore : 3,
      maxScore: typeof input.maxScore === "number" ? input.maxScore : undefined,
      minViews: typeof input.minViews === "number" ? input.minViews : undefined,
      maxViews: typeof input.maxViews === "number" ? input.maxViews : undefined,
      minSubscribers: typeof input.minSubscribers === "number" ? input.minSubscribers : undefined,
      maxSubscribers: typeof input.maxSubscribers === "number" ? input.maxSubscribers : undefined,
      minVelocity: typeof input.minVelocity === "number" ? input.minVelocity : undefined,
      maxVelocity: typeof input.maxVelocity === "number" ? input.maxVelocity : undefined,
      minDurationSeconds: typeof input.minDurationSeconds === "number" ? input.minDurationSeconds : undefined,
      maxDurationSeconds: typeof input.maxDurationSeconds === "number" ? input.maxDurationSeconds : undefined,
      limit: typeof input.limit === "number" ? input.limit : 20,
      saveTop: typeof input.saveTop === "number" ? input.saveTop : 5,
    });

    return {
      totalCandidates: result.total,
      savedReferenceIds: result.savedReferenceIds,
      topCandidates: result.videos,
      references: this.listReferences(run.project_id).slice(0, 10),
    };
  }

  private async runConceptAdaptationStage(run: WorkflowRunRecord, input: JsonRecord) {
    const referenceIds = Array.isArray(input.referenceIds) ? input.referenceIds.map(Number) : this.listReferences(run.project_id).slice(0, 5).map((reference) => reference.id);
    const concept = await this.generateConcept(run.project_id, {
      referenceIds,
      context: typeof input.adaptationContext === "string" ? input.adaptationContext : run.target_niche ?? undefined,
      providerId: typeof input.providerId === "number" ? input.providerId : undefined,
    });

    return {
      conceptRunId: concept.id,
      model: concept.model,
      concept: concept.concept,
    };
  }

  private async runThumbnailCreationStage(run: WorkflowRunRecord, input: JsonRecord) {
    const referenceIds = Array.isArray(input.referenceIds) ? input.referenceIds.map(Number) : this.listReferences(run.project_id).slice(0, 3).map((reference) => reference.id);
    const generation = await this.generateProjectThumbnail(run.project_id, {
      referenceIds,
      prompt: typeof input.thumbnailPrompt === "string" ? input.thumbnailPrompt : undefined,
      context: typeof input.thumbnailContext === "string" ? input.thumbnailContext : undefined,
      characterProfileId: typeof input.characterProfileId === "number" ? input.characterProfileId : null,
      size: typeof input.thumbnailSize === "string" ? (input.thumbnailSize as "16:9" | "3:2" | "1:1" | "2:3") : "16:9",
    });

    return {
      thumbnailGenerationId: generation.id,
      resultUrls: generation.resultUrls,
      downloadUrls: generation.downloadUrls,
    };
  }

  private defaultSourceSetId(projectId: number): number {
    const row = db.prepare("SELECT id FROM source_sets WHERE project_id = ? ORDER BY id ASC LIMIT 1").get(projectId) as { id: number } | undefined;
    if (!row) {
      throw new Error("Project has no source set.");
    }
    return row.id;
  }

  private resolveReferenceVideos(projectId: number, referenceIds?: number[]): PromptSourceVideo[] {
    const ids = referenceIds && referenceIds.length > 0
      ? referenceIds
      : (db.prepare("SELECT id FROM project_references WHERE project_id = ? ORDER BY created_at DESC LIMIT 5").all(projectId) as Array<{ id: number }>).map((row) => row.id);

    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(", ");
    return db.prepare(`
      SELECT
        videos.id AS videoId,
        videos.title,
        channels.name AS channelName,
        videos.views,
        videos.outlier_score AS outlierScore,
        videos.view_velocity AS viewVelocity,
        videos.published_at AS publishedAt,
        COALESCE(json_group_array(DISTINCT lists.name) FILTER (WHERE lists.name IS NOT NULL), '[]') AS lists
      FROM project_references
      INNER JOIN videos ON videos.id = project_references.video_id
      INNER JOIN channels ON channels.id = videos.channel_id
      LEFT JOIN list_channels ON list_channels.channel_id = channels.id
      LEFT JOIN lists ON lists.id = list_channels.list_id
      WHERE project_references.project_id = ? AND project_references.id IN (${placeholders})
      GROUP BY project_references.id
      ORDER BY project_references.created_at DESC
    `).all(projectId, ...ids).map((row) => ({
      ...(row as Omit<PromptSourceVideo, "lists"> & { lists: string }),
      lists: parseJson((row as { lists: string }).lists, [] as string[]),
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
      tags: ["seed-video", "agent-ingested"],
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

  private completeStage(workflowRunId: number, stage: WorkflowStageKey, input: JsonRecord, output: JsonRecord) {
    db.prepare(`
      UPDATE workflow_stage_runs
      SET status = 'completed', input_json = ?, output_json = ?, updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP
      WHERE workflow_run_id = ? AND stage_key = ?
    `).run(JSON.stringify(input), JSON.stringify(output), workflowRunId, stage);
  }
}
