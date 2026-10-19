import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

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

const FIXTURE = `<!doctype html><html><body style="margin:0;padding:40px;font-family:system-ui">
  <div data-agent-native-node-id="row" style="display:flex;gap:16px">
    <button data-agent-native-node-id="alpha" style="width:120px;height:44px">Alpha</button>
    <button data-agent-native-node-id="beta" style="width:120px;height:44px">Beta</button>
  </div>
  <section data-agent-native-node-id="card" style="margin-top:40px;width:400px;height:200px;padding:16px;background:#dde3ea">
    <h2 data-agent-native-node-id="card-title" style="margin:0;font-size:20px">Card title</h2>
  </section>
</body></html>`;

type Posted = { type: string; dropMode?: string; styles?: unknown };

async function dragAlphaTo(page: Page, x: number, y: number) {
  const posted: Posted[] = [];
  await page.setContent(FIXTURE);
  await page.exposeFunction("__pushPosted", (message: Posted) =>
    posted.push(message),
  );
  await page.evaluate(() => {
    window.addEventListener("message", (e: MessageEvent) => {
      if (
        e.data?.type === "visual-structure-change" ||
        e.data?.type === "visual-style-change"
      ) {
        (window as any).__pushPosted({
          type: e.data.type,
          dropMode: e.data.dropMode,
          styles: e.data.styles,
        });
      }
    });
  });
  await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
  await page.evaluate(() => {
    window.postMessage(
      {
        type: "select-element",
        selector: '[data-agent-native-node-id="alpha"]',
      },
      "*",
    );
  });
  await page.waitForTimeout(30);
  await page.mouse.move(100, 62);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(50);
  return posted;
}

describe("dropping onto the free area of a box with in-flow content", () => {
  it("places the layer absolute at the release point inside the box", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const card = { x: 40, y: 124 };
      const posted = await dragAlphaTo(page, card.x + 220, card.y + 120);

      expect(posted).toContainEqual({
        type: "visual-style-change",
        styles: { position: "relative" },
      });
      expect(
        posted.find((message) => message.type === "visual-structure-change")
          ?.dropMode,
      ).toBe("absolute-container");
      const alpha = await page
        .locator('[data-agent-native-node-id="alpha"]')
        .evaluate((el) => {
          const r = el.getBoundingClientRect();
          return {
            parent: el.parentElement?.getAttribute("data-agent-native-node-id"),
            x: r.x,
            y: r.y,
          };
        });
      expect(alpha).toEqual({
        parent: "card",
        x: card.x + 220 - 60,
        y: card.y + 120 - 22,
      });
    } finally {
      await browser.close();
    }
  });

  it("still inserts into the flow when the release is over a child", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const posted = await dragAlphaTo(page, 120, 150);

      expect(
        posted.find((message) => message.type === "visual-structure-change")
          ?.dropMode,
      ).toBe("flow-insert");
      expect(posted.map((message) => message.styles)).not.toContainEqual({
        position: "relative",
      });
    } finally {
      await browser.close();
    }
  });
});
