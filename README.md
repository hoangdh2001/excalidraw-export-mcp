# excalidraw-export-mcp

MCP server for exporting `.excalidraw` files to **PNG**, **JPG**, and **SVG** — with authentic Virgil handwriting font and rough.js sketch style. Runs fully offline using a bundled copy of `@excalidraw/excalidraw` and headless Chromium via Playwright.

## Setup

### 1. Install dependencies

```bash
cd /path/to/excalidraw-export-mcp
npm install
npx playwright install chromium
```

### 2. Add to Claude Desktop config

Open `~/Library/Application Support/Claude/claude_desktop_config.json` and add:

```json
{
  "mcpServers": {
    "excalidraw-export": {
      "command": "node",
      "args": ["/path/to/excalidraw-export-mcp/index.js"]
    }
  }
}
```

Restart Claude Desktop to load the server.

---

## Tools

### `export_excalidraw`

Export a single `.excalidraw` file.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `input_path` | string | **required** | Absolute path to `.excalidraw` file |
| `format` | `png` \| `jpg` \| `svg` | **required** | Output format |
| `output_path` | string | auto | Output file path (defaults to same folder, same name) |
| `scale` | number | `2` | Resolution scale for PNG/JPG (1 = normal, 2 = 2×, 3 = 3×) |
| `background` | boolean | `true` | Include background color |
| `dark_mode` | boolean | `false` | Export with dark theme |

**Example prompt:**
> Export `/Users/me/diagrams/flow.excalidraw` to PNG at 3× resolution

### `export_excalidraw_batch`

Export multiple files in one call.

```json
{
  "exports": [
    { "input_path": "/path/to/a.excalidraw", "format": "png" },
    { "input_path": "/path/to/b.excalidraw", "format": "svg", "output_path": "/path/to/b-export.svg" },
    { "input_path": "/path/to/c.excalidraw", "format": "jpg", "scale": 3 }
  ]
}
```

### `get_excalidraw_info`

Read metadata from a `.excalidraw` file without exporting.

Returns element counts, canvas size, background color, and asset count.

---

## Notes

- **No internet required** — all rendering is done locally using the bundled Excalidraw library
- **SVG output** has the Virgil font embedded as base64, so it displays correctly anywhere
- **PNG/JPG** are rendered at `scale: 2` by default (retina-quality)
- The `excali_bundle.js` file (14 MB) must stay in the same directory as `index.js`
- The `fonts/Virgil-Regular.woff2` file must stay in the `fonts/` subdirectory
