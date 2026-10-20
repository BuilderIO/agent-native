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

const SCREEN = `<!doctype html><html><body style="margin:0;position:relative;width:600px;height:400px">
  <section data-agent-native-node-id="row" style="position:absolute;left:40px;top:40px;width:240px;padding:16px;display:flex;flex-direction:column;gap:12px">
    <div data-agent-native-node-id="a" style="width:180px;height:48px;background:#6366f1"></div>
    <div data-agent-native-node-id="b" style="width:180px;height:48px;background:#a855f7"></div>
    <div data-agent-native-node-id="c" style="width:180px;height:48px;background:#ec4899"></div>
  </section>
</body></html>`;

describe("held reorder inside an editor iframe", () => {
  it("survives the editor moving keyboard focus out of the iframe mid-drag", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(
        `<!doctype html><html><body style="margin:0"><div id="surface" tabindex="-1"></div><iframe id="screen" style="position:absolute;left:0;top:0;width:600px;height:400px;border:0"></iframe></body></html>`,
      );
      await page.evaluate((html) => {
        (document.getElementById("screen") as HTMLIFrameElement).srcdoc = html;
      }, SCREEN);
      const frame = page.frameLocator("#screen");
      await frame.locator('[data-agent-native-node-id="a"]').waitFor();
      const screen = page
        .frames()
        .find((candidate) => candidate !== page.mainFrame())!;
      await screen.addScriptTag({
        content: hydratedEditorChromeBridgeScript(),
      });
      await frame.locator('[data-agent-native-edit-overlay="shield"]').waitFor({
        state: "attached",
      });
      await page.evaluate(() => {
        (window as any).__structureChanges = 0;
        window.addEventListener("message", (event) => {
          if (event.data?.type === "visual-structure-change") {
            (window as any).__structureChanges += 1;
          }
        });
      });
      await page.locator("#screen").focus();
      expect(
        await screen.evaluate(() => document.hasFocus()),
        "precondition: keyboard focus is inside the screen, as after text editing",
      ).toBe(true);

      await page.mouse.move(146, 80);
      await page.mouse.down();
      await page.mouse.move(150, 90, { steps: 4 });
      await page.evaluate(() => document.getElementById("surface")!.focus());
      await page.mouse.move(146, 186, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(50);

      expect(
        await screen.evaluate(() =>
          Array.from(
            document.querySelector('[data-agent-native-node-id="row"]')!
              .children,
          ).map((child) => child.getAttribute("data-agent-native-node-id")),
        ),
      ).toEqual(["b", "a", "c"]);
      expect(
        await page.evaluate(() => (window as any).__structureChanges),
      ).toBe(1);
    } finally {
      await browser.close();
    }
  });
});
