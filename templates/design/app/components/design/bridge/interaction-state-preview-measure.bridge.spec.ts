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

const FIXTURE = `<!doctype html><html><head><style>
[data-agent-native-node-id="alpha"][data-an-state-preview="hover"] { opacity: 0.91 !important; }
</style></head><body style="margin:0;padding:40px">
  <button data-agent-native-node-id="alpha" style="width:160px;height:48px;opacity:0.97">Alpha</button>
</body></html>`;

describe("element info under an interaction-state preview", () => {
  it("reports the element's default-state styles and leaves the preview on", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      const alpha = page.locator('[data-agent-native-node-id="alpha"]');

      await page.evaluate(() =>
        window.postMessage(
          {
            type: "state-preview",
            nodeId: "alpha",
            state: "hover",
            selector: '[data-agent-native-node-id="alpha"]',
          },
          "*",
        ),
      );
      await expect
        .poll(() => alpha.evaluate((node) => getComputedStyle(node).opacity))
        .toBe("0.91");

      const info = await page.evaluate(
        () =>
          new Promise<{ computedStyles?: Record<string, string> }[]>(
            (resolve) => {
              window.addEventListener("message", (event) => {
                if (event.data?.type === "agent-native:selectable-rects-result")
                  resolve(event.data.payload ?? []);
              });
              window.postMessage(
                {
                  type: "agent-native:collect-selectable-rects",
                  correlationId: "spec",
                  deep: true,
                  includePortableStyleSnapshot: false,
                  atPoint: { x: 120, y: 64 },
                },
                "*",
              );
            },
          ),
      );
      const alphaInfo = info.find(
        (entry) => (entry as { sourceId?: string }).sourceId === "alpha",
      );

      expect(alphaInfo?.computedStyles?.opacity).toBe("0.97");
      expect(await alpha.getAttribute("data-an-state-preview")).toBe("hover");
      expect(
        await alpha.evaluate((node) => getComputedStyle(node).opacity),
      ).toBe("0.91");
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});
