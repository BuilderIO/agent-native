import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedBoardBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "true")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("board"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "true")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "-4096")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "4096")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

describe("embedded board content offset bridge", () => {
  it("updates the rendered offset in a sandboxed read-only iframe", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(
        `<!doctype html><iframe id="board" sandbox="allow-scripts" srcdoc="<!doctype html><html><head><style>html,body{margin:0}body{position:relative;width:2000px;height:2000px}</style><style data-agent-native-content-offset>body > [data-agent-native-node-id]{translate:-4096px 4096px;}</style></head><body><div id='target' data-agent-native-node-id='target' style='position:absolute;left:1000px;top:1000px;width:100px;height:100px'></div></body></html>"></iframe>`,
      );
      const frame = page
        .frames()
        .find((candidate) => candidate !== page.mainFrame());
      expect(frame).toBeDefined();
      await frame!.addScriptTag({ content: hydratedBoardBridgeScript() });

      await page.evaluate(() => {
        window.frames[0]?.postMessage(
          { type: "set-content-offset", x: -8192, y: 2048 },
          "*",
        );
      });
      await frame!.waitForFunction(
        () =>
          document.querySelector("style[data-agent-native-content-offset]")
            ?.textContent ===
          "body > [data-agent-native-node-id]{translate:-8192px 2048px;}",
      );

      const rect = await frame!.locator("#target").evaluate((element) => {
        const { x, y } = element.getBoundingClientRect();
        return { x, y };
      });
      expect(rect).toEqual({ x: -7192, y: 3048 });

      await page.evaluate(() => {
        window.frames[0]?.postMessage(
          { type: "set-content-offset", x: "invalid", y: 2048 },
          "*",
        );
      });
      await frame!.waitForTimeout(10);
      expect(
        await frame!
          .locator("style[data-agent-native-content-offset]")
          .textContent(),
      ).toBe("body > [data-agent-native-node-id]{translate:-8192px 2048px;}");
    } finally {
      await browser.close();
    }
  });
});
