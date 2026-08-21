import { readFileSync } from "node:fs";

import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(initialSourceHead = ""): string {
  return editorChromeBridgeScript
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
    .replace("__INITIAL_SOURCE_HEAD__", JSON.stringify(initialSourceHead));
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

/** Tags every current node so a rebuilt node is distinguishable from a kept one. */
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
    "patches a changed head without rebuilding the body",
    { timeout: 30_000 },
    async () => {
      await withBridgedPage(BASE_BODY, async (page) => {
        // The bridge adopts the first patch's head as its baseline, because a
        // freshly built srcdoc already carries it. Establish that baseline
        // before asserting on a head that actually changes.
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

/**
 * Reproduces the srcdoc's own script order, which the bridge depends on: a
 * deferred Alpine in `<head>` and the bridge inline at the end of `<body>`, so
 * the bridge captures source ownership before Alpine renders anything.
 * Attaching the bridge after Alpine (what `addScriptTag` would do) marks
 * Alpine's own output as source-owned and is not a configuration that ships.
 */
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

        // Alpine keeps the same element after a morph, so it never re-renders:
        // anything the morph deletes here stays deleted.
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

        // New nodes are prepended, so a surviving stale block would win the
        // cascade — a duplicate here is not cosmetic.
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

          // The Group action wraps the selection in a new parent.
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

        // Two review comments pulled in opposite directions here — skip the
        // attribute and the authored edit is lost, overwrite it and Alpine's
        // output is. Merging is the only answer that satisfies both.
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

        // Preserving runtime output must not also preserve content the user
        // deleted; Alpine never re-renders the element it still holds.
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

          // Alpine's own MutationObserver initialises added nodes, so the
          // morph does not need to call initTree itself.
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
        // The srcdoc build bakes the head it rendered, so the first in-place
        // patch has a real baseline and can retire a changed unmarked node.
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

        // Recreating it would cancel an async script still loading, and the
        // innerHTML-built replacement never executes.
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

        // A template's children live in .content, so a childNodes walk sees an
        // empty element and silently drops every edit inside an x-for body.
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
