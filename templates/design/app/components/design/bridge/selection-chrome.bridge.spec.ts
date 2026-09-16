import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("selection-chrome"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const FIXTURE = `<!doctype html><html><body style="margin:0">
  <div id="auto-layout" style="display:flex;width:600px;height:400px;padding:20px;gap:20px">
    <div id="frame" data-agent-native-node-id="frame" data-an-primitive="frame" style="display:flex;width:300px;height:300px;background:#fff">
      <div id="child" data-agent-native-node-id="child" data-an-primitive="rectangle" style="width:80px;height:80px;background:#d4d4d8"></div>
    </div>
  </div>
</body></html>`;

async function select(page: import("@playwright/test").Page, selector: string) {
  await page.evaluate((value) => {
    window.postMessage(
      { type: "select-element", selector: value, selectorCandidates: [value] },
      "*",
    );
  }, selector);
  await page.waitForTimeout(50);
}

describe("editor chrome selection overlays", () => {
  it("does not double-outline a selected frame, but keeps the parent cue for child layers", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      await select(page, "#frame");
      expect(
        await page
          .locator('[data-agent-native-edit-overlay="parent-auto-layout"]')
          .evaluate((element) => (element as HTMLElement).style.display),
      ).toBe("none");
      expect(
        await page
          .locator('[data-agent-native-edit-overlay="selection"]')
          .evaluate((element) => (element as HTMLElement).style.display),
      ).toBe("block");
      expect(
        await page
          .locator('[data-agent-native-edit-handle="nw"]')
          .evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return {
              width: rect.width,
              height: rect.height,
              borderRadius: style.borderRadius,
            };
          }),
      ).toEqual({ width: 7, height: 7, borderRadius: "0px" });

      await select(page, "#child");
      expect(
        await page
          .locator('[data-agent-native-edit-overlay="parent-auto-layout"]')
          .evaluate((element) => (element as HTMLElement).style.display),
      ).toBe("block");
    } finally {
      await browser.close();
    }
  });
});
