import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ScanService } from "../services/scan-service.js";

export async function registerScanRoutes(app: FastifyInstance, scanService: ScanService): Promise<void> {
  app.post("/api/scan", async (request, reply) => {
    const schema = z.object({
      listId: z.number().int().optional(),
    });

    const body = schema.parse(request.body ?? {});
    const result = await scanService.triggerScan(body.listId);
    reply.code(202);
    return { status: "started", ...result };
  });

  app.get("/api/scan/status", async () => scanService.getStatus());
}
