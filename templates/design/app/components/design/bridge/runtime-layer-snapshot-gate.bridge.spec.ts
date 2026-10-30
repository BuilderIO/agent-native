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

describe("runtime snapshot resource modes", () => {
  it.each(["references", "embedded"] as const)(
    "captures rendered DOM and compiled CSS with %s resources",
    async (resourceMode) => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.route("https://images.example.test/pixel.svg", (route) =>
          route.fulfill({
            contentType: "image/svg+xml",
            headers: { "access-control-allow-origin": "*" },
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>',
          }),
        );
        await install(page, false);
        await page.evaluate(() => {
          const style = document.createElement("style");
          document.head.append(style);
          style.sheet?.insertRule(".materialized { color: rgb(1, 2, 3); }");
          const copy = document.createElement("p");
          copy.className = "materialized";
          copy.textContent = "Generated child";
          document.body.append(copy);
          const image = document.createElement("img");
          image.src = "https://images.example.test/pixel.svg";
          document.body.append(image);
        });
        await page.waitForFunction(() =>
          Array.from(document.images).every(
            (image) => image.complete && image.naturalWidth > 0,
          ),
        );
        const html = await page.evaluate(
          async (mode) =>
            await new Promise<string>((resolve, reject) => {
              const timer = setTimeout(
                () => reject(new Error("Snapshot timed out")),
                10000,
              );
              const listener = (event: MessageEvent) => {
                const data = event.data;
                if (
                  data?.type ===
                  "agent-native:runtime-layer-snapshot-reservation-request"
                )
                  window.postMessage(
                    {
                      type: "grant-runtime-layer-snapshot-reservation",
                      requestId: data.requestId,
                      documentId: data.documentId,
                    },
                    "*",
                  );
                if (data?.type === "agent-native:runtime-layer-snapshot") {
                  clearTimeout(timer);
                  window.removeEventListener("message", listener);
                  resolve(data.payload.html);
                }
              };
              window.addEventListener("message", listener);
              window.postMessage(
                {
                  type: "request-runtime-layer-snapshot",
                  ...(mode === "references" ? { resourceMode: mode } : {}),
                },
                "*",
              );
            }),
          resourceMode,
        );
        expect(html).toContain("Generated child");
        expect(html).toContain(".materialized { color: rgb(1, 2, 3); }");
        if (resourceMode === "references") {
          expect(html).toContain('src="https://images.example.test/pixel.svg"');
          expect(html).not.toContain("data:image/");
        } else expect(html).toContain("data:image/");
      } finally {
        await browser.close();
      }
    },
  );
});

it("returns canvas pixels as binary attachments in reference snapshots", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await install(page, false);
    const result = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 8;
      canvas.height = 8;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas context unavailable");
      context.fillStyle = "red";
      context.fillRect(0, 0, 8, 8);
      document.body.append(canvas);
      return await new Promise<{
        html: string;
        sizes: number[];
        types: string[];
      }>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Snapshot timed out")),
          10000,
        );
        const listener = (event: MessageEvent) => {
          const data = event.data;
          if (
            data?.type ===
            "agent-native:runtime-layer-snapshot-reservation-request"
          )
            window.postMessage(
              {
                type: "grant-runtime-layer-snapshot-reservation",
                requestId: data.requestId,
                documentId: data.documentId,
              },
              "*",
            );
          if (data?.type === "agent-native:runtime-layer-snapshot") {
            clearTimeout(timer);
            window.removeEventListener("message", listener);
            const resources = data.payload.resources as Array<{ blob: Blob }>;
            if (!resources.every((resource) => resource.blob instanceof Blob)) {
              reject(new Error("Expected binary resources"));
              return;
            }
            resolve({
              html: data.payload.html,
              sizes: resources.map((resource) => resource.blob.size),
              types: resources.map((resource) => resource.blob.type),
            });
          }
        };
        window.addEventListener("message", listener);
        window.postMessage(
          {
            type: "request-runtime-layer-snapshot",
            resourceMode: "references",
          },
          "*",
        );
      });
    });
    expect(result.html).toContain(
      'src="agent-native-clipboard-resource:canvas-0"',
    );
    expect(result.html).not.toContain("data:image/");
    expect(result.html).not.toContain("canvas-unavailable");
    expect(result.types).toEqual(["image/png"]);
    expect(result.sizes).toHaveLength(1);
    expect(result.sizes[0]).toBeGreaterThan(0);
  } finally {
    await browser.close();
  }
});

it("refuses an unsupported snapshot resource mode", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await install(page, false);
    const reason = await page.evaluate(
      async () =>
        await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Expected resource mode rejection")),
            2000,
          );
          const listener = (event: MessageEvent) => {
            if (
              event.data?.type !== "agent-native:runtime-layer-snapshot-error"
            )
              return;
            clearTimeout(timer);
            window.removeEventListener("message", listener);
            resolve(event.data.payload.reason);
          };
          window.addEventListener("message", listener);
          window.postMessage(
            {
              type: "request-runtime-layer-snapshot",
              resourceMode: "unexpected",
            },
            "*",
          );
        }),
    );
    expect(reason).toBe("unsupported-resource-mode");
    expect(await reservationRequests(page)).toHaveLength(0);
  } finally {
    await browser.close();
  }
});
