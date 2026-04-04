# MCP

The MCP server exposes OpenOutlier as a small research toolset.

## Environment

- `OPENOUTLIER_BASE_URL`
- `OPENOUTLIER_API_KEY` if your local OpenOutlier instance has `API_KEY` enabled

## Available tools

- `list_projects`
- `create_project`
- `get_project`
- `discover_channels`
- `add_channel_to_source_set`
- `search_references`
- `save_reference`
- `import_reference_video`
- `trigger_scan`
- `get_scan_status`

## Typical flow

1. create or select a project
2. discover channels for a source set
3. attach the best channels
4. trigger a scan
5. search references
6. save the strongest references
