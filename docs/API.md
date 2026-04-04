# API

If `API_KEY` is set, protected routes require:

```http
x-api-key: your_api_key
```

If `API_KEY` is not set, local requests work without auth.

## Health

### `GET /api/health`

Returns service health.

## Projects

### `GET /api/projects`

List projects.

### `POST /api/projects`

Create a project.

```json
{
  "name": "Editing educators",
  "niche": "English video editing tutorials",
  "primaryChannelInput": "@yourchannel"
}
```

### `GET /api/projects/:id`

Return one project with source sets and saved references.

## Source sets

### `POST /api/projects/:id/source-sets`

Create a source set.

### `GET /api/source-sets/:id`

Fetch one source set with tracked channels.

### `POST /api/source-sets/:id/channels`

Attach a channel to a source set.

```json
{
  "handle": "@the_nicks_edit"
}
```

### `POST /api/source-sets/:id/discover`

Discover competitor channels for a source set.

```json
{
  "query": "premiere pro tutorials",
  "limit": 8,
  "autoAttach": false
}
```

## Scanning

### `POST /api/scan`

Start a scan.

```json
{
  "listId": 1
}
```

### `GET /api/scan/status`

Fetch current scan status.

## Discovery

### `GET /api/discover/outliers`

Search the scanned outlier feed.

Useful query params:
- `projectId`
- `sourceSetId`
- `search`
- `contentType=all|long|short`
- `days`
- `minScore`
- `minViews`
- `minSubscribers`
- `minVelocity`
- `sort=score|views|date|velocity|momentum`
- `order=asc|desc`
- `limit`

### `GET /api/discover/similar-topics?videoId=...`

Return title/topic-neighbor videos.

### `GET /api/discover/niches`

Return topic clusters from recent outliers.

## References

### `POST /api/projects/:id/references/search`

Search within a project and optionally auto-save the top results.

```json
{
  "sourceSetId": 1,
  "contentType": "long",
  "days": 365,
  "minScore": 3,
  "sort": "momentum",
  "saveTop": 5
}
```

### `GET /api/projects/:id/references`

List saved references for a project.

### `POST /api/projects/:id/references`

Save one video as a reference.

```json
{
  "sourceSetId": 1,
  "videoId": "abc123xyz89",
  "tags": ["hook", "editing"]
}
```

### `POST /api/projects/:id/references/import-video`

Import a direct YouTube video as a saved reference.

```json
{
  "sourceSetId": 1,
  "videoUrl": "https://www.youtube.com/watch?v=abc123xyz89"
}
```
