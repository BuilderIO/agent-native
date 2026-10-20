import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "true")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("scroll-test"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const TALL_PAGE = `<!doctype html><html><body style="margin:0">
  <div style="height:3000px">a page taller than its frame</div>
</body></html>`;

async function setInteractionMode(page: Page, interact: boolean) {
  await page.evaluate((interact) => {
    window.postMessage({ type: "set-interaction-mode", interact }, "*");
  }, interact);
  // The bridge answers a message on the next task.
  await page.waitForTimeout(50);
}

const rootOverflow = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).overflow);

describe("the canvas bridge and a screen that scrolls in Interact", () => {
  // A clipped root is a hidden viewport in an editor frame: the wheel reaches
  // the page and moves nothing, though `scrollBy` still would.
  it(
    "clips the screen's document in Design and releases it while Interact owns the page",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(TALL_PAGE);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });

        expect(await rootOverflow(page)).toBe("clip");

        await setInteractionMode(page, true);
        expect(await rootOverflow(page)).not.toBe("clip");

        await setInteractionMode(page, false);
        expect(await rootOverflow(page)).toBe("clip");
      } finally {
        await browser.close();
      }
    },
  );
});
