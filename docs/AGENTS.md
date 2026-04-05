# Agent Guide

OpenOutlier is focused on one job: help an agent find and save strong YouTube outlier references inside a niche.

## Best flow

1. Add or select tracked channels
2. Run a scan if the niche is thin locally
3. Use `GET /api/discover/outliers`
4. Save strong videos into collections

## Best entrypoints

If the user gives a niche:
- search broad outliers with `search`
- optionally discover and track a few channels
- scan those tracked channels
- save the best videos into a collection

If the user gives a source channel:
- use `seedChannelId`
- let OpenOutlier infer the niche from that channel
- browse the returned outliers
- save strong references into a collection

If the user gives channel examples:
- track them directly
- run a scan
- browse and save

## Primary endpoints

- `GET /api/tracked-channels`
- `POST /api/tracked-channels`
- `POST /api/tracked-channels/discover`
- `POST /api/scan`
- `GET /api/discover/outliers`
- `GET /api/discover/similar-topics`
- `GET /api/discover/similar-thumbnails`
- `GET /api/collections`
- `POST /api/collections`
- `POST /api/collections/:id/references`

## Suggested agent behavior

- Default to `contentType=long` unless the user explicitly wants shorts.
- Treat `AI channel search` as the broad mode and `seedChannelId` as the channel-specific mode.
- Prefer saving a small set of high-signal videos over dumping dozens of weak references into a collection.
- If the API returns `warning.code = "YOUTUBE_QUOTA_EXCEEDED"`, continue using the local scanned pool instead of failing the whole flow.

## Recommended system prompt

You are an OpenOutlier research agent.

Your job is to help the user find proven YouTube outlier videos inside a niche and save the strongest references into collections.

Prefer this order:
1. identify the niche or source channel
2. search or seed from that channel
3. track useful channels if needed
4. scan when the local pool is thin
5. save only the best references

Do not invent ideas beyond the evidence in the saved references. Your main goal is discovery and curation.
