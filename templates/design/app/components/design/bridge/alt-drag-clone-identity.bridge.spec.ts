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

function hydratedBridge(chromeScale = 1): string {
  if (!bridgeSource) throw new Error("Failed to compile editor bridge");
  return bridgeSource
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", String(chromeScale))
    .replace("__EDITOR_CHROME_SCALE_Y__", String(chromeScale))
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("screen-a"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const fixture = `<!doctype html><html><body style="margin:0">
  <main style="display:flex;gap:24px;padding:24px">
    <button data-agent-native-node-id="main-button" data-agent-native-component-id="cmp-play"
            style="width:100px;height:60px">Play <span data-agent-native-node-id="main-label">icon</span></button>
    <aside data-agent-native-node-id="drop-target" style="width:180px;height:140px">Target</aside>
    <section data-agent-native-node-id="later-selection" style="width:100px;height:60px">Later</section>
  </main>
</body></html>`;

type BridgeMessage = {
  type?: string;
  requestId?: string;
  sourceNodeIdMap?: unknown;
  payload?: { sourceId?: string; selector?: string };
  applied?: boolean;
};

async function installAndListen(page: Page, html = fixture, chromeScale = 1) {
  await page.setContent(html);
  await page.evaluate(() => {
    (
      window as Window & { __altDragCloneMessages?: BridgeMessage[] }
    ).__altDragCloneMessages = [];
    window.addEventListener("message", (event) => {
      (
        window as Window & { __altDragCloneMessages?: BridgeMessage[] }
      ).__altDragCloneMessages?.push(event.data as BridgeMessage);
    });
  });
  await page.addScriptTag({ content: hydratedBridge(chromeScale) });
  await page.evaluate(() => {
    window.postMessage(
      {
        type: "select-element",
        selector: '[data-agent-native-node-id="main-button"]',
      },
      "*",
    );
  });
  await page.waitForFunction(() => {
    const overlay = document.querySelector<HTMLElement>(
      '[data-agent-native-edit-overlay="selection"]',
    );
    return overlay?.style.display === "block";
  });
}

async function altDragDuplicate(page: Page): Promise<BridgeMessage> {
  const box = await page
    .locator('[data-agent-native-edit-overlay="selection"]')
    .boundingBox();
  expect(box).not.toBeNull();
  const target = await page
    .locator('[data-agent-native-node-id="drop-target"]')
    .boundingBox();
  expect(target).not.toBeNull();
  await page.keyboard.down("Alt");
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + 8,
    box!.y + box!.height / 2 + 6,
    {
      steps: 2,
    },
  );
  await page.mouse.move(
    target!.x + target!.width / 2,
    target!.y + target!.height / 2,
    {
      steps: 8,
    },
  );
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.waitForFunction(() =>
    (
      window as Window & { __altDragCloneMessages?: BridgeMessage[] }
    ).__altDragCloneMessages?.some(
      (message) => message.type === "visual-duplicate-change",
    ),
  );
  return page.evaluate(() => {
    const message = (
      window as Window & { __altDragCloneMessages?: BridgeMessage[] }
    ).__altDragCloneMessages?.find(
      (entry) => entry.type === "visual-duplicate-change",
    );
    return message!;
  });
}

async function messages(page: Page): Promise<BridgeMessage[]> {
  return page.evaluate(
    () =>
      (window as Window & { __altDragCloneMessages?: BridgeMessage[] })
        .__altDragCloneMessages ?? [],
  );
}

describe("Alt-drag clone identity handoff", () => {
  it("keeps a component tag outside a small selection near the screen top", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await installAndListen(
        page,
        `<!doctype html><html><body style="margin:0">
        <button data-agent-native-node-id="main-button" data-agent-native-component="LinkedButton" data-agent-native-component-id="cmp-play"
          style="position:absolute;left:40px;top:60px;width:180px;height:52px"><span data-agent-native-node-id="main-label">Play</span></button>
        <aside data-agent-native-node-id="drop-target" style="position:absolute;left:400px;top:180px;width:180px;height:140px">Target</aside>
      </body></html>`,
        0.25,
      );
      const button = await page
        .locator('[data-agent-native-node-id="main-button"]')
        .boundingBox();
      const tag = await page
        .locator('[data-agent-native-edit-overlay="component-tag"]')
        .boundingBox();
      expect(button).not.toBeNull();
      expect(tag).not.toBeNull();
      expect(
        tag!.y >= button!.y + button!.height ||
          tag!.y + tag!.height <= button!.y,
      ).toBe(true);
      const chromeRects = await page
        .locator(
          '[data-agent-native-edge-handle], [data-agent-native-edit-handle], [data-agent-native-rotate-handle], [data-agent-native-edit-overlay="size-badge"]',
        )
        .evaluateAll((elements) =>
          elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            };
          }),
        );
      for (const rect of chromeRects) {
        expect(
          tag!.x >= rect.x + rect.width ||
            tag!.x + tag!.width <= rect.x ||
            tag!.y >= rect.y + rect.height ||
            tag!.y + tag!.height <= rect.y,
        ).toBe(true);
      }
      const duplicate = await altDragDuplicate(page);
      expect(duplicate.sourceNodeIdMap).toHaveLength(2);
    } finally {
      await browser.close();
    }
  });

  it("sends the original-to-fresh durable ID map and removes a rejected clone", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await installAndListen(page);
      const duplicate = await altDragDuplicate(page);

      expect(duplicate.requestId).toMatch(/^duplicate-/);
      expect(duplicate.sourceNodeIdMap).toEqual([
        ["main-button", expect.stringMatching(/^an-copy-/)],
        ["main-label", expect.stringMatching(/^an-copy-child-/)],
      ]);
      expect(
        await page.locator('[data-agent-native-node-id="main-button"]').count(),
      ).toBe(1);
      const cloneId = (duplicate.sourceNodeIdMap as [string, string][])[0]?.[1];
      expect(cloneId).toBeTruthy();
      expect(
        await page.locator(`[data-agent-native-node-id="${cloneId}"]`).count(),
      ).toBe(1);

      await page.evaluate((requestId) => {
        window.postMessage(
          { type: "visual-structure-ack", requestId, applied: false },
          "*",
        );
      }, duplicate.requestId);

      expect(
        await page.locator(`[data-agent-native-node-id="${cloneId}"]`).count(),
      ).toBe(0);
      expect(
        await page.locator('[data-agent-native-node-id="main-button"]').count(),
      ).toBe(1);
      const selectedAfterRollback = (await messages(page)).filter(
        (message) => message.type === "element-select",
      );
      expect(
        selectedAfterRollback[selectedAfterRollback.length - 1]?.payload
          ?.sourceId,
      ).toBe("main-button");
    } finally {
      await browser.close();
    }
  });

  it("does not let a delayed refusal steal a newer selection", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await installAndListen(page);
      const duplicate = await altDragDuplicate(page);
      const cloneId = (duplicate.sourceNodeIdMap as [string, string][])[0]?.[1];
      expect(cloneId).toBeTruthy();

      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="later-selection"]',
          },
          "*",
        );
      });
      await page.waitForFunction(() => {
        const selected = (
          window as Window & { __altDragCloneMessages?: BridgeMessage[] }
        ).__altDragCloneMessages?.filter(
          (message) => message.type === "element-select",
        );
        return (
          selected?.[selected.length - 1]?.payload?.sourceId ===
          "later-selection"
        );
      });

      await page.evaluate((requestId) => {
        window.postMessage(
          { type: "visual-structure-ack", requestId, applied: false },
          "*",
        );
      }, duplicate.requestId);

      expect(
        await page.locator(`[data-agent-native-node-id="${cloneId}"]`).count(),
      ).toBe(0);
      const selectedAfterRollback = (await messages(page)).filter(
        (message) => message.type === "element-select",
      );
      expect(
        selectedAfterRollback[selectedAfterRollback.length - 1]?.payload
          ?.sourceId,
      ).toBe("later-selection");
    } finally {
      await browser.close();
    }
  });
});
