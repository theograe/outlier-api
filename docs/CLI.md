# CLI

The CLI is a thin wrapper around the API.

## Commands

### Discover channels

```bash
node apps/cli/dist/index.js discover --source-set 1 --query "premiere pro tutorials"
```

### Import one reference video

```bash
node apps/cli/dist/index.js import-video --project 1 --video "https://www.youtube.com/watch?v=abc123xyz89"
```

### Trigger a scan

```bash
node apps/cli/dist/index.js scan --list 1
```

## Environment

- `OPENOUTLIER_BASE_URL`
- `OPENOUTLIER_API_KEY` or `API_KEY`
