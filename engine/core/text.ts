// Type for the clips, reels and thumbnails (2026-10-19, shared core): this ffmpeg has no text filters (no libass, no drawtext), so words
// are drawn by Chrome (playwright-core and Chrome, as the engine's renderer) into PNGs with transparency, in Plus
// Jakarta Sans, and ffmpeg lays the PNGs over the picture.
import path from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';
import { APP } from './media';

const FONT = path.join(APP, 'public', 'fonts', 'PlusJakartaSans.ttf');
export const INK = '#0A0A0A', BONE = '#F4F1EA', ASH = '#9A978F', GOLD = '#C9A84C';

const page0 = (w: number, h: number, body: string, css = '') => `<!doctype html><html><head><style>
@font-face { font-family: Jakarta; src: url("file://${FONT}"); font-weight: 200 800; }
html, body { margin: 0; width: ${w}px; height: ${h}px; background: transparent; overflow: hidden; }
body { font-family: Jakarta, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
${css}</style></head><body>${body}</body></html>`;

/** Renders each HTML body (w x h, transparent) to a PNG, in one Chrome. */
export async function renderPngs(w: number, h: number, jobs: { body: string; out: string; css?: string; opaque?: boolean }[]) {
  const { chromium } = await import(path.join(APP, 'node_modules', 'playwright-core', 'index.mjs'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    for (const j of jobs) {
      // from a file next to the output: a page set inline (about:blank) may not load local fonts and pictures
      const html = j.out.replace(/\.png$/, '.html');
      writeFileSync(html, page0(w, h, j.body, j.css));
      await page.goto(`file://${html}`, { waitUntil: 'load' });
      await page.evaluate(() => (document as any).fonts.ready);
      await page.screenshot({ path: j.out, omitBackground: !j.opaque, clip: { x: 0, y: 0, width: w, height: h } });
      rmSync(html);
    }
  } finally {
    await browser.close();
  }
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Straight quotes set badly at display sizes. */
export const curly = (s: string) => s.replace(/(\w)'(\w)/g, '$1’$2').replace(/'(\w)/g, '‘$1').replace(/'/g, '’').replace(/"(\S)/g, '“$1').replace(/"/g, '”');
