import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return (
    editorChromeBridgeScript
      .replace("__READ_ONLY__", "false")
      .replace("__TEXT_EDITING_ENABLED__", "true")
      .replace("__EDITOR_CHROME_SCALE_X__", "1")
      .replace("__EDITOR_CHROME_SCALE_Y__", "1")
      .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("text-commit"))
      // This suite exercises board-style click-through before text editing.
      // Screen content intentionally uses direct single-click selection instead.
      .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "true")
      .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
      .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
      .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
      .replace("__LIVE_REFLOW_ENABLED__", "false")
      .replace("__SELECTED_LAYER_DRAG_PRIORITY__", "false")
      .replace(/__INITIAL_SOURCE_HEAD__/g, '""')
  );
}

const NODE_ID = "draft-text-1";
const SELECTOR = `[data-agent-native-node-id="${NODE_ID}"]`;

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

async function startMultilineSelectionSession(page: Page): Promise<void> {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.setContent(`<!doctype html><html><head><style>
    html, body { margin: 0; width: 100%; height: 100%; }
    #${NODE_ID} { position: absolute; left: 100px; top: 100px; width: 300px; font: 24px/30px sans-serif; }
    #${NODE_ID} > div { display: block; height: 30px; }
  </style></head><body>
    <div id="${NODE_ID}" data-agent-native-node-id="${NODE_ID}" data-an-primitive="text">
      <div id="line-home">Home</div>
      <div id="line-browse">Browse</div>
      <div id="line-library">Library</div>
    </div>
  </body></html>`);
  await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
  await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
  await page.evaluate(() => {
    (
      window as Window & { __selectionPayloads?: unknown[] }
    ).__selectionPayloads = [];
    window.addEventListener("message", (event: MessageEvent) => {
      if ((event.data as { type?: string })?.type === "element-select") {
        (
          window as Window & { __selectionPayloads?: unknown[] }
        ).__selectionPayloads?.push(
          (event.data as { payload?: unknown }).payload,
        );
      }
    });
  });
}

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
    "selects generated Text lines as the Text object and enters editing with all its text selected",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await startMultilineSelectionSession(page);

        const browse = (await page.locator("#line-browse").boundingBox())!;
        const modifier = process.platform === "darwin" ? "Meta" : "Control";
        await page.keyboard.down(modifier);
        try {
          await page.mouse.click(
            browse.x + browse.width / 2,
            browse.y + browse.height / 2,
          );
        } finally {
          await page.keyboard.up(modifier);
        }
        await page.waitForFunction(
          () =>
            (window as Window & { __selectionPayloads?: unknown[] })
              .__selectionPayloads?.length === 1,
        );
        const selection = await page.evaluate(
          () =>
            (
              window as Window & {
                __selectionPayloads?: Array<{
                  sourceId?: string;
                  primitiveKind?: string;
                  wholeTextStyleRoot?: boolean;
                }>;
              }
            ).__selectionPayloads?.[0],
        );
        expect(selection).toMatchObject({
          sourceId: NODE_ID,
          primitiveKind: "text",
          wholeTextStyleRoot: true,
        });

        await page.mouse.click(
          browse.x + browse.width / 2,
          browse.y + browse.height / 2,
        );
        await page.waitForFunction(
          () =>
            (window as Window & { __selectionPayloads?: unknown[] })
              .__selectionPayloads?.length === 2,
        );
        const repeatedSelection = await page.evaluate(
          () =>
            (
              window as Window & {
                __selectionPayloads?: Array<{
                  sourceId?: string;
                }>;
              }
            ).__selectionPayloads?.[1],
        );
        expect(repeatedSelection?.sourceId).toBe(NODE_ID);

        const library = (await page.locator("#line-library").boundingBox())!;
        await page.mouse.dblclick(
          library.x + library.width / 2,
          library.y + library.height / 2,
        );
        const editing = page.locator(
          `#${NODE_ID}[data-agent-native-text-editing="true"][contenteditable="true"]`,
        );
        await page.waitForFunction(
          (selector) =>
            document.activeElement === document.querySelector(selector),
          `#${NODE_ID}[data-agent-native-text-editing="true"][contenteditable="true"]`,
        );
        expect(await editing.count()).toBe(1);
        expect(
          await page.evaluate(() =>
            window.getSelection()?.toString().replace(/\s+/g, ""),
          ),
        ).toBe("HomeBrowseLibrary");

        await page.mouse.click(
          library.x + library.width - 1,
          library.y + library.height / 2,
        );
        const caretLineId = await page.evaluate(() => {
          const anchor = window.getSelection()?.anchorNode;
          const element =
            anchor?.nodeType === Node.ELEMENT_NODE
              ? (anchor as Element)
              : anchor?.parentElement;
          return element?.closest("[id^='line-']")?.id ?? null;
        });
        expect(caretLineId).toBe("line-library");

        await page.keyboard.type("!");
        await page.keyboard.press("Escape");
        expect(await committedContent(page)).toMatchObject({
          text: expect.stringContaining("Library!"),
        });
        expect(await page.locator("#line-home").textContent()).toBe("Home");
        expect(await page.locator("#line-browse").textContent()).toBe("Browse");
        expect(await page.locator("#line-library").textContent()).toBe(
          "Library!",
        );
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "keeps a selected multiline Text root selected when clicking one of its lines again",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await startMultilineSelectionSession(page);

        await page.evaluate((selector) => {
          window.postMessage({ type: "select-element", selector }, "*");
        }, SELECTOR);
        await page.waitForFunction(
          () =>
            (window as Window & { __selectionPayloads?: unknown[] })
              .__selectionPayloads?.length === 1,
        );
        const initialSelection = await page.evaluate(
          () =>
            (
              window as Window & {
                __selectionPayloads?: Array<{ sourceId?: string }>;
              }
            ).__selectionPayloads?.[0],
        );
        expect(initialSelection?.sourceId).toBe(NODE_ID);

        const browse = (await page.locator("#line-browse").boundingBox())!;
        await page.mouse.click(
          browse.x + browse.width / 2,
          browse.y + browse.height / 2,
        );
        await page.waitForFunction(
          () =>
            (window as Window & { __selectionPayloads?: unknown[] })
              .__selectionPayloads?.length === 2,
        );
        const repeatedSelection = await page.evaluate(
          () =>
            (
              window as Window & {
                __selectionPayloads?: Array<{ sourceId?: string }>;
              }
            ).__selectionPayloads?.[1],
        );
        expect(repeatedSelection?.sourceId).toBe(NODE_ID);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "keeps generated Group promotion while text editing resolves to the nested Text root",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setViewportSize({ width: 900, height: 700 });
        await page.setContent(`<!doctype html><html><head><style>
          html, body { margin: 0; width: 100%; height: 100%; }
          #generated-group { position: absolute; left: 100px; top: 100px; width: 320px; height: 140px; }
          #${NODE_ID} { width: 300px; font: 24px/30px sans-serif; }
          #${NODE_ID} > div { display: block; height: 30px; }
        </style></head><body>
          <div id="generated-group" data-agent-native-node-id="generated-group" data-agent-native-layer-name="Text Group" data-agent-native-group-wrapper="true">
            <div id="${NODE_ID}" data-agent-native-node-id="${NODE_ID}" data-an-primitive="text">
              <div id="line-one">One</div>
              <div id="line-two">Two</div>
            </div>
          </div>
        </body></html>`);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });
        await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
        await page.evaluate(() => {
          (
            window as Window & { __selectionPayloads?: unknown[] }
          ).__selectionPayloads = [];
          window.addEventListener("message", (event: MessageEvent) => {
            if ((event.data as { type?: string })?.type === "element-select") {
              (
                window as Window & { __selectionPayloads?: unknown[] }
              ).__selectionPayloads?.push(
                (event.data as { payload?: unknown }).payload,
              );
            }
          });
        });

        const line = (await page.locator("#line-two").boundingBox())!;
        await page.mouse.click(
          line.x + line.width / 2,
          line.y + line.height / 2,
        );
        await page.waitForFunction(
          () =>
            (window as Window & { __selectionPayloads?: unknown[] })
              .__selectionPayloads?.length === 1,
        );
        const selection = await page.evaluate(
          () =>
            (
              window as Window & {
                __selectionPayloads?: Array<{
                  sourceId?: string;
                }>;
              }
            ).__selectionPayloads?.[0],
        );
        expect(selection?.sourceId).toBe("generated-group");

        await page.mouse.click(
          line.x + line.width / 2,
          line.y + line.height / 2,
        );
        await page.waitForFunction(
          () =>
            (window as Window & { __selectionPayloads?: unknown[] })
              .__selectionPayloads?.length === 2,
        );
        const deepSelection = await page.evaluate(
          () =>
            (
              window as Window & {
                __selectionPayloads?: Array<{ sourceId?: string }>;
              }
            ).__selectionPayloads?.[1],
        );
        expect(deepSelection?.sourceId).toBe(NODE_ID);

        await page.mouse.dblclick(
          line.x + line.width / 2,
          line.y + line.height / 2,
        );
        const editing = page.locator(
          `#${NODE_ID}[data-agent-native-text-editing="true"][contenteditable="true"]`,
        );
        await page.waitForFunction(
          (selector) =>
            document.activeElement === document.querySelector(selector),
          `#${NODE_ID}[data-agent-native-text-editing="true"][contenteditable="true"]`,
          { timeout: 3000 },
        );
        expect(await editing.count()).toBe(1);
      } finally {
        await browser.close();
      }
    },
  );

  it.each(["Meta", "Control"])(
    "%s+Enter commits and exits without inserting a line break",
    { timeout: 30_000 },
    async (modifier) => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await startSession(page);
        await page.keyboard.type("First title");
        await page.keyboard.press(`${modifier}+Enter`);
        expect(
          await page.locator("[data-agent-native-text-editing]").count(),
        ).toBe(0);
        expect(await committedContent(page)).toEqual({
          text: "First title",
          html: "First title",
          childNodes: ["#text"],
        });
        await page.waitForFunction(
          () =>
            (window as Window & { __committed?: string[] }).__committed
              ?.length === 1,
        );
      } finally {
        await browser.close();
      }
    },
  );

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
        await page.waitForFunction(
          () =>
            (window as Window & { __committed?: string[] }).__committed
              ?.length === 1,
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
