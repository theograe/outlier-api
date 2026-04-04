# OpenOutlier

OpenOutlier is an open-source YouTube outlier finder. It helps you track channels in a niche, scan their recent uploads, surface standout videos, and save the best references for later.

The product is intentionally narrow:
- track your niche
- discover competitors
- scan channels
- filter the outlier feed
- save strong references

## What ships in this MVP

- Fastify API for projects, source sets, scanning, discovery, and saved references
- Next.js local UI for projects, discover, and settings
- SQLite storage for local/self-hosted use
- agent-friendly REST API, TypeScript SDK, MCP server, and CLI
- topic similarity for finding related outlier ideas

## Core model

- `Project`: one niche or research focus
- `Source Set`: a group of tracked channels inside a project
- `Reference`: a saved outlier video worth studying

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
- an API key for local auth
- an OpenAI API key if you want embedding-backed topic similarity

## Quick start

1. Copy `.env.example` to `.env`
2. Fill in the required values
3. Install dependencies with `npm install`
4. Start the app with `npm run dev`
5. Open [http://localhost:3000](http://localhost:3000)

Minimal `.env`:

```env
YOUTUBE_API_KEY=...
API_KEY=...
OPENAI_API_KEY=...
NEXT_PUBLIC_OPENOUTLIER_API_URL=http://localhost:3001
NEXT_PUBLIC_OPENOUTLIER_API_KEY=...
```

## Scripts

- `npm run dev`: run API and web locally
- `npm run build`: build all workspaces
- `npm run lint`: lint API and web
- `npm run test`: run core and API tests

## API highlights

- `POST /api/projects`
- `POST /api/projects/:id/source-sets`
- `POST /api/source-sets/:id/channels`
- `POST /api/source-sets/:id/discover`
- `POST /api/scan`
- `GET /api/discover/outliers`
- `POST /api/projects/:id/references`
- `POST /api/projects/:id/references/import-video`

More detail lives in [docs/API.md](/Users/theograeser/Documents/outlier%20api/docs/API.md), with agent guidance in [docs/AGENTS.md](/Users/theograeser/Documents/outlier%20api/docs/AGENTS.md).

## Agent integrations

OpenOutlier can be consumed four ways:

- direct REST API
- the TypeScript SDK in `packages/sdk`
- the MCP server in `apps/mcp`
- the CLI in `apps/cli`

## Archived spike

The previous thumbnail/adaptation work has been archived outside this repo at:

`/Users/theograeser/Documents/openoutlier-archive-2026-04-03/discovery-studio-spike`

## License

[MIT](LICENSE)
