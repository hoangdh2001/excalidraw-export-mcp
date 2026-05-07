#!/usr/bin/env node
/**
 * excalidraw-export-mcp
 * MCP server that exports .excalidraw files to PNG, JPG, and SVG
 * using local Playwright + bundled @excalidraw/excalidraw (no internet required)
 * Virgil font is embedded as base64 for fully self-contained SVG output.
 *
 * Browser resolution order (zero config required):
 *   1. System Chrome / Chromium / Edge already installed on the machine
 *   2. Playwright's own Chromium (auto-installs on first use if missing)
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { chromium } = require('playwright');
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Paths resolved relative to this script ───────────────────────────────────
const BUNDLE_PATH = path.join(__dirname, 'excali_bundle.js');
const FONT_PATH   = path.join(__dirname, 'fonts', 'Virgil-Regular.woff2');

// Validate required files exist on startup
if (!fs.existsSync(BUNDLE_PATH)) {
  process.stderr.write(`[excalidraw-export-mcp] ERROR: excali_bundle.js not found at ${BUNDLE_PATH}\n`);
  process.exit(1);
}
if (!fs.existsSync(FONT_PATH)) {
  process.stderr.write(`[excalidraw-export-mcp] ERROR: Virgil-Regular.woff2 not found at ${FONT_PATH}\n`);
  process.exit(1);
}

// ─── Pre-load resources once at startup ───────────────────────────────────────
const bundleCode  = fs.readFileSync(BUNDLE_PATH, 'utf8');
const fontBase64  = fs.readFileSync(FONT_PATH).toString('base64');
const fontDataUrl = `data:font/woff2;base64,${fontBase64}`;
const fontFaceCSS = `@font-face { font-family: 'Virgil'; src: url('${fontDataUrl}') format('woff2'); font-weight: normal; font-style: normal; }`;

// ─── Browser detection ────────────────────────────────────────────────────────
/**
 * Look for a system Chrome/Chromium/Edge installation.
 * Returns the executable path string, or null if none found.
 */
function findSystemBrowser() {
  const platform = os.platform();

  const candidates = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/bin/microsoft-edge',
      '/snap/bin/chromium',
    ],
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
  };

  for (const p of (candidates[platform] || [])) {
    if (p && fs.existsSync(p)) {
      process.stderr.write(`[excalidraw-export-mcp] Using system browser: ${p}\n`);
      return p;
    }
  }
  return null;
}

/**
 * Ensure a usable browser is available.
 * Returns launch options object for chromium.launch().
 * Falls back to auto-installing Playwright Chromium if no system browser found.
 */
async function resolveLaunchOptions() {
  // 1. Try system browser first (zero install cost)
  const systemExec = findSystemBrowser();
  if (systemExec) {
    return { headless: true, executablePath: systemExec };
  }

  // 2. Check if Playwright's own Chromium is already installed
  try {
    // If this doesn't throw, Chromium exists
    await chromium.executablePath();
    process.stderr.write('[excalidraw-export-mcp] Using Playwright Chromium.\n');
    return { headless: true };
  } catch (_) {}

  // 3. Auto-install Playwright Chromium (runs once, ~100MB download)
  process.stderr.write('[excalidraw-export-mcp] No browser found. Auto-installing Playwright Chromium (one-time ~100MB download)...\n');
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'node_modules', 'playwright', 'cli.js'), 'install', 'chromium'],
    { stdio: 'inherit', timeout: 300_000 }
  );
  if (result.status !== 0) {
    throw new Error('Failed to auto-install Chromium. Please run: npx playwright install chromium');
  }
  process.stderr.write('[excalidraw-export-mcp] Chromium installed successfully.\n');
  return { headless: true };
}

// Resolve browser options once at startup (async — done before first export)
let _launchOptionsPromise = null;
function getLaunchOptions() {
  if (!_launchOptionsPromise) _launchOptionsPromise = resolveLaunchOptions();
  return _launchOptionsPromise;
}

process.stderr.write('[excalidraw-export-mcp] Resources loaded. Server starting...\n');

// ─── Core export function ─────────────────────────────────────────────────────
/**
 * Export a single .excalidraw file to the requested format.
 * @param {string} inputPath  - Absolute path to .excalidraw file
 * @param {string} format     - 'png' | 'jpg' | 'svg'
 * @param {string} outputPath - Absolute path for the output file
 * @param {object} opts       - { scale, background, darkMode }
 * @returns {Promise<{success: boolean, outputPath: string, size: number, message: string}>}
 */
async function exportExcalidraw(inputPath, format, outputPath, opts = {}) {
  const { scale = 2, background = true, darkMode = false } = opts;

  // Read and parse the .excalidraw file
  let excalidrawData;
  try {
    excalidrawData = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch (e) {
    throw new Error(`Failed to read/parse ${inputPath}: ${e.message}`);
  }

  // Ensure output directory exists
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Determine MIME type
  const mimeType = format === 'jpg' ? 'image/jpeg'
                 : format === 'svg' ? 'image/svg+xml'
                 : `image/${format}`;
  const quality  = format === 'jpg' ? 0.95 : 1;

  // Build self-contained HTML page
  const html = buildExportHTML(excalidrawData, { mimeType, quality, scale, background, darkMode });

  // Write HTML to a temp file
  const tmpHtml = path.join(os.tmpdir(), `excalidraw_export_${Date.now()}.html`);
  fs.writeFileSync(tmpHtml, html, 'utf8');

  let browser;
  try {
    const launchOptions = await getLaunchOptions();
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage();

    // Suppress console noise from the page
    page.on('console', () => {});
    page.on('pageerror', () => {});

    await page.goto(`file://${tmpHtml}`);
    await page.waitForFunction(() => window.__done === true, { timeout: 60000 });

    const exportError = await page.evaluate(() => window.__error);
    if (exportError) throw new Error(`Export failed in browser: ${exportError}`);

    if (format === 'svg') {
      let svgContent = await page.evaluate(() => window.__svgResult);
      // Inject Virgil @font-face into SVG for fully self-contained output
      svgContent = injectFontIntoSVG(svgContent);
      fs.writeFileSync(outputPath, svgContent, 'utf8');
    } else {
      const b64 = await page.evaluate(() => window.__pngResult);
      const prefix = format === 'jpg' ? 'data:image/jpeg;base64,' : 'data:image/png;base64,';
      const buffer = Buffer.from(b64.replace(prefix, ''), 'base64');
      fs.writeFileSync(outputPath, buffer);
    }

    const stat = fs.statSync(outputPath);
    return {
      success: true,
      outputPath,
      size: stat.size,
      message: `Exported to ${format.toUpperCase()}: ${outputPath} (${(stat.size / 1024).toFixed(1)} KB)`
    };
  } finally {
    if (browser) await browser.close();
    try { fs.unlinkSync(tmpHtml); } catch (_) {}
  }
}

/**
 * Build the self-contained HTML page that runs Excalidraw export.
 */
function buildExportHTML(excalidrawData, { mimeType, quality, scale, background, darkMode }) {
  const dataJson = JSON.stringify(excalidrawData);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    ${fontFaceCSS}
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: 1px; height: 1px; overflow: hidden; }
  </style>
</head>
<body>
<script>
${bundleCode}
</script>
<script>
(async function() {
  try {
    const diagramData = ${dataJson};
    // Bundle exposes these via window.__exportToSvg / window.__exportToBlob
    const exportToSvg  = window.__exportToSvg;
    const exportToBlob = window.__exportToBlob;

    const elements  = diagramData.elements || [];
    const appState  = {
      ...(diagramData.appState || {}),
      exportWithDarkMode: ${darkMode},
      exportBackground:   ${background},
    };
    const files = diagramData.files || {};

    const mimeType = ${JSON.stringify(mimeType)};

    if (mimeType === 'image/svg+xml') {
      const svgEl = await exportToSvg({ elements, appState, files });
      window.__svgResult = new XMLSerializer().serializeToString(svgEl);
      window.__done = true;
    } else {
      const blob = await exportToBlob({
        elements, appState, files,
        mimeType,
        quality: ${quality},
        scale:   ${scale},
      });
      const reader = new FileReader();
      reader.onloadend = () => {
        window.__pngResult = reader.result;
        window.__done = true;
      };
      reader.readAsDataURL(blob);
    }
  } catch (e) {
    window.__error = e.message || String(e);
    window.__done = true;
  }
})();
</script>
</body>
</html>`;
}

/**
 * Inject Virgil @font-face into an SVG string for self-contained output.
 */
function injectFontIntoSVG(svgString) {
  const fontFace = `<defs><style>${fontFaceCSS}</style></defs>`;
  // Insert after opening <svg ...> tag
  return svgString.replace(/(<svg[^>]*>)/, `$1\n  ${fontFace}`);
}

// ─── MCP Tool definitions ─────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'export_excalidraw',
    description: 'Export a .excalidraw file to PNG, JPG, or SVG image. Renders with authentic Virgil handwriting font and rough.js sketch style. SVG output is fully self-contained with embedded font.',
    inputSchema: {
      type: 'object',
      required: ['input_path', 'format'],
      properties: {
        input_path: {
          type: 'string',
          description: 'Absolute path to the .excalidraw file to export'
        },
        format: {
          type: 'string',
          enum: ['png', 'jpg', 'svg'],
          description: 'Output image format: png, jpg, or svg'
        },
        output_path: {
          type: 'string',
          description: 'Absolute path for the output file. Defaults to same directory as input with appropriate extension.'
        },
        scale: {
          type: 'number',
          description: 'Scale factor for raster exports (PNG/JPG). Default: 2 (2x resolution). Use 1 for normal, 3 for high-DPI.',
          default: 2
        },
        background: {
          type: 'boolean',
          description: 'Include background in export. Default: true',
          default: true
        },
        dark_mode: {
          type: 'boolean',
          description: 'Export with dark mode theme. Default: false',
          default: false
        }
      }
    }
  },
  {
    name: 'export_excalidraw_batch',
    description: 'Export multiple .excalidraw files in one call. Each item can specify its own format, output path, and options.',
    inputSchema: {
      type: 'object',
      required: ['exports'],
      properties: {
        exports: {
          type: 'array',
          description: 'List of export jobs to run',
          items: {
            type: 'object',
            required: ['input_path', 'format'],
            properties: {
              input_path:  { type: 'string', description: 'Absolute path to .excalidraw file' },
              format:      { type: 'string', enum: ['png', 'jpg', 'svg'] },
              output_path: { type: 'string', description: 'Output file path (optional)' },
              scale:       { type: 'number', default: 2 },
              background:  { type: 'boolean', default: true },
              dark_mode:   { type: 'boolean', default: false }
            }
          }
        }
      }
    }
  },
  {
    name: 'get_excalidraw_info',
    description: 'Read metadata from a .excalidraw file: element count, element types, canvas size, and app state.',
    inputSchema: {
      type: 'object',
      required: ['input_path'],
      properties: {
        input_path: {
          type: 'string',
          description: 'Absolute path to the .excalidraw file'
        }
      }
    }
  }
];

// ─── Tool handlers ────────────────────────────────────────────────────────────
async function handleExportExcalidraw(args) {
  const {
    input_path,
    format,
    output_path,
    scale      = 2,
    background = true,
    dark_mode  = false
  } = args;

  if (!fs.existsSync(input_path)) {
    throw new Error(`Input file not found: ${input_path}`);
  }

  // Default output path: same directory, same name, new extension
  const resolvedOutput = output_path || (() => {
    const dir  = path.dirname(input_path);
    const base = path.basename(input_path, '.excalidraw');
    return path.join(dir, `${base}.${format}`);
  })();

  const result = await exportExcalidraw(input_path, format, resolvedOutput, {
    scale,
    background,
    darkMode: dark_mode
  });

  return result.message;
}

async function handleExportExcalidrawBatch(args) {
  const { exports } = args;
  const results = [];

  for (const job of exports) {
    try {
      const msg = await handleExportExcalidraw(job);
      results.push(`✅ ${msg}`);
    } catch (e) {
      results.push(`❌ ${job.input_path} → ${job.format}: ${e.message}`);
    }
  }

  return results.join('\n');
}

function handleGetExcalidrawInfo(args) {
  const { input_path } = args;

  if (!fs.existsSync(input_path)) {
    throw new Error(`File not found: ${input_path}`);
  }

  const data = JSON.parse(fs.readFileSync(input_path, 'utf8'));
  const elements = data.elements || [];

  // Count element types
  const typeCounts = {};
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const el of elements) {
    typeCounts[el.type] = (typeCounts[el.type] || 0) + 1;
    if (el.x !== undefined) {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + (el.width || 0));
      maxY = Math.max(maxY, el.y + (el.height || 0));
    }
  }

  const width  = isFinite(maxX) ? Math.round(maxX - minX) : 0;
  const height = isFinite(maxY) ? Math.round(maxY - minY) : 0;

  const typeList = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `  ${t}: ${n}`)
    .join('\n');

  return [
    `File: ${path.basename(input_path)}`,
    `Version: ${data.version || 'unknown'} | Source: ${data.source || 'unknown'}`,
    `Elements: ${elements.length} total`,
    typeList,
    `Canvas bounds: ${width} × ${height} px (content area)`,
    `Background: ${data.appState?.viewBackgroundColor || '#ffffff'}`,
    `Grid: ${data.appState?.gridSize || 'off'}`,
    `Asset files: ${Object.keys(data.files || {}).length}`
  ].join('\n');
}

// ─── MCP Server setup ─────────────────────────────────────────────────────────
const server = new Server(
  { name: 'excalidraw-export-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      case 'export_excalidraw':
        result = await handleExportExcalidraw(args);
        break;

      case 'export_excalidraw_batch':
        result = await handleExportExcalidrawBatch(args);
        break;

      case 'get_excalidraw_info':
        result = handleGetExcalidrawInfo(args);
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: 'text', text: result }]
    };
  } catch (e) {
    return {
      content: [{ type: 'text', text: `Error: ${e.message}` }],
      isError: true
    };
  }
});

// ─── Start server ─────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[excalidraw-export-mcp] Server ready. Listening on stdio.\n');
}

if (require.main === module) {
  main().catch((e) => {
    process.stderr.write(`[excalidraw-export-mcp] Fatal: ${e.message}\n`);
    process.exit(1);
  });
}

// ─── Exports for testing ──────────────────────────────────────────────────────
module.exports = {
  findSystemBrowser,
  buildExportHTML,
  injectFontIntoSVG,
  exportExcalidraw,
  handleGetExcalidrawInfo,
  handleExportExcalidraw,
};
