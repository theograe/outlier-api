import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { OpenOutlierClient } from "@openoutlier/sdk";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const client = new OpenOutlierClient({
  baseUrl: process.env.OPENOUTLIER_BASE_URL ?? "http://localhost:3001",
  apiKey: requireEnv("OPENOUTLIER_API_KEY"),
});

const server = new McpServer({
  name: "openoutlier-mcp",
  version: "1.0.0",
});

function toStructuredContent(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }

  if (Array.isArray(payload)) {
    return { items: payload as unknown[] };
  }

  return { value: payload };
}

function textResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: toStructuredContent(payload),
  };
}

server.registerTool("list_projects", {
  description: "List OpenOutlier projects.",
}, async () => textResult(await client.listProjects()));

server.registerTool("create_project", {
  description: "Create a new OpenOutlier project.",
  inputSchema: z.object({
    name: z.string().min(1),
    niche: z.string().optional(),
    primaryChannelInput: z.string().optional(),
    competitorSourceSetName: z.string().optional(),
  }),
}, async (args) => textResult(await client.createProject(args)));

server.registerTool("get_project", {
  description: "Fetch one OpenOutlier project with source sets and saved references.",
  inputSchema: z.object({
    projectId: z.number().int(),
  }),
}, async ({ projectId }) => textResult(await client.getProject(projectId)));

server.registerTool("discover_channels", {
  description: "Discover YouTube channels for a source set.",
  inputSchema: z.object({
    sourceSetId: z.number().int(),
    query: z.string().optional(),
    niche: z.string().optional(),
    limit: z.number().int().min(1).max(25).optional(),
    autoAttach: z.boolean().optional(),
  }),
}, async ({ sourceSetId, ...input }) => textResult(await client.discoverChannels(sourceSetId, input)));

server.registerTool("add_channel_to_source_set", {
  description: "Attach a channel to a tracked source set.",
  inputSchema: z.object({
    sourceSetId: z.number().int(),
    channelUrl: z.string().optional(),
    channelId: z.string().optional(),
    handle: z.string().optional(),
  }),
}, async ({ sourceSetId, ...input }) => textResult(await client.addChannelToSourceSet(sourceSetId, input)));

server.registerTool("search_references", {
  description: "Search the scanned outlier feed for a project.",
  inputSchema: z.object({
    projectId: z.number().int(),
    sourceSetId: z.number().int().optional(),
    search: z.string().optional(),
    contentType: z.enum(["all", "long", "short"]).optional(),
    days: z.number().int().optional(),
    sort: z.enum(["score", "views", "date", "velocity", "momentum"]).optional(),
    order: z.enum(["asc", "desc"]).optional(),
    limit: z.number().int().optional(),
    minScore: z.number().optional(),
    maxScore: z.number().optional(),
    saveTop: z.number().int().optional(),
  }),
}, async ({ projectId, ...input }) => textResult(await client.searchReferences(projectId, input)));

server.registerTool("save_reference", {
  description: "Save a video as a project reference.",
  inputSchema: z.object({
    projectId: z.number().int(),
    sourceSetId: z.number().int().optional(),
    videoId: z.string(),
    notes: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
}, async ({ projectId, ...input }) => textResult(await client.saveReference(projectId, input)));

server.registerTool("import_reference_video", {
  description: "Import a single YouTube video directly as a saved reference.",
  inputSchema: z.object({
    projectId: z.number().int(),
    sourceSetId: z.number().int().optional(),
    videoId: z.string().optional(),
    videoUrl: z.string().optional(),
  }),
}, async ({ projectId, ...input }) => textResult(await client.importReferenceVideo(projectId, input)));

server.registerTool("trigger_scan", {
  description: "Start a scan for a source set's backing list.",
  inputSchema: z.object({
    listId: z.number().int().optional(),
  }),
}, async ({ listId }) => textResult(await client.triggerScan(listId)));

server.registerTool("get_scan_status", {
  description: "Fetch the current scan status.",
}, async () => textResult(await client.getScanStatus()));

const transport = new StdioServerTransport();
await server.connect(transport);
