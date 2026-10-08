import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(
  chromeScale: number,
  boardSurface = false,
): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "true")
    .replace("__EDITOR_CHROME_SCALE_X__", String(chromeScale))
    .replace("__EDITOR_CHROME_SCALE_Y__", String(chromeScale))
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("text-edit"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", String(boardSurface))
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace("__LIVE_REFLOW_ENABLED__", "false")
    .replace("__SELECTED_LAYER_DRAG_PRIORITY__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const content = `<!doctype html><html><head></head><body data-agent-native-node-id="an-body" style="margin:0">
  <div data-agent-native-node-id="tx" data-an-primitive="text" style="position:absolute;left:40px;top:40px;width:max-content;font:64px/1.2 monospace;color:rgb(10, 20, 30)">AI work</div>
</body></html>`;

const boardContent = `<!doctype html><html><head></head><body data-agent-native-node-id="an-body" style="margin:0">
  <div data-agent-native-node-id="frame" data-an-primitive="frame" style="position:absolute;left:20px;top:20px;width:400px;height:200px;background:#fff;overflow:hidden">
    <div data-agent-native-node-id="tx" data-an-primitive="text" style="position:absolute;left:20px;top:40px;width:max-content;font:64px/1.2 monospace;color:rgb(10, 20, 30)">AI work</div>
  </div>
</body></html>`;

async function openTextEdit(
  page: Page,
  chromeScale = 1,
  boardSurface = false,
): Promise<void> {
  await page.setContent(boardSurface ? boardContent : content);
  await page.addScriptTag({
    content: hydratedEditorChromeBridgeScript(chromeScale, boardSurface),
  });
  await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
  const box = (await page
    .locator('[data-agent-native-node-id="tx"]')
    .boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForSelector("[data-agent-native-text-editing]");
}

function charX(page: Page, index: number): Promise<{ x: number; y: number }> {
  return page.evaluate((i) => {
    const text = document.querySelector('[data-agent-native-node-id="tx"]')!
      .firstChild as Text;
    const range = document.createRange();
    range.setStart(text, i);
    range.setEnd(text, i + 1);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + 1, y: rect.top + rect.height / 2 };
  }, index);
}

const selectionText = (page: Page) =>
  page.evaluate(() => window.getSelection()!.toString());

describe("text edit mode native pointer selection", () => {
  it(
    "selects all text on the double-click that enters edit mode",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await openTextEdit(page);
        expect(await selectionText(page)).toBe("AI work");
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "places the caret on click and selects by drag, double-click, and triple-click",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await openTextEdit(page);
        const before = await page
          .locator('[data-agent-native-node-id="tx"]')
          .boundingBox();

        const w = await charX(page, 3);
        await page.mouse.click(w.x, w.y);
        expect(
          await page.evaluate(() => window.getSelection()!.anchorOffset),
        ).toBe(3);

        const end = await charX(page, 6);
        await page.mouse.move(w.x, w.y);
        await page.mouse.down();
        await page.mouse.move(end.x + 30, end.y, { steps: 8 });
        await page.mouse.up();
        expect(await selectionText(page)).toBe("work");

        const a = await charX(page, 0);
        await page.mouse.dblclick(a.x + 4, a.y);
        expect(await selectionText(page)).toBe("AI");

        await page.mouse.click(a.x + 4, a.y, { clickCount: 3 });
        expect((await selectionText(page)).trim()).toBe("AI work");

        expect(
          await page.locator('[data-agent-native-node-id="tx"]').boundingBox(),
        ).toEqual(before);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "draws a caret one screen pixel wide in the text colour when zoomed out",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await openTextEdit(page, 0.25);
        const w = await charX(page, 3);
        await page.mouse.click(w.x, w.y);
        const caret = page.locator(
          '[data-agent-native-edit-overlay="text-caret"]',
        );
        await expect
          .poll(() => caret.evaluate((el) => getComputedStyle(el).display))
          .toBe("block");
        const drawn = await caret.evaluate((el) => ({
          width: parseFloat(getComputedStyle(el).width),
          color: getComputedStyle(el).backgroundColor,
          nativeCaret: getComputedStyle(
            document.querySelector("[data-agent-native-text-editing]")!,
          ).caretColor,
        }));
        expect(drawn).toEqual({
          width: 4,
          color: "rgb(10, 20, 30)",
          nativeCaret: "rgba(0, 0, 0, 0)",
        });

        await page.keyboard.press("Shift+ArrowRight");
        await expect
          .poll(() => caret.evaluate((el) => getComputedStyle(el).display))
          .toBe("none");
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "moves the caret on click inside a board frame's text after entering edit mode",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await openTextEdit(page, 1, true);
        expect(await selectionText(page)).toBe("AI work");

        const w = await charX(page, 3);
        await page.mouse.click(w.x, w.y);
        expect(
          await page.evaluate(() => ({
            collapsed: window.getSelection()!.isCollapsed,
            offset: window.getSelection()!.anchorOffset,
            editing: document.querySelectorAll(
              "[data-agent-native-text-editing]",
            ).length,
          })),
        ).toEqual({ collapsed: true, offset: 3, editing: 1 });
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "uses caretPositionFromPoint when caretRangeFromPoint is unavailable",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await openTextEdit(page);
        await page.evaluate(() => {
          const text = document.querySelector(
            '[data-agent-native-node-id="tx"]',
          )!.firstChild!;
          Object.defineProperty(document, "caretPositionFromPoint", {
            configurable: true,
            value: () => ({ offsetNode: text, offset: 3 }),
          });
          Object.defineProperty(document, "caretRangeFromPoint", {
            configurable: true,
            value: undefined,
          });
        });

        const point = await charX(page, 5);
        await page
          .locator('[data-agent-native-node-id="tx"]')
          .evaluate((element, coordinates) => {
            element.dispatchEvent(
              new MouseEvent("mousedown", {
                bubbles: true,
                cancelable: true,
                button: 0,
                detail: 1,
                clientX: coordinates.x,
                clientY: coordinates.y,
              }),
            );
          }, point);
        expect(
          await page.evaluate(() => ({
            collapsed: window.getSelection()!.isCollapsed,
            offset: window.getSelection()!.anchorOffset,
          })),
        ).toEqual({ collapsed: true, offset: 3 });
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "starts a new selection when dragging inside already-selected text",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await openTextEdit(page);
        expect(await selectionText(page)).toBe("AI work");

        const w = await charX(page, 3);
        const end = await charX(page, 6);
        await page.mouse.move(w.x, w.y);
        await page.mouse.down();
        await page.mouse.move(end.x + 30, end.y, { steps: 8 });
        await page.mouse.up();
        expect(await selectionText(page)).toBe("work");
        expect(
          await page.locator('[data-agent-native-node-id="tx"]').textContent(),
        ).toBe("AI work");
      } finally {
        await browser.close();
      }
    },
  );

  for (const boardSurface of [false, true]) {
    it(
      `a click outside the text ends editing and keeps the typed text (${boardSurface ? "board" : "screen"})`,
      { timeout: 30_000 },
      async () => {
        const browser = await chromium.launch({ headless: true });
        try {
          const page = await browser.newPage();
          await openTextEdit(page, 1, boardSurface);
          await page.mouse.click(700, 500);
          await expect
            .poll(() =>
              page.locator("[data-agent-native-text-editing]").count(),
            )
            .toBe(0);
          expect(
            await page
              .locator('[data-agent-native-node-id="tx"]')
              .textContent(),
          ).toBe("AI work");
        } finally {
          await browser.close();
        }
      },
    );
  }

  it(
    "an idle board text edit does not re-post selection chrome every frame",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await openTextEdit(page, 1, true);
        const w = await charX(page, 3);
        await page.mouse.click(w.x, w.y);
        await page.waitForTimeout(300);
        const posts = await page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              let count = 0;
              window.addEventListener("message", (event: MessageEvent) => {
                if (
                  (event.data as { type?: string } | null)?.type ===
                  "agent-native:board-selection-rect"
                ) {
                  count += 1;
                }
              });
              setTimeout(() => resolve(count), 1000);
            }),
        );
        expect(posts).toBeLessThan(5);
      } finally {
        await browser.close();
      }
    },
  );
});
