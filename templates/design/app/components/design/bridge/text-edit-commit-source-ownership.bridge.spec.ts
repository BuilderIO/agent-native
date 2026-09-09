import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

/**
 * Needs a real browser: the subject is DOM identity across a morph, and only a
 * real contenteditable produces the unmarked nodes that break it.
 */
function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "true")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("text-commit"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace("__LIVE_REFLOW_ENABLED__", "false")
    .replace("__SELECTED_LAYER_DRAG_PRIORITY__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const NODE_ID = "draft-text-1";
const SELECTOR = `[data-agent-native-node-id="${NODE_ID}"]`;

/** The document as it is right after the text tool created an empty layer. */
const documentHtml = (inner: string) =>
  `<!doctype html><html><head></head><body data-agent-native-node-id="an-body"><div data-agent-native-node-id="${NODE_ID}" data-an-primitive="text" style="position: absolute; left: 28px; top: 22px; display: inline-block; white-space: pre-wrap;">${inner}</div></body></html>`;

async function startSession(page: Page, inner = ""): Promise<void> {
  await page.setContent(documentHtml(inner));
  await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
  await page.evaluate(() => {
    (window as Window & { __committed?: unknown[] }).__committed = [];
    window.addEventListener("message", (event: MessageEvent) => {
      if ((event.data as { type?: string })?.type === "text-content-change") {
        (window as Window & { __committed?: unknown[] }).__committed!.push(
          (event.data as { value?: string }).value,
        );
      }
    });
  });
  await page.evaluate(
    (nodeId) =>
      window.postMessage({ type: "begin-text-edit", nodeId, force: true }, "*"),
    NODE_ID,
  );
  await page.waitForFunction(
    () => !!document.querySelector("[data-agent-native-text-editing]"),
  );
}

/** The host saving the commit and echoing the saved document back. */
async function echoSavedDocument(page: Page, inner: string): Promise<void> {
  await page.evaluate(
    ([content, selector]) =>
      window.postMessage(
        {
          type: "replace-document-content",
          content,
          selectedSelector: selector,
          selectorCandidates: [selector],
          forceFullDocument: true,
        },
        "*",
      ),
    [documentHtml(inner), SELECTOR] as const,
  );
  await page.waitForTimeout(50);
}

function committedContent(page: Page) {
  return page.evaluate((selector) => {
    const host = document.querySelector(selector)!;
    return {
      text: host.textContent,
      html: host.innerHTML,
      childNodes: Array.from(host.childNodes).map((node) => node.nodeName),
    };
  }, SELECTOR);
}

describe("text-edit commit claims its content as source", () => {
  it(
    "renders committed text once after the saved document echoes back",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      const pageErrors: string[] = [];
      try {
        const page = await browser.newPage();
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await startSession(page);

        await page.keyboard.type("my page");
        // Identity probe: a reused text node keeps it, an imported copy cannot.
        await page.evaluate((selector) => {
          const typed = document.querySelector(selector)!.firstChild as Node & {
            __probe?: string;
          };
          typed.__probe = "typed";
        }, SELECTOR);
        await page.evaluate(
          (selector) =>
            (document.querySelector(selector) as HTMLElement).blur(),
          SELECTOR,
        );
        expect(
          await page.evaluate(
            () => (window as Window & { __committed?: string[] }).__committed,
          ),
        ).toEqual(["my page"]);

        await echoSavedDocument(page, "my page");

        expect(await committedContent(page)).toEqual({
          text: "my page",
          html: "my page",
          childNodes: ["#text"],
        });
        expect(
          await page.evaluate(
            (selector) =>
              (
                document.querySelector(selector)!.firstChild as Node & {
                  __probe?: string;
                }
              ).__probe,
            SELECTOR,
          ),
        ).toBe("typed");
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "renders a committed line break once, not one per morph",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await startSession(page);

        await page.keyboard.type("first");
        await page.keyboard.press("Enter");
        await page.keyboard.type("second");
        await page.evaluate(
          (selector) =>
            (document.querySelector(selector) as HTMLElement).blur(),
          SELECTOR,
        );
        const committed = await committedContent(page);
        await echoSavedDocument(page, committed.html!);

        expect(await committedContent(page)).toEqual(committed);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "keeps a discarded session's restored content morphable",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await startSession(page, "original");

        await page.keyboard.type("typed over");
        // Cmd+Z inside a programmatic session discards the DOM edit and hands
        // the chord to the host; the restored content is the saved content.
        await page.evaluate(
          (selector) =>
            document.querySelector(selector)!.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "z",
                metaKey: true,
                bubbles: true,
                cancelable: true,
              }),
            ),
          SELECTOR,
        );
        await echoSavedDocument(page, "original");

        expect(await committedContent(page)).toEqual({
          text: "original",
          html: "original",
          childNodes: ["#text"],
        });
      } finally {
        await browser.close();
      }
    },
  );
});

describe("text-edit buffered keystroke replay", () => {
  it(
    "replays buffered keys ahead of characters typed after activation",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await startSession(page);

        // The host's flush is posted on activation but arrives a task later,
        // by which time native typing has already put characters in.
        await page.keyboard.type("pa");
        await page.evaluate(() =>
          window.postMessage(
            { type: "text-edit-insert-text", text: "my " },
            "*",
          ),
        );
        await page.waitForTimeout(50);
        await page.keyboard.type("ge");

        expect((await committedContent(page)).text).toBe("my page");
      } finally {
        await browser.close();
      }
    },
  );
});
