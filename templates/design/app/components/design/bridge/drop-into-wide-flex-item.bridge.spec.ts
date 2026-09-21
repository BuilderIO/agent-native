import { fileURLToPath } from "node:url";

import { chromium, type Browser, type Page } from "@playwright/test";
import { buildSync } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const editorChromeBridgeSource = buildSync({
  entryPoints: [
    fileURLToPath(new URL("./editor-chrome.bridge.ts", import.meta.url)),
  ],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  write: false,
}).outputFiles[0]?.text;

function hydratedBridge(): string {
  if (!editorChromeBridgeSource) {
    throw new Error("Failed to compile editor chrome bridge for drop test");
  }
  return editorChromeBridgeSource
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("drop-screen"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

// Geometry copied from the reported design's closing section measured at a
// 1280px viewport: a 1120x208 flex row whose first item is a 430x96 block.
const PAGE = `<!doctype html><html><body style="margin:0;font:16px/1.4 Inter,sans-serif">
  <h2 data-agent-native-node-id="moving" style="margin:12px 0 10px;max-width:560px;font:700 48px/50.4px Inter,sans-serif">Make progress feel clear.</h2>
  <section data-agent-native-node-id="section" style="padding:96px 0">
    <div data-agent-native-node-id="closing" style="display:flex;justify-content:space-between;align-items:center;gap:30px;padding:56px;width:1120px;box-sizing:border-box;background:#15181b;color:#fff">
      <div data-agent-native-node-id="group">
        <div data-agent-native-node-id="eyebrow" style="font:12px/1.6 monospace">READY WHEN YOU ARE</div>
        <p data-agent-native-node-id="blurb" style="max-width:430px">Bring the real work into focus with a workspace designed for the next decision.</p>
      </div>
      <a data-agent-native-node-id="cta" href="#top" style="display:inline-block;padding:11px 17px;border:1px solid #fff;border-radius:999px">Start building &rarr;</a>
    </div>
  </section>
</body></html>`;

async function installBridge(page: Page): Promise<void> {
  await page.addScriptTag({ content: hydratedBridge() });
  await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
}

async function selectElementDirect(page: Page, selector: string) {
  await page.evaluate((sel) => {
    window.postMessage({ type: "select-element", selector: sel }, "*");
  }, selector);
  await page.waitForFunction((sel) => {
    const overlay = document.querySelector<HTMLElement>(
      '[data-agent-native-edit-overlay="selection"]',
    );
    const target = document.querySelector(sel);
    if (!overlay || !target) return false;
    return window.getComputedStyle(overlay).display === "block";
  }, selector);
}

describe("dropping a flow layer onto a wide flex-item container", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  it(
    "nests into the group the pointer is over, not beside it",
    { timeout: 30_000 },
    async () => {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
      });
      await page.setContent(PAGE, { waitUntil: "load" });
      await installBridge(page);

      // A drop landing on one of the group's children would nest for the
      // wrong reason, so pin the element actually under the pointer.
      const aim = await page.evaluate(() => {
        const group = document.querySelector(
          '[data-agent-native-node-id="group"]',
        ) as HTMLElement;
        const rect = group.getBoundingClientRect();
        const x = rect.left + rect.width * 0.13;
        const y = rect.bottom - 4;
        const hit = (document.elementsFromPoint(x, y) as HTMLElement[]).find(
          (el) => !el.hasAttribute("data-agent-native-edit-overlay"),
        );
        return {
          x,
          y,
          width: rect.width,
          hitId: hit?.getAttribute("data-agent-native-node-id") ?? null,
        };
      });
      expect(aim.hitId).toBe("group");
      // Only a container wide enough for the clamp to bite exercises the bug.
      expect(aim.width * 0.22).toBeGreaterThan(12);

      await selectElementDirect(page, '[data-agent-native-node-id="moving"]');
      const box = await page
        .locator('[data-agent-native-node-id="moving"]')
        .boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        box!.x + box!.width / 2 + 6,
        box!.y + box!.height / 2 + 6,
        { steps: 2 },
      );
      await page.mouse.move(aim.x, aim.y, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(80);

      const landed = await page.evaluate(() => {
        const el = document.querySelector(
          '[data-agent-native-node-id="moving"]',
        );
        if (!el) return { found: false, parentId: null };
        const p = el.parentElement;
        return {
          found: true,
          parentId: p?.getAttribute("data-agent-native-node-id") ?? null,
        };
      });
      await page.close();

      expect(landed.found).toBe(true);
      expect(landed.parentId).toBe("group");
    },
  );
});
