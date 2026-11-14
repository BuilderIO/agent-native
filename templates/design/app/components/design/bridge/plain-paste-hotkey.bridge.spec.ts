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

type BridgeMessage = { type?: string; key?: string; html?: string };

async function install(page: Page) {
  await page.setContent(
    `<!doctype html><html><body data-agent-native-node-id="an-body" style="margin:0"><div data-agent-native-node-id="el" style="position:absolute;left:40px;top:40px;width:80px;height:60px">El</div></body></html>`,
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

// The keydown and the paste event it causes arrive in one task, ahead of the
// bridge's 0ms hotkey timer, which is the order a real Cmd+V produces.
async function pressPlainPaste(page: Page, clipboard: Record<string, string>) {
  await page.evaluate((data) => {
    const mac = /Mac/.test(navigator.platform);
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "v",
        code: "KeyV",
        metaKey: mac,
        ctrlKey: !mac,
        bubbles: true,
        cancelable: true,
      }),
    );
    const clipboardData = new DataTransfer();
    for (const [type, value] of Object.entries(data)) {
      clipboardData.setData(type, value);
    }
    document.body.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, clipboard);
  await page.waitForTimeout(80);
  return page.evaluate(() =>
    ((window as Window & { __messages?: BridgeMessage[] }).__messages ?? [])
      .filter(
        (message) =>
          message.type === "design-hotkey" ||
          message.type === "figma-clipboard-paste",
      )
      .map((message) => message.type),
  );
}

describe("plain Cmd/Ctrl+V inside a canvas iframe", () => {
  it("still hands the hotkey to the editor when the paste carries nothing the bridge relays", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await install(page);

      expect(
        await pressPlainPaste(page, { "text/plain": "unrelated text" }),
      ).toEqual(["design-hotkey"]);
    } finally {
      await browser.close();
    }
  });

  it("relays a Design copy instead of also sending the hotkey", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await install(page);

      expect(
        await pressPlainPaste(page, {
          "text/html": "<div>Copy</div>\n<!--agent-native-clipboard-v1:abc-->",
        }),
      ).toEqual(["figma-clipboard-paste"]);
    } finally {
      await browser.close();
    }
  });
});
