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

const FIXTURE = `<!doctype html><html><body data-agent-native-node-id="page" style="margin:0">
  <div data-agent-native-node-id="icon" data-an-primitive="frame" style="position:absolute;left:100px;top:100px;width:24px;height:24px;background:#f59e0b"></div>
  <div data-agent-native-node-id="button" data-an-primitive="frame" style="position:absolute;left:100px;top:300px;display:flex;flex-direction:row;align-items:center;gap:8px;padding:12px 16px;background:#6366f1">
    <span data-agent-native-node-id="save-label" style="display:block;height:24px;font:600 16px/24px system-ui">Save</span>
  </div>
</body></html>`;

describe("Alt-drag copy into an auto-layout row", () => {
  it("sends the copy as a flow child, without the source's absolute placement", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      const duplicates: Array<{ cloneHtml: string; dropMode?: string }> = [];
      await page.exposeFunction(
        "__pushDuplicate",
        (message: { cloneHtml: string; dropMode?: string }) =>
          duplicates.push(message),
      );
      await page.evaluate(() => {
        window.addEventListener("message", (e: MessageEvent) => {
          if (e.data?.type === "visual-duplicate-change") {
            (window as any).__pushDuplicate({
              cloneHtml: e.data.cloneHtml,
              dropMode: e.data.dropMode,
            });
          }
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="icon"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);

      await page.mouse.move(112, 112);
      await page.keyboard.down("Alt");
      await page.mouse.down();
      await page.mouse.move(116, 160, { steps: 4 });
      await page.mouse.move(108, 324, { steps: 12 });
      await page.mouse.up();
      await page.keyboard.up("Alt");
      await page.waitForTimeout(30);

      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]!.dropMode).toBe("flow-insert");
      expect(duplicates[0]!.cloneHtml).not.toMatch(/position:\s*absolute/);
      expect(duplicates[0]!.cloneHtml).not.toMatch(/left:\s*\d/);
    } finally {
      await browser.close();
    }
  });
});
