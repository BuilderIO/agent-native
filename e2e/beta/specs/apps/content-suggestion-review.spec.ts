import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import {
  ACTIVE_EDITOR,
  typeAtParagraphEnd,
} from "../../../../templates/content/e2e/helpers";
import {
  assertSignedInOnBeta,
  runMarker,
  signedInContext,
  skipUnlessAuthed,
} from "../../lib/authed";
import {
  purgeContentPage,
  readContentAction,
  runContentAction,
} from "../../lib/content-pages";
import { originFor, selectedSites, siteById } from "../../lib/fleet";

skipUnlessAuthed();

// A retry would hide the dropped keystroke or lost decision these exist to
// catch.
test.describe.configure({ retries: 0 });

const selected = new Set(selectedSites().map((site) => site.id));

/** A decision shows on the page this soon after its click. */
const SHOWS_WITHIN_MS = 300;
const TYPED = " Typed right after the click.";

const paragraph = (n: number) =>
  `Paragraph ${n} says the quick brown fox jumps over the lazy dog number ${n}.`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The suggested edit for paragraph `n`: "lazy dog" becomes "sleepy cat". */
function sleepyCat(markdown: string, n: number) {
  const from = markdown.indexOf(`lazy dog number ${n}.`);
  if (from < 0) throw new Error(`The fixture has no paragraph ${n}`);
  const to = from + "lazy dog".length;
  return {
    ordinal: 0,
    kind: "replace_text",
    targetId: "body",
    schemaVersion: 1,
    before: { markdown, changedText: "lazy dog" },
    after: {
      markdown: `${markdown.slice(0, from)}sleepy cat${markdown.slice(to)}`,
      changedText: "sleepy cat",
    },
    anchor: {
      from,
      to,
      prefix: markdown.slice(Math.max(0, from - 32), from),
      suffix: markdown.slice(to, to + 32),
    },
  };
}

/** What the page shows: paragraphs as read, cards in the review rail. */
interface View {
  editable: string | null;
  cards: string[];
  paragraphs: string[];
}

interface Frame extends View {
  at: number;
}

interface Watch {
  t0: number;
  frames: Frame[];
  stop: boolean;
}

type WatchedWindow = Window & {
  __review?: Watch;
  __reviewView?: () => View;
};

/** The parts of the page's TipTap editor these checks use. */
interface PageEditor {
  state: {
    doc: {
      descendants(
        visit: (node: { isText: boolean; text?: string }, at: number) => void,
      ): void;
    };
  };
  commands: { setTextSelection(at: number): boolean };
  view: { focus(): void };
}

type Shown = "accepted" | "rejected" | "pending";

type Target =
  | { suggestion: string; decision: "accepted" | "rejected" }
  | { button: string }
  | { resolve: string };

/**
 * Records every animation frame in which the editor or the review cards
 * change, so a decision's timing, a lock, or anything that flickers back can
 * be read afterwards.
 */
async function watch(page: Page): Promise<void> {
  await page.evaluate((editor) => {
    const read = (): View => {
      const root = document.querySelector(editor);
      return {
        editable: root?.getAttribute("contenteditable") ?? null,
        cards: [
          ...document.querySelectorAll(
            "[data-suggestion-id], [data-comment-layout-thread]",
          ),
        ]
          .filter(
            (card) =>
              !card.closest(".ProseMirror") &&
              !card.hasAttribute("data-suggestion-widget"),
          )
          .map(
            (card) =>
              card.getAttribute("data-suggestion-id") ??
              card.getAttribute("data-comment-layout-thread") ??
              "",
          ),
        paragraphs: root
          ? [...root.querySelectorAll(":scope > p")].map((p) =>
              (p as HTMLElement).innerText.replace(/ /g, " "),
            )
          : [],
      };
    };
    const state: Watch = { t0: performance.now(), frames: [], stop: false };
    const watched = window as WatchedWindow;
    watched.__review = state;
    watched.__reviewView = read;
    let last = "";
    const tick = () => {
      const view = read();
      const key = JSON.stringify(view);
      if (key !== last) {
        state.frames.push({
          at: Math.round(performance.now() - state.t0),
          ...view,
        });
        last = key;
      }
      if (!state.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, ACTIVE_EDITOR);
}

async function framesSoFar(page: Page): Promise<Frame[]> {
  return page.evaluate(() => (window as WatchedWindow).__review?.frames ?? []);
}

/** Waits until what the page shows now satisfies `holds`. */
async function expectView(
  page: Page,
  holds: (view: View) => boolean,
  message: string,
) {
  await expect
    .poll(
      async () =>
        holds(
          await page.evaluate(() => {
            const read = (window as WatchedWindow).__reviewView;
            if (!read) throw new Error("The page is not being watched");
            return read();
          }),
        ),
      { message, timeout: 30_000 },
    )
    .toBe(true);
}

/** Clicks each target `gapMs` apart and returns when each click happened. */
async function click(
  page: Page,
  targets: Target[],
  gapMs = 0,
): Promise<number[]> {
  return page.evaluate(
    async ({ targets, gapMs }) => {
      const state = (window as WatchedWindow).__review;
      if (!state) throw new Error("The page is not being watched");
      const at: number[] = [];
      for (const [index, target] of targets.entries()) {
        if (index) await new Promise((resolve) => setTimeout(resolve, gapMs));
        let button: HTMLButtonElement | null | undefined;
        if ("suggestion" in target) {
          button = [
            ...document.querySelectorAll<HTMLButtonElement>(
              `[data-suggestion-id="${CSS.escape(target.suggestion)}"] [data-suggestion-decision="${target.decision}"]`,
            ),
          ].find((candidate) => !candidate.closest(".ProseMirror"));
        } else if ("button" in target) {
          button = [...document.querySelectorAll("button")].find(
            (candidate) => candidate.textContent?.trim() === target.button,
          );
        } else {
          button = document.querySelector<HTMLButtonElement>(
            `[data-comment-layout-thread="${CSS.escape(target.resolve)}"] [data-comment-resolve]`,
          );
        }
        if (!button || button.disabled) {
          throw new Error(`No enabled button for ${JSON.stringify(target)}`);
        }
        at.push(Math.round(performance.now() - state.t0));
        button.click();
      }
      return at;
    },
    { targets, gapMs },
  );
}

function shows(view: View, n: number, state: Shown): boolean {
  const text = view.paragraphs.find((p) => p.includes(`number ${n}.`));
  if (!text) return false;
  const lazy = text.includes("lazy dog");
  const sleepy = text.includes("sleepy cat");
  if (state === "accepted") return sleepy && !lazy;
  if (state === "rejected") return lazy && !sleepy;
  return lazy && sleepy;
}

const typedInto = (n: number) => (view: View) =>
  view.paragraphs.some((p) => p.includes(`number ${n}.${TYPED}`));

/** Milliseconds from `from` until a frame first satisfies `holds`. */
function msUntil(
  frames: Frame[],
  from: number,
  holds: (frame: Frame) => boolean,
): number | null {
  const frame = frames.find(
    (candidate) => candidate.at >= from && holds(candidate),
  );
  return frame ? frame.at - from : null;
}

async function expectShownAtOnce(
  page: Page,
  from: number,
  holds: (frame: Frame) => boolean,
  what: string,
) {
  await page.waitForTimeout(SHOWS_WITHIN_MS + 200);
  const ms = msUntil(await framesSoFar(page), from, holds);
  expect(ms, `${what} never showed`).not.toBeNull();
  expect(ms, `${what} showed ${ms} ms after the click`).toBeLessThanOrEqual(
    SHOWS_WITHIN_MS,
  );
}

async function expectEditableThroughout(page: Page, from: number) {
  const locked = (await framesSoFar(page)).filter(
    (frame) => frame.at >= from && frame.editable !== "true",
  );
  expect(
    locked.map(({ at, editable }) => `${at} ms: ${editable}`),
    "the page stopped being editable",
  ).toEqual([]);
}

/** Types inside the words paragraph `n`'s suggestion changes. */
async function typeInsideChange(page: Page, n: number, text: string) {
  await page.evaluate(
    ({ n, editor }) => {
      const tiptap = (
        document.querySelector(editor) as
          | (Element & { editor?: PageEditor })
          | null
      )?.editor;
      if (!tiptap) throw new Error(`No TipTap editor on ${editor}`);
      let at: number | null = null;
      tiptap.state.doc.descendants((node, position) => {
        if (at !== null || !node.isText) return;
        const index = node.text?.indexOf(`lazy dog number ${n}.`) ?? -1;
        if (index >= 0) at = position + index + 2;
      });
      if (at === null) throw new Error(`No "lazy dog" in paragraph ${n}`);
      tiptap.commands.setTextSelection(at);
      tiptap.view.focus();
    },
    { n, editor: ACTIVE_EDITOR },
  );
  await page.keyboard.type(text, { delay: 40 });
}

interface Saved {
  includes: string[];
  excludes: string[];
  statuses: Record<string, string>;
}

interface Review {
  origin: string;
  id: string;
  /** The suggestion that changes paragraph `n`. */
  suggestion: (n: number) => string;
  /** Comment thread IDs, in fixture order. */
  comments: string[];
  /** Opens the page in a new tab, ready to review and watched. */
  open: () => Promise<Page>;
  /** Waits until the saved page and suggestions match. */
  expectSaved: (expected: Saved) => Promise<void>;
  /** Opens the page fresh and waits until it shows what `holds` expects. */
  expectAfterReload: (holds: (view: View) => boolean) => Promise<void>;
}

interface Fixture {
  paragraphs?: number;
  /** Paragraphs that each get their own suggestion. */
  singles?: number[];
  /** Paragraphs whose suggestions form one group. */
  group?: number[];
  /** Paragraphs that each get a comment on "quick brown fox". */
  comments?: number[];
}

async function runReview(
  name: string,
  browser: Browser,
  fixture: Fixture,
  body: (review: Review) => Promise<void>,
) {
  test.skip(!selected.has("content"), "content is not in this run's selection");
  const site = siteById("content");
  const origin = originFor(site);
  const context: BrowserContext = await signedInContext(browser, site, {
    seedModel: false,
    baseURL: origin,
  });
  const api = await context.newPage();
  const title = `${runMarker(`content review ${name}`)} ${crypto.randomUUID()}`;
  const id = crypto.randomUUID();
  let created = false;
  try {
    await assertSignedInOnBeta(context, site);
    await runContentAction(api, origin, "create-document", {
      id,
      title,
      content: Array.from({ length: fixture.paragraphs ?? 6 }, (_, i) =>
        paragraph(i + 1),
      ).join("\n"),
    });
    created = true;

    const current = async () => {
      const document = await readContentAction(api, origin, "get-document", {
        id,
      });
      return {
        content: String(document.content),
        baseRevision: document.baseRevision ?? document.revision,
      };
    };
    const byParagraph = new Map<number, string>();
    for (const n of fixture.singles ?? []) {
      const { content, baseRevision } = await current();
      const result = await runContentAction(
        api,
        origin,
        "create-resource-suggestion",
        {
          resourceType: "document",
          resourceId: id,
          adapterKind: "content.document-markdown",
          baseRevision,
          summary: `Edit paragraph ${n}`,
          idempotencyKey: `${id}-${n}`,
          operations: [sleepyCat(content, n)],
        },
      );
      byParagraph.set(n, String(result.id));
    }
    if (fixture.group?.length) {
      const { content, baseRevision } = await current();
      const result = await runContentAction(
        api,
        origin,
        "create-resource-suggestion-proposal",
        {
          resourceType: "document",
          resourceId: id,
          adapterKind: "content.document-markdown",
          baseRevision,
          summary: `${fixture.group.length} edits`,
          idempotencyKey: `${id}-group`,
          suggestions: fixture.group.map((n) => ({
            summary: `Edit paragraph ${n}`,
            operations: [sleepyCat(content, n)],
          })),
        },
      );
      const members = result.suggestions as Array<{ id: string }>;
      fixture.group.forEach((n, index) =>
        byParagraph.set(n, members[index].id),
      );
    }
    const comments: string[] = [];
    for (const n of fixture.comments ?? []) {
      const commentId = crypto.randomUUID();
      await runContentAction(api, origin, "add-comment", {
        documentId: id,
        clientOperationId: commentId,
        content: `Comment on paragraph ${n}`,
        quotedText: "quick brown fox",
        anchorPrefix: `Paragraph ${n} says the `,
        anchorSuffix: ` jumps over the lazy dog number ${n}.`,
      });
      comments.push(commentId);
    }

    const load = async (page: Page) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${origin}/page/${id}`, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      const editor = page.locator(ACTIVE_EDITOR);
      await expect(editor).toHaveAttribute("contenteditable", "true", {
        timeout: 60_000,
      });
      await expect(editor).toContainText("lazy dog", { timeout: 60_000 });
      await watch(page);
    };
    const review: Review = {
      origin,
      id,
      comments,
      suggestion: (n) => {
        const suggestion = byParagraph.get(n);
        if (!suggestion) throw new Error(`No suggestion for paragraph ${n}`);
        return suggestion;
      },
      open: async () => {
        const page = await context.newPage();
        await load(page);
        if (fixture.singles?.length) {
          await expect(
            page.locator(
              '[data-suggestion-decision="accepted"]:not(.ProseMirror *)',
            ),
          ).toHaveCount(fixture.singles.length, { timeout: 60_000 });
        }
        if (fixture.group?.length) {
          await expect(
            page.getByRole("button", {
              name: "Accept remaining",
              exact: true,
            }),
          ).toBeVisible({ timeout: 60_000 });
        }
        for (const comment of comments) {
          await expect(
            page.locator(`[data-comment-layout-thread="${comment}"]`),
          ).toBeVisible({ timeout: 60_000 });
        }
        // Cards settle into place after the first sync.
        await page.waitForTimeout(1_500);
        return page;
      },
      expectSaved: async (expected) => {
        await expect
          .poll(
            async () => {
              const [document, list] = await Promise.all([
                readContentAction(api, origin, "get-document", { id }),
                readContentAction(api, origin, "list-resource-suggestions", {
                  resourceType: "document",
                  resourceId: id,
                }),
              ]);
              const content = String(document.content);
              return {
                includes: expected.includes.filter((text) =>
                  content.includes(text),
                ),
                excludes: expected.excludes.filter((text) =>
                  content.includes(text),
                ),
                statuses: Object.fromEntries(
                  (list.suggestions as Array<{ id: string; status: string }>)
                    .filter((suggestion) => suggestion.id in expected.statuses)
                    .map((suggestion) => [suggestion.id, suggestion.status]),
                ),
              };
            },
            { message: "the saved page", timeout: 60_000 },
          )
          .toEqual({ ...expected, excludes: [] });
      },
      expectAfterReload: async (holds) => {
        const page = await context.newPage();
        try {
          await load(page);
          await expectView(page, holds, "the page after a reload");
        } finally {
          await page.close();
        }
      },
    };
    await body(review);
  } finally {
    try {
      if (created) await purgeContentPage(api, origin, id, title);
    } finally {
      await context.close();
    }
  }
}

test.describe("[content-review] deciding suggestions on a beta page", () => {
  for (const decision of ["accepted", "rejected"] as const) {
    test(`${decision === "accepted" ? "Accept" : "Reject"} keeps the page editable and saves a sentence typed right after`, async ({
      browser,
    }) => {
      await runReview(decision, browser, { singles: [2, 4] }, async (r) => {
        const watcher = await r.open();
        const page = await r.open();
        const [clicked] = await click(page, [
          { suggestion: r.suggestion(2), decision },
        ]);
        await page.waitForTimeout(100);
        await typeAtParagraphEnd(page, "number 1.", TYPED);

        await expectShownAtOnce(
          page,
          clicked,
          (frame) =>
            shows(frame, 2, decision) && !frame.cards.includes(r.suggestion(2)),
          `the ${decision} suggestion`,
        );
        await expectEditableThroughout(page, clicked);
        const result = (view: View) =>
          shows(view, 2, decision) &&
          shows(view, 4, "pending") &&
          typedInto(1)(view);
        await r.expectSaved({
          includes: [
            `number 1.${TYPED}`,
            decision === "accepted"
              ? "sleepy cat number 2."
              : "lazy dog number 2.",
          ],
          excludes: [],
          statuses: {
            [r.suggestion(2)]: decision,
            [r.suggestion(4)]: "pending",
          },
        });
        await expectView(watcher, result, "the other tab, without a reload");
        await r.expectAfterReload(result);
      });
    });
  }

  for (const button of ["Accept remaining", "Reject remaining"] as const) {
    test(`${button} keeps the page editable and saves a sentence typed right after`, async ({
      browser,
    }) => {
      const decision = button === "Accept remaining" ? "accepted" : "rejected";
      const group = [1, 2, 3, 4, 5, 6];
      await runReview(
        `group ${decision}`,
        browser,
        { paragraphs: 8, group },
        async (r) => {
          const page = await r.open();
          const [clicked] = await click(page, [{ button }]);
          await page.waitForTimeout(100);
          await typeAtParagraphEnd(page, "number 8.", TYPED);

          const result = (view: View) =>
            group.every((n) => shows(view, n, decision));
          await expectShownAtOnce(page, clicked, result, button);
          await expectEditableThroughout(page, clicked);
          await r.expectSaved({
            includes: [
              `number 8.${TYPED}`,
              ...group.map((n) =>
                decision === "accepted"
                  ? `sleepy cat number ${n}.`
                  : `lazy dog number ${n}.`,
              ),
            ],
            excludes: [],
            statuses: Object.fromEntries(
              group.map((n) => [r.suggestion(n), decision]),
            ),
          });
          await r.expectAfterReload(
            (view) => result(view) && typedInto(8)(view),
          );
        },
      );
    });
  }

  test("a 5 s save keeps the page editable, holds the changing words, and saves decisions in click order", async ({
    browser,
  }) => {
    await runReview("slow", browser, { singles: [2, 4, 6] }, async (r) => {
      const page = await r.open();
      const sent: string[] = [];
      await page.route(
        "**/_agent-native/actions/decide-resource-suggestion",
        async (route) => {
          sent.push((route.request().postDataJSON() as { id: string }).id);
          await sleep(5_000);
          await route.continue();
        },
      );
      const [first] = await click(page, [
        { suggestion: r.suggestion(2), decision: "accepted" },
      ]);
      await page.waitForTimeout(100);
      await typeAtParagraphEnd(page, "number 1.", TYPED);
      // The words the first decision replaces are held until it saves.
      await typeInsideChange(page, 2, "XYZ");
      const [second] = await click(page, [
        { suggestion: r.suggestion(4), decision: "accepted" },
      ]);

      await expectShownAtOnce(
        page,
        first,
        (frame) => shows(frame, 2, "accepted"),
        "the first accept",
      );
      await expectShownAtOnce(
        page,
        second,
        (frame) => shows(frame, 4, "accepted"),
        "the second accept",
      );
      await expectEditableThroughout(page, first);
      await expectView(
        page,
        (view) => !view.paragraphs.some((p) => p.includes("XYZ")),
        "the typing inside the changing words was held",
      );

      await r.expectSaved({
        includes: [
          `number 1.${TYPED}`,
          "sleepy cat number 2.",
          "sleepy cat number 4.",
        ],
        excludes: ["XYZ"],
        statuses: {
          [r.suggestion(2)]: "accepted",
          [r.suggestion(4)]: "accepted",
          [r.suggestion(6)]: "pending",
        },
      });
      expect(sent, "decisions saved in click order").toEqual([
        r.suggestion(2),
        r.suggestion(4),
      ]);
      await r.expectAfterReload(
        (view) =>
          shows(view, 2, "accepted") &&
          shows(view, 4, "accepted") &&
          shows(view, 6, "pending") &&
          typedInto(1)(view),
      );
    });
  });

  test("typing in the accepted suggestion's own paragraph during the save keeps both", async ({
    browser,
  }) => {
    await runReview(
      "same paragraph",
      browser,
      { singles: [2, 4] },
      async (r) => {
        const watcher = await r.open();
        const page = await r.open();
        await page.route(
          "**/_agent-native/actions/decide-resource-suggestion",
          async (route) => {
            await sleep(1_000);
            await route.continue();
          },
        );
        const [clicked] = await click(page, [
          { suggestion: r.suggestion(2), decision: "accepted" },
        ]);
        await page.waitForTimeout(100);
        await typeAtParagraphEnd(page, "number 2.", TYPED);

        await expectShownAtOnce(
          page,
          clicked,
          (frame) => shows(frame, 2, "accepted"),
          "the accept",
        );
        await expectEditableThroughout(page, clicked);
        const result = (view: View) =>
          shows(view, 2, "accepted") &&
          shows(view, 4, "pending") &&
          typedInto(2)(view);
        await r.expectSaved({
          includes: [`sleepy cat number 2.${TYPED}`],
          excludes: ["lazy dog number 2."],
          statuses: {
            [r.suggestion(2)]: "accepted",
            [r.suggestion(4)]: "pending",
          },
        });
        await expectView(page, result, "the page after the save");
        await expectView(watcher, result, "the other tab, without a reload");
        await r.expectAfterReload(result);
      },
    );
  });

  test("three Accepts 150 ms apart each show at once and all save", async ({
    browser,
  }) => {
    const paragraphs = [2, 4, 6];
    await runReview("rapid", browser, { singles: paragraphs }, async (r) => {
      const page = await r.open();
      const clicks = await click(
        page,
        paragraphs.map((n) => ({
          suggestion: r.suggestion(n),
          decision: "accepted" as const,
        })),
        150,
      );
      for (const [index, n] of paragraphs.entries()) {
        await expectShownAtOnce(
          page,
          clicks[index],
          (frame) => shows(frame, n, "accepted"),
          `accept ${index + 1}`,
        );
      }
      await r.expectSaved({
        includes: paragraphs.map((n) => `sleepy cat number ${n}.`),
        excludes: [],
        statuses: Object.fromEntries(
          paragraphs.map((n) => [r.suggestion(n), "accepted"]),
        ),
      });
      await r.expectAfterReload((view) =>
        paragraphs.every((n) => shows(view, n, "accepted")),
      );
    });
  });

  test("a failed Accept returns only that suggestion to pending and keeps what was typed", async ({
    browser,
  }) => {
    await runReview("failed", browser, { singles: [2, 4] }, async (r) => {
      const watcher = await r.open();
      const page = await r.open();
      let calls = 0;
      await page.route(
        "**/_agent-native/actions/decide-resource-suggestion",
        async (route) => {
          calls += 1;
          if (calls > 1) return route.continue();
          await sleep(2_000);
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "Injected by the beta e2e test" }),
          });
        },
      );
      const [clicked] = await click(page, [
        { suggestion: r.suggestion(2), decision: "accepted" },
      ]);
      await page.waitForTimeout(100);
      await typeAtParagraphEnd(page, "number 1.", TYPED);
      await click(page, [
        { suggestion: r.suggestion(4), decision: "accepted" },
      ]);

      const toast = page.locator("[data-sonner-toast]", {
        hasText: "Couldn't accept this suggestion",
      });
      await expect(toast).toBeVisible({ timeout: 15_000 });
      await expect(toast).toContainText("It's back to pending");
      const result = (view: View) =>
        shows(view, 2, "pending") &&
        shows(view, 4, "accepted") &&
        typedInto(1)(view);
      await expectView(page, result, "the page after the failed save");
      await expectEditableThroughout(page, clicked);
      await r.expectSaved({
        includes: [`number 1.${TYPED}`, "sleepy cat number 4."],
        excludes: ["sleepy cat number 2."],
        statuses: {
          [r.suggestion(2)]: "pending",
          [r.suggestion(4)]: "accepted",
        },
      });
      await expectView(watcher, result, "the other tab, without a reload");
      await r.expectAfterReload(result);
    });
  });

  test("a dropped connection on Accept remaining returns the group to pending and keeps what was typed", async ({
    browser,
  }) => {
    const group = [1, 2, 3, 4, 5, 6];
    await runReview(
      "group-dropped",
      browser,
      { paragraphs: 8, group },
      async (r) => {
        const page = await r.open();
        await page.route(
          "**/_agent-native/actions/decide-resource-suggestion-proposal",
          async (route) => {
            await sleep(2_000);
            await route.abort("failed");
          },
        );
        const [clicked] = await click(page, [{ button: "Accept remaining" }]);
        await page.waitForTimeout(100);
        await typeAtParagraphEnd(page, "number 8.", TYPED);

        const toast = page.locator("[data-sonner-toast]", {
          hasText: "Couldn't accept these suggestions",
        });
        await expect(toast).toBeVisible({ timeout: 15_000 });
        await expect(toast).toContainText("They're back to pending");
        const result = (view: View) =>
          group.every((n) => shows(view, n, "pending")) && typedInto(8)(view);
        await expectView(page, result, "the page after the dropped save");
        await expectEditableThroughout(page, clicked);
        await r.expectSaved({
          includes: [`number 8.${TYPED}`, "lazy dog number 1."],
          excludes: ["sleepy cat"],
          statuses: Object.fromEntries(
            group.map((n) => [r.suggestion(n), "pending"]),
          ),
        });
        await r.expectAfterReload(result);
      },
    );
  });

  test("a stale suggestion list after Accept doesn't bring the suggestion back", async ({
    browser,
  }) => {
    await runReview("stale-list", browser, { singles: [2, 4] }, async (r) => {
      const page = await r.open();
      // The list as it stood before the decision, delivered after it.
      const before = JSON.stringify(
        await readContentAction(page, r.origin, "list-resource-suggestions", {
          resourceType: "document",
          resourceId: r.id,
        }),
      );
      let decided = false;
      let staleServed = 0;
      await page.route(
        "**/_agent-native/actions/decide-resource-suggestion",
        async (route) => {
          const response = await route.fetch();
          await route.fulfill({ response });
          decided = true;
        },
      );
      // Every list asked for until the page has the decision's answer is
      // answered after it, with the list from before it.
      await page.route(
        "**/_agent-native/actions/list-resource-suggestions*",
        async (route) => {
          if (staleServed >= 2) return route.continue();
          const started = Date.now();
          while (!decided && Date.now() - started < 10_000) await sleep(50);
          if (!decided) return route.continue();
          staleServed += 1;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: before,
          });
        },
      );
      const [clicked] = await click(page, [
        { suggestion: r.suggestion(2), decision: "accepted" },
      ]);
      await r.expectSaved({
        includes: ["sleepy cat number 2."],
        excludes: [],
        statuses: {
          [r.suggestion(2)]: "accepted",
          [r.suggestion(4)]: "pending",
        },
      });
      await page.waitForTimeout(3_000);
      expect(
        staleServed,
        "no stale list reached the page after the decision",
      ).toBeGreaterThan(0);

      const frames = await framesSoFar(page);
      const shownAt = msUntil(frames, clicked, (frame) =>
        shows(frame, 2, "accepted"),
      );
      expect(shownAt, "the accept never showed").not.toBeNull();
      const reverted = frames.filter(
        (frame) =>
          frame.at >= clicked + (shownAt ?? 0) &&
          (!shows(frame, 2, "accepted") ||
            frame.cards.includes(r.suggestion(2))),
      );
      expect(
        reverted.map(({ at }) => at),
        "the accepted suggestion came back",
      ).toEqual([]);
    });
  });

  test("resolving a comment shows at once, and a failed resolve brings it back", async ({
    browser,
  }) => {
    await runReview("resolve", browser, { comments: [1, 3] }, async (r) => {
      const page = await r.open();
      const [first, second] = r.comments;
      const resolved = async () =>
        Object.fromEntries(
          (
            (
              await readContentAction(page, r.origin, "list-comments", {
                documentId: r.id,
              })
            ).comments as Array<{ id: string; resolved: unknown }>
          )
            .filter((comment) => comment.id === first || comment.id === second)
            .map((comment) => [comment.id, Boolean(comment.resolved)]),
        );

      const [clicked] = await click(page, [{ resolve: first }]);
      await expectShownAtOnce(
        page,
        clicked,
        (frame) => !frame.cards.includes(first),
        "the resolved comment",
      );
      await expect
        .poll(resolved, { timeout: 30_000 })
        .toEqual({ [first]: true, [second]: false });

      await page.route(
        "**/_agent-native/actions/update-comment",
        async (route) => {
          await sleep(1_000);
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "Injected by the beta e2e test" }),
          });
        },
      );
      const [again] = await click(page, [{ resolve: second }]);
      await expectShownAtOnce(
        page,
        again,
        (frame) => !frame.cards.includes(second),
        "the second resolve",
      );
      await expectView(
        page,
        (view) => view.cards.includes(second),
        "the comment whose resolve failed is back",
      );
      expect(await resolved()).toEqual({ [first]: true, [second]: false });
    });
  });
});
