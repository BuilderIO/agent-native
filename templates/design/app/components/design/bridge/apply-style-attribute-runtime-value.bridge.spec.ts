import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

/**
 * Reproduces "screen stays white after delete/undo": a structural morph
 * (replaceRuntimeDocument -> morphRuntimeBody -> morphElement -> morphAttributes
 * -> applyStyleAttribute) must never let an UNCHANGED source style value reset
 * a property a runtime script (a theme toggle, Tailwind's CDN build) has since
 * set to something else live. Only a source value that is new or has actually
 * changed since the previous render may win.
 */
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

      // The theme script's effect, arriving after the bridge has already
      // hydrated (recorded body's source style as "background:rgb(255,255,255)").
      await page.evaluate(() => {
        document.body.style.background = "rgb(11, 11, 11)";
      });
      expect(await bodyBackground(page)).toBe("rgb(11, 11, 11)");

      // A structural edit (delete-widget): the body's OWN style declaration
      // in the source is unchanged, only a descendant is removed.
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

      // This time the SOURCE itself changes the property — a real edit must
      // still win, or the fix would just freeze the property forever.
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

      // No runtime write this time — the live value is still exactly the
      // source's own declared value.
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
