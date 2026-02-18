# myinstants-mcp

MCP server for [myinstants.com](https://www.myinstants.com) — search and play millions of sound buttons from any AI agent.

## Setup

```bash
npm install
```

Add to your MCP client config:

```json
{
  "mcpServers": {
    "myinstants": {
      "command": "node",
      "args": ["/path/to/myinstants-mcp/server.js"]
    }
  }
}
```

## Architecture

| MCP Feature | Purpose |
|---|---|
| **Tool: `search_sounds`** | Search myinstants.com, returns matches with slugs |
| **Tool: `play_sound`** | Play by slug, URL, or quick search (streams directly) |
| **Resource: `myinstants://trending`** | Currently trending US sounds |

Sounds stream directly via `ffplay` or `mpv` — no download step. Queued playback prevents overlap.

## Environment

| Variable | Default | Description |
|---|---|---|
| `MYINSTANTS_VOLUME` | `0.5` | Playback volume (0-1) |

## Requirements

One of: `ffplay` (via ffmpeg) or `mpv` for streaming playback.
```bash
brew install ffmpeg  # macOS
sudo apt install ffmpeg  # Linux
```
