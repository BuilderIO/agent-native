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

const FIXTURE = `<!doctype html><html><body style="margin:0;position:relative;width:600px;height:400px">
  <section data-agent-native-node-id="row" style="position:absolute;left:40px;top:40px;width:300px;height:80px;display:flex;gap:12px">
    <div data-agent-native-node-id="first" style="width:100px;height:48px;background:#6366f1"></div>
    <div data-agent-native-node-id="second" style="width:100px;height:48px;background:#a855f7"></div>
  </section>
</body></html>`;

type DragStatePreview = { phase: string; anchorId?: string };

describe("held reorder preview", () => {
  it("is published again when the pointer leaves the screen and comes back to the same slot", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 600, height: 400 },
      });
      await page.setContent(FIXTURE);
      const previews: DragStatePreview[] = [];
      await page.exposeFunction("__pushPreview", (preview: DragStatePreview) =>
        previews.push(preview),
      );
      await page.evaluate(() => {
        window.addEventListener("message", (e: MessageEvent) => {
          if (
            e.data?.type === "agent-native:editor-drag-state" &&
            e.data.preview
          ) {
            (window as any).__pushPreview(e.data.preview);
          }
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.mouse.move(90, 64);
      await page.mouse.down();
      await page.mouse.move(110, 70, { steps: 4 });
      await page.mouse.move(400, 300, { steps: 8 });
      await page.waitForTimeout(30);
      const held = previews[previews.length - 1];
      expect(held?.phase, "precondition: a slot preview is held").toBe(
        "preview",
      );
      await page.mouse.move(-80, 80, { steps: 4 });
      await page.waitForTimeout(30);
      expect(
        previews[previews.length - 1]?.phase,
        "leaving clears the preview",
      ).toBe("clear");
      await page.mouse.move(400, 300, { steps: 4 });
      await page.waitForTimeout(30);
      await page.mouse.up();

      expect(previews[previews.length - 1]).toEqual(held);
    } finally {
      await browser.close();
    }
  });
});
