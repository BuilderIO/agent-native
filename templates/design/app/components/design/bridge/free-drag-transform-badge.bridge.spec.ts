import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("free-drag-badge"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="root-frame" data-an-primitive="frame"
       style="position:absolute;left:48px;top:48px;width:120px;height:80px;background:#f97316"></div>
</body></html>`;

describe("free-position drag transform badge", () => {
  it("shows the held Option duplicate cue for a root frame", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="root-frame"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(50);

      const root = page.locator('[data-agent-native-node-id="root-frame"]');
      const box = (await root.boundingBox())!;
      const start = {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      };
      await page.mouse.move(start.x, start.y);
      await page.keyboard.down("Alt");
      await page.mouse.down();
      try {
        await page.mouse.move(start.x + 6, start.y + 3, { steps: 2 });
        await expect(
          page
            .locator("[data-agent-native-transform-badge]")
            .evaluate((element) => ({
              display: getComputedStyle(element).display,
              text: element.textContent,
            })),
        ).resolves.toEqual({ display: "block", text: "Duplicate layer" });
      } finally {
        await page.mouse.up();
        await page.keyboard.up("Alt");
      }
    } finally {
      await browser.close();
    }
  });
});
