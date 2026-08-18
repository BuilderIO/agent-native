import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(readOnly = false): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", String(readOnly))
    .replace("__TEXT_EDITING_ENABLED__", "true")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("interaction-test"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false");
}

// Three non-overlapping elements each painted above the shield's z-index
// (99990) — exactly the portal/toast/modal pattern real apps use that lets
// app content win paint order over the shield.
const raceContent = `<!doctype html><html><body>
  <a id="link" href="/escaped" style="position:fixed;top:0;left:0;z-index:2147483647;padding:8px;display:block">Navigate</a>
  <form id="form" action="/submitted" method="post" style="position:fixed;top:60px;left:0;z-index:2147483647">
    <button id="submitBtn" type="submit">Submit</button>
  </form>
  <button id="plainBtn" style="position:fixed;top:120px;left:0;z-index:2147483647">Click me</button>
  <script>
    window.__linkClicks = 0;
    window.__formSubmits = 0;
    window.__buttonClicks = 0;
    document.querySelector('#link').addEventListener('click', () => window.__linkClicks++);
    document.querySelector('#form').addEventListener('submit', (e) => { e.preventDefault(); window.__formSubmits++; });
    document.querySelector('#plainBtn').addEventListener('click', () => window.__buttonClicks++);
  </script>
</body></html>`;

describe("editor chrome edit-mode native-interaction net", () => {
  it(
    "blocks link navigation and form submit even when app content paints above the shield",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      const pageErrors: string[] = [];
      try {
        const page = await browser.newPage();
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.setContent(raceContent);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });

        const originalUrl = page.url();
        // These targets paint above the shield, so the browser dispatches
        // the click straight to them (this is the z-index race the net
        // guards against) — clicking through the shield itself is already
        // covered by the pre-existing shield listeners.
        await page.locator("#link").click({ force: true });
        await page.locator("#submitBtn").click({ force: true });
        await page.waitForTimeout(25);

        expect(page.url()).toBe(originalUrl);
        expect(
          await page.evaluate(() => ({
            linkClicks: (window as any).__linkClicks,
            formSubmits: (window as any).__formSubmits,
          })),
        ).toEqual({ linkClicks: 0, formSubmits: 0 });
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "blocks Enter/Space from activating a focused control regardless of z-index",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(raceContent);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });

        await page.locator("#link").focus();
        await page.keyboard.press("Enter");
        await page.locator("#plainBtn").focus();
        await page.keyboard.press("Space");
        await page.waitForTimeout(25);

        expect(
          await page.evaluate(() => ({
            linkClicks: (window as any).__linkClicks,
            buttonClicks: (window as any).__buttonClicks,
          })),
        ).toEqual({ linkClicks: 0, buttonClicks: 0 });
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "leaves native interaction alone when the bridge is read-only",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(raceContent);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(true),
        });

        // Same raced-above-the-shield target as the first test — only the
        // readOnly flag differs, isolating the net's own mode gate.
        await page.locator("#plainBtn").click({ force: true });
        await page.waitForTimeout(25);

        expect(await page.evaluate(() => (window as any).__buttonClicks)).toBe(
          1,
        );
      } finally {
        await browser.close();
      }
    },
  );
});
