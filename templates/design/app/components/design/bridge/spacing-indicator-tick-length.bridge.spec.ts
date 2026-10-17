import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("live-screen"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="frame" style="position:absolute;left:20px;top:20px;width:600px;height:40px;padding:20px;background:#333">
    <div style="width:20px;height:20px;background:#fff"></div>
  </div>
</body></html>`;

describe("padding indicator tick length", () => {
  it("renders horizontal and vertical padding ticks at the same visual length", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(FIXTURE);
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScript(),
      });

      const box = (await page
        .locator('[data-agent-native-node-id="frame"]')
        .boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

      await page.waitForFunction(
        () =>
          document.querySelectorAll(
            '[data-agent-native-spacing-line="padding"]',
          ).length === 4,
      );

      const geometry = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll(
            '[data-agent-native-spacing-line="padding"]',
          ),
        ).map((node) => {
          const el = node as HTMLElement;
          return {
            width: parseFloat(el.style.width),
            height: parseFloat(el.style.height),
          };
        }),
      );

      expect(geometry).toHaveLength(4);
      const [top, bottom, left, right] = geometry;
      const tickLengths = [top.width, bottom.width, left.height, right.height];

      for (const length of tickLengths) {
        expect(length).toBeCloseTo(tickLengths[0], 5);
      }
    } finally {
      await browser.close();
    }
  });
});
