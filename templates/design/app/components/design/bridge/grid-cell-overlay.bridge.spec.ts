import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("grid-cell-test"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace("__LIVE_REFLOW_ENABLED__", "false")
    .replace("__SELECTED_LAYER_DRAG_PRIORITY__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, () => JSON.stringify(""));
}

/** A grid whose fixed tracks do not fill it, so the distribution keywords move them. */
const gridDocument = (containerStyle: string) =>
  `<!doctype html><html><head></head><body style="margin:0">
    <div data-agent-native-node-id="grid" data-agent-native-layer-name="Grid" style="position:absolute;left:40px;top:40px;width:400px;height:300px;display:grid;grid-template-columns:100px 100px;grid-template-rows:80px 80px;gap:20px;${containerStyle}">
      <div data-agent-native-node-id="cell-a"></div>
      <div data-agent-native-node-id="cell-b"></div>
      <div data-agent-native-node-id="cell-c"></div>
      <div data-agent-native-node-id="cell-d"></div>
    </div>
  </body></html>`;

async function withBridgedGrid(
  containerStyle: string,
  run: (page: Page) => Promise<void>,
): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setContent(gridDocument(containerStyle));
    await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
    await page.evaluate(() => {
      window.postMessage(
        {
          type: "select-element",
          selector: '[data-agent-native-node-id="grid"]',
          selectorCandidates: ['[data-agent-native-node-id="grid"]'],
        },
        "*",
      );
    });
    await page.waitForTimeout(80);
    await run(page);
    expect(pageErrors).toEqual([]);
  } finally {
    await browser.close();
  }
}

/** Offset between a painted cell and the real grid item that occupies it. */
async function cellDrift(
  page: Page,
  cell: string,
  nodeId: string,
): Promise<{ x: number; y: number; painted: boolean }> {
  return page.evaluate(
    ({ cellKey, id }) => {
      const painted = document.querySelector(
        `[data-agent-native-grid-cell="${cellKey}"]`,
      );
      const item = document.querySelector(
        `[data-agent-native-node-id="${id}"]`,
      );
      if (!painted || !item) return { x: NaN, y: NaN, painted: false };
      const a = painted.getBoundingClientRect();
      const b = item.getBoundingClientRect();
      return { x: a.left - b.left, y: a.top - b.top, painted: true };
    },
    { cellKey: cell, id: nodeId },
  );
}

describe("grid cell overlay tracks the used grid position", () => {
  it(
    "lands on the real tracks of a start-aligned grid",
    { timeout: 30_000 },
    async () => {
      await withBridgedGrid("", async (page) => {
        const drift = await cellDrift(page, "0:0", "cell-a");
        expect(drift.painted).toBe(true);
        expect(Math.abs(drift.x)).toBeLessThan(1);
        expect(Math.abs(drift.y)).toBeLessThan(1);
      });
    },
  );

  it(
    "follows justify-content and align-content instead of the content origin",
    { timeout: 30_000 },
    async () => {
      await withBridgedGrid(
        "justify-content:center;align-content:end",
        async (page) => {
          const drift = await cellDrift(page, "0:0", "cell-a");
          expect(drift.painted).toBe(true);
          expect(Math.abs(drift.x)).toBeLessThan(1);
          expect(Math.abs(drift.y)).toBeLessThan(1);
        },
      );
    },
  );

  it(
    "widens the painted gaps for a space-between grid",
    { timeout: 30_000 },
    async () => {
      await withBridgedGrid("justify-content:space-between", async (page) => {
        const drift = await cellDrift(page, "1:0", "cell-b");
        expect(drift.painted).toBe(true);
        expect(Math.abs(drift.x)).toBeLessThan(1);
      });
    },
  );
});
