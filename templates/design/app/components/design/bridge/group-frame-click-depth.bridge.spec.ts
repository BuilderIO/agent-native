import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedBridge(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "true")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("live-screen"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

// The markers are the ones Cmd+G (Group) and Alt+Cmd+G (Frame selection)
// write into the source.
const FIXTURE = `<!doctype html><html><body style="margin:0;width:900px;height:600px">
  <div data-agent-native-node-id="group" data-agent-native-layer-name="Group"
       data-agent-native-group-wrapper="true" data-agent-native-preserve-styles="true"
       data-agent-native-group="true"
       style="position:absolute;left:40px;top:40px;width:300px;height:120px">
    <div data-agent-native-node-id="rect" data-agent-native-layer-name="Rect"
         style="position:absolute;left:0;top:0;width:120px;height:120px;background:#f59e0b"></div>
    <div data-agent-native-node-id="ellipse" data-agent-native-layer-name="Ellipse"
         style="position:absolute;left:180px;top:0;width:120px;height:120px;border-radius:50%;background:#06b6d4"></div>
  </div>
  <div data-agent-native-node-id="frame" data-agent-native-layer-name="Frame"
       data-agent-native-group-wrapper="true" data-agent-native-preserve-styles="true"
       data-an-primitive="frame"
       style="position:absolute;left:40px;top:220px;width:300px;height:120px;background:#1f2937">
    <div data-agent-native-node-id="frame-kid" data-agent-native-layer-name="Frame kid"
         style="position:absolute;left:20px;top:20px;width:100px;height:80px;background:#3b82f6"></div>
  </div>
  <div data-agent-native-node-id="card" data-agent-native-layer-name="Card"
       style="position:absolute;left:400px;top:220px;width:300px;height:120px;background:#1f2937">
    <div data-agent-native-node-id="card-kid" data-agent-native-layer-name="Card kid"
         style="position:absolute;left:20px;top:20px;width:100px;height:80px;background:#ec4899"></div>
  </div>
</body></html>`;

async function openFixture(page: Page) {
  await page.setContent(FIXTURE);
  await page.evaluate(() => {
    (window as any).__selected = [];
    window.addEventListener("message", (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.data?.type === "element-select") {
        (window as any).__selected.push(event.data.payload?.sourceId ?? "");
      }
    });
  });
  await page.addScriptTag({ content: hydratedBridge() });
  await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
}

async function selectionAfter(page: Page, gesture: () => Promise<void>) {
  const before = await page.evaluate(
    () => ((window as any).__selected as string[]).length,
  );
  await gesture();
  await page.waitForFunction(
    (count) => ((window as any).__selected as string[]).length > count,
    before,
    { timeout: 2_000 },
  );
  // A double-click fires two clicks first; let every message land.
  await page.waitForTimeout(150);
  return page.evaluate(() => {
    const selected = (window as any).__selected as string[];
    return selected[selected.length - 1];
  });
}

async function withPage(run: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 600 },
    });
    await openFixture(page);
    await run(page);
  } finally {
    await browser.close();
  }
}

describe("click depth for groups and frames inside a screen", () => {
  it("double-clicking a child of a selected Cmd+G group enters the group", async () => {
    await withPage(async (page) => {
      expect(await selectionAfter(page, () => page.mouse.click(100, 100))).toBe(
        "group",
      );
      await page.waitForTimeout(600);
      expect(
        await selectionAfter(page, () => page.mouse.dblclick(100, 100)),
      ).toBe("rect");
      await page.waitForTimeout(600);
      // Inside the group, a click on a sibling selects at that depth.
      expect(await selectionAfter(page, () => page.mouse.click(280, 100))).toBe(
        "ellipse",
      );
    });
  });

  it("Cmd+click deep-selects a Cmd+G group child without selecting the group first", async () => {
    await withPage(async (page) => {
      await page.keyboard.down("Meta");
      expect(await selectionAfter(page, () => page.mouse.click(100, 100))).toBe(
        "rect",
      );
      await page.keyboard.up("Meta");
    });
  });

  it("an Alt+Cmd+G Frame takes clicks like any other container", async () => {
    await withPage(async (page) => {
      expect(await selectionAfter(page, () => page.mouse.click(470, 280))).toBe(
        "card",
      );
      await page.waitForTimeout(600);
      expect(await selectionAfter(page, () => page.mouse.click(110, 280))).toBe(
        "frame",
      );
      await page.waitForTimeout(600);
      expect(
        await selectionAfter(page, () => page.mouse.dblclick(110, 280)),
      ).toBe("frame-kid");
    });
  });
});
