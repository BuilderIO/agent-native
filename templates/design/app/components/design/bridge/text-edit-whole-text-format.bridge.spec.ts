import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedBridge(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "true")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("text-format"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="tx" data-an-primitive="text" style="position:absolute;left:40px;top:40px;width:max-content;font:32px/1.2 sans-serif">Hello world</div>
</body></html>`;

async function withEditing(run: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(FIXTURE);
    await page.addScriptTag({ content: hydratedBridge() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await page.evaluate(() => {
      (window as any).__commits = [];
      window.addEventListener("message", (event: MessageEvent) => {
        if (event.data?.type === "visual-style-change") {
          (window as any).__commits.push(event.data);
        }
      });
    });
    const box = (await page
      .locator('[data-agent-native-node-id="tx"]')
      .boundingBox())!;
    await page.mouse.click(box.x + 10, box.y + box.height / 2);
    await page.mouse.dblclick(box.x + 10, box.y + box.height / 2);
    await page.waitForSelector("[data-agent-native-text-editing]");
    await run(page);
  } finally {
    await browser.close();
  }
}

const markup = (page: Page) =>
  page.locator('[data-agent-native-node-id="tx"]').evaluate((el) => ({
    html: el.innerHTML,
  }));

describe("Cmd+B / Cmd+I in text edit mode", () => {
  it.each(["b", "i"])(
    "Cmd+%s on the whole text styles and commits the layer itself, without a span",
    async (key) => {
      await withEditing(async (page) => {
        await page.keyboard.press(`ControlOrMeta+a`);
        await page.keyboard.press(`ControlOrMeta+${key}`);
        expect(await markup(page)).toEqual({ html: "Hello world" });
        const layer = await page
          .locator('[data-agent-native-node-id="tx"]')
          .evaluate((el: HTMLElement) => ({
            fontWeight: el.style.fontWeight,
            fontStyle: el.style.fontStyle,
          }));
        if (key === "b") expect(layer.fontWeight).toBe("700");
        else expect(layer.fontStyle).toBe("italic");
        await page.waitForFunction(
          () => ((window as any).__commits as unknown[]).length > 0,
        );
        const commits = await page.evaluate(
          () =>
            (window as any).__commits as Array<{
              styles: Record<string, string>;
            }>,
        );
        expect(commits.map((commit) => commit.styles)).toEqual([
          key === "b" ? { "font-weight": "700" } : { "font-style": "italic" },
        ]);
      });
    },
  );

  it("Cmd+B on part of the text still styles just that part", async () => {
    await withEditing(async (page) => {
      await page.evaluate(() => {
        const text = document.querySelector('[data-agent-native-node-id="tx"]')!
          .firstChild as Text;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 5);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      });
      await page.keyboard.press("ControlOrMeta+b");
      expect((await markup(page)).html).toMatch(
        /^<span style="font-weight: 700;">Hello<\/span> world$/,
      );
    });
  });
});
