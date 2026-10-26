import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedBridge(boardSurface: boolean): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("menu-fixture"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", String(boardSurface))
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const FIXTURE = `<!doctype html><html><body data-agent-native-node-id="screen-body" style="margin:0;position:relative;width:600px;height:500px">
  <div data-agent-native-node-id="card" style="position:absolute;left:40px;top:40px;width:200px;height:120px;background:#ddd"></div>
</body></html>`;

type MenuMessage = {
  type?: string;
  payload?: { tagName?: string; sourceId?: string } | null;
};

async function rightClickMenuPayload(
  boardSurface: boolean,
  x: number,
  y: number,
) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page: Page = await browser.newPage({
      viewport: { width: 600, height: 500 },
    });
    await page.setContent(FIXTURE);
    await page.addScriptTag({ content: hydratedBridge(boardSurface) });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await page.evaluate(() => {
      (window as any).__messages = [];
      window.addEventListener("message", (event: MessageEvent) => {
        (window as any).__messages.push(event.data);
      });
    });
    await page.mouse.click(x, y, { button: "right" });
    await page.waitForFunction(() =>
      ((window as any).__messages as MenuMessage[]).some(
        (message) => message.type === "element-contextmenu",
      ),
    );
    const menu = await page.evaluate(() =>
      ((window as any).__messages as MenuMessage[]).find(
        (message) => message.type === "element-contextmenu",
      ),
    );
    return menu?.payload ?? null;
  } finally {
    await browser.close();
  }
}

describe("right-click on a screen's empty background", () => {
  it("targets the screen itself, so the menu acts on the screen", async () => {
    const payload = await rightClickMenuPayload(false, 400, 300);
    expect(payload?.tagName?.toUpperCase()).toBe("BODY");
  });

  it("still targets the layer under the pointer", async () => {
    const payload = await rightClickMenuPayload(false, 100, 100);
    expect(payload?.sourceId).toBe("card");
  });

  it("leaves empty board canvas without a target", async () => {
    expect(await rightClickMenuPayload(true, 400, 300)).toBeNull();
  });
});
