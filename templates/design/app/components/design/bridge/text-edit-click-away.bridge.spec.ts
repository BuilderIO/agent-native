import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedBridge(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "true")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("click-away"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const FIXTURE = `<!doctype html><html><body style="margin:0;width:800px;height:600px">
  <div data-agent-native-node-id="tx" data-an-primitive="text" style="position:absolute;left:40px;top:40px;width:max-content;font:32px/1.2 sans-serif">Hello</div>
  <div data-agent-native-node-id="box" style="position:absolute;left:400px;top:40px;width:120px;height:80px;background:#3b82f6"></div>
</body></html>`;

type Message = { type?: string; payload?: { sourceId?: string } };

async function editThenClick(x: number, y: number): Promise<Message[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page: Page = await browser.newPage({
      viewport: { width: 800, height: 600 },
    });
    await page.setContent(FIXTURE);
    await page.addScriptTag({ content: hydratedBridge() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await page.mouse.click(60, 60);
    await page.mouse.dblclick(60, 60);
    await page.waitForSelector("[data-agent-native-text-editing]");
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    await page.evaluate(() => {
      (window as any).__messages = [];
      window.addEventListener("message", (event: MessageEvent) => {
        if (event.source === window)
          (window as any).__messages.push(event.data);
      });
    });
    await page.waitForTimeout(400);
    await page.mouse.click(x, y);
    await page.waitForTimeout(300);
    expect(await page.locator("[data-agent-native-text-editing]").count()).toBe(
      0,
    );
    return (await page.evaluate(() => (window as any).__messages)) as Message[];
  } finally {
    await browser.close();
  }
}

const selectionMessages = (messages: Message[]) =>
  messages.filter(
    (message) =>
      message.type === "element-select" || message.type === "clear-selection",
  );

describe("clicking away from a text edit", () => {
  it("commits and deselects everything when the click lands on empty canvas", async () => {
    const messages = await editThenClick(600, 400);
    expect(messages.some((m) => m.type === "text-content-change")).toBe(true);
    const selection = selectionMessages(messages);
    expect(selection[selection.length - 1]?.type).toBe("clear-selection");
  });

  it("selects the layer the click lands on", async () => {
    const messages = await editThenClick(460, 80);
    const selection = selectionMessages(messages);
    expect(selection[selection.length - 1]).toMatchObject({
      type: "element-select",
      payload: { sourceId: "box" },
    });
  });
});
