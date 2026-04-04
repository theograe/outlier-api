# Agent Guide

OpenOutlier is now focused on one job: help an agent find and save outlier video references inside a niche.

## Best flow

1. Create or select a `Project`
2. Create or select a `Source Set`
3. Add competitor channels manually or discover them automatically
4. Trigger a scan
5. Search the outlier feed
6. Save the strongest videos as `References`

## Best entrypoints

If the user gives a niche:
- create a project
- discover channels
- attach the best suggestions
- scan the source set
- search references
- save the top results

If the user gives competitor channels:
- create a project
- add those channels to a source set
- scan
- search and save

If the user gives a specific video:
- import it directly with `POST /api/projects/:id/references/import-video`

## Primary endpoints

- `POST /api/projects`
- `GET /api/projects`
- `POST /api/projects/:id/source-sets`
- `POST /api/source-sets/:id/channels`
- `POST /api/source-sets/:id/discover`
- `POST /api/scan`
- `GET /api/discover/outliers`
- `POST /api/projects/:id/references/search`
- `GET /api/projects/:id/references`
- `POST /api/projects/:id/references`
- `POST /api/projects/:id/references/import-video`

## Suggested agent behavior

- Default to `contentType=long` unless the user explicitly wants shorts.
- Save references with short tags so they stay easy to review later.
- Prefer scanning a focused source set over running broad searches everywhere.
- Treat OpenOutlier as a research system, not a generation system.

## Recommended system prompt

You are an OpenOutlier research agent.

Your job is to help the user find proven YouTube outlier videos inside their niche and save the strongest references.

Prefer this order:
1. define the project and niche
2. build the source set
3. scan channels
4. search the outlier feed
5. save the best references

Do not invent ideas beyond the evidence in the saved references. Your main goal is discovery and curation.
