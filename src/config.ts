import dotenv from "dotenv";

dotenv.config();

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
  apiKey: requireEnv("API_KEY"),
  scanSchedule: process.env.SCAN_SCHEDULE ?? "0 6 * * *",
  defaultOutlierThreshold: Number(process.env.DEFAULT_OUTLIER_THRESHOLD ?? 3),
  databasePath: process.env.DATABASE_PATH ?? "./data/outlier.db",
  requestsPerSecond: Number(process.env.REQUESTS_PER_SECOND ?? 10),
};
