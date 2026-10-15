import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("ctrl-fixture"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const FIXTURE = `<!doctype html><html><body style="margin:0;position:relative;width:600px;height:500px">
  <div data-agent-native-node-id="card" style="position:absolute;left:40px;top:40px;width:200px;height:120px;background:#ddd"></div>
</body></html>`;

/** The event order macOS Chrome produces for a Ctrl+primary press, then a release `travel` px away. */
async function macCtrlPress(page: Page, travel: number) {
  await page.evaluate(async (distance) => {
    const shield = document.querySelector(
      '[data-agent-native-edit-overlay="shield"]',
    )!;
    const at = (type: string, x: number, Event: typeof MouseEvent) =>
      shield.dispatchEvent(
        new Event(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          button: 0,
          buttons: type.endsWith("up") ? 0 : 1,
          ctrlKey: true,
          clientX: x,
          clientY: 100,
          ...(Event === PointerEvent ? { pointerId: 1, isPrimary: true } : {}),
        } as PointerEventInit),
      );
    at("pointerdown", 140, PointerEvent);
    at("mousedown", 140, MouseEvent);
    at("contextmenu", 140, MouseEvent);
    for (let step = 1; step <= 4; step += 1) {
      at("pointermove", 140 + (distance * step) / 4, PointerEvent);
    }
    at("pointerup", 140 + distance, PointerEvent);
    at("mouseup", 140 + distance, MouseEvent);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }, travel);
  return page.evaluate(
    () =>
      ((window as any).__messages as Array<{ type?: string }>).filter(
        (message) => message.type === "element-contextmenu",
      ).length,
  );
}

async function withMacBridge(run: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 600, height: 500 },
    });
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "platform", {
        get: () => "MacIntel",
      });
    });
    await page.setContent(FIXTURE);
    await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await page.evaluate(() => {
      (window as any).__messages = [];
      window.addEventListener("message", (event: MessageEvent) => {
        (window as any).__messages.push(event.data);
      });
    });
    await run(page);
  } finally {
    await browser.close();
  }
}

describe("macOS Ctrl+press context menu", () => {
  it("does not open when the press becomes an Ignore Auto Layout drag", async () => {
    await withMacBridge(async (page) => {
      expect(await macCtrlPress(page, 80)).toBe(0);
    });
  });

  it("opens on release when the press never dragged", async () => {
    await withMacBridge(async (page) => {
      expect(await macCtrlPress(page, 0)).toBe(1);
    });
  });
});
