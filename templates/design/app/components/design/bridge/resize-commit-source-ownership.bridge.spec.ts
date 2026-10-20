import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("resize-commit"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace("__LIVE_REFLOW_ENABLED__", "false")
    .replace("__SELECTED_LAYER_DRAG_PRIORITY__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const SELECTOR = '[data-agent-native-node-id="rect"]';

const documentHtml = (width: number, height: number) =>
  `<!doctype html><html><body style="margin:0">` +
  `<div ${SELECTOR.slice(1, -1)} style="position:absolute;left:0px;top:0px;width:${width}px;height:${height}px;background:#333"></div>` +
  `</body></html>`;

function sizeOf(style: string | null): { width: number; height: number } {
  return {
    width: Number(/width:\s*([\d.]+)px/.exec(style ?? "")?.[1] ?? NaN),
    height: Number(/height:\s*([\d.]+)px/.exec(style ?? "")?.[1] ?? NaN),
  };
}

async function replaceDocument(page: Page, html: string): Promise<void> {
  await page.evaluate(
    ([content, selector]) =>
      window.postMessage(
        {
          type: "replace-document-content",
          content,
          selectedSelector: selector,
          selectorCandidates: [selector],
          forceFullDocument: true,
        },
        "*",
      ),
    [html, SELECTOR] as const,
  );
  await page.waitForTimeout(50);
}

describe("resize commit refreshes source ownership", () => {
  it("undo's full-document reconcile reverts a resized element's live geometry", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(documentHtml(120, 90));
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      const el = page.locator(SELECTOR);
      const before = (await el.boundingBox())!;
      await page.mouse.click(
        before.x + before.width / 2,
        before.y + before.height / 2,
      );
      await page.waitForTimeout(200);

      const handle = page.locator('[data-agent-native-edit-handle="se"]');
      const handleBox = (await handle.boundingBox())!;
      const hx = handleBox.x + handleBox.width / 2;
      const hy = handleBox.y + handleBox.height / 2;

      await page.mouse.move(hx, hy);
      await page.mouse.down();
      await page.mouse.move(hx + 96, hy + 64, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(100);

      const resized = sizeOf(await el.getAttribute("style"));
      expect(resized.width).toBeCloseTo(216, 0);
      expect(resized.height).toBeCloseTo(154, 0);

      const sourceMetaStyle = await page.evaluate(
        (selector) =>
          (
            document.querySelector(selector) as Element & {
              __anSourceMeta?: { style: string };
            }
          ).__anSourceMeta?.style ?? null,
        SELECTOR,
      );
      expect(
        sizeOf(sourceMetaStyle),
        "source-ownership baseline must match the committed size, not the pre-resize size",
      ).toEqual(resized);

      await replaceDocument(page, documentHtml(120, 90));

      const reverted = sizeOf(await el.getAttribute("style"));
      expect(
        reverted,
        "the live element must return to its pre-resize size after undo's reconcile",
      ).toEqual({ width: 120, height: 90 });
    } finally {
      await browser.close();
    }
  });
});
