// Lays several screenshots out as one labelled image, so one Read replaces
// many: a clip's frames as a contact sheet, or one issue's evidence side by
// side (clip | production before | Figma | local after).
//
//   node .agents/skills/design-clip-repro/harness/sheet.mjs "<title>" "<label>=<image>" ["<label>=<image>" ...]
//
// In a script:
//   import { sheet } from "<repo>/.agents/skills/design-clip-repro/harness/sheet.mjs";
//   const path = await sheet("flip export", [{ label: "Clip", image }, { label: "Local after", image }]);
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";

import { LAUNCH, SHOTS_DIR, chromium } from "./harness-env.mjs";

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const slug = (s) => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-|-$/g, "");

/** Writes a JPEG under SHOTS_DIR (or `out`) and returns its path. */
export async function sheet(title, cells, { columns = Math.min(cells.length, 4), cellWidth = 480, out } = {}) {
  const figures = cells
    .map((c) => {
      const mime = MIME[extname(c.image).toLowerCase()] ?? "image/png";
      const data = readFileSync(c.image).toString("base64");
      const caption = c.caption ? `<div class="cap">${escapeHtml(c.caption)}</div>` : "";
      return `<figure><figcaption>${escapeHtml(c.label)}</figcaption><img src="data:${mime};base64,${data}">${caption}</figure>`;
    })
    .join("");
  const html = `<!doctype html><html><head><style>
body{margin:0;background:#fff;font:13px system-ui,sans-serif;color:#111}
h1{margin:0;padding:10px 12px;font-size:15px}
main{display:grid;grid-template-columns:repeat(${columns},${cellWidth}px);gap:10px;padding:0 12px 12px}
figure{margin:0;border:1px solid #ddd;border-radius:6px;overflow:hidden}
figcaption{padding:6px 8px;background:#f4f4f5;font-weight:600}
img{display:block;width:100%}
.cap{padding:6px 8px;color:#444}
</style></head><body><h1>${escapeHtml(title)}</h1><main>${figures}</main></body></html>`;
  const browser = await chromium.launch(LAUNCH);
  try {
    const page = await browser.newPage({ viewport: { width: columns * (cellWidth + 10) + 14, height: 300 } });
    await page.setContent(html, { waitUntil: "load" });
    const path = out ?? `${SHOTS_DIR}/${slug(title)}.jpg`;
    await page.screenshot({ path, fullPage: true, type: "jpeg", quality: 82 });
    return path;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [title, ...pairs] = process.argv.slice(2);
  if (!title || pairs.length === 0) {
    console.error('usage: sheet.mjs "<title>" "<label>=<image>" ["<label>=<image>" ...]');
    process.exit(2);
  }
  const cells = pairs.map((pair) => {
    const i = pair.indexOf("=");
    return { label: pair.slice(0, i), image: pair.slice(i + 1) };
  });
  console.log(`sheet: ${await sheet(title, cells)} (open it with Read)`);
}
