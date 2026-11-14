import { chromium, type Locator, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedBridge(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("resize-readout"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const FIXTURE = `<!doctype html><html><body style="margin:0;width:800px;height:600px">
  <div data-agent-native-node-id="a" style="position:absolute;left:40px;top:40px;width:120px;height:90px;background:#333"></div>
  <div data-agent-native-node-id="b" style="position:absolute;left:240px;top:40px;width:120px;height:90px;background:#666"></div>
</body></html>`;

// Every size readout the bridge can paint, with the text it shows.
async function visibleSizeReadouts(page: Page) {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[data-agent-native-transform-badge],[data-agent-native-edit-overlay="size-badge"]',
      ),
    ]
      .filter((badge) => window.getComputedStyle(badge).display !== "none")
      .map((badge) => badge.textContent ?? ""),
  );
}

async function dragHandleMidway(page: Page, handle: Locator) {
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 40, { steps: 8 });
  await page.waitForTimeout(80);
}

async function withPage(run: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 800, height: 600 },
    });
    await page.setContent(FIXTURE);
    await page.addScriptTag({ content: hydratedBridge() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await run(page);
  } finally {
    await browser.close();
  }
}

describe("resize shows one size readout", () => {
  it("a layer resize shows only the size badge under the selection", async () => {
    await withPage(async (page) => {
      await page.mouse.click(100, 85);
      await page.waitForTimeout(200);
      await dragHandleMidway(
        page,
        page.locator('[data-agent-native-edit-handle="se"]'),
      );
      expect(await visibleSizeReadouts(page)).toEqual(["180 × 130"]);
      await page.mouse.up();
    });
  });

  it("a multi-selection resize shows only the size badge under the selection", async () => {
    await withPage(async (page) => {
      await page.mouse.click(100, 85);
      await page.keyboard.down("Shift");
      await page.mouse.click(300, 85);
      await page.keyboard.up("Shift");
      await page.waitForTimeout(200);
      await dragHandleMidway(
        page,
        page.locator(
          "[data-agent-native-multi-selection-bounds] [data-corner='se']",
        ),
      );
      const readouts = await visibleSizeReadouts(page);
      expect(readouts).toHaveLength(1);
      expect(readouts[0]).toMatch(/^\d+ × \d+$/);
      await page.mouse.up();
    });
  });
});
