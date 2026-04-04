import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const candidatePaths = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../../.env"),
];

for (const candidatePath of candidatePaths) {
  if (fs.existsSync(candidatePath)) {
    dotenv.config({ path: candidatePath });
    break;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  youtubeApiKey: requireEnv("YOUTUBE_API_KEY"),
  apiKey: process.env.API_KEY ?? "",
  scanSchedule: process.env.SCAN_SCHEDULE ?? "0 6 * * *",
  defaultOutlierThreshold: Number(process.env.DEFAULT_OUTLIER_THRESHOLD ?? 3),
  databasePath: process.env.DATABASE_PATH ?? path.resolve(process.cwd(), "../../data/outlier.db"),
  requestsPerSecond: Number(process.env.REQUESTS_PER_SECOND ?? 10),
  defaultLlmModel: process.env.OPENOUTLIER_DEFAULT_LLM_MODEL ?? "gpt-4.1-mini",
  defaultEmbeddingsModel: process.env.OPENOUTLIER_EMBEDDINGS_MODEL ?? "text-embedding-3-small",
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  mediaRoot: process.env.OPENOUTLIER_MEDIA_ROOT ?? path.resolve(process.cwd(), "../../data/media"),
};
