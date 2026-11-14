import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedBridge(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("home"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const FIXTURE = `<!doctype html><html><body style="margin:0;width:800px;height:600px">
  <div data-agent-native-node-id="box" style="position:absolute;left:40px;top:60px;width:120px;height:80px;background:#3b82f6"></div>
</body></html>`;

type BoundsMessage = {
  type?: string;
  screenId?: string;
  rect?: { left: number; top: number; width: number; height: number } | null;
};

describe("screen selection bounds for the canvas rulers", () => {
  it("reports the selected layer's extent, then null once it is deselected", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedBridge() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await page.evaluate(() => {
        (window as any).__bounds = [];
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.data?.type === "agent-native:screen-selection-bounds") {
            (window as any).__bounds.push(event.data);
          }
        });
      });
      const latest = () =>
        page.evaluate(() => {
          const bounds = (window as any).__bounds as BoundsMessage[];
          return bounds[bounds.length - 1];
        });

      await page.mouse.click(100, 100);
      await page.waitForTimeout(150);
      expect(await latest()).toMatchObject({
        screenId: "home",
        rect: { left: 40, top: 60, width: 120, height: 80 },
      });

      await page.keyboard.press("Escape");
      await page.mouse.click(600, 500);
      await page.waitForTimeout(150);
      expect(await latest()).toMatchObject({ screenId: "home", rect: null });
    } finally {
      await browser.close();
    }
  });
});
