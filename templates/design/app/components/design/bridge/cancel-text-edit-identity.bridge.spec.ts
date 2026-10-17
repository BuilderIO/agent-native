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

async function startEmptyFrame(page: Page): Promise<void> {
  await page.setContent(
    '<!doctype html><html><head></head><body data-agent-native-node-id="an-body"></body></html>',
  );
  await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
  await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
  await page.evaluate(() => {
    (window as Window & { __pending?: unknown[] }).__pending = [];
    window.addEventListener("message", (event: MessageEvent) => {
      const data = event.data as { type?: string } | null;
      if (
        data?.type === "text-edit-pending" ||
        data?.type === "text-editing-state"
      ) {
        (window as Window & { __pending?: unknown[] }).__pending!.push(data);
      }
    });
  });
}

function postBeginTextEdit(page: Page, nodeId: string) {
  return page.evaluate(
    (id) =>
      window.postMessage(
        { type: "begin-text-edit", nodeId: id, force: true },
        "*",
      ),
    nodeId,
  );
}

function postCancelTextEdit(page: Page, screenId: string, nodeId: string) {
  return page.evaluate(
    ([screen, id]) =>
      window.postMessage(
        { type: "agent-native:cancel-text-edit", screenId: screen, nodeId: id },
        "*",
      ),
    [screenId, nodeId] as const,
  );
}

function mountNode(page: Page, nodeId: string) {
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

function editingState(page: Page) {
  return page.evaluate(() => ({
    editing: document.querySelectorAll("[data-agent-native-text-editing]")
      .length,
    activeNodeId:
      document.activeElement?.getAttribute?.("data-agent-native-node-id") ??
      null,
    messages: (window as Window & { __pending?: unknown[] }).__pending ?? [],
  }));
}

describe("cancel-text-edit crosses the bridge with the request's identity", () => {
  it(
    "a cancelled begin never focuses the node that arrives after it",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await startEmptyFrame(page);

        await postBeginTextEdit(page, "text-late");
        await page.waitForFunction(() =>
          (
            (
              window as Window & {
                __pending?: Array<{ type?: string; pending?: boolean }>;
              }
            ).__pending ?? []
          ).some(
            (message) =>
              message.type === "text-edit-pending" && message.pending,
          ),
        );

        await postCancelTextEdit(page, SCREEN_ID, "text-late");
        await mountNode(page, "text-late");
        await page.waitForTimeout(400);

        const state = await editingState(page);
        expect(state.editing).toBe(0);
        expect(state.activeNodeId).not.toBe("text-late");
        expect(
          (state.messages as Array<{ type?: string; active?: boolean }>).filter(
            (message) =>
              message.type === "text-editing-state" && message.active,
          ),
        ).toHaveLength(0);
        expect(
          (
            state.messages as Array<{
              type?: string;
              nodeId?: string;
              pending?: boolean;
            }>
          ).some(
            (message) =>
              message.type === "text-edit-pending" &&
              message.nodeId === "text-late" &&
              message.pending === false,
          ),
        ).toBe(true);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "a cancelled begin never inserts the text it was carrying",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await startEmptyFrame(page);

        await page.evaluate(() =>
          window.postMessage(
            {
              type: "begin-text-edit",
              nodeId: "text-owed",
              force: true,
              insertText: "Standalone",
            },
            "*",
          ),
        );
        await page.waitForFunction(() =>
          (
            (
              window as Window & {
                __pending?: Array<{ type?: string; pending?: boolean }>;
              }
            ).__pending ?? []
          ).some(
            (message) =>
              message.type === "text-edit-pending" && message.pending,
          ),
        );

        await postCancelTextEdit(page, SCREEN_ID, "text-owed");
        await mountNode(page, "text-owed");
        await page.waitForTimeout(400);

        expect(
          await page.evaluate(
            () =>
              document.querySelector('[data-agent-native-node-id="text-owed"]')
                ?.textContent ?? "",
          ),
        ).toBe("");
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "a cancel for one node leaves another node's pending request alone",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await startEmptyFrame(page);

        await postBeginTextEdit(page, "text-b");
        await postCancelTextEdit(page, SCREEN_ID, "text-a");
        await postCancelTextEdit(page, "some-other-screen", "text-b");
        await mountNode(page, "text-b");
        await page.waitForFunction(
          () => !!document.querySelector("[data-agent-native-text-editing]"),
        );

        const state = await editingState(page);
        expect(state.editing).toBe(1);
        expect(state.activeNodeId).toBe("text-b");
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "ends an abandoned EMPTY session but never one the user typed into",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await startEmptyFrame(page);
        await mountNode(page, "text-typed");
        await postBeginTextEdit(page, "text-typed");
        await page.waitForFunction(
          () => !!document.querySelector("[data-agent-native-text-editing]"),
        );
        await page.keyboard.type("kept");

        await postCancelTextEdit(page, SCREEN_ID, "text-typed");
        await page.waitForTimeout(100);
        expect((await editingState(page)).editing).toBe(1);

        await mountNode(page, "text-empty");
        await postBeginTextEdit(page, "text-empty");
        await page.waitForFunction(
          () =>
            document
              .querySelector("[data-agent-native-text-editing]")
              ?.getAttribute("data-agent-native-node-id") === "text-empty",
        );
        await postCancelTextEdit(page, SCREEN_ID, "text-empty");
        await page.waitForTimeout(100);
        expect(
          await page.evaluate(
            () =>
              document
                .querySelector("[data-agent-native-text-editing]")
                ?.getAttribute("data-agent-native-node-id") ?? null,
          ),
        ).not.toBe("text-empty");
      } finally {
        await browser.close();
      }
    },
  );
});
