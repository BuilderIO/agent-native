import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Builds one labelled side-by-side PNG from a run's artifacts so a whole case
 * can be eyeballed in a single image.
 *
 * Usage: pnpm figma-fidelity:sheet <caseDir> [maxWidthPerPanel]
 */
import { chromium } from "@playwright/test";

const caseDir = process.argv[2];
if (!caseDir) throw new Error("usage: make-sheet <caseDir> [maxWidthPerPanel]");
const panelWidth = Number(process.argv[3] ?? 420);

const panels = [
  ["design (reference)", "design.png"],
  ["figma svg export", "export.png"],
  ["diff", "diff.png"],
  ["figma render", "figma.png"],
  ["our import", "import.png"],
].filter(([, file]) => existsSync(join(caseDir, file)));

if (!panels.length) throw new Error(`no known artifacts in ${caseDir}`);

const cells = panels
  .map(([label, file]) => {
    const dataUrl = `data:image/png;base64,${readFileSync(join(caseDir, file)).toString("base64")}`;
    return `<figure><img src="${dataUrl}"><figcaption>${label}</figcaption></figure>`;
  })
  .join("");

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: panelWidth * panels.length + 40, height: 400 },
});
// A local diagnostic sheet, not product UI: the dark ground and checkerboard
// exist so red diff pixels and transparent regions read clearly.
// guard:allow-raw-color — diagnostic artifact, not themed UI
await page.setContent(`<!doctype html><body style="margin:0;background:#111;font:12px system-ui;color:#eee">
<div id="sheet" style="display:inline-flex;gap:8px;padding:8px;align-items:flex-start">${cells}</div>
<style>
  figure{margin:0;display:block}
  img{display:block;width:${panelWidth}px;height:auto;background:
    /* guard:allow-raw-color — transparency checkerboard */
    repeating-conic-gradient(#333 0 25%, #222 0 50%) 0 0/16px 16px}
  figcaption{padding:4px 2px;opacity:.85}
</style></body>`);
await page.evaluate("globalThis.__name ||= (fn) => fn;");
await page.waitForFunction(() =>
  Array.from(document.images).every((i) => i.complete),
);
const png = await page.locator("#sheet").screenshot();
const out = join(caseDir, "sheet.png");
writeFileSync(out, png);
await browser.close();
console.log(out);
