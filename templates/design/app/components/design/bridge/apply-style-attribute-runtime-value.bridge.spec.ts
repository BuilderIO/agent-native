import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("style-attr-test"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const initialHtml = (widget: string) =>
  `<!doctype html><html><head></head><body data-agent-native-node-id="an-body" style="background:rgb(255,255,255)">${widget}</body></html>`;

const WIDGET = `<div data-agent-native-node-id="widget">Widget</div>`;

async function replaceDocument(page: Page, html: string): Promise<void> {
  await page.evaluate((content) => {
    window.postMessage(
      {
        type: "replace-document-content",
        content,
        selectedSelector: "",
        selectorCandidates: [],
        forceFullDocument: true,
      },
      "*",
    );
  }, html);
  await page.waitForTimeout(50);
}

async function bodyBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

describe("applyStyleAttribute preserves a runtime-set value across a structural morph", () => {
  it("keeps a runtime-set background when the source's own value is unchanged", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.setContent(initialHtml(WIDGET));
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      await page.evaluate(() => {
        document.body.style.background = "rgb(11, 11, 11)";
      });
      expect(await bodyBackground(page)).toBe("rgb(11, 11, 11)");

      await replaceDocument(page, initialHtml(""));

      expect(
        await bodyBackground(page),
        "an unchanged source style must not reset the runtime's live value",
      ).toBe("rgb(11, 11, 11)");
      expect(
        await page.locator('[data-agent-native-node-id="widget"]').count(),
        "the structural edit itself must still have applied",
      ).toBe(0);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("still applies a genuine source style change over the runtime's value", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.setContent(initialHtml(WIDGET));
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      await page.evaluate(() => {
        document.body.style.background = "rgb(11, 11, 11)";
      });
      expect(await bodyBackground(page)).toBe("rgb(11, 11, 11)");

      const changedHtml =
        '<!doctype html><html><head></head><body data-agent-native-node-id="an-body" style="background:rgb(20,40,60)"></body></html>';
      await replaceDocument(page, changedHtml);

      expect(
        await bodyBackground(page),
        "a real source edit to the same property must still apply",
      ).toBe("rgb(20, 40, 60)");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("still drops a property the source stops declaring, when the live value still matches the old source", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.setContent(initialHtml(WIDGET));
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      const droppedHtml =
        '<!doctype html><html><head></head><body data-agent-native-node-id="an-body">' +
        WIDGET +
        "</body></html>";
      await replaceDocument(page, droppedHtml);

      expect(
        await page.evaluate(() => document.body.getAttribute("style")),
        "a property the source stops declaring, with no runtime divergence, must be dropped",
      ).toBeNull();
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});
