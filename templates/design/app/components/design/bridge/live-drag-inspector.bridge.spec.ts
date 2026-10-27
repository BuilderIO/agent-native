import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedBridge(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("live-drag"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const FIXTURE = `<!doctype html><html><body style="margin:0;width:800px;height:600px">
  <div data-agent-native-node-id="box" style="position:absolute;left:40px;top:40px;width:120px;height:80px;background:#3b82f6"></div>
</body></html>`;

type Message = {
  type?: string;
  sourceId?: string;
  active?: boolean;
  left?: string;
  top?: string;
  payload?: { sourceId?: string; boundingRect?: { x?: number; y?: number } };
};

async function messages(page: Page): Promise<Message[]> {
  return page.evaluate(() => (window as any).__messages as Message[]);
}

async function withDrag(run: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 800, height: 600 },
    });
    await page.setContent(FIXTURE);
    await page.addScriptTag({ content: hydratedBridge() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await page.evaluate(() => {
      (window as any).__messages = [];
      window.addEventListener("message", (event: MessageEvent) => {
        if (event.source === window)
          (window as any).__messages.push(event.data);
      });
    });
    await page.mouse.click(100, 80);
    await page.waitForTimeout(100);
    await page.mouse.move(100, 80);
    await page.mouse.down();
    await page.mouse.move(237, 151, { steps: 8 });
    await page.waitForTimeout(50);
    await run(page);
  } finally {
    await browser.close();
  }
}

describe("the inspector follows an in-screen move", () => {
  it("reports the live position on every move tick", async () => {
    await withDrag(async (page) => {
      const live = (await messages(page)).filter(
        (message) => message.type === "agent-native:live-drag-position",
      );
      expect(live[live.length - 1]).toMatchObject({
        sourceId: "box",
        active: true,
        left: "177px",
        top: "111px",
      });
      await page.mouse.up();
    });
  });

  // The inspector adds the live offset to its measured baseline, so a
  // measurement taken mid-drag would count the travel twice and stay stale
  // after Escape.
  it("measures a dragged layer at its pre-drag position", async () => {
    await withDrag(async (page) => {
      await page.evaluate(() =>
        window.postMessage(
          {
            type: "agent-native:measure-selection",
            correlationId: "mid-drag",
            selector: '[data-agent-native-node-id="box"]',
          },
          "*",
        ),
      );
      await page.waitForTimeout(50);
      const measured = (await messages(page)).filter(
        (message) => message.type === "agent-native:selection-measured",
      );
      expect(measured[measured.length - 1]?.payload).toMatchObject({
        boundingRect: expect.objectContaining({ x: 40, y: 40 }),
      });
      const live = await page
        .locator('[data-agent-native-node-id="box"]')
        .evaluate((el: HTMLElement) => [el.style.left, el.style.top]);
      expect(live).toEqual(["177px", "111px"]);
      await page.mouse.up();
    });
  });

  it("Escape restores the pre-drag position in the inspector", async () => {
    await withDrag(async (page) => {
      const before = (await messages(page)).length;
      await page.keyboard.press("Escape");
      await page.waitForTimeout(50);
      const after = (await messages(page)).slice(before);
      expect(
        after.filter(
          (message) => message.type === "agent-native:live-drag-position",
        ),
      ).toEqual([expect.objectContaining({ sourceId: "box", active: false })]);
      const reselected = after.filter(
        (message) => message.type === "element-select",
      );
      expect(reselected[reselected.length - 1]?.payload).toMatchObject({
        sourceId: "box",
        boundingRect: expect.objectContaining({ x: 40, y: 40 }),
      });
      await page.mouse.up();
    });
  });
});
