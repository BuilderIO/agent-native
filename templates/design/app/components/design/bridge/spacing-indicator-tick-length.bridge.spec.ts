import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

/**
 * Reported bug: on a selected Frame the top/bottom padding tick marks
 * rendered visibly longer than the left/right ticks. Root cause was
 * buildPaddingSpacingHandles deriving each orientation's tick length from a
 * different rect dimension (rect.width * 0.12 for horizontal ticks,
 * rect.height * 0.12 for vertical ticks) — the two only matched by
 * coincidence on a square element. Both orientations must share one tick
 * length derived from the same metric.
 *
 * Runs the real generated bridge in a real browser: layout-derived geometry
 * needs a real layout/paint engine, not happy-dom's stub.
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

// A wide, short frame with generous padding on all four edges: including
// padding, the frame's border box is 680x80. The old formula clamps the
// horizontal tick to 18px (680 * 0.12 = 81.6, clamped) while the vertical
// tick lands unclamped at 9.6px (80 * 0.12) — an easy-to-see 8px+ gap that
// survives any rounding.
const FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="frame" style="position:absolute;left:20px;top:20px;width:600px;height:40px;padding:20px;background:#333">
    <div style="width:20px;height:20px;background:#fff"></div>
  </div>
</body></html>`;

describe("padding indicator tick length", () => {
  it("renders horizontal and vertical padding ticks at the same visual length", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(FIXTURE);
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScript(),
      });

      const box = (await page
        .locator('[data-agent-native-node-id="frame"]')
        .boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

      await page.waitForFunction(
        () =>
          document.querySelectorAll(
            '[data-agent-native-spacing-line="padding"]',
          ).length === 4,
      );

      // Read the exact inline style length rather than offsetWidth/Height —
      // the browser rounds those to the nearest device pixel, which can mask
      // a several-tenths-of-a-pixel mismatch.
      const geometry = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll(
            '[data-agent-native-spacing-line="padding"]',
          ),
        ).map((node) => {
          const el = node as HTMLElement;
          return {
            width: parseFloat(el.style.width),
            height: parseFloat(el.style.height),
          };
        }),
      );

      expect(geometry).toHaveLength(4);
      // Push order in buildPaddingSpacingHandles is top, bottom (horizontal
      // — tick length is the node's width), then left, right (vertical —
      // tick length is the node's height).
      const [top, bottom, left, right] = geometry;
      const tickLengths = [top.width, bottom.width, left.height, right.height];

      for (const length of tickLengths) {
        expect(length).toBeCloseTo(tickLengths[0], 5);
      }
    } finally {
      await browser.close();
    }
  });
});
