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
  <div data-agent-native-node-id="box-a"
       style="position:absolute;left:30px;top:280px;width:120px;height:80px;background:#3b82f6"></div>
</body></html>`;

describe("free move commit", () => {
  it("saves nothing when the layer is dropped back where it started", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      const committed: Record<string, string>[] = [];
      await page.exposeFunction(
        "__pushCommit",
        (styles: Record<string, string>) => committed.push(styles),
      );
      await page.evaluate(() => {
        window.addEventListener("message", (e: MessageEvent) => {
          if (e.data?.type === "visual-style-change") {
            (window as any).__pushCommit(e.data.styles);
          }
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="box-a"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);
      const box = page.locator('[data-agent-native-node-id="box-a"]');

      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(290, 420, { steps: 8 });
      expect(
        await box.evaluate((el: HTMLElement) => el.style.left),
        "the layer follows the pointer away from its start",
      ).toBe("230px");
      await page.mouse.move(90, 320, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(30);

      expect(committed).toEqual([]);
      expect(
        await box.evaluate((el: HTMLElement) => [el.style.left, el.style.top]),
      ).toEqual(["30px", "280px"]);
    } finally {
      await browser.close();
    }
  });
});
