import { fileURLToPath } from "node:url";

import { chromium, type Page } from "@playwright/test";
import { buildSync } from "esbuild";
import { describe, expect, it } from "vitest";

const bridgeSource = buildSync({
  entryPoints: [
    fileURLToPath(new URL("./editor-chrome.bridge.ts", import.meta.url)),
  ],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  write: false,
}).outputFiles[0]?.text;

function hydratedBridge(): string {
  if (!bridgeSource) throw new Error("Failed to compile editor bridge");
  return (
    bridgeSource
      .replace("__READ_ONLY__", "false")
      .replace("__TEXT_EDITING_ENABLED__", "false")
      .replace("__EDITOR_CHROME_SCALE_X__", "1")
      .replace("__EDITOR_CHROME_SCALE_Y__", "1")
      .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("screen-a"))
      .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
      .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
      .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
      .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
      // Both ship on in DesignCanvas; the lift/reflow drag visuals under test
      // only exist when live reflow is on.
      .replace("__LIVE_REFLOW_ENABLED__", "true")
      .replace("__SELECTED_LAYER_DRAG_PRIORITY__", "true")
      .replace(/__INITIAL_SOURCE_HEAD__/g, '""')
  );
}

// A packed flex group: inserting the alt-drag clone after the source shifts
// every later sibling, so a clone that is only translated by the raw pointer
// delta renders one slot away from the grab point for the whole gesture.
const groupFixture = `<!doctype html><html><body style="margin:0">
  <main data-agent-native-node-id="group" style="display:flex;gap:24px;padding:24px;align-items:flex-start">
    <button data-agent-native-node-id="first" style="width:120px;height:60px">First</button>
    <button data-agent-native-node-id="second" style="width:120px;height:60px">Second</button>
    <button data-agent-native-node-id="third" style="width:120px;height:60px">Third</button>
  </main>
</body></html>`;

type Rect = { left: number; top: number; width: number; height: number };

async function install(page: Page, selectId: string): Promise<void> {
  await page.setContent(groupFixture);
  await page.addScriptTag({ content: hydratedBridge() });
  await page.evaluate((nodeId) => {
    window.postMessage(
      {
        type: "select-element",
        selector: `[data-agent-native-node-id="${nodeId}"]`,
      },
      "*",
    );
  }, selectId);
  await page.waitForFunction(() => {
    const overlay = document.querySelector<HTMLElement>(
      '[data-agent-native-edit-overlay="selection"]',
    );
    return overlay?.style.display === "block";
  });
}

function rectOf(page: Page, nodeId: string): Promise<Rect> {
  return page.evaluate((id) => {
    const element = document.querySelector(
      `[data-agent-native-node-id="${id}"]`,
    );
    if (!element) throw new Error(`missing ${id}`);
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }, nodeId);
}

// The clone is inserted directly after its source and its durable ids are
// reset, so it is addressed by DOM position rather than by node id.
function cloneRect(page: Page, sourceIndex: number): Promise<Rect> {
  return page.evaluate((index) => {
    const group = document.querySelector('[data-agent-native-node-id="group"]');
    const clone = group?.children[index + 1];
    if (!clone) throw new Error("clone not inserted");
    const rect = clone.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }, sourceIndex);
}

describe("Alt-drag clone cursor tracking", () => {
  it("keeps the duplicate under the grab point instead of the next flow slot", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await install(page, "first");
      const source = await rectOf(page, "first");

      await page.keyboard.down("Alt");
      await page.mouse.move(
        source.left + source.width / 2,
        source.top + source.height / 2,
      );
      await page.mouse.down();
      // The clone is inserted when the drag threshold is crossed, so the first
      // frame it can be measured on is the first real move. It must already be
      // under the grab point there, not in the slot it was inserted into.
      await page.mouse.move(
        source.left + source.width / 2 + 8,
        source.top + source.height / 2 + 6,
        { steps: 2 },
      );

      const atThreshold = await cloneRect(page, 0);
      expect(atThreshold.left).toBeCloseTo(source.left + 8, 0);
      expect(atThreshold.top).toBeCloseTo(source.top + 6, 0);

      await page.mouse.move(
        source.left + source.width / 2 + 40,
        source.top + source.height / 2 + 30,
        { steps: 4 },
      );

      const dragged = await cloneRect(page, 0);
      expect(dragged.left).toBeCloseTo(source.left + 40, 0);
      expect(dragged.top).toBeCloseTo(source.top + 30, 0);

      await page.mouse.up();
      await page.keyboard.up("Alt");
    } finally {
      await browser.close();
    }
  });

  it("tracks the cursor for a duplicate grabbed from the middle of a group", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await install(page, "second");
      const source = await rectOf(page, "second");

      await page.keyboard.down("Alt");
      await page.mouse.move(source.left + 10, source.top + 12);
      await page.mouse.down();
      await page.mouse.move(source.left + 10 - 60, source.top + 12 + 45, {
        steps: 4,
      });

      const dragged = await cloneRect(page, 1);
      expect(dragged.left).toBeCloseTo(source.left - 60, 0);
      expect(dragged.top).toBeCloseTo(source.top + 45, 0);

      await page.mouse.up();
      await page.keyboard.up("Alt");
    } finally {
      await browser.close();
    }
  });

  it("leaves a plain (non-duplicating) flow drag tracking the cursor", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await install(page, "second");
      const source = await rectOf(page, "second");

      await page.mouse.move(
        source.left + source.width / 2,
        source.top + source.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        source.left + source.width / 2 + 35,
        source.top + source.height / 2 + 25,
        { steps: 4 },
      );

      const dragged = await rectOf(page, "second");
      expect(dragged.left).toBeCloseTo(source.left + 35, 0);
      expect(dragged.top).toBeCloseTo(source.top + 25, 0);

      await page.mouse.up();
    } finally {
      await browser.close();
    }
  });
});
