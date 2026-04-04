import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ScanService } from "../services/scan-service.js";
import { WorkflowService } from "../services/workflow-service.js";
import { GoogleImageService } from "../services/google-image-service.js";

export async function registerWorkflowRoutes(app: FastifyInstance, scanService: ScanService): Promise<void> {
  const workflows = new WorkflowService(scanService);
  const images = new GoogleImageService();

  app.get("/api/projects", async () => workflows.listProjects());

  app.post("/api/projects", async (request, reply) => {
    const body = z.object({
      name: z.string().min(1),
      niche: z.string().optional().nullable(),
      primaryChannelInput: z.string().optional().nullable(),
      competitorSourceSetName: z.string().optional().nullable(),
    }).parse(request.body);

    const project = await workflows.createProjectAsync(body);
    reply.code(201);
    return project;
  });

  app.get("/api/projects/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    try {
      return workflows.getProject(id);
    } catch {
      return reply.notFound("Project not found.");
    }
  });

  app.get("/api/projects/:id/source-sets", async (request) => {
    const id = Number((request.params as { id: string }).id);
    return workflows.listSourceSets(id);
  });

  app.post("/api/projects/:id/source-sets", async (request, reply) => {
    const projectId = Number((request.params as { id: string }).id);
    const body = z.object({
      name: z.string().min(1),
      role: z.string().optional(),
      discoveryMode: z.string().optional(),
    }).parse(request.body);

    const sourceSet = workflows.createSourceSet(projectId, body);
    reply.code(201);
    return sourceSet;
  });

  app.get("/api/source-sets/:id", async (request, reply) => {
    const sourceSetId = Number((request.params as { id: string }).id);
    try {
      return workflows.getSourceSet(sourceSetId);
    } catch {
      return reply.notFound("Source set not found.");
    }
  });

  app.post("/api/source-sets/:id/channels", async (request, reply) => {
    const sourceSetId = Number((request.params as { id: string }).id);
    const body = z.object({
      channelUrl: z.string().optional(),
      channelId: z.string().optional(),
      handle: z.string().optional(),
      relationship: z.string().optional(),
    }).parse(request.body);

    const channel = await workflows.addChannelToSourceSet(sourceSetId, body);
    reply.code(201);
    return channel;
  });

  app.post("/api/source-sets/:id/discover", async (request) => {
    const sourceSetId = Number((request.params as { id: string }).id);
    const body = z.object({
      query: z.string().optional(),
      niche: z.string().optional(),
      limit: z.number().int().min(1).max(25).optional(),
      autoAttach: z.boolean().default(false),
    }).parse(request.body ?? {});

    return workflows.discoverChannels(sourceSetId, body);
  });

  app.post("/api/projects/:id/references/search", async (request) => {
    const projectId = Number((request.params as { id: string }).id);
    const body = z.object({
      sourceSetId: z.number().int().optional(),
      search: z.string().optional(),
      contentType: z.enum(["all", "long", "short"]).optional(),
      days: z.number().int().min(1).optional(),
      sort: z.enum(["score", "views", "date", "velocity", "momentum"]).optional(),
      order: z.enum(["asc", "desc"]).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      minScore: z.number().optional(),
      maxScore: z.number().optional(),
      minViews: z.number().optional(),
      maxViews: z.number().optional(),
      minSubscribers: z.number().optional(),
      maxSubscribers: z.number().optional(),
      minVelocity: z.number().optional(),
      maxVelocity: z.number().optional(),
      minDurationSeconds: z.number().optional(),
      maxDurationSeconds: z.number().optional(),
      saveTop: z.number().int().min(0).max(50).optional(),
    }).parse(request.body ?? {});

    return workflows.searchReferences(projectId, body);
  });

  app.get("/api/projects/:id/references", async (request) => {
    const projectId = Number((request.params as { id: string }).id);
    return workflows.listReferences(projectId);
  });

  app.post("/api/projects/:id/references", async (request, reply) => {
    const projectId = Number((request.params as { id: string }).id);
    const body = z.object({
      sourceSetId: z.number().int().optional().nullable(),
      videoId: z.string(),
      kind: z.string().optional(),
      notes: z.string().optional().nullable(),
      tags: z.array(z.string()).default([]),
    }).parse(request.body);

    const reference = workflows.saveReference(projectId, body);
    reply.code(201);
    return reference;
  });

  app.post("/api/projects/:id/references/import-video", async (request, reply) => {
    const projectId = Number((request.params as { id: string }).id);
    const body = z.object({
      sourceSetId: z.number().int().optional().nullable(),
      videoId: z.string().optional().nullable(),
      videoUrl: z.string().optional().nullable(),
    }).parse(request.body ?? {});

    const imported = await workflows.importReferenceVideo(projectId, body.sourceSetId ?? null, body.videoUrl ?? body.videoId ?? "");
    reply.code(201);
    return imported;
  });

  app.get("/api/projects/:id/concepts", async (request) => {
    const projectId = Number((request.params as { id: string }).id);
    return workflows.listConceptRuns(projectId);
  });

  app.get("/api/projects/:id/workflow-runs", async (request) => {
    const projectId = Number((request.params as { id: string }).id);
    return workflows.listWorkflowRuns(projectId);
  });

  app.get("/api/projects/:id/thumbnail-generations", async (request) => {
    const projectId = Number((request.params as { id: string }).id);
    return images.listGenerations(projectId);
  });

  app.post("/api/projects/:id/concepts/generate", async (request, reply) => {
    const projectId = Number((request.params as { id: string }).id);
    const body = z.object({
      referenceIds: z.array(z.number().int()).optional(),
      context: z.string().optional(),
      providerId: z.number().int().optional(),
    }).parse(request.body ?? {});

    const concept = await workflows.generateConcept(projectId, body);
    reply.code(201);
    return concept;
  });

  app.post("/api/projects/:id/thumbnails/generate", async (request, reply) => {
    const projectId = Number((request.params as { id: string }).id);
    const body = z.object({
      referenceIds: z.array(z.number().int()).optional(),
      prompt: z.string().optional(),
      context: z.string().optional(),
      characterProfileId: z.number().int().optional().nullable(),
      size: z.enum(["16:9", "3:2", "1:1", "2:3"]).default("16:9"),
    }).parse(request.body ?? {});

    const generation = await workflows.generateProjectThumbnail(projectId, body);
    reply.code(201);
    return generation;
  });

  app.post("/api/workflow-runs", async (request, reply) => {
    const body = z.object({
      projectId: z.number().int(),
      sourceSetId: z.number().int().optional().nullable(),
      mode: z.enum(["auto", "copilot", "manual"]).default("copilot"),
      targetNiche: z.string().optional().nullable(),
      targetChannelId: z.string().optional().nullable(),
      startStage: z.enum(["source_discovery", "reference_research", "concept_adaptation", "thumbnail_creation"]).optional(),
      stopAfterStage: z.enum(["source_discovery", "reference_research", "concept_adaptation", "thumbnail_creation"]).optional().nullable(),
      referenceIds: z.array(z.number().int()).optional(),
      seedVideoId: z.string().optional().nullable(),
      seedVideoUrl: z.string().optional().nullable(),
      input: z.record(z.string(), z.unknown()).default({}),
      runImmediately: z.boolean().default(false),
    }).parse(request.body ?? {});

    const workflowRun = await workflows.createWorkflowRunAsync(body);
    const result = body.runImmediately ? await workflows.advanceWorkflowRun(workflowRun.id, body.input) : workflowRun;
    reply.code(201);
    return result;
  });

  app.post("/api/workflow-runs/run-auto", async (request, reply) => {
    const body = z.object({
      projectId: z.number().int(),
      sourceSetId: z.number().int().optional().nullable(),
      targetNiche: z.string().optional().nullable(),
      targetChannelId: z.string().optional().nullable(),
      startStage: z.enum(["source_discovery", "reference_research", "concept_adaptation", "thumbnail_creation"]).optional(),
      stopAfterStage: z.enum(["source_discovery", "reference_research", "concept_adaptation", "thumbnail_creation"]).optional().nullable(),
      referenceIds: z.array(z.number().int()).optional(),
      seedVideoId: z.string().optional().nullable(),
      seedVideoUrl: z.string().optional().nullable(),
      input: z.record(z.string(), z.unknown()).default({}),
    }).parse(request.body ?? {});

    const workflowRun = await workflows.createWorkflowRunAsync({
      ...body,
      mode: "auto",
    });
    const result = await workflows.advanceWorkflowRun(workflowRun.id, body.input);
    reply.code(201);
    return result;
  });

  app.get("/api/workflow-runs/:id", async (request, reply) => {
    const workflowRunId = Number((request.params as { id: string }).id);
    try {
      return workflows.getWorkflowRun(workflowRunId);
    } catch {
      return reply.notFound("Workflow run not found.");
    }
  });

  app.post("/api/workflow-runs/:id/advance", async (request) => {
    const workflowRunId = Number((request.params as { id: string }).id);
    const body = z.record(z.string(), z.unknown()).default({}).parse(request.body ?? {});
    return workflows.advanceWorkflowRun(workflowRunId, body);
  });
}
