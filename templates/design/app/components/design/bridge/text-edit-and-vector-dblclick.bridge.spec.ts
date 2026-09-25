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
  return bridgeSource
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "true")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("screen-a"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace("__LIVE_REFLOW_ENABLED__", "false")
    .replace("__SELECTED_LAYER_DRAG_PRIORITY__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

type BridgeMessage = {
  type?: string;
  key?: string;
  payload?: { computedStyles?: Record<string, string> };
};

async function install(page: Page, body: string) {
  await page.setContent(
    `<!doctype html><html><body data-agent-native-node-id="an-body" style="margin:0">${body}</body></html>`,
  );
  await page.evaluate(() => {
    const store = window as Window & { __messages?: BridgeMessage[] };
    store.__messages = [];
    window.addEventListener("message", (event: MessageEvent) => {
      store.__messages!.push(event.data as BridgeMessage);
    });
  });
  await page.addScriptTag({ content: hydratedBridge() });
  await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
}

function messages(page: Page): Promise<BridgeMessage[]> {
  return page.evaluate(
    () =>
      (window as Window & { __messages?: BridgeMessage[] }).__messages ?? [],
  );
}

async function centerOf(page: Page, nodeId: string, fx = 0.5) {
  const box = await page
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .boundingBox();
  if (!box) throw new Error(`no box for ${nodeId}`);
  return { x: box.x + box.width * fx, y: box.y + box.height / 2 };
}

const TEXT = `<div data-agent-native-node-id="t1" data-an-primitive="text"
  style="position:absolute;left:40px;top:40px;font-size:64px">Hello world</div>`;

const OPEN_PATH = `<svg data-agent-native-node-id="v1" data-an-primitive="path"
  data-an-pen-nodes="[0,[10,150,null,null,null,null,null],[200,140,null,null,null,null,null],[120,20,null,null,null,null,null]]"
  viewBox="0 0 210 160" style="position:absolute;left:40px;top:40px;width:210px;height:160px;overflow:visible">
  <path d="M 10 150 L 200 140 L 120 20" fill="none" fill-opacity="0" stroke="#000000"
    stroke-width="4" style="fill: rgb(0, 0, 0); stroke: none"></path></svg>`;

describe("clip regressions: text caret and vector double-click", () => {
  it("keeps a text edit live when a click inside the text follows the host's mode replay", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await install(page, TEXT);
      const start = await centerOf(page, "t1", 0.2);
      await page.mouse.dblclick(start.x, start.y);
      await page.waitForSelector(
        '[data-agent-native-node-id="t1"][contenteditable="true"]',
      );
      await page.evaluate(() => {
        window.postMessage({ type: "set-read-only", readOnly: false }, "*");
        window.postMessage(
          { type: "set-interaction-mode", interact: false },
          "*",
        );
      });
      await page.waitForTimeout(100);

      const inside = await centerOf(page, "t1", 0.8);
      await page.mouse.click(inside.x, inside.y);
      await page.waitForTimeout(100);

      expect(
        await page.evaluate(
          () =>
            document.activeElement?.getAttribute("data-agent-native-node-id") ??
            null,
        ),
      ).toBe("t1");
      expect(
        await page
          .locator('[contenteditable="true"]')
          .getAttribute("data-agent-native-node-id"),
      ).toBe("t1");
    } finally {
      await browser.close();
    }
  });

  it("asks the host to open point editing when the selected vector is double-clicked", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await install(page, OPEN_PATH);
      const onPath = { x: 40 + 105, y: 40 + 145 };
      await page.mouse.click(onPath.x, onPath.y);
      await page.waitForFunction(() =>
        (window as Window & { __messages?: BridgeMessage[] }).__messages?.some(
          (message) => message.type === "element-select",
        ),
      );
      await page.mouse.dblclick(onPath.x, onPath.y);
      await page.waitForTimeout(150);

      expect(
        (await messages(page)).filter(
          (message) =>
            message.type === "design-hotkey" && message.key === "Enter",
        ),
      ).toHaveLength(1);
    } finally {
      await browser.close();
    }
  });

  it("reports an open path's own fill opacity, not the marker that hides its chord", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await install(page, OPEN_PATH);
      await page.mouse.click(40 + 105, 40 + 145);
      await page.waitForFunction(() =>
        (window as Window & { __messages?: BridgeMessage[] }).__messages?.some(
          (message) => message.type === "element-select",
        ),
      );
      const selects = (await messages(page)).filter(
        (message) => message.type === "element-select",
      );
      const styles = selects[selects.length - 1]?.payload?.computedStyles;

      expect(styles?.fill).toBe("rgb(0, 0, 0)");
      expect(styles?.fillOpacity).toBe("1");
    } finally {
      await browser.close();
    }
  });
});
