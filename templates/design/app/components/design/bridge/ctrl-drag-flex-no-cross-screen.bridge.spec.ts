import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

/**
 * Figma parity (unique-paths-5): Ctrl/Cmd-drag overrides a flex/auto-layout
 * parent's normal reorder-only drag resistance, letting the child move (or
 * leave the row) freely. Reported bug: the drag instead got claimed by the
 * host's cross-screen reparent path the moment the pointer crossed the
 * screen's rendered edge, which has no ctrl-awareness at all — so the
 * child never actually left the flex row.
 *
 * Runs the real generated bridge in a real browser: flex layout and
 * getBoundingClientRect need a real layout engine, not happy-dom's stub.
 */
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

// Mirrors e2e/global-setup.ts's FIXTURE_HTML shape: an outer flex-COLUMN
// (`main`, normal document flow, not absolutely positioned) containing a
// nested flex-ROW of two named buttons, plus a trailing flow sibling to
// drop onto — the exact structure parity-unique-paths.spec.ts's real e2e
// test drags against.
const FIXTURE = `<!doctype html><html><body style="margin:0">
  <main style="display:flex;flex-direction:column;gap:16px;padding:24px">
    <div data-agent-native-node-id="row" data-agent-native-layer-name="Row"
         style="display:flex;flex-direction:row;gap:8px">
      <div data-agent-native-node-id="alpha" data-agent-native-layer-name="Alpha"
           style="width:100px;height:60px;background:#3b82f6"></div>
      <div data-agent-native-node-id="beta" data-agent-native-layer-name="Beta"
           style="width:100px;height:60px;background:#22c55e"></div>
    </div>
    <div data-agent-native-node-id="footer" data-agent-native-layer-name="Footer"
         style="width:100px;height:60px;background:#f59e0b"></div>
  </main>
</body></html>`;

describe("Ctrl-drag out of an auto-layout parent", () => {
  it("never posts a cross-screen-drag message, and the child actually leaves the row", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      const crossScreenMessages: string[] = [];
      await page.exposeFunction("__pushCrossScreen", (phase: string) =>
        crossScreenMessages.push(phase),
      );
      await page.evaluate(() => {
        window.addEventListener("message", (e: MessageEvent) => {
          const data = e.data as { type?: string; phase?: string };
          if (data?.type === "agent-native:cross-screen-drag") {
            (window as any).__pushCrossScreen(data.phase ?? "");
          }
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      // Select Alpha directly via the same postMessage the Layers panel
      // uses (app/components/design/bridge/editor-chrome.bridge.ts's
      // "select-element" handler) — a click here would hit container-first
      // selection ("row" first, since nothing is selected yet), which this
      // test does not need to exercise.
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="alpha"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(50);

      await page.mouse.move(74, 54);
      await page.keyboard.down("Control");
      await page.mouse.down();
      await page.mouse.move(74, 130, { steps: 10 });
      await page.waitForTimeout(50);
      await page.mouse.up();
      await page.keyboard.up("Control");
      await page.waitForTimeout(50);

      expect(
        crossScreenMessages,
        "a ctrl-drag overriding auto-layout resistance must never hand the gesture to the host's cross-screen path",
      ).toEqual([]);

      const rowHtml = await page
        .locator('[data-agent-native-node-id="row"]')
        .evaluate((el) => el.outerHTML);
      expect(
        rowHtml.includes('data-agent-native-node-id="alpha"'),
        `Ctrl-drag should be able to pull Alpha out of the flex row against normal auto-layout drag resistance; row still contains it: ${rowHtml}`,
      ).toBe(false);
    } finally {
      await browser.close();
    }
  });
});
