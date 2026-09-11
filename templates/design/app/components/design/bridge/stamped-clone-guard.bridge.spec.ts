import { chromium } from "@playwright/test";
import { expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydrated(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("stamped-clone"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

/**
 * Projecting template bodies stamps them, so Alpine copies that id onto every
 * clone. Clone detection keyed on "has a stable id" then reads every clone as
 * real source and switches eight protections off at once — the reorder
 * rejection, the text-edit rejection, and every anchor-candidate filter.
 */
const PAGE = `<!doctype html><html><head><style>
  html,body{margin:0} ul{list-style:none;padding:0;margin:0;width:260px}
  li{height:44px;border:1px solid #ccc;box-sizing:border-box}
</style></head><body>
  <ul data-agent-native-node-id="an-list">
    <template x-for="t in todos" data-agent-native-node-id="an-tpl"><li data-agent-native-node-id="an-row"></li></template>
    <li data-agent-native-node-id="an-row">Walk the dog</li>
    <li data-agent-native-node-id="an-row">Buy milk</li>
  </ul>
</body></html>`;

it(
  "a clone that inherited its template body's id is still refused a reorder",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.setContent(PAGE);
      await page.addScriptTag({ content: hydrated() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      const rows = await page.locator("li").all();
      const first = (await rows[0]!.boundingBox())!;
      const second = (await rows[1]!.boundingBox())!;
      const startX = first.x + first.width / 2;
      const startY = first.y + first.height / 2;

      await page.mouse.click(startX, startY);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX - 5, startY - 5, { steps: 3 });
      await page.mouse.move(startX, second.y + second.height - 5, {
        steps: 10,
      });
      await page.waitForTimeout(90);

      const midDrag = await page.evaluate(() => {
        const guide = document.querySelector<HTMLElement>(
          "[data-agent-native-insertion-guide]",
        );
        const badge = document.querySelector<HTMLElement>(
          "[data-agent-native-transform-badge]",
        );
        return {
          guideVisible: guide
            ? window.getComputedStyle(guide).display === "block"
            : false,
          badge:
            badge && window.getComputedStyle(badge).display !== "none"
              ? badge.textContent
              : null,
        };
      });

      expect(midDrag.guideVisible).toBe(false);
      expect(midDrag.badge).toMatch(/can.t reorder/i);

      await page.mouse.up();
      await page.waitForTimeout(90);

      const order = await page.evaluate(() =>
        Array.from(document.querySelectorAll("li")).map((el) =>
          el.textContent?.trim(),
        ),
      );
      expect(order).toEqual(["Walk the dog", "Buy milk"]);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);
