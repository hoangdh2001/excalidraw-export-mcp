#!/usr/bin/env node
/**
 * Test suite for excalidraw-export-mcp
 * Run: node test.js
 * Requires Node 18+ (uses node:test)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const {
  findSystemBrowser,
  buildExportHTML,
  injectFontIntoSVG,
  exportExcalidraw,
  handleGetExcalidrawInfo,
  handleExportExcalidraw,
} = require('./index.js');

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const SIMPLE_DIAGRAM = {
  type: 'excalidraw',
  version: 2,
  source: 'https://excalidraw.com',
  elements: [
    {
      type: 'rectangle', id: 'r1',
      x: 50, y: 50, width: 200, height: 80,
      strokeColor: '#8b5cf6', backgroundColor: '#d0bfff',
      fillStyle: 'solid', strokeWidth: 2, roughness: 1,
      roundness: { type: 3 }, boundElements: [{ id: 't1', type: 'text' }],
    },
    {
      type: 'text', id: 't1',
      x: 50, y: 50, width: 200, height: 80,
      text: 'Hello MCP', fontSize: 20, fontFamily: 1,
      textAlign: 'center', verticalAlign: 'middle',
      strokeColor: '#4c1d95', containerId: 'r1',
    },
    {
      type: 'ellipse', id: 'e1',
      x: 300, y: 50, width: 120, height: 80,
      strokeColor: '#22c55e', backgroundColor: '#b2f2bb',
      fillStyle: 'solid', strokeWidth: 2, roughness: 1,
      boundElements: [],
    },
    {
      type: 'arrow', id: 'a1',
      x: 250, y: 90, width: 50, height: 0,
      points: [[0, 0], [50, 0]],
      strokeColor: '#555555', strokeWidth: 2,
      endArrowhead: 'arrow', startArrowhead: null, roughness: 1,
      boundElements: [],
    },
  ],
  appState: { viewBackgroundColor: '#ffffff' },
  files: {},
};

// Temp dir for output files
const TMP_DIR = path.join(os.tmpdir(), `excalidraw-mcp-test-${Date.now()}`);
const FIXTURE_PATH = path.join(TMP_DIR, 'simple.excalidraw');

// ─── Setup / Teardown ─────────────────────────────────────────────────────────
before(() => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(FIXTURE_PATH, JSON.stringify(SIMPLE_DIAGRAM), 'utf8');
  console.log(`  Fixture: ${FIXTURE_PATH}`);
  console.log(`  Output:  ${TMP_DIR}`);
});

after(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

// ─── Unit: findSystemBrowser ──────────────────────────────────────────────────
describe('findSystemBrowser', () => {
  it('returns a string path or null', () => {
    const result = findSystemBrowser();
    assert.ok(
      result === null || typeof result === 'string',
      `Expected string or null, got ${typeof result}`
    );
  });

  it('if found, the path actually exists on disk', () => {
    const result = findSystemBrowser();
    if (result !== null) {
      assert.ok(fs.existsSync(result), `Browser path does not exist: ${result}`);
    }
  });
});

// ─── Unit: buildExportHTML ────────────────────────────────────────────────────
describe('buildExportHTML', () => {
  it('returns a non-empty HTML string', () => {
    const html = buildExportHTML(SIMPLE_DIAGRAM, {
      mimeType: 'image/png', quality: 1, scale: 2,
      background: true, darkMode: false,
    });
    assert.ok(typeof html === 'string' && html.length > 1000);
  });

  it('contains the Virgil @font-face declaration', () => {
    const html = buildExportHTML(SIMPLE_DIAGRAM, {
      mimeType: 'image/png', quality: 1, scale: 1,
      background: true, darkMode: false,
    });
    assert.ok(html.includes('font-family'), 'Missing font-family declaration');
    assert.ok(html.includes('Virgil'), 'Missing Virgil font name');
    assert.ok(html.includes('woff2'), 'Missing woff2 format');
    assert.ok(html.includes('data:font/woff2;base64,'), 'Missing base64 font data');
  });

  it('embeds the diagram data in the HTML', () => {
    const html = buildExportHTML(SIMPLE_DIAGRAM, {
      mimeType: 'image/png', quality: 1, scale: 1,
      background: true, darkMode: false,
    });
    assert.ok(html.includes('Hello MCP'), 'Diagram text not found in HTML');
  });

  it('uses exportToBlob for PNG/JPG', () => {
    const html = buildExportHTML(SIMPLE_DIAGRAM, {
      mimeType: 'image/png', quality: 1, scale: 2,
      background: true, darkMode: false,
    });
    assert.ok(html.includes('__exportToBlob'), 'Should use exportToBlob for PNG');
  });

  it('uses exportToSvg for SVG', () => {
    const html = buildExportHTML(SIMPLE_DIAGRAM, {
      mimeType: 'image/svg+xml', quality: 1, scale: 1,
      background: true, darkMode: false,
    });
    assert.ok(html.includes('__exportToSvg'), 'Should use exportToSvg for SVG');
    // Note: template includes both branches (if/else); only __exportToSvg is executed
    assert.ok(html.includes("mimeType === 'image/svg+xml'"), 'Should branch on SVG mime type');
  });

  it('passes darkMode flag correctly', () => {
    const light = buildExportHTML(SIMPLE_DIAGRAM, {
      mimeType: 'image/png', quality: 1, scale: 1,
      background: true, darkMode: false,
    });
    const dark = buildExportHTML(SIMPLE_DIAGRAM, {
      mimeType: 'image/png', quality: 1, scale: 1,
      background: true, darkMode: true,
    });
    assert.ok(light.includes('exportWithDarkMode: false'));
    assert.ok(dark.includes('exportWithDarkMode: true'));
  });
});

// ─── Unit: injectFontIntoSVG ──────────────────────────────────────────────────
describe('injectFontIntoSVG', () => {
  it('inserts <defs><style> block after opening <svg> tag', () => {
    const input = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const result = injectFontIntoSVG(input);
    assert.ok(result.includes('<defs>'), 'Missing <defs>');
    assert.ok(result.includes('@font-face'), 'Missing @font-face');
    assert.ok(result.includes('Virgil'), 'Missing Virgil in injected CSS');
    assert.ok(result.includes('data:font/woff2;base64,'), 'Missing base64 font data');
  });

  it('font block is inserted right after the opening <svg> tag', () => {
    const input = '<svg viewBox="0 0 100 100"><rect/></svg>';
    const result = injectFontIntoSVG(input);
    const svgTagEnd = result.indexOf('>') + 1;
    const defsStart = result.indexOf('<defs>');
    assert.ok(defsStart > 0 && defsStart <= svgTagEnd + 5,
      'Font defs should appear immediately after <svg> opening tag');
  });

  it('preserves the original SVG content', () => {
    const input = '<svg viewBox="0 0 200 200"><rect x="10" y="10" width="50" height="50"/></svg>';
    const result = injectFontIntoSVG(input);
    assert.ok(result.includes('<rect x="10"'), 'Original content should be preserved');
    assert.ok(result.startsWith('<svg'), 'Should still start with <svg');
  });

  it('output is valid enough to write as a file', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg"><text>Test</text></svg>';
    const result = injectFontIntoSVG(input);
    assert.ok(result.length > input.length, 'Output should be larger than input');
    assert.ok(result.includes('</svg>'), 'Should have closing </svg>');
  });
});

// ─── Unit: handleGetExcalidrawInfo ────────────────────────────────────────────
describe('handleGetExcalidrawInfo', () => {
  it('returns metadata string for a valid file', () => {
    const result = handleGetExcalidrawInfo({ input_path: FIXTURE_PATH });
    assert.ok(typeof result === 'string' && result.length > 0);
  });

  it('includes element counts', () => {
    const result = handleGetExcalidrawInfo({ input_path: FIXTURE_PATH });
    assert.ok(result.includes('4'), 'Should report 4 total elements');
    assert.ok(result.includes('rectangle: 1'));
    assert.ok(result.includes('text: 1'));
    assert.ok(result.includes('ellipse: 1'));
    assert.ok(result.includes('arrow: 1'));
  });

  it('includes canvas bounds', () => {
    const result = handleGetExcalidrawInfo({ input_path: FIXTURE_PATH });
    assert.ok(result.includes('Canvas bounds'), 'Should include canvas bounds');
  });

  it('includes background color', () => {
    const result = handleGetExcalidrawInfo({ input_path: FIXTURE_PATH });
    assert.ok(result.includes('#ffffff'), 'Should include background color');
  });

  it('throws for non-existent file', () => {
    assert.throws(
      () => handleGetExcalidrawInfo({ input_path: '/does/not/exist.excalidraw' }),
      /File not found/
    );
  });

  it('throws for invalid JSON', () => {
    const badPath = path.join(TMP_DIR, 'bad.excalidraw');
    fs.writeFileSync(badPath, 'not valid json');
    assert.throws(
      () => handleGetExcalidrawInfo({ input_path: badPath }),
      /Failed to read|SyntaxError|Unexpected token/
    );
  });
});

// ─── Integration: export PNG ──────────────────────────────────────────────────
describe('exportExcalidraw (integration)', () => {
  it('exports PNG and produces a valid file', async () => {
    const outPath = path.join(TMP_DIR, 'out.png');
    const result = await exportExcalidraw(FIXTURE_PATH, 'png', outPath, { scale: 1 });
    assert.ok(result.success, `Export failed: ${result.message}`);
    assert.ok(fs.existsSync(outPath), 'PNG file not created');
    const size = fs.statSync(outPath).size;
    assert.ok(size > 1000, `PNG too small (${size} bytes) — likely empty`);
    // PNG magic bytes: 89 50 4E 47
    const buf = fs.readFileSync(outPath);
    assert.equal(buf[0], 0x89);
    assert.equal(buf[1], 0x50); // P
    assert.equal(buf[2], 0x4E); // N
    assert.equal(buf[3], 0x47); // G
  });

  it('exports JPG and produces a valid file', async () => {
    const outPath = path.join(TMP_DIR, 'out.jpg');
    const result = await exportExcalidraw(FIXTURE_PATH, 'jpg', outPath, { scale: 1 });
    assert.ok(result.success);
    assert.ok(fs.existsSync(outPath));
    const size = fs.statSync(outPath).size;
    assert.ok(size > 1000, `JPG too small (${size} bytes)`);
    // JPEG magic bytes: FF D8 FF
    const buf = fs.readFileSync(outPath);
    assert.equal(buf[0], 0xFF);
    assert.equal(buf[1], 0xD8);
    assert.equal(buf[2], 0xFF);
  });

  it('exports SVG and produces valid XML with embedded font', async () => {
    const outPath = path.join(TMP_DIR, 'out.svg');
    const result = await exportExcalidraw(FIXTURE_PATH, 'svg', outPath);
    assert.ok(result.success);
    assert.ok(fs.existsSync(outPath));
    const content = fs.readFileSync(outPath, 'utf8');
    assert.ok(content.startsWith('<svg'), 'SVG should start with <svg');
    assert.ok(content.includes('</svg>'), 'SVG should end with </svg>');
    assert.ok(content.includes('@font-face'), 'SVG should have embedded @font-face');
    assert.ok(content.includes('Virgil'), 'SVG should reference Virgil font');
    assert.ok(content.includes('data:font/woff2;base64,'), 'SVG should have base64 font');
    assert.ok(content.length > 5000, 'SVG too small — likely empty');
  });

  it('PNG at scale:2 is at least as large as scale:1', async () => {
    const out1x = path.join(TMP_DIR, 'out_1x.png');
    const out2x = path.join(TMP_DIR, 'out_2x.png');
    await exportExcalidraw(FIXTURE_PATH, 'png', out1x, { scale: 1 });
    await exportExcalidraw(FIXTURE_PATH, 'png', out2x, { scale: 2 });
    const size1x = fs.statSync(out1x).size;
    const size2x = fs.statSync(out2x).size;
    // PNG compression may equalize sizes for simple diagrams, but 2x should never be smaller
    assert.ok(size2x >= size1x, `2x (${size2x}B) should not be smaller than 1x (${size1x}B)`);
  });

  it('creates output directory if it does not exist', async () => {
    const nestedOut = path.join(TMP_DIR, 'nested', 'deep', 'out.png');
    const result = await exportExcalidraw(FIXTURE_PATH, 'png', nestedOut, { scale: 1 });
    assert.ok(result.success);
    assert.ok(fs.existsSync(nestedOut), 'File should be created in nested dir');
  });

  it('throws for non-existent input file', async () => {
    // exportExcalidraw wraps fs errors as "Failed to read/parse..."
    await assert.rejects(
      () => exportExcalidraw('/no/such/file.excalidraw', 'png', path.join(TMP_DIR, 'x.png')),
      /Failed to read\/parse|Input file not found|ENOENT/
    );
  });
});

// ─── Integration: handleExportExcalidraw (default output path) ───────────────
describe('handleExportExcalidraw (default output path)', () => {
  it('auto-generates output path from input path when none given', async () => {
    // Copy fixture to a named location so the auto-name is predictable
    const src = path.join(TMP_DIR, 'mydiagram.excalidraw');
    fs.copyFileSync(FIXTURE_PATH, src);
    const expectedOut = path.join(TMP_DIR, 'mydiagram.png');

    const msg = await handleExportExcalidraw({ input_path: src, format: 'png' });
    assert.ok(fs.existsSync(expectedOut), 'Auto-named PNG should be created');
    assert.ok(msg.includes('mydiagram.png'), 'Message should include filename');
  });
});
