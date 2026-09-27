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
      ).toEqual({ width: 7, height: 7, borderRadius: "2px" });

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

  it("keeps an overview-scale resize alive after the pointer leaves the iframe", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(
        '<div id="viewport" style="width:200px;height:140px;overflow:hidden">' +
          '<iframe id="preview" style="width:1280px;height:900px;border:0;transform:scale(0.15625);transform-origin:0 0"></iframe>' +
          "</div>",
      );
      const iframe = page.locator("#preview");
      const iframeHandle = await iframe.elementHandle();
      if (!iframeHandle) throw new Error("preview iframe did not mount");
      await iframe.evaluate((element) =>
        element.setAttribute(
          "srcdoc",
          '<!doctype html><html><body style="margin:0">' +
            '<div id="child" data-agent-native-node-id="child" style="position:absolute;left:20px;top:20px;width:200px;height:120px;background:#d4d4d8"></div>' +
            "</body></html>",
        ),
      );
      await page.waitForTimeout(50);
      const frame = await iframeHandle.contentFrame();
      if (!frame) throw new Error("preview iframe document was replaced");
      await frame.locator("#child").waitFor();
      await frame.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      const child = frame.locator("#child");
      const childBox = (await child.boundingBox())!;
      await page.mouse.click(
        childBox.x + childBox.width / 2,
        childBox.y + childBox.height / 2,
      );
      await page.waitForTimeout(200);

      const handle = frame.locator('[data-agent-native-edit-handle="se"]');
      const handleBox = (await handle.boundingBox())!;
      await page.mouse.move(
        handleBox.x + handleBox.width / 2,
        handleBox.y + handleBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(handleBox.x + 220, handleBox.y + 100, {
        steps: 12,
      });
      await page.mouse.up();

      const resized = await frame.locator("#child").evaluate((element) => ({
        width: (element as HTMLElement).style.width,
        height: (element as HTMLElement).style.height,
      }));
      expect(Number.parseFloat(resized.width)).toBeGreaterThan(200);
      expect(Number.parseFloat(resized.height)).toBeGreaterThan(120);
    } finally {
      await browser.close();
    }
  });
});
