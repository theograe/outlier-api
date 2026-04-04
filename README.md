# OpenOutlier

OpenOutlier is an open-source YouTube outlier research engine for creator teams, agents, and operators. It helps you track channels, surface outlier videos, save references, adapt winning ideas to a target niche, and generate thumbnail directions and images from those references.

This repo is intentionally agent-first:
- a person can use the local UI
- a copilot can drive the workflow with human approvals
- an external agent can run the same workflow end-to-end over API

## What ships in the OSS MVP

- Fastify API for scans, discovery, research, workflows, settings, and media
- Next.js local UI for discover, projects, boards, ideas, and settings
- SQLite storage with schema boundaries designed for future Postgres migration
- OpenAI-backed text generation and topic embeddings with heuristic fallback
- Kie `nano-banana-2` thumbnail generation
- character profiles with reusable face-sheet references for thumbnail consistency
- workflow runs that support `manual`, `copilot`, and `auto` execution modes
- workflow entry from tracked channels, saved references, or a single seed video URL

## Product model

OpenOutlier is moving toward this canonical workflow model:

- `Project`: one niche or channel growth effort
- `Source Set`: your channel, competitors, or discovered channels
- `Reference`: a saved outlier used as inspiration
- `Concept`: an adapted idea package with titles, hooks, and thumbnail direction
- `Thumbnail Run`: generated images and prompt lineage
- `Workflow Run`: a guided pass through source discovery, research, adaptation, and thumbnail creation

Legacy compatibility routes like `/api/lists` and `/api/feed` still exist for backward compatibility, but the main local UI now runs on projects, source sets, references, concepts, boards, and workflow runs.

## Workspace layout

- `apps/api`: Fastify API, scan scheduler, workflow orchestration, AI/image integrations
- `apps/web`: local Next.js interface
- `packages/core`: scoring, similarity, prompt grounding, shared domain logic
- `packages/storage`: SQLite bootstrap and schema, structured to stay adapter-friendly

## Requirements

- Node.js `20+`
- a YouTube Data API key
- an OpenAI API key for text generation and embeddings
- a Kie API key for `nano-banana-2` image generation

## Quick start

1. Copy `.env.example` to `.env`
2. Fill in the required keys
3. Install dependencies with `npm install`
4. Start the app with `npm run dev`
5. Open [http://localhost:3000](http://localhost:3000)

Start in `/projects` if you want the workflow-native surface first. The legacy `/collections` route now redirects there.

Minimal `.env`:

```env
YOUTUBE_API_KEY=...
API_KEY=...
OPENAI_API_KEY=...
KIE_API_KEY=...
NEXT_PUBLIC_OPENOUTLIER_API_URL=http://localhost:3001
NEXT_PUBLIC_OPENOUTLIER_API_KEY=...
```

## Scripts

- `npm run dev`: run API and web locally
- `npm run build`: build all workspaces
- `npm run lint`: lint API and web
- `npm run test`: run core and API tests

## Agent-first workflow

The workflow engine is the core of the product. An agent can:

- create a project
- create or enrich source sets
- discover competitor channels automatically
- import a direct seed video
- search and save references
- generate adapted concepts
- generate thumbnails from reference context and character profiles

Key workflow endpoints:

- `POST /api/projects`
- `POST /api/source-sets/:id/discover`
- `POST /api/projects/:id/references/search`
- `POST /api/projects/:id/references/import-video`
- `POST /api/projects/:id/concepts/generate`
- `POST /api/projects/:id/thumbnails/generate`
- `POST /api/workflow-runs`
- `POST /api/workflow-runs/run-auto`
- `POST /api/workflow-runs/:id/advance`

More endpoint detail and example payloads live in [docs/API.md](docs/API.md).

## Auth

Every API endpoint except `GET /api/health` and local media under `/api/media/*` requires:

```http
x-api-key: your_api_key
```

The local UI uses `NEXT_PUBLIC_OPENOUTLIER_API_KEY` to talk to the API during development.

## AI and image generation

OpenAI is used for:
- grounded idea generation
- title generation
- thumbnail briefs and adaptation summaries
- topic embeddings for similar-topic search

Kie `nano-banana-2` is used for:
- face-sheet generation from uploaded reference photos
- final thumbnail image generation from adapted concepts and references

If no active OpenAI provider is saved in settings, the backend falls back to `OPENAI_API_KEY` from env.

## Current OSS defaults

- SQLite for local/self-hosted mode
- single workspace, but schema is written to be workspace-ready
- in-process scheduled scans for local use
- BYO API keys instead of hosted credentials
- workflow-first backend with compatibility routes kept during migration

## MVP status

This repo is ready for an open-source MVP release, but it is still an MVP:

- hosted multi-tenant deployment is not finished
- long-running jobs still run in-process locally
- compatibility list routes still exist for older integrations, but the primary UI is now project-native
- OAuth-based provider setup is not implemented yet

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
