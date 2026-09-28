import { readFileSync } from "node:fs";

import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(initialSourceHead = ""): string {
  return (
    editorChromeBridgeScript
      .replace("__READ_ONLY__", "false")
      .replace("__TEXT_EDITING_ENABLED__", "false")
      .replace("__EDITOR_CHROME_SCALE_X__", "1")
      .replace("__EDITOR_CHROME_SCALE_Y__", "1")
      .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("morph-test"))
      .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
      .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
      .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
      .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
      .replace("__LIVE_REFLOW_ENABLED__", "false")
      .replace("__SELECTED_LAYER_DRAG_PRIORITY__", "false")
      // Mirrors DesignCanvas's inlineScriptJson: a bare JSON.stringify leaves
      // "</script>" intact and the parser closes the injected bridge there.
      .replace(/__INITIAL_SOURCE_HEAD__/g, () =>
        JSON.stringify(initialSourceHead).replace(/</g, "\\u003c"),
      )
  );
}

const card = (id: string, label: string) =>
  `<article data-agent-native-node-id="${id}" class="card"><h3 data-agent-native-node-id="${id}-title">${label}</h3></article>`;

const documentHtml = (body: string, headExtra = "") =>
  `<!doctype html><html><head><style>.card{padding:4px}</style>${headExtra}</head><body data-agent-native-node-id="an-body"><main data-agent-native-node-id="an-main">${body}</main></body></html>`;

const BASE_BODY = [
  card("a", "Alpha"),
  card("b", "Beta"),
  card("c", "Gamma"),
].join("");

async function stampIdentity(page: Page): Promise<void> {
  await page.evaluate(() => {
    document
      .querySelectorAll("[data-agent-native-node-id]")
      .forEach((element, index) => {
        (element as HTMLElement & { __identity?: number }).__identity =
          index + 1;
      });
  });
}

async function identityOf(page: Page, nodeId: string): Promise<number | null> {
  return page.evaluate((id) => {
    const element = document.querySelector(
      `[data-agent-native-node-id="${id}"]`,
    );
    return element
      ? ((element as HTMLElement & { __identity?: number }).__identity ?? null)
      : null;
  }, nodeId);
}

async function replaceDocument(page: Page, html: string): Promise<void> {
  await page.evaluate((content) => {
    window.postMessage(
      {
        type: "replace-document-content",
        content,
        selectedSelector: "",
        selectorCandidates: [],
        forceFullDocument: true,
      },
      "*",
    );
  }, html);
  await page.waitForTimeout(50);
}

async function replaceDocumentWithSelection(
  page: Page,
  html: string,
  selectedSelector: string,
  selectorCandidates: string[],
  forceFullDocument = true,
): Promise<void> {
  await page.evaluate(
    ({ content, selector, candidates, force }) => {
      window.postMessage(
        {
          type: "replace-document-content",
          content,
          selectedSelector: selector,
          selectorCandidates: candidates,
          forceFullDocument: force,
        },
        "*",
      );
    },
    {
      content: html,
      selector: selectedSelector,
      candidates: selectorCandidates,
      force: forceFullDocument,
    },
  );
  await page.waitForTimeout(50);
}

async function replaceSelectedSubtree(
  page: Page,
  html: string,
  selectedSelector: string,
): Promise<void> {
  await page.evaluate(
    ({ content, selector }) => {
      window.postMessage(
        {
          type: "replace-document-content",
          content,
          selectedSelector: selector,
          selectorCandidates: [selector],
          forceFullDocument: false,
        },
        "*",
      );
    },
    { content: html, selector: selectedSelector },
  );
  await page.waitForTimeout(50);
}

async function mainChildOrder(page: Page): Promise<(string | null)[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        '[data-agent-native-node-id="an-main"] > [data-agent-native-node-id]',
      ),
    ).map((el) => el.getAttribute("data-agent-native-node-id")),
  );
}

async function captureSelections(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __selects: string[] }).__selects = seen;
    window.addEventListener("message", (event) => {
      const data = (event as MessageEvent).data;
      if (data?.type === "element-select") {
        seen.push(String(data.payload?.sourceId ?? ""));
      }
    });
  });
}

async function readSelections(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const window_ = window as unknown as { __selects: string[] };
    const seen = window_.__selects.slice();
    window_.__selects.length = 0;
    return seen;
  });
}

async function selectionOverlayVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const overlay = document.querySelector(
      '[data-agent-native-edit-overlay="selection"]',
    ) as HTMLElement | null;
    return !!overlay && overlay.style.display !== "none";
  });
}

async function selectBySelector(
  page: Page,
  selector: string,
  candidates: string[],
): Promise<void> {
  await page.evaluate(
    ({ selector: sel, candidates: list }) => {
      window.postMessage(
        { type: "select-element", selector: sel, selectorCandidates: list },
        "*",
      );
    },
    { selector, candidates },
  );
  await page.waitForTimeout(50);
}

async function withBridgedPage(
  body: string,
  run: (page: Page) => Promise<void>,
): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setContent(documentHtml(body));
    await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
    await stampIdentity(page);
    await run(page);
    expect(pageErrors).toEqual([]);
  } finally {
    await browser.close();
  }
}

describe("replace-document-content morphs instead of rebuilding the body", () => {
  it(
    "keeps every untouched node when one element is deleted",
    { timeout: 30_000 },
    async () => {
      await withBridgedPage(BASE_BODY, async (page) => {
        const before = {
          a: await identityOf(page, "a"),
          c: await identityOf(page, "c"),
          main: await identityOf(page, "an-main"),
        };
        await replaceDocument(
          page,
          documentHtml([card("a", "Alpha"), card("c", "Gamma")].join("")),
        );

        expect(
          await page.locator('[data-agent-native-node-id="b"]').count(),
        ).toBe(0);
        expect({
          a: await identityOf(page, "a"),
          c: await identityOf(page, "c"),
          main: await identityOf(page, "an-main"),
        }).toEqual(before);
      });
    },
  );

  it(
    "keeps running Alpine-style component state through a sibling delete",
    { timeout: 30_000 },
    async () => {
      await withBridgedPage(BASE_BODY, async (page) => {
        await page.evaluate(() => {
          const kept = document.querySelector(
            '[data-agent-native-node-id="c"]',
          );
          (kept as HTMLElement & { __openCount?: number }).__openCount = 7;
          kept?.addEventListener("morph-probe", () => {
            (kept as HTMLElement & { __probed?: boolean }).__probed = true;
          });
        });

        await replaceDocument(
          page,
          documentHtml([card("a", "Alpha"), card("c", "Gamma")].join("")),
        );

        const survived = await page.evaluate(() => {
          const kept = document.querySelector(
            '[data-agent-native-node-id="c"]',
          ) as
            | (HTMLElement & { __openCount?: number; __probed?: boolean })
            | null;
          kept?.dispatchEvent(new CustomEvent("morph-probe"));
          return {
            state: kept?.__openCount ?? null,
            listener: kept?.__probed === true,
          };
        });
        expect(survived).toEqual({ state: 7, listener: true });
      });
    },
  );

  it(
    "reuses the moved node when siblings are reordered",
    { timeout: 30_000 },
    async () => {
      await withBridgedPage(BASE_BODY, async (page) => {
        const before = await identityOf(page, "c");
        await replaceDocument(
          page,
          documentHtml(
            [card("c", "Gamma"), card("a", "Alpha"), card("b", "Beta")].join(
              "",
            ),
          ),
        );

        expect(await identityOf(page, "c")).toBe(before);
        expect(
          await page.evaluate(() =>
            Array.from(
              document.querySelectorAll("main > [data-agent-native-node-id]"),
            ).map((element) =>
              element.getAttribute("data-agent-native-node-id"),
            ),
          ),
        ).toEqual(["c", "a", "b"]);
      });
    },
  );

  it(
    "applies an attribute-only edit in place",
    { timeout: 30_000 },
    async () => {
      await withBridgedPage(BASE_BODY, async (page) => {
        const before = await identityOf(page, "b");
        await replaceDocument(
          page,
          documentHtml(
            [
              card("a", "Alpha"),
              '<article data-agent-native-node-id="b" class="card card--wide"><h3 data-agent-native-node-id="b-title">Beta</h3></article>',
              card("c", "Gamma"),
            ].join(""),
          ),
        );

        expect(await identityOf(page, "b")).toBe(before);
        expect(
          await page
            .locator('[data-agent-native-node-id="b"]')
            .getAttribute("class"),
        ).toBe("card card--wide");
      });
    },
  );

  it(
    "keeps source ownership and live state through the selected-subtree fast path",
    { timeout: 30_000 },
    async () => {
      const body = (name: string, className: string) =>
        `<section data-agent-native-node-id="workspace" data-agent-native-layer-name="${name}" class="${className}"><input data-agent-native-node-id="workspace-input" value="source"></section><aside data-agent-native-node-id="aside">Keep</aside>`;
      await withBridgedPage(body("Frame", "card"), async (page) => {
        const before = {
          workspace: await identityOf(page, "workspace"),
          input: await identityOf(page, "workspace-input"),
          aside: await identityOf(page, "aside"),
        };
        await page.evaluate(() => {
          const workspace = document.querySelector(
            '[data-agent-native-node-id="workspace"]',
          ) as HTMLElement & {
            __openCount?: number;
            __probed?: boolean;
          };
          workspace.__openCount = 7;
          workspace.addEventListener("morph-probe", () => {
            workspace.__probed = true;
          });
          (
            document.querySelector(
              '[data-agent-native-node-id="workspace-input"]',
            ) as HTMLInputElement
          ).value = "typed";
        });

        await replaceSelectedSubtree(
          page,
          documentHtml(body("Workspace", "card card--wide")),
          '[data-agent-native-node-id="workspace"]',
        );

        const afterSubtreeEdit = await page.evaluate(() => {
          const workspace = document.querySelector(
            '[data-agent-native-node-id="workspace"]',
          ) as
            | (HTMLElement & {
                __anSource?: boolean;
                __anSourceMeta?: { attrs?: string[]; className?: string };
                __openCount?: number;
                __probed?: boolean;
              })
            | null;
          workspace?.dispatchEvent(new CustomEvent("morph-probe"));
          return {
            sourceOwned: workspace?.__anSource === true,
            sourceMeta: workspace?.__anSourceMeta
              ? {
                  attrs: workspace.__anSourceMeta.attrs,
                  className: workspace.__anSourceMeta.className,
                }
              : null,
            openCount: workspace?.__openCount ?? null,
            listener: workspace?.__probed === true,
            inputValue: (
              document.querySelector(
                '[data-agent-native-node-id="workspace-input"]',
              ) as HTMLInputElement | null
            )?.value,
          };
        });

        expect({
          workspace: await identityOf(page, "workspace"),
          input: await identityOf(page, "workspace-input"),
          aside: await identityOf(page, "aside"),
        }).toEqual(before);
        expect(afterSubtreeEdit).toMatchObject({
          sourceOwned: true,
          sourceMeta: {
            attrs: expect.arrayContaining([
              "data-agent-native-layer-name",
              "data-agent-native-node-id",
              "class",
            ]),
            className: "card card--wide",
          },
          openCount: 7,
          listener: true,
          inputValue: "typed",
        });

        await replaceDocument(
          page,
          documentHtml(body("Workspace", "card card--wide")),
        );

        expect(
          await page.locator('[data-agent-native-node-id="workspace"]').count(),
        ).toBe(1);
        expect({
          workspace: await identityOf(page, "workspace"),
          input: await identityOf(page, "workspace-input"),
          aside: await identityOf(page, "aside"),
        }).toEqual(before);
        expect(
          await page
            .locator('[data-agent-native-node-id="workspace-input"]')
            .inputValue(),
        ).toBe("typed");
      });
    },
  );

  it(
    "updates a root source key in place when a stable selector still matches it",
    { timeout: 30_000 },
    async () => {
      const body = (id: string) =>
        `<section data-agent-native-node-id="${id}" class="workspace"><span data-agent-native-node-id="workspace-label">Label</span></section>`;
      await withBridgedPage(body("workspace-before"), async (page) => {
        const before = {
          workspace: await identityOf(page, "workspace-before"),
          label: await identityOf(page, "workspace-label"),
        };

        await replaceSelectedSubtree(
          page,
          documentHtml(body("workspace-after")),
          ".workspace",
        );

        expect(
          await page
            .locator('[data-agent-native-node-id="workspace-before"]')
            .count(),
        ).toBe(0);
        expect(
          await page
            .locator('[data-agent-native-node-id="workspace-after"]')
            .count(),
        ).toBe(1);
        expect({
          workspace: await identityOf(page, "workspace-after"),
          label: await identityOf(page, "workspace-label"),
        }).toEqual(before);
        expect(
          await page
            .locator('[data-agent-native-node-id="workspace-after"]')
            .evaluate((element) => {
              const source = element as HTMLElement & {
                __anSource?: boolean;
                __anSourceMeta?: { attrs?: string[] };
              };
              return {
                sourceOwned: source.__anSource === true,
                sourceKeyInMeta: source.__anSourceMeta?.attrs?.includes(
                  "data-agent-native-node-id",
                ),
              };
            }),
        ).toEqual({ sourceOwned: true, sourceKeyInMeta: true });

        await replaceDocument(page, documentHtml(body("workspace-after")));
        expect(
          await page
            .locator('[data-agent-native-node-id="workspace-after"]')
            .count(),
        ).toBe(1);
        expect(await identityOf(page, "workspace-after")).toBe(
          before.workspace,
        );
      });
    },
  );

  it(
    "stamps a selected-subtree replacement when the root tag changes",
    { timeout: 30_000 },
    async () => {
      const body = (tag: "article" | "section") =>
        `<${tag} data-agent-native-node-id="workspace" class="workspace"><span data-agent-native-node-id="workspace-label">Label</span></${tag}>`;
      await withBridgedPage(body("article"), async (page) => {
        const original = await identityOf(page, "workspace");
        await replaceSelectedSubtree(
          page,
          documentHtml(body("section")),
          '[data-agent-native-node-id="workspace"]',
        );

        expect(
          await page
            .locator('[data-agent-native-node-id="workspace"]')
            .evaluate((element) => {
              const source = element as HTMLElement & {
                __anSource?: boolean;
                __anSourceMeta?: { attrs?: string[] };
              };
              return {
                tag: element.tagName.toLowerCase(),
                sourceOwned: source.__anSource === true,
                sourceKeyInMeta: source.__anSourceMeta?.attrs?.includes(
                  "data-agent-native-node-id",
                ),
              };
            }),
        ).toEqual({
          tag: "section",
          sourceOwned: true,
          sourceKeyInMeta: true,
        });
        expect(await identityOf(page, "workspace")).not.toBe(original);

        await page
          .locator('[data-agent-native-node-id="workspace"]')
          .evaluate((element) => {
            (
              element as HTMLElement & { __replacementMarker?: number }
            ).__replacementMarker = 42;
          });
        await replaceDocument(page, documentHtml(body("section")));
        expect(
          await page.locator('[data-agent-native-node-id="workspace"]').count(),
        ).toBe(1);
        expect(
          await page
            .locator('[data-agent-native-node-id="workspace"]')
            .evaluate(
              (element) =>
                (element as HTMLElement & { __replacementMarker?: number })
                  .__replacementMarker ?? null,
            ),
        ).toBe(42);
      });
    },
  );

  it(
    "patches a changed head without rebuilding the body",
    { timeout: 30_000 },
    async () => {
      await withBridgedPage(BASE_BODY, async (page) => {
        await replaceDocument(page, documentHtml(BASE_BODY));
        await stampIdentity(page);
        const before = await identityOf(page, "c");
        await replaceDocument(
          page,
          documentHtml(
            BASE_BODY,
            "<style data-agent-native-breakpoints>@media (max-width:640px){.card{display:none}}</style>",
          ),
        );

        expect(await identityOf(page, "c")).toBe(before);
        expect(
          await page
            .locator("head style[data-agent-native-breakpoints]")
            .count(),
        ).toBe(1);
      });
    },
  );

  it(
    "preserves the editor's own overlay chrome",
    { timeout: 30_000 },
    async () => {
      await withBridgedPage(BASE_BODY, async (page) => {
        const overlaysBefore = await page
          .locator("[data-agent-native-edit-overlay]")
          .count();
        expect(overlaysBefore).toBeGreaterThan(0);

        await replaceDocument(
          page,
          documentHtml([card("a", "Alpha"), card("c", "Gamma")].join("")),
        );

        expect(
          await page.locator("[data-agent-native-edit-overlay]").count(),
        ).toBe(overlaysBefore);
      });
    },
  );
  it(
    "keeps unkeyed markup in place when a keyed sibling is deleted",
    { timeout: 30_000 },
    async () => {
      const body = `<p>lead</p>${card("a", "Alpha")}<p>tail</p>${card("b", "Beta")}`;
      await withBridgedPage(body, async (page) => {
        await page.evaluate(() => {
          document.querySelectorAll("main > p").forEach((element, index) => {
            (element as HTMLElement & { __identity?: number }).__identity =
              100 + index;
          });
        });

        await replaceDocument(
          page,
          documentHtml(`<p>lead</p>${card("a", "Alpha")}<p>tail</p>`),
        );

        expect(
          await page.evaluate(() =>
            Array.from(document.querySelectorAll("main > p")).map(
              (element) =>
                (element as HTMLElement & { __identity?: number }).__identity ??
                null,
            ),
          ),
        ).toEqual([100, 101]);
        expect(
          await page.locator('[data-agent-native-node-id="b"]').count(),
        ).toBe(0);
      });
    },
  );
});

const ALPINE = readFileSync("node_modules/alpinejs/dist/cdn.min.js", "utf8");

async function withAlpinePage(
  body: string,
  run: (page: Page) => Promise<void>,
): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.route("**/alpine.js", (route) =>
      route.fulfill({ contentType: "text/javascript", body: ALPINE }),
    );
    await page.route("**/bridge.js", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: hydratedEditorChromeBridgeScript(),
      }),
    );
    await page.route("**/screen", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><script defer src="/alpine.js"></script></head><body data-agent-native-node-id="an-body">${body}<script src="/bridge.js"></script></body></html>`,
      }),
    );
    await page.goto("http://localhost/screen");
    await page.waitForTimeout(500);
    await run(page);
    expect(pageErrors).toEqual([]);
  } finally {
    await browser.close();
  }
}

const ALPINE_BODY = (headingClass: string) =>
  `<div data-agent-native-node-id="an-root" x-data="{ count: 3, open: false, rows: ['a','b','c'] }">
     <h1 data-agent-native-node-id="an-h1" class="${headingClass}">Title</h1>
     <span data-agent-native-node-id="an-count" x-text="count"></span>
     <p data-agent-native-node-id="an-panel" x-show="open">hidden</p>
     <ul data-agent-native-node-id="an-list"><template x-for="r in rows"><li x-text="r"></li></template></ul>
   </div>`;

describe("morphing an Alpine-managed tree", () => {
  it(
    "keeps Alpine template clones through a selected-subtree edit",
    { timeout: 30_000 },
    async () => {
      const body = (className: string) =>
        `<div data-agent-native-node-id="an-root" x-data="{ rows: ['one', 'two'] }"><ul data-agent-native-node-id="an-list" class="${className}"><template x-for="row in rows"><li x-text="row"></li></template></ul></div>`;
      await withAlpinePage(body("before"), async (page) => {
        await page.evaluate(() => {
          const win = window as Window & { __cloneRefs?: Element[] };
          win.__cloneRefs = Array.from(
            document.querySelectorAll(
              '[data-agent-native-node-id="an-list"] > li',
            ),
          );
          if (win.__cloneRefs.length !== 2) {
            throw new Error(
              `expected two x-for clones, got ${win.__cloneRefs.length}`,
            );
          }
        });

        await replaceSelectedSubtree(
          page,
          documentHtml(body("after")),
          '[data-agent-native-node-id="an-list"]',
        );

        expect(
          await page
            .locator('[data-agent-native-node-id="an-list"]')
            .getAttribute("class"),
        ).toBe("after");
        expect(
          await page.evaluate(() => {
            const win = window as Window & { __cloneRefs?: Element[] };
            const clones = Array.from(
              document.querySelectorAll(
                '[data-agent-native-node-id="an-list"] > li',
              ),
            );
            return {
              text: clones.map((clone) => clone.textContent),
              sameNodes:
                clones.length === win.__cloneRefs?.length &&
                clones.every(
                  (clone, index) => clone === win.__cloneRefs?.[index],
                ),
            };
          }),
        ).toEqual({ text: ["one", "two"], sameNodes: true });
        expect(
          await page
            .locator('[data-agent-native-node-id="an-list"]')
            .evaluate(
              (element) =>
                (element as HTMLElement & { __anSource?: boolean })
                  .__anSource === true,
            ),
        ).toBe(true);
      });
    },
  );

  it(
    "keeps x-for clones, x-text output and x-show styling through an unrelated edit",
    { timeout: 30_000 },
    async () => {
      await withAlpinePage(ALPINE_BODY("before"), async (page) => {
        expect(
          await page.evaluate(() => ({
            count: document.querySelector(
              '[data-agent-native-node-id="an-count"]',
            )?.textContent,
            rows: document.querySelectorAll(
              '[data-agent-native-node-id="an-list"] li',
            ).length,
          })),
        ).toEqual({ count: "3", rows: 3 });

        await replaceDocument(page, documentHtml(ALPINE_BODY("after")));

        expect(
          await page.evaluate(() => ({
            count: document.querySelector(
              '[data-agent-native-node-id="an-count"]',
            )?.textContent,
            rows: document.querySelectorAll(
              '[data-agent-native-node-id="an-list"] li',
            ).length,
            panelDisplay: (
              document.querySelector(
                '[data-agent-native-node-id="an-panel"]',
              ) as HTMLElement
            )?.style.display,
            headingClass: document.querySelector(
              '[data-agent-native-node-id="an-h1"]',
            )?.className,
          })),
        ).toEqual({
          count: "3",
          rows: 3,
          panelDisplay: "none",
          headingClass: "after",
        });
      });
    },
  );
});

describe("morph edge cases", () => {
  it(
    "replaces a keyed node whose tag changed",
    { timeout: 30_000 },
    async () => {
      await withBridgedPage(
        '<div data-agent-native-node-id="k">hi</div>',
        async (page) => {
          await replaceDocument(
            page,
            documentHtml('<button data-agent-native-node-id="k">hi</button>'),
          );
          expect(
            await page.evaluate(
              () =>
                document.querySelector('[data-agent-native-node-id="k"]')
                  ?.tagName,
            ),
          ).toBe("BUTTON");
        },
      );
    },
  );

  it(
    "keeps an unkeyed stateful sibling that follows a deleted keyed node",
    { timeout: 30_000 },
    async () => {
      await withBridgedPage(
        '<div data-agent-native-node-id="gone">a</div><p id="keep">b</p>',
        async (page) => {
          await page.evaluate(() => {
            (
              document.getElementById("keep") as HTMLElement & {
                __identity?: number;
              }
            ).__identity = 42;
          });

          await replaceDocument(page, documentHtml('<p id="keep">b</p>'));

          expect(
            await page.evaluate(
              () =>
                (
                  document.getElementById("keep") as HTMLElement & {
                    __identity?: number;
                  }
                )?.__identity ?? null,
            ),
          ).toBe(42);
          expect(
            await page.locator('[data-agent-native-node-id="gone"]').count(),
          ).toBe(0);
        },
      );
    },
  );

  it(
    "applies a head-only edit that arrives as the very first patch",
    { timeout: 30_000 },
    async () => {
      await withBridgedPage(BASE_BODY, async (page) => {
        await replaceDocument(
          page,
          documentHtml(
            BASE_BODY,
            "<style data-agent-native-breakpoints>@media (max-width:640px){.card{display:none}}</style>",
          ),
        );

        // The seed branch used to adopt the incoming head as its baseline, so
        // the first breakpoint/motion/token write never reached the document
        // and every later diff was measured against a head never applied.
        expect(
          await page
            .locator("head style[data-agent-native-breakpoints]")
            .count(),
        ).toBe(1);
      });
    },
  );

  it(
    "continues seeding the head after replacing its first managed node",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.setContent(
          `<!doctype html><html><head><style data-agent-native-board-surface-render>old</style></head><body>${BASE_BODY}</body></html>`,
        );
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });

        await replaceDocument(
          page,
          `<!doctype html><html><head><style data-agent-native-board-surface-render>new</style><style data-agent-native-breakpoints>@media (max-width:640px){.card{display:none}}</style></head><body>${BASE_BODY}</body></html>`,
        );

        expect(pageErrors).toEqual([]);
        expect(
          await page.evaluate(() =>
            Array.from(
              document.head.querySelectorAll(
                "style[data-agent-native-board-surface-render], style[data-agent-native-breakpoints]",
              ),
            ).map((node) => node.outerHTML),
          ),
        ).toEqual([
          '<style data-agent-native-board-surface-render="">new</style>',
          '<style data-agent-native-breakpoints="">@media (max-width:640px){.card{display:none}}</style>',
        ]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "does not duplicate a head node the document already carries",
    { timeout: 30_000 },
    async () => {
      await withBridgedPage(BASE_BODY, async (page) => {
        await replaceDocument(page, documentHtml(BASE_BODY));
        await replaceDocument(page, documentHtml(BASE_BODY));
        expect(await page.locator("head style").count()).toBe(
          await page.evaluate(
            () => document.querySelectorAll("head style").length,
          ),
        );
        expect(
          await page.evaluate(
            () =>
              Array.from(document.querySelectorAll("head style")).filter(
                (node) => node.textContent?.includes(".card{padding:4px}"),
              ).length,
          ),
        ).toBe(1);
      });
    },
  );
});

describe("morph findings from the second review round", () => {
  it(
    "still removes an authored attribute dropped from an Alpine-bound element",
    { timeout: 30_000 },
    async () => {
      const bound = (extra: string) =>
        `<div data-agent-native-node-id="an-root" x-data="{ o: false }"><a data-agent-native-node-id="an-link" :class="o ? 'x' : 'y'"${extra}>go</a></div>`;
      await withAlpinePage(
        bound(' href="/old" aria-label="L"'),
        async (page) => {
          await replaceDocument(page, documentHtml(bound("")));
          expect(
            await page.evaluate(() => {
              const link = document.querySelector(
                '[data-agent-native-node-id="an-link"]',
              );
              return {
                href: link?.getAttribute("href"),
                aria: link?.getAttribute("aria-label"),
              };
            }),
          ).toEqual({ href: null, aria: null });
        },
      );
    },
  );

  it(
    "replaces a changed head node on the first patch instead of stacking a second copy",
    { timeout: 30_000 },
    async () => {
      const managed = (color: string) =>
        `<style data-agent-native-breakpoints>@media (max-width:640px){p{color:${color}}}</style>`;
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(documentHtml(BASE_BODY, managed("red")));
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });

        await replaceDocument(page, documentHtml(BASE_BODY, managed("blue")));

        expect(
          await page.evaluate(() =>
            Array.from(
              document.querySelectorAll(
                "head style[data-agent-native-breakpoints]",
              ),
            ).map((node) =>
              node.textContent?.includes("blue") ? "blue" : "red",
            ),
          ),
        ).toEqual(["blue"]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "moves an existing keyed child into a newly inserted wrapper",
    { timeout: 30_000 },
    async () => {
      await withBridgedPage(
        '<div data-agent-native-node-id="child">c</div>',
        async (page) => {
          await page.evaluate(() => {
            (
              document.querySelector(
                '[data-agent-native-node-id="child"]',
              ) as HTMLElement & {
                __identity?: number;
              }
            ).__identity = 7;
          });

          await replaceDocument(
            page,
            documentHtml(
              '<section data-agent-native-node-id="grp"><div data-agent-native-node-id="child">c</div></section>',
            ),
          );

          expect(
            await page.evaluate(
              () =>
                (
                  document.querySelector(
                    '[data-agent-native-node-id="child"]',
                  ) as HTMLElement & {
                    __identity?: number;
                  }
                )?.__identity ?? null,
            ),
          ).toBe(7);
          expect(
            await page.evaluate(() =>
              document
                .querySelector('[data-agent-native-node-id="grp"]')
                ?.firstElementChild?.getAttribute("data-agent-native-node-id"),
            ),
          ).toBe("child");
        },
      );
    },
  );

  it(
    "keeps an unkeyed sibling that follows a keyed node whose tag changed",
    { timeout: 30_000 },
    async () => {
      await withBridgedPage(
        '<div data-agent-native-node-id="k">a</div><p id="keep">b</p>',
        async (page) => {
          await page.evaluate(() => {
            (
              document.getElementById("keep") as HTMLElement & {
                __identity?: number;
              }
            ).__identity = 99;
          });

          await replaceDocument(
            page,
            documentHtml(
              '<button data-agent-native-node-id="k">a</button><p id="keep">b</p>',
            ),
          );

          expect(
            await page.evaluate(() => ({
              tag: document.querySelector('[data-agent-native-node-id="k"]')
                ?.tagName,
              identity:
                (
                  document.getElementById("keep") as HTMLElement & {
                    __identity?: number;
                  }
                )?.__identity ?? null,
            })),
          ).toEqual({ tag: "BUTTON", identity: 99 });
        },
      );
    },
  );
});

describe("morph findings from the third review round", () => {
  const boundBody = (staticClass: string) =>
    `<div data-agent-native-node-id="an-root" x-data="{ active: true, open: false }">
       <p data-agent-native-node-id="an-bound" class="${staticClass}" :class="active ? 'is-active' : ''" x-show="open">bound</p>
       <span data-agent-native-node-id="an-other">other</span>
     </div>`;

  it(
    "applies an authored class edit while keeping Alpine's resolved class and style",
    { timeout: 30_000 },
    async () => {
      await withAlpinePage(boundBody("p-4"), async (page) => {
        expect(
          await page.evaluate(() => {
            const el = document.querySelector(
              '[data-agent-native-node-id="an-bound"]',
            ) as HTMLElement;
            return { cls: el.className, display: el.style.display };
          }),
        ).toEqual({ cls: "p-4 is-active", display: "none" });

        await replaceDocument(page, documentHtml(boundBody("p-8")));

        expect(
          await page.evaluate(() => {
            const el = document.querySelector(
              '[data-agent-native-node-id="an-bound"]',
            ) as HTMLElement;
            return { cls: el.className, display: el.style.display };
          }),
        ).toEqual({ cls: "p-8 is-active", display: "none" });
      });
    },
  );

  it(
    "still deletes an authored child removed from source inside an Alpine tree",
    { timeout: 30_000 },
    async () => {
      await withAlpinePage(boundBody("p-4"), async (page) => {
        await replaceDocument(
          page,
          documentHtml(
            `<div data-agent-native-node-id="an-root" x-data="{ active: true, open: false }">
               <p data-agent-native-node-id="an-bound" class="p-4" :class="active ? 'is-active' : ''" x-show="open">bound</p>
             </div>`,
          ),
        );

        expect(
          await page.locator('[data-agent-native-node-id="an-other"]').count(),
        ).toBe(0);
        expect(
          await page.locator('[data-agent-native-node-id="an-bound"]').count(),
        ).toBe(1);
      });
    },
  );

  it(
    "initialises an Alpine node the morph inserts",
    { timeout: 30_000 },
    async () => {
      await withAlpinePage(
        '<div data-agent-native-node-id="an-root" x-data="{ n: 41 }"><span data-agent-native-node-id="an-keep">keep</span></div>',
        async (page) => {
          await replaceDocument(
            page,
            documentHtml(
              '<div data-agent-native-node-id="an-root" x-data="{ n: 41 }"><span data-agent-native-node-id="an-keep">keep</span><b data-agent-native-node-id="an-new" x-text="n + 1"></b></div>',
            ),
          );
          await page.waitForTimeout(300);

          expect(
            await page.evaluate(
              () =>
                document.querySelector('[data-agent-native-node-id="an-new"]')
                  ?.textContent,
            ),
          ).toBe("42");
        },
      );
    },
  );

  it(
    "replaces an ordinary authored style whose contents changed on the first patch",
    { timeout: 30_000 },
    async () => {
      const head = (color: string) => `<style>.card{color:${color}}</style>`;
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(documentHtml(BASE_BODY, head("red")));
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(
            `<style>.card{padding:4px}</style>${head("red")}`,
          ),
        });

        await replaceDocument(page, documentHtml(BASE_BODY, head("blue")));

        expect(
          await page.evaluate(() =>
            Array.from(document.querySelectorAll("head style"))
              .map((node) => node.textContent ?? "")
              .filter((text) => text.includes(".card{color:")),
          ),
        ).toEqual([".card{color:blue}"]);
      } finally {
        await browser.close();
      }
    },
  );
});

describe("morph findings from the fourth review round", () => {
  it(
    "leaves an unchanged head script node in place across a head edit",
    { timeout: 30_000 },
    async () => {
      const head = (color: string) =>
        `<script id="keepme">window.__ran = 1;</script><style>.x{color:${color}}</style>`;
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(documentHtml(BASE_BODY, head("red")));
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(head("red")),
        });
        await page.evaluate(() => {
          (
            document.getElementById("keepme") as HTMLElement & {
              __identity?: number;
            }
          ).__identity = 5;
        });

        await replaceDocument(page, documentHtml(BASE_BODY, head("blue")));

        expect(
          await page.evaluate(
            () =>
              (
                document.getElementById("keepme") as HTMLElement & {
                  __identity?: number;
                }
              )?.__identity ?? null,
          ),
        ).toBe(5);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "reconciles markup inside a template element",
    { timeout: 30_000 },
    async () => {
      const body = (label: string) =>
        `<ul data-agent-native-node-id="an-list"><template data-agent-native-node-id="an-tpl"><li>${label}</li></template></ul>`;
      await withBridgedPage(body("old"), async (page) => {
        await replaceDocument(page, documentHtml(body("new")));

        expect(
          await page.evaluate(
            () =>
              (document.querySelector("template") as HTMLTemplateElement)
                .content.textContent,
          ),
        ).toBe("new");
      });
    },
  );
});

describe("morph findings from the fifth review round", () => {
  it(
    "survives a source head containing a literal script close tag",
    { timeout: 30_000 },
    async () => {
      const nastyHead = `<script type="application/ld+json">{"a":"</script>"}</script>`;
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.route("**/screen", (route) =>
          route.fulfill({
            contentType: "text/html",
            body: `<!doctype html><html><head></head><body data-agent-native-node-id="an-body"><p data-agent-native-node-id="an-p">x</p><script>${hydratedEditorChromeBridgeScript(nastyHead)}</script></body></html>`,
          }),
        );
        await page.goto("http://localhost/screen");
        await page.waitForTimeout(200);

        await replaceDocument(
          page,
          documentHtml('<p data-agent-native-node-id="an-p">changed</p>'),
        );

        expect(
          await page.evaluate(
            () =>
              document.querySelector('[data-agent-native-node-id="an-p"]')
                ?.textContent,
          ),
        ).toBe("changed");
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "applies an explicit source value change to a dirty input",
    { timeout: 30_000 },
    async () => {
      await withBridgedPage(
        '<input data-agent-native-node-id="an-input" value="foo">',
        async (page) => {
          await page.evaluate(() => {
            (document.querySelector("input") as HTMLInputElement).value =
              "typed";
          });

          await replaceDocument(
            page,
            documentHtml(
              '<input data-agent-native-node-id="an-input" value="bar">',
            ),
          );

          expect(
            await page.evaluate(
              () => (document.querySelector("input") as HTMLInputElement).value,
            ),
          ).toBe("bar");
        },
      );
    },
  );

  it(
    "boots without the source-head placeholder replaced",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.setContent(documentHtml(BASE_BODY));
        await page.addScriptTag({
          content: editorChromeBridgeScript
            .replace("__READ_ONLY__", "false")
            .replace("__TEXT_EDITING_ENABLED__", "false")
            .replace("__EDITOR_CHROME_SCALE_X__", "1")
            .replace("__EDITOR_CHROME_SCALE_Y__", "1")
            .replace("__DESIGN_CANVAS_SCREEN_ID__", '"morph-test"')
            .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
            .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
            .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
            .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
            .replace("__LIVE_REFLOW_ENABLED__", "false")
            .replace("__SELECTED_LAYER_DRAG_PRIORITY__", "false"),
        });
        await page.waitForTimeout(200);

        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );
});

describe("morph findings from the sixth review round", () => {
  it(
    "keeps a runtime style override when source drops the same property",
    { timeout: 30_000 },
    async () => {
      const body = (style: string) =>
        `<div data-agent-native-node-id="an-root" x-data="{ open: false }"><p data-agent-native-node-id="an-p"${style} x-show="open">hi</p></div>`;
      await withAlpinePage(
        body(' style="display:block;color:red"'),
        async (page) => {
          const read = () =>
            page.evaluate(
              () =>
                (
                  document.querySelector(
                    '[data-agent-native-node-id="an-p"]',
                  ) as HTMLElement
                ).style.display,
            );
          expect(await read()).toBe("none");

          await replaceDocument(page, documentHtml(body("")));

          expect(await read()).toBe("none");
        },
      );
    },
  );

  it(
    "rebuilds a component whose x-data expression changed",
    { timeout: 30_000 },
    async () => {
      const body = (state: string) =>
        `<div data-agent-native-node-id="an-root" x-data="{ n: ${state} }"><span data-agent-native-node-id="an-n" x-text="n"></span></div>`;
      await withAlpinePage(body("1"), async (page) => {
        await page.evaluate(() => {
          (window as Window & { __rootBefore?: Element }).__rootBefore =
            document.querySelector('[data-agent-native-node-id="an-root"]') ??
            undefined;
        });
        expect(
          await page.evaluate(
            () =>
              document.querySelector('[data-agent-native-node-id="an-n"]')
                ?.textContent,
          ),
        ).toBe("1");

        await replaceSelectedSubtree(
          page,
          documentHtml(body("99")),
          '[data-agent-native-node-id="an-root"]',
        );

        // Alpine evaluates x-data once, so patching the attribute in place
        // leaves every binding underneath on the old scope. Polled because
        // Alpine re-initialises the replacement on its own observer tick.
        await expect
          .poll(
            async () =>
              page.evaluate(
                () =>
                  document.querySelector('[data-agent-native-node-id="an-n"]')
                    ?.textContent,
              ),
            { timeout: 10_000 },
          )
          .toBe("99");
        expect(
          await page.evaluate(
            () =>
              document.querySelector(
                '[data-agent-native-node-id="an-root"]',
              ) !==
              (window as Window & { __rootBefore?: Element }).__rootBefore,
          ),
        ).toBe(true);
        expect(
          await page
            .locator('[data-agent-native-node-id="an-root"]')
            .evaluate(
              (element) =>
                (element as HTMLElement & { __anSource?: boolean })
                  .__anSource === true,
            ),
        ).toBe(true);

        await page
          .locator('[data-agent-native-node-id="an-root"]')
          .evaluate((element) => {
            (
              element as HTMLElement & { __replacementMarker?: number }
            ).__replacementMarker = 99;
          });
        await replaceDocument(page, documentHtml(body("99")));
        expect(
          await page
            .locator('[data-agent-native-node-id="an-root"]')
            .evaluate(
              (element) =>
                (element as HTMLElement & { __replacementMarker?: number })
                  .__replacementMarker ?? null,
            ),
        ).toBe(99);
        expect(
          await page.locator('[data-agent-native-node-id="an-root"]').count(),
        ).toBe(1);
      });
    },
  );

  it(
    "does not duplicate rendered output when x-text fallback copy changes",
    { timeout: 30_000 },
    async () => {
      const body = (fallback: string) =>
        `<div data-agent-native-node-id="an-root" x-data="{ name: 'RUNTIME' }"><span data-agent-native-node-id="an-s" x-text="name">${fallback}</span></div>`;
      await withAlpinePage(body("oldfallback"), async (page) => {
        await replaceDocument(page, documentHtml(body("newfallback")));
        await page.waitForTimeout(200);

        expect(
          await page.evaluate(
            () =>
              document.querySelector('[data-agent-native-node-id="an-s"]')
                ?.textContent,
          ),
        ).toBe("RUNTIME");
      });
    },
  );
});

describe("a forced replacement re-anchors only stable identity", () => {
  it(
    "keeps a node-id selection selected through a layout-flow replacement",
    { timeout: 30_000 },
    async () => {
      await withBridgedPage(BASE_BODY, async (page) => {
        await captureSelections(page);
        await selectBySelector(page, '[data-agent-native-node-id="b"]', [
          '[data-agent-native-node-id="b"]',
        ]);
        await readSelections(page);

        await replaceDocumentWithSelection(
          page,
          documentHtml(
            [
              card("a", "Alpha"),
              '<article data-agent-native-node-id="b" class="card" style="display:grid"><h3 data-agent-native-node-id="b-title">Beta</h3></article>',
              card("c", "Gamma"),
            ].join(""),
          ),
          '[data-agent-native-node-id="b"]',
          ['[data-agent-native-node-id="b"]'],
        );

        expect(await selectionOverlayVisible(page)).toBe(true);
        expect(await readSelections(page)).toContain("b");
      });
    },
  );

  it(
    "does not hand a positional selector to the sibling that shifted into it",
    { timeout: 30_000 },
    async () => {
      const positional =
        '[data-agent-native-node-id="an-main"] > div:nth-of-type(1)';
      await withBridgedPage(
        '<div class="one">One</div><div class="two">Two</div>',
        async (page) => {
          await captureSelections(page);
          await selectBySelector(page, positional, [positional]);
          expect(await selectionOverlayVisible(page)).toBe(true);
          await readSelections(page);

          await replaceDocumentWithSelection(
            page,
            documentHtml('<div class="two">Two</div>'),
            positional,
            [positional],
          );

          expect(await selectionOverlayVisible(page)).toBe(false);
          expect(await readSelections(page)).toEqual([]);
        },
      );
    },
  );
});

describe("repeat-template paint replay", () => {
  const colors = {
    white: "rgb(255, 255, 255)",
    pink: "rgb(225, 29, 72)",
    blue: "rgb(0, 0, 255)",
  };
  const repeatedRow = (
    id: string,
    className: string,
    color: string,
    extra = "",
  ) =>
    `<li data-agent-native-node-id="${id}" class="${className}" style="background-color:${color}"><span x-text="item.label"></span>${extra}</li>`;
  const body = (primary: string, other: string, keyed = false) =>
    `<div data-agent-native-node-id="an-repeat-root" x-data="{ items: [{id:'a',label:'Alpha'},{id:'b',label:'Beta'},{id:'c',label:'Gamma'}], otherItems: [{id:'o1',label:'Other 1'},{id:'o2',label:'Other 2'}] }"><ul id="primary"><template x-for="item in items" ${keyed ? ':key="item.id"' : ""} data-agent-native-node-id="an-primary-template">${primary}</template></ul><ul id="other"><template x-for="item in otherItems" ${keyed ? ':key="item.id"' : ""} data-agent-native-node-id="an-other-template">${other}</template></ul></div>`;

  it(
    "replays commit and Undo paint to unkeyed Alpine clones without clobbering runtime state",
    { timeout: 30_000 },
    async () => {
      const initial = body(
        repeatedRow("an-row", "source-base", colors.white),
        repeatedRow("an-row", "other-base", colors.blue),
      );
      await withAlpinePage(initial, async (page) => {
        const lookup = await page.evaluate(() => {
          const template = document.querySelector(
            "#primary template",
          ) as HTMLTemplateElement & { _x_lookup?: Map<unknown, Element> };
          return {
            isMap: template._x_lookup instanceof Map,
            keys: [...(template._x_lookup?.keys() || [])].map(String),
          };
        });
        expect(lookup).toEqual({ isMap: true, keys: ["0", "1", "2"] });
        await page.evaluate(() => {
          for (const node of document.querySelectorAll<HTMLElement>(
            "#primary > li",
          )) {
            node.classList.add("runtime-token", "preview-pink");
            node.style.display = "none";
            node.style.backgroundColor = "rgb(225, 29, 72)";
          }
          for (const node of document.querySelectorAll<HTMLElement>(
            "#other > li",
          )) {
            node.classList.add("other-runtime-token");
            node.style.backgroundColor = "rgb(0, 0, 255)";
          }
        });
        await replaceDocument(
          page,
          documentHtml(
            body(
              repeatedRow("an-row", "source-base", colors.pink),
              repeatedRow("an-row", "other-base", colors.blue),
            ),
          ),
        );
        expect(
          await page.locator("#primary > li").evaluateAll((nodes) =>
            nodes.map((node) => ({
              color: getComputedStyle(node).backgroundColor,
              display: (node as HTMLElement).style.display,
              className: (node as HTMLElement).className,
              text: node.textContent?.trim(),
            })),
          ),
        ).toEqual([
          {
            color: colors.pink,
            display: "none",
            className: "source-base runtime-token preview-pink",
            text: "Alpha",
          },
          {
            color: colors.pink,
            display: "none",
            className: "source-base runtime-token preview-pink",
            text: "Beta",
          },
          {
            color: colors.pink,
            display: "none",
            className: "source-base runtime-token preview-pink",
            text: "Gamma",
          },
        ]);
        await replaceDocument(
          page,
          documentHtml(
            body(
              repeatedRow("an-row", "source-base", colors.white),
              repeatedRow("an-row", "other-base", colors.blue),
            ),
          ),
        );
        expect(
          await page
            .locator("#primary > li")
            .evaluateAll((nodes) =>
              nodes.map((node) => getComputedStyle(node).backgroundColor),
            ),
        ).toEqual([colors.white, colors.white, colors.white]);
        expect(
          await page
            .locator("#primary > li")
            .evaluateAll((nodes) =>
              nodes.map((node) => (node as HTMLElement).style.display),
            ),
        ).toEqual(["none", "none", "none"]);
        expect(
          await page
            .locator("#primary > li")
            .evaluateAll((nodes) =>
              nodes.map((node) => node.textContent?.trim()),
            ),
        ).toEqual(["Alpha", "Beta", "Gamma"]);
        expect(
          await page
            .locator("#other > li")
            .evaluateAll((nodes) =>
              nodes.map((node) => getComputedStyle(node).backgroundColor),
            ),
        ).toEqual([colors.blue, colors.blue]);
      });
    },
  );

  it(
    "scopes duplicate row IDs to each sibling keyed Alpine lookup",
    { timeout: 30_000 },
    async () => {
      const paired = (primary: string, other: string) =>
        `<div data-agent-native-node-id="an-repeat-root" x-data="{ items: [{id:'a',label:'A'},{id:'b',label:'B'}], otherItems: [{id:'x',label:'X'},{id:'y',label:'Y'}] }"><ul id="siblings"><template x-for="item in items" :key="item.id" data-agent-native-node-id="an-primary-template">${primary}</template><template x-for="item in otherItems" :key="item.id" data-agent-native-node-id="an-other-template">${other}</template></ul></div>`;
      await withAlpinePage(
        paired(
          repeatedRow("an-shared-row", "primary", colors.white),
          repeatedRow("an-shared-row", "other", colors.blue),
        ),
        async (page) => {
          expect(
            await page
              .locator("#siblings > li")
              .evaluateAll((nodes) =>
                nodes.map((node) => node.textContent?.trim()),
              ),
          ).toEqual(["A", "B", "X", "Y"]);
          await replaceDocument(
            page,
            documentHtml(
              paired(
                repeatedRow("an-shared-row", "primary", colors.pink),
                repeatedRow("an-shared-row", "other", colors.blue),
              ),
            ),
          );
          expect(
            await page
              .locator("#siblings > li")
              .evaluateAll((nodes) =>
                nodes.map((node) => getComputedStyle(node).backgroundColor),
              ),
          ).toEqual([colors.pink, colors.pink, colors.blue, colors.blue]);
          await replaceDocument(
            page,
            documentHtml(
              paired(
                repeatedRow("an-shared-row", "primary", colors.white),
                repeatedRow("an-shared-row", "other", colors.blue),
              ),
            ),
          );
          expect(
            await page
              .locator("#siblings > li")
              .evaluateAll((nodes) =>
                nodes.map((node) => getComputedStyle(node).backgroundColor),
              ),
          ).toEqual([colors.white, colors.white, colors.blue, colors.blue]);
        },
      );
    },
  );

  it(
    "maps same-row duplicate descendant IDs only through an unambiguous sibling pair",
    { timeout: 30_000 },
    async () => {
      const row = (first: string, second: string) =>
        `<li data-agent-native-node-id="an-row"><span x-text="item.label"></span><div data-agent-native-node-id="an-duplicate" class="first-target" style="background-color:${first}">first</div><div data-agent-native-node-id="an-duplicate" class="second-target" style="background-color:${second}">second</div></li>`;
      await withAlpinePage(
        body(
          row(colors.white, colors.blue),
          repeatedRow("an-other-row", "other", colors.blue),
        ),
        async (page) => {
          await replaceDocument(
            page,
            documentHtml(
              body(
                row(colors.pink, colors.pink),
                repeatedRow("an-other-row", "other", colors.blue),
              ),
            ),
          );
          const paint = () =>
            page
              .locator("#primary > li")
              .evaluateAll((rows) =>
                rows.map((row) => [
                  getComputedStyle(row.querySelector(".first-target")!)
                    .backgroundColor,
                  getComputedStyle(row.querySelector(".second-target")!)
                    .backgroundColor,
                ]),
              );
          expect(await paint()).toEqual(
            Array.from({ length: 3 }, () => [colors.pink, colors.pink]),
          );
          await replaceDocument(
            page,
            documentHtml(
              body(
                row(colors.white, colors.blue),
                repeatedRow("an-other-row", "other", colors.blue),
              ),
            ),
          );
          expect(await paint()).toEqual(
            Array.from({ length: 3 }, () => [colors.white, colors.blue]),
          );
        },
      );
    },
  );

  it(
    "uses a newly stamped ID after a prior update inserted a sibling",
    { timeout: 30_000 },
    async () => {
      const row = (paint = "") =>
        `<li><span x-text="item.label"></span><p ${paint}>target</p></li>`;
      const other = `<li><span x-text="item.label"></span><p style="background-color:${colors.blue}">other</p></li>`;
      await withAlpinePage(body(row(), other), async (page) => {
        await replaceDocument(
          page,
          documentHtml(
            body(
              `<li><span x-text="item.label"></span><p data-agent-native-node-id="an-late-id">target</p></li>`,
              other,
            ),
          ),
        );
        await replaceDocument(
          page,
          documentHtml(
            body(
              `<li><span x-text="item.label"></span><i>inserted</i><p data-agent-native-node-id="an-late-id" style="background-color:${colors.pink}">target</p></li>`,
              other,
            ),
          ),
        );
        expect(
          await page
            .locator("#primary > li p")
            .evaluateAll((nodes) =>
              nodes.map((node) => getComputedStyle(node).backgroundColor),
            ),
        ).toEqual([colors.pink, colors.pink, colors.pink]);
        expect(
          await page
            .locator("#primary > li p")
            .evaluateAll((nodes) => nodes.map((node) => node.textContent)),
        ).toEqual(["target", "target", "target"]);
        expect(
          await page
            .locator("#other > li p")
            .evaluateAll((nodes) =>
              nodes.map((node) => getComputedStyle(node).backgroundColor),
            ),
        ).toEqual([colors.blue, colors.blue]);
      });
    },
  );
});

describe("a same-parent reorder without forceFullDocument", () => {
  it(
    "is dropped from the live DOM when the active selection is an unrelated sibling",
    { timeout: 30_000 },
    async () => {
      await withBridgedPage(BASE_BODY, async (page) => {
        expect(await mainChildOrder(page)).toEqual(["a", "b", "c"]);

        await replaceDocumentWithSelection(
          page,
          documentHtml(
            [card("b", "Beta"), card("a", "Alpha"), card("c", "Gamma")].join(
              "",
            ),
          ),
          '[data-agent-native-node-id="c"]',
          ['[data-agent-native-node-id="c"]'],
          false,
        );

        expect(await mainChildOrder(page)).toEqual(["a", "b", "c"]);
      });
    },
  );

  it(
    "reaches the live DOM when forceFullDocument is set (the fix runLayerMove must opt into)",
    { timeout: 30_000 },
    async () => {
      await withBridgedPage(BASE_BODY, async (page) => {
        await replaceDocumentWithSelection(
          page,
          documentHtml(
            [card("b", "Beta"), card("a", "Alpha"), card("c", "Gamma")].join(
              "",
            ),
          ),
          '[data-agent-native-node-id="c"]',
          ['[data-agent-native-node-id="c"]'],
          true,
        );

        expect(await mainChildOrder(page)).toEqual(["b", "a", "c"]);
      });
    },
  );
});
