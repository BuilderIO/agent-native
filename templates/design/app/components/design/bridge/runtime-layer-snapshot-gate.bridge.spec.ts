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

function hydratedBridge(runtimeLayerSnapshotEnabled: boolean): string {
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
    .replace(
      "__RUNTIME_LAYER_SNAPSHOT_ENABLED__",
      runtimeLayerSnapshotEnabled ? "true" : "false",
    )
    .replace("__LIVE_REFLOW_ENABLED__", "false")
    .replace("__SELECTED_LAYER_DRAG_PRIORITY__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

type BridgeMessage = { type?: string; requestId?: number; documentId?: string };

const RESERVATION_REQUEST =
  "agent-native:runtime-layer-snapshot-reservation-request";

async function install(page: Page, runtimeLayerSnapshotEnabled: boolean) {
  await page.setContent(
    `<!doctype html><html><body data-agent-native-node-id="an-body"><main data-agent-native-node-id="m1"><h1 data-agent-native-node-id="h1">Title</h1></main></body></html>`,
  );
  await page.evaluate(() => {
    const store = window as Window & { __messages?: BridgeMessage[] };
    store.__messages = [];
    window.addEventListener("message", (event: MessageEvent) => {
      store.__messages!.push(event.data as BridgeMessage);
    });
  });
  await page.addScriptTag({
    content: hydratedBridge(runtimeLayerSnapshotEnabled),
  });
  await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
}

function reservationRequests(page: Page): Promise<BridgeMessage[]> {
  return page.evaluate(
    (type) =>
      (
        (window as Window & { __messages?: BridgeMessage[] }).__messages ?? []
      ).filter((message) => message?.type === type),
    RESERVATION_REQUEST,
  );
}

async function replayEditMode(page: Page) {
  await page.evaluate(() => {
    window.postMessage({ type: "set-interaction-mode", interact: false }, "*");
  });
}

describe("runtime layer snapshots", () => {
  it("never serializes an inline screen when the host replays edit mode", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await install(page, false);
      for (let replay = 0; replay < 3; replay += 1) {
        await replayEditMode(page);
        await page.waitForTimeout(100);
      }
      await page.waitForTimeout(1_800);
      expect(await reservationRequests(page)).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("still snapshots a localhost screen when the host replays edit mode", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await install(page, true);
      await expect
        .poll(async () => (await reservationRequests(page)).length, {
          timeout: 3_000,
        })
        .toBe(1);
      const [boot] = await reservationRequests(page);
      await page.evaluate((request) => {
        const store = window as Window & { __messages?: BridgeMessage[] };
        window.postMessage(
          {
            type: "grant-runtime-layer-snapshot-reservation",
            requestId: request.requestId,
            documentId: request.documentId,
          },
          "*",
        );
        store.__messages = [];
      }, boot!);

      await replayEditMode(page);
      await expect
        .poll(async () => (await reservationRequests(page)).length, {
          timeout: 3_000,
        })
        .toBe(1);
    } finally {
      await browser.close();
    }
  });
});
