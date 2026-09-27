import { chromium } from "@playwright/test";
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

const SELECTOR = '[data-agent-native-node-id="box"]';

async function scale(factor: number, anchorX: number, anchorY: number) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body style="margin:0">
      <div data-agent-native-node-id="box" style="position:absolute;left:300px;top:200px;width:200px;height:120px;border:2px solid #333;border-radius:10px;background:#ccc"></div>
    </body></html>`);
    const batches: unknown[] = [];
    await page.exposeFunction("__pushBatch", (changes: unknown) =>
      batches.push(changes),
    );
    await page.evaluate(() => {
      window.addEventListener("message", (e: MessageEvent) => {
        if (e.data?.type === "visual-style-batch-change") {
          (window as any).__pushBatch(e.data.changes);
        }
      });
    });
    await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
    await page.evaluate((selector) => {
      window.postMessage({ type: "select-element", selector }, "*");
    }, SELECTOR);
    await page.waitForTimeout(50);
    await page.evaluate(
      ([selector, factor, anchorX, anchorY]) => {
        window.postMessage(
          {
            type: "agent-native:scale-selection",
            selector,
            factor,
            anchorX,
            anchorY,
          },
          "*",
        );
      },
      [SELECTOR, factor, anchorX, anchorY] as const,
    );
    await page.waitForTimeout(50);
    return batches as Array<Array<{ styles: Record<string, string> }>>;
  } finally {
    await browser.close();
  }
}

describe("inspector Scale section", () => {
  it("scales about the centre anchor, carrying stroke and radius like K-drag", async () => {
    const batches = await scale(2, 0.5, 0.5);
    expect(batches).toHaveLength(1);
    expect(batches[0][0].styles).toMatchObject({
      left: "200px",
      top: "140px",
      width: "400px",
      height: "240px",
      "border-top-left-radius": "20px",
      "border-width": "4px 4px 4px 4px",
    });
  });

  it("keeps a top-left anchor fixed", async () => {
    const batches = await scale(1.5, 0, 0);
    expect(batches[0][0].styles).toMatchObject({
      left: "300px",
      top: "200px",
      width: "300px",
      height: "180px",
    });
  });
}, 60_000);
