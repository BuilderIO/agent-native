import { chromium, type Browser } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(boardSurface: boolean): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "true")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("frame-label-test"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", boardSurface ? "true" : "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

// Mirrors a real screen document: one frame primitive as a direct child of
// <body>, which is the shape that made "has no frame ancestor" wrongly read as
// "is a top-level canvas object".
const content = `<!doctype html><html><head></head><body data-agent-native-layer-name="Screen 1" style="margin:0">
  <div data-agent-native-node-id="draft-frame-1" data-agent-native-layer-name="Frame" data-an-primitive="frame" style="position:absolute;left:184px;top:109px;width:382px;height:283px;background:#ffffff">
    <div data-agent-native-node-id="rect-1" data-agent-native-layer-name="Rectangle" data-an-primitive="rectangle" style="position:absolute;left:16px;top:16px;width:48px;height:48px;background:#d4d4d8"></div>
  </div>
</body></html>`;

async function frameLabelTexts(
  browser: Browser,
  boardSurface: boolean,
): Promise<string[]> {
  const page = await browser.newPage();
  try {
    await page.setContent(content);
    await page.addScriptTag({
      content: hydratedEditorChromeBridgeScript(boardSurface),
    });
    // The bridge paints labels on a requestAnimationFrame, so an immediate read
    // would report "no labels" before it has had a chance to draw any.
    await page.waitForTimeout(1_000);
    return await page.evaluate(() =>
      Array.from(
        document.querySelectorAll("[data-agent-native-frame-label]"),
        (label) => label.textContent ?? "",
      ),
    );
  } finally {
    await page.close();
  }
}

describe("editor chrome frame name labels", () => {
  // Both halves live in one case on purpose: the board-surface result is the
  // positive control that proves the empty screen-document result means
  // "suppressed" rather than "the bridge never drew anything".
  it(
    "labels a top-level board frame but nothing inside a screen document",
    { timeout: 60_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        expect(await frameLabelTexts(browser, true)).toEqual(["Frame"]);
        expect(await frameLabelTexts(browser, false)).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );
});
