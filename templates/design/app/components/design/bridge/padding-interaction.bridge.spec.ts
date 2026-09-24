import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("padding-test"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace("__LIVE_REFLOW_ENABLED__", "false")
    .replace("__SELECTED_LAYER_DRAG_PRIORITY__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const WIDE_FRAME = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="frame" style="position:absolute;left:20px;top:20px;width:600px;height:40px;padding:20px;background:#333">
    <div style="width:20px;height:20px;background:#fff"></div>
  </div>
</body></html>`;

const PADDING_FRAME = `<!doctype html><html><body style="margin:0">
  <div id="card" data-agent-native-node-id="card" style="position:absolute;left:200px;top:150px;width:360px;height:220px;padding:40px 30px 20px 10px;background:#333;box-sizing:border-box">
    <div style="width:20px;height:20px;background:#fff"></div>
  </div>
</body></html>`;

async function installBridge(page: import("@playwright/test").Page) {
  await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
  await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
}

describe("padding interaction bridge", () => {
  it("uses one visual tick length for horizontal and vertical padding indicators", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(WIDE_FRAME);
      await installBridge(page);

      const box = (await page
        .locator('[data-agent-native-node-id="frame"]')
        .boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForFunction(
        () =>
          document.querySelectorAll("[data-agent-native-spacing-line]")
            .length === 4,
      );

      const geometry = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll("[data-agent-native-spacing-line]"),
        ).map((node) => {
          const line = node as HTMLElement;
          return {
            width: parseFloat(line.style.width),
            height: parseFloat(line.style.height),
          };
        }),
      );
      const [top, bottom, left, right] = geometry;
      const tickLengths = [top.width, bottom.width, left.height, right.height];
      for (const length of tickLengths) {
        expect(length).toBeCloseTo(tickLengths[0], 5);
      }
    } finally {
      await browser.close();
    }
  });

  it("Shift-drag snaps all padding sides to the dragged value and scales them together", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      await page.setContent(PADDING_FRAME);
      await installBridge(page);

      await page.mouse.click(205, 160);
      await page.waitForSelector('[data-spacing-key="padding:top"]');
      const handle = page.locator('[data-spacing-key="padding:top"]');
      const handleBox = (await handle.boundingBox())!;
      const handleX = handleBox.x + handleBox.width / 2;
      const handleY = handleBox.y + handleBox.height / 2;

      await page.keyboard.down("Shift");
      await page.mouse.move(handleX, handleY);
      await page.mouse.down();

      const snapped = await page.evaluate(() => {
        const style = getComputedStyle(document.getElementById("card")!);
        return [
          style.paddingTop,
          style.paddingRight,
          style.paddingBottom,
          style.paddingLeft,
        ];
      });
      expect(snapped).toEqual(["40px", "40px", "40px", "40px"]);

      await page.mouse.move(handleX, handleY + 20, { steps: 5 });
      const scaled = await page.evaluate(() => {
        const style = getComputedStyle(document.getElementById("card")!);
        return [
          style.paddingTop,
          style.paddingRight,
          style.paddingBottom,
          style.paddingLeft,
        ];
      });
      expect(scaled).toEqual(["60px", "60px", "60px", "60px"]);

      await page.mouse.up();
      await page.keyboard.up("Shift");
    } finally {
      await browser.close();
    }
  });
});
