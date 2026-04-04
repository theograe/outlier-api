import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { ZodError } from "zod";
import { config } from "./config.js";
import { initializeDatabase } from "./db.js";
import { ScanService } from "./services/scan-service.js";
import { registerListRoutes } from "./routes/lists.js";
import { registerChannelRoutes } from "./routes/channels.js";
import { registerFeedRoutes } from "./routes/feed.js";
import { registerDiscoverRoutes } from "./routes/discover.js";
import { registerScanRoutes } from "./routes/scan.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerAgentRoutes } from "./routes/agent.js";
import { registerWorkflowRoutes } from "./routes/workflows.js";

export function buildApp() {
  initializeDatabase();

  const app = Fastify({ logger: true });
  const scanService = new ScanService();

  void app.register(cors, { origin: true });
  void app.register(sensible);

  app.get("/api/health", async () => ({
    ok: true,
    service: "OpenOutlier",
    timestamp: new Date().toISOString(),
  }));

  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/api/health") {
      return;
    }

    if (!config.apiKey) {
      return;
    }

    const apiKey = request.headers["x-api-key"];
    if (apiKey !== config.apiKey) {
      return reply.unauthorized("Invalid API key.");
    }
  });

  void registerListRoutes(app);
  void registerChannelRoutes(app);
  void registerFeedRoutes(app);
  void registerDiscoverRoutes(app);
  void registerScanRoutes(app, scanService);
  void registerSettingsRoutes(app, scanService);
  void registerAgentRoutes(app);
  void registerWorkflowRoutes(app, scanService);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "ValidationError",
        details: error.flatten(),
      });
    }

    app.log.error(error);
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    const name =
      typeof error === "object" && error !== null && "name" in error && typeof error.name === "string"
        ? error.name
        : "Error";
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected server error";

    return reply.status(statusCode).send({
      error: name,
      message,
    });
  });

  scanService.startScheduler();

  return app;
}
