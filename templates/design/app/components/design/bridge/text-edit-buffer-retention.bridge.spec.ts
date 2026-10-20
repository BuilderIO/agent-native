import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

const SCREEN_ID = "board-file";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "true")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify(SCREEN_ID))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace("__LIVE_REFLOW_ENABLED__", "false")
    .replace("__SELECTED_LAYER_DRAG_PRIORITY__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

async function startFrame(page: Page): Promise<void> {
  await page.setContent(
    '<!doctype html><html><head></head><body data-agent-native-node-id="an-body"></body></html>',
  );
  await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
  await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
}

function mountTextNode(page: Page, nodeId: string) {
  return page.evaluate((id) => {
    const node = document.createElement("div");
    node.setAttribute("data-agent-native-node-id", id);
    node.setAttribute("data-an-primitive", "text");
    node.setAttribute(
      "style",
      "position:absolute;left:28px;top:22px;display:inline-block;white-space:pre-wrap;",
    );
    document.body.appendChild(node);
  }, nodeId);
}

function beginTextEdit(page: Page, nodeId: string) {
  return page.evaluate(
    (id) =>
      window.postMessage(
        { type: "begin-text-edit", nodeId: id, force: true },
        "*",
      ),
    nodeId,
  );
}

function nodeText(page: Page, nodeId: string) {
  return page.evaluate(
    (id) =>
      document.querySelector(`[data-agent-native-node-id="${id}"]`)
        ?.textContent ?? "",
    nodeId,
  );
}

describe("text buffered inside the frame is never dropped", () => {
  it(
    "Escape keeps characters typed before the node arrived",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await startFrame(page);

        await beginTextEdit(page, "text-late");
        await page.keyboard.type("Sta");
        await page.keyboard.press("Escape");

        await mountTextNode(page, "text-late");
        await page.waitForFunction(
          () =>
            (
              document.querySelector(
                '[data-agent-native-node-id="text-late"]',
              ) as HTMLElement | null
            )?.textContent === "Sta",
          undefined,
          { timeout: 5_000 },
        );
        expect(await nodeText(page, "text-late")).toBe("Sta");
        expect(
          await page.evaluate(
            () =>
              document.querySelectorAll("[data-agent-native-text-editing]")
                .length,
          ),
        ).toBe(0);
      } finally {
        await browser.close();
      }
    },
  );
});
