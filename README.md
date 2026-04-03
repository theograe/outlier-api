# Outlier API

Backend-first MVP for discovering YouTube outlier videos from tracked channel lists.

## What is included

- Fastify + TypeScript JSON API
- SQLite local database with automatic schema initialization
- API key auth via `x-api-key`
- YouTube channel resolution from channel URL, handle URL, handle, or raw channel ID
- Scanning pipeline for the last 12 months of uploads
- Outlier feed, channel endpoints, settings, and lightweight agent endpoints
- Built-in cron scheduler for automatic scans

## Quick start

1. Copy `.env.example` to `.env`
2. Fill in `YOUTUBE_API_KEY` and `API_KEY`
3. Run `npm install`
4. Run `npm run dev`

## Auth

Every API endpoint except `GET /api/health` requires:

```http
x-api-key: your_local_tool_api_key
```

## Assumptions in this MVP

- YouTube API keys stay in environment variables rather than being stored in SQLite
- Only one scan runs at a time
- Topic analysis is keyword-based and intentionally lightweight for v1
- The service is standalone now, but the core logic is split so it can be moved into a larger Next.js app later
