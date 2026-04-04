#!/usr/bin/env node

import { OpenOutlierClient } from "@openoutlier/sdk";

function usage() {
  console.log(`OpenOutlier CLI

Commands:
  discover --source-set <id> [--query <text>] [--limit <n>] [--auto-attach]
  import-video --project <id> --video <url> [--source-set <id>]
  scan --list <id>

Environment:
  OPENOUTLIER_BASE_URL   Default: http://localhost:3001
  OPENOUTLIER_API_KEY    Required unless API_KEY is set
`);
}

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h") {
    usage();
    process.exit(0);
  }

  const apiKey = process.env.OPENOUTLIER_API_KEY ?? process.env.API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENOUTLIER_API_KEY or API_KEY.");
  }

  const client = new OpenOutlierClient({
    baseUrl: process.env.OPENOUTLIER_BASE_URL ?? "http://localhost:3001",
    apiKey,
  });

  if (command === "discover") {
    const sourceSetId = Number(readFlag("--source-set"));
    if (!sourceSetId) {
      throw new Error("discover requires --source-set.");
    }
    const query = readFlag("--query");
    const limit = readFlag("--limit") ? Number(readFlag("--limit")) : undefined;
    const autoAttach = hasFlag("--auto-attach");

    const result = await client.discoverChannels(sourceSetId, {
      query,
      limit,
      autoAttach,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "import-video") {
    const projectId = Number(readFlag("--project"));
    const sourceSetId = readFlag("--source-set") ? Number(readFlag("--source-set")) : undefined;
    const videoUrl = readFlag("--video");

    if (!projectId || !videoUrl) {
      throw new Error("import-video requires --project and --video.");
    }

    const result = await client.importReferenceVideo(projectId, {
      sourceSetId,
      videoUrl,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "scan") {
    const listId = Number(readFlag("--list"));
    if (!listId) {
      throw new Error("scan requires --list.");
    }

    const result = await client.triggerScan(listId);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
