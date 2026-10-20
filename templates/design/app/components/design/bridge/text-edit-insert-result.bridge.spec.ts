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
  await page.evaluate(() => {
    (window as Window & { __results?: unknown[] }).__results = [];
    window.addEventListener("message", (event: MessageEvent) => {
      const data = event.data as { type?: string } | null;
      if (data?.type === "text-edit-insert-result") {
        (window as Window & { __results?: unknown[] }).__results!.push(data);
      }
    });
  });
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

function postInsertText(page: Page, nodeId: string, text: string) {
  return page.evaluate(
    ([id, value]) =>
      window.postMessage(
        { type: "text-edit-insert-text", nodeId: id, text: value },
        "*",
      ),
    [nodeId, text] as const,
  );
}

function results(page: Page) {
  return page.evaluate(
    () =>
      ((window as Window & { __results?: unknown[] }).__results ??
        []) as Array<{
        nodeId?: string;
        inserted?: boolean;
      }>,
  );
}

describe("the frame reports whether handed-over text landed", () => {
  it(
    "answers inserted for a live session and dropped for a missing one",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await startFrame(page);

        await postInsertText(page, "text-gone", "Sta");
        await page.waitForFunction(
          () =>
            ((window as Window & { __results?: unknown[] }).__results ?? [])
              .length > 0,
        );
        expect(await results(page)).toEqual([
          {
            type: "text-edit-insert-result",
            nodeId: "text-gone",
            inserted: false,
          },
        ]);

        await mountTextNode(page, "text-live");
        await page.evaluate(() =>
          window.postMessage(
            { type: "begin-text-edit", nodeId: "text-live", force: true },
            "*",
          ),
        );
        await page.waitForFunction(
          () => !!document.querySelector("[data-agent-native-text-editing]"),
        );
        await postInsertText(page, "text-live", "Sta");
        await page.waitForFunction(
          () =>
            ((window as Window & { __results?: unknown[] }).__results ?? [])
              .length > 1,
        );

        const all = await results(page);
        expect(all[all.length - 1]).toEqual({
          type: "text-edit-insert-result",
          nodeId: "text-live",
          inserted: true,
        });
        expect(
          await page.evaluate(
            () =>
              document.querySelector('[data-agent-native-node-id="text-live"]')
                ?.textContent ?? "",
          ),
        ).toContain("Sta");
      } finally {
        await browser.close();
      }
    },
  );
});

describe("the frame never acknowledges text it did not place", () => {
  it(
    "answers dropped when the document refuses the insertion",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await startFrame(page);
        await mountTextNode(page, "text-refused");
        await page.evaluate(() =>
          window.postMessage(
            { type: "begin-text-edit", nodeId: "text-refused", force: true },
            "*",
          ),
        );
        await page.waitForFunction(
          () => !!document.querySelector("[data-agent-native-text-editing]"),
        );

        await page.evaluate(() => {
          document.execCommand = () => false;
          window.getSelection = () => null as unknown as Selection;
        });
        await postInsertText(page, "text-refused", "Sta");
        await page.waitForFunction(
          () =>
            ((window as Window & { __results?: unknown[] }).__results ?? [])
              .length > 0,
        );

        const all = await results(page);
        expect(all[all.length - 1]).toEqual({
          type: "text-edit-insert-result",
          nodeId: "text-refused",
          inserted: false,
        });
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "refuses an insert for a node that is not the live session",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await startFrame(page);
        await mountTextNode(page, "text-a");
        await mountTextNode(page, "text-b");
        await page.evaluate(() =>
          window.postMessage(
            { type: "begin-text-edit", nodeId: "text-b", force: true },
            "*",
          ),
        );
        await page.waitForFunction(
          () => !!document.querySelector("[data-agent-native-text-editing]"),
        );

        await postInsertText(page, "text-a", "Sta");
        await page.waitForFunction(
          () =>
            ((window as Window & { __results?: unknown[] }).__results ?? [])
              .length > 0,
        );

        const all = await results(page);
        expect(all[all.length - 1]).toEqual({
          type: "text-edit-insert-result",
          nodeId: "text-a",
          inserted: false,
        });
        expect(
          await page.evaluate(() => ({
            a:
              document.querySelector('[data-agent-native-node-id="text-a"]')
                ?.textContent ?? "",
            b:
              document.querySelector('[data-agent-native-node-id="text-b"]')
                ?.textContent ?? "",
          })),
        ).toEqual({ a: "", b: "" });
      } finally {
        await browser.close();
      }
    },
  );
});

describe("a refused insertion is never reported as committed", () => {
  it(
    "reports not-taken, not committed, when the commit-on-arrival insert fails",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await startFrame(page);
        await page.evaluate(() => {
          (window as Window & { __pending?: unknown[] }).__pending = [];
          window.addEventListener("message", (event: MessageEvent) => {
            const data = event.data as { type?: string } | null;
            if (data?.type === "text-edit-pending") {
              (window as Window & { __pending?: unknown[] }).__pending!.push(
                data,
              );
            }
          });
          document.execCommand = () => false;
          window.getSelection = () => null as unknown as Selection;
        });
        await mountTextNode(page, "text-escape");

        await page.evaluate(() =>
          window.postMessage(
            {
              type: "begin-text-edit",
              nodeId: "text-escape",
              force: true,
              insertText: "Sta",
              commitImmediately: true,
            },
            "*",
          ),
        );
        await page.waitForFunction(
          () =>
            ((window as Window & { __pending?: unknown[] }).__pending ?? [])
              .length > 0,
        );

        const pending = await page.evaluate(
          () =>
            ((window as Window & { __pending?: unknown[] }).__pending ??
              []) as Array<{ reason?: string }>,
        );
        expect(pending[pending.length - 1]?.reason).toBe("not-taken");
        const results_ = await results(page);
        expect(results_[results_.length - 1]).toEqual({
          type: "text-edit-insert-result",
          nodeId: "text-escape",
          inserted: false,
        });
      } finally {
        await browser.close();
      }
    },
  );
});
