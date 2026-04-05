# OpenOutlier

OpenOutlier is an open-source, local-first YouTube outlier finder.

It is built for one narrow job:
- search YouTube for outliers in a niche
- browse strong videos quickly
- track interesting channels
- save the best references into collections

## What ships in this MVP

- Fastify API for discovery, tracked channels, collections, scans, and saved references
- Next.js local UI for Browse, Collections, Tracked Channels, and Connections
- SQLite storage for local/self-hosted use
- agent-friendly REST API, TypeScript SDK, MCP server, and CLI
- topic similarity and thumbnail similarity for browsing related outliers

## Product model

- `Browse`: the main feed for finding outliers
- `Tracked channels`: channels you want OpenOutlier to learn from and scan
- `Collections`: saved-video folders for references you want to keep
- `Connections`: API keys and local connection health

## Workspace layout

- `apps/api`: Fastify API and scan scheduler
- `apps/cli`: simple CLI for discovery tasks
- `apps/mcp`: MCP server exposing OpenOutlier as tools
- `apps/web`: local Next.js interface
- `packages/core`: scoring and similarity utilities
- `packages/sdk`: typed TypeScript client
- `packages/storage`: SQLite bootstrap and schema

## Requirements

- Node.js `20+`
- a YouTube Data API key
- optionally an OpenAI API key for embedding-backed similarity and channel niche matching
- optionally an API key if you want to protect the API for local agents or external clients

## Quick start

1. Copy `.env.example` to `.env`
2. Fill in the required values
3. Install dependencies with `npm install`
4. Start the app with `npm run dev`
5. Open [http://localhost:3000](http://localhost:3000)

Minimal `.env`:

```env
YOUTUBE_API_KEY=...
OPENAI_API_KEY=...
```

Optional local auth:

```env
API_KEY=choose-a-long-random-string
NEXT_PUBLIC_OPENOUTLIER_API_URL=http://localhost:3001
NEXT_PUBLIC_OPENOUTLIER_API_KEY=choose-a-long-random-string
```

## How to use it

1. Add your own channel or a few relevant channels to `Tracked channels`
2. Let OpenOutlier scan them
3. Use `Browse` to search a niche, pick a tracked source channel, or explore AI channel search
4. Save strong outliers into `Collections`

## Scripts

- `npm run dev`: run API and web locally
- `npm run build`: build all workspaces
- `npm run lint`: lint API and web
- `npm run test`: run core and API tests

## API highlights

- `GET /api/tracked-channels`
- `POST /api/tracked-channels`
- `GET /api/collections`
- `POST /api/collections`
- `GET /api/discover/outliers`
- `GET /api/discover/similar-topics`
- `GET /api/discover/similar-thumbnails`
- `POST /api/collections/:id/references`
- `POST /api/scan`

More detail lives in `docs/API.md`, with agent guidance in `docs/AGENTS.md`.

## Agent integrations

OpenOutlier can be consumed four ways:

- direct REST API
- the TypeScript SDK in `packages/sdk`
- the MCP server in `apps/mcp`
- the CLI in `apps/cli`

For local open-source use, the simplest mode is to leave `API_KEY` unset.
That means the local web UI works without a browser-exposed key, and local agents can call the API directly on `http://localhost:3001`.

## Notes

- YouTube search is quota-limited. If your quota is exhausted, OpenOutlier falls back to the local scanned pool where possible.
- The app is intentionally local-first, so some searches are slower than premium hosted tools that precompute large cloud indexes.

## License

[MIT](LICENSE)
