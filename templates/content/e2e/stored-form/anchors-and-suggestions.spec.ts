import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Response,
} from "@playwright/test";

import { knownLossSpec } from "../../acceptance/known-loss";
import {
  ACTION_HEADERS,
  AgentClient,
  countMarkers,
  createPage,
  delay,
  EDITOR,
  expectEditorReady,
  getDocument,
  Markers,
  noiseFailures,
  postAction,
  TabSet,
  typeAtParagraphEnd,
} from "../helpers";
import { enterGateArm, knownLossOnArm } from "../live-body-gate";

// SF-05: comment anchors and pending suggestions survive concurrent edits and
// the stored-form migration.

test.describe.configure({ retries: 0, timeout: 240_000 });

// The tabs fall back to the 12 s collaboration poll; a change that only one
// tab made reaches the other within one interval and a little.
const POLL_INTERVAL_MS = 12_000;

const QUOTE = "shared phrase";

// Bravo holds the commented quote. Foxtrot repeats it, so only the stored
// context and offset tell the two apart. Tab A types at the end of Alpha,
// inside the quote's stored prefix; tab B types between the comment and the
// first suggestion; the agent rewrites Echo, between the two suggestions.
const PARAGRAPHS = [
  "Alpha paragraph the first tab types after.",
  "Bravo keeps the shared phrase in view.",
  "Charlie paragraph the second tab types after.",
  "Delta paragraph holds the first suggestion kumquat.",
  "Echo paragraph the agent rewrites.",
  "Foxtrot repeats the shared phrase as a decoy.",
  "Golf paragraph holds the second suggestion tamarind.",
];

const ACCEPTED = { find: "kumquat", replace: "persimmon" };
const REJECTED = { find: "tamarind", replace: "rambutan" };

const CARET_NODES =
  ".collaboration-carets__caret,.collaboration-carets__label,.ProseMirror-yjs-cursor";

interface CommentAnchor {
  quotedText: string;
  anchorPrefix: string;
  anchorSuffix: string;
  anchorStartOffset: number;
}

/**
 * The anchor the editor captures for a selection: offsets and 32 characters
 * of context in the text of every block joined with no separator.
 */
function anchorIn(
  blocks: readonly string[],
  block: number,
  quote: string,
): CommentAnchor {
  const within = blocks[block].indexOf(quote);
  if (within < 0) throw new Error(`${quote} is not in block ${block}`);
  const text = blocks.join("");
  const start = blocks.slice(0, block).join("").length + within;
  const end = start + quote.length;
  return {
    quotedText: quote,
    anchorPrefix: text.slice(Math.max(0, start - 32), start),
    anchorSuffix: text.slice(end, end + 32),
    anchorStartOffset: start,
  };
}

async function addComment(
  page: Page,
  documentId: string,
  anchor: CommentAnchor,
): Promise<string> {
  const created = await postAction<{ threadId?: string }>(page, "add-comment", {
    documentId,
    content: "Keep this wording.",
    ...anchor,
  });
  expect(created.threadId, JSON.stringify(created)).toEqual(expect.any(String));
  return created.threadId!;
}

interface StoredSuggestion {
  id: string;
  status: string;
  revision: number;
  baseRevision: string;
  metadata: Record<string, unknown> | null;
}

async function listSuggestions(
  page: Page,
  documentId: string,
): Promise<StoredSuggestion[]> {
  const response = await page.request.get(
    "/_agent-native/actions/list-resource-suggestions",
    {
      params: { resourceType: "document", resourceId: documentId },
      headers: ACTION_HEADERS,
    },
  );
  const text = await response.text();
  expect(
    response.ok(),
    `list-resource-suggestions (${response.status()}): ${text}`,
  ).toBe(true);
  return (JSON.parse(text) as { suggestions: StoredSuggestion[] }).suggestions;
}

async function suggestionStatus(
  page: Page,
  documentId: string,
  suggestionId: string,
): Promise<string | undefined> {
  return (await listSuggestions(page, documentId)).find(
    (suggestion) => suggestion.id === suggestionId,
  )?.status;
}

/** An agent's pending suggestion over MCP: one find, one reviewable edit. */
async function suggest(
  agent: AgentClient,
  page: Page,
  documentId: string,
  edit: { find: string; replace: string },
): Promise<string> {
  const { revision } = await getDocument(page, documentId);
  const result = await agent.call("suggest-document-edit", {
    id: documentId,
    baseRevision: revision,
    idempotencyKey: `${documentId}-sf05-${edit.find}`,
    find: edit.find,
    replace: edit.replace,
  });
  expect(result.isError, result.raw).toBe(false);
  const made = (await listSuggestions(page, documentId)).filter(
    (suggestion) => suggestion.metadata?.sourceFind === edit.find,
  );
  expect(
    made.map((suggestion) => suggestion.status),
    `one pending suggestion for "${edit.find}": ${result.raw}`,
  ).toEqual(["pending"]);
  return made[0].id;
}

interface Highlight {
  text: string;
  blocks: string[];
}

/** What a thread's highlight covers in one tab, without remote carets. */
async function commentHighlight(
  page: Page,
  threadId: string,
): Promise<Highlight> {
  return page.evaluate(
    ({ editor, threadId, carets }) => {
      const spans = [
        ...document.querySelectorAll(
          `${editor} .comment-highlight[data-comment-thread="${CSS.escape(threadId)}"]`,
        ),
      ];
      const clean = (element: Element | null) => {
        if (!element) return "";
        const copy = element.cloneNode(true) as HTMLElement;
        copy.querySelectorAll(carets).forEach((node) => node.remove());
        return copy.textContent ?? "";
      };
      return {
        text: spans.map(clean).join(""),
        blocks: [
          ...new Set(
            spans.map((span) =>
              clean(span.closest("p, td, th, li, h1, h2, h3")),
            ),
          ),
        ],
      };
    },
    { editor: EDITOR, threadId, carets: CARET_NODES },
  );
}

async function expectHighlight(
  page: Page,
  label: string,
  threadId: string,
  quote: string,
  blockStart: string,
): Promise<void> {
  await expect
    .poll(() => commentHighlight(page, threadId), {
      message: `${label}: the highlight covers exactly "${quote}" in the block starting "${blockStart}"`,
      timeout: 30_000,
    })
    .toEqual({
      text: quote,
      blocks: [expect.stringMatching(new RegExp(`^${blockStart}`))],
    });
}

interface SuggestionMarks {
  deleted: string;
  inserted: string;
  blocks: string[];
}

/** The suggested deletion and insertion one tab paints for a suggestion. */
async function suggestionMarks(
  page: Page,
  suggestionId: string,
): Promise<SuggestionMarks> {
  return page.evaluate(
    ({ editor, suggestionId }) => {
      const nodes = [
        ...document.querySelectorAll(
          `${editor} [data-suggestion-id="${CSS.escape(suggestionId)}"]`,
        ),
      ];
      const text = (kind: string) =>
        nodes
          .filter((node) => node.classList.contains(kind))
          .map((node) => node.textContent ?? "")
          .join("");
      return {
        deleted: text("suggestion-delete"),
        inserted: text("suggestion-insert"),
        blocks: [
          ...new Set(
            nodes.map(
              (node) => node.closest("p, td, th, li")?.textContent ?? "",
            ),
          ),
        ],
      };
    },
    { editor: EDITOR, suggestionId },
  );
}

async function expectSuggestionRenders(
  page: Page,
  label: string,
  suggestionId: string,
  edit: { find: string; replace: string },
  blockStart: string,
): Promise<void> {
  await expect
    .poll(() => suggestionMarks(page, suggestionId), {
      message: `${label}: the suggestion paints "${edit.find}" → "${edit.replace}" in the block starting "${blockStart}"`,
      timeout: 30_000,
    })
    .toEqual({
      deleted: edit.find,
      inserted: edit.replace,
      blocks: [expect.stringMatching(new RegExp(`^${blockStart}`))],
    });
}

/** The text of each paragraph the editor shows, table cells included. */
async function renderedBlocks(page: Page): Promise<string[]> {
  return page.evaluate(
    ({ editor, carets }) =>
      [...document.querySelectorAll(`${editor} p`)].map((block) => {
        const copy = block.cloneNode(true) as HTMLElement;
        copy.querySelectorAll(carets).forEach((node) => node.remove());
        return copy.textContent ?? "";
      }),
    { editor: EDITOR, carets: CARET_NODES },
  );
}

async function editorText(page: Page): Promise<string> {
  return page.evaluate(
    ({ editor, carets }) => {
      const root = document.querySelector(editor);
      if (!root) return "";
      const copy = root.cloneNode(true) as HTMLElement;
      copy
        .querySelectorAll(`${carets},[data-suggestion-widget]`)
        .forEach((node) => node.remove());
      return copy.textContent ?? "";
    },
    { editor: EDITOR, carets: CARET_NODES },
  );
}

/** Every marker once in the saved page and in each tab. */
async function waitForConvergence(
  reader: Page,
  id: string,
  tabs: TabSet,
  markers: Markers,
): Promise<void> {
  await tabs.showAll();
  const surfaces = async () => {
    const counts: Record<string, Record<string, number>> = {
      sql: countMarkers(
        (await getDocument(reader, id)).content ?? "",
        markers.all,
      ),
    };
    for (const [page, record] of tabs.tabs)
      counts[record.label] = countMarkers(await editorText(page), markers.all);
    return counts;
  };
  const once = Object.fromEntries(markers.all.map((marker) => [marker, 1]));
  await expect
    .poll(surfaces, {
      message: "every marker once in SQL and in each tab",
      timeout: 60_000,
      intervals: [1_000],
    })
    .toEqual(
      Object.fromEntries(
        ["sql", ...[...tabs.tabs.values()].map((tab) => tab.label)].map(
          (surface) => [surface, once],
        ),
      ),
    );
  await tabs.quiet();
}

/** The answers every decide-resource-suggestion call a page made received. */
function recordDecisions(page: Page): Array<{ status: number; body: string }> {
  const answers: Array<{ status: number; body: string }> = [];
  page.on("response", (response: Response) => {
    if (
      new URL(response.url()).pathname !==
      "/_agent-native/actions/decide-resource-suggestion"
    )
      return;
    void response
      .text()
      .then((body) => answers.push({ status: response.status(), body }));
  });
  return answers;
}

/** Accept or reject through the suggestion's own card, as a reviewer does. */
async function decideInUi(
  page: Page,
  suggestionId: string,
  decision: "accepted" | "rejected",
): Promise<void> {
  await page
    .locator(`${EDITOR} [data-suggestion-id="${suggestionId}"]`)
    .first()
    .click();
  await page
    .locator(
      `[data-suggestion-id="${suggestionId}"] button[data-suggestion-decision="${decision}"]`,
    )
    .filter({ visible: true })
    .first()
    .click();
}

/** One tab shows the accepted text, no suggestion marks and no error. */
async function expectShowsAccepted(
  tabs: TabSet,
  tab: Page,
  suggestionId: string,
): Promise<void> {
  const record = tabs.record(tab);
  await expect
    .poll(
      async () => {
        const text = await editorText(tab);
        return {
          accepted:
            text.includes(`suggestion ${ACCEPTED.replace}.`) &&
            !text.includes(ACCEPTED.find),
          suggestionMarks: await tab
            .locator(`${EDITOR} [data-suggestion-id="${suggestionId}"]`)
            .count(),
          recovery: [...record.recovery],
          errorToasts: [...record.errorToasts],
        };
      },
      {
        message: `${record.label} shows the accepted text and no error`,
        timeout: POLL_INTERVAL_MS * 3,
      },
    )
    .toEqual({
      accepted: true,
      suggestionMarks: 0,
      recovery: [],
      errorToasts: [],
    });
}

function expectNoNoise(tabs: TabSet, labels?: readonly string[]): void {
  const records = [...tabs.tabs.values()].filter(
    (record) => !labels || labels.includes(record.label),
  );
  for (const record of records)
    expect(
      record.editorMounts,
      `${record.label} reported no editor mount, so its toasts and recovery copy went uncounted`,
    ).toBeGreaterThan(0);
  expect(
    noiseFailures(records),
    "recovery notices, error toasts or saves sent to History",
  ).toEqual([]);
}

interface Around {
  id: string;
  tabs: TabSet;
  first: Page;
  second: Page;
  markers: Markers;
  threadId: string;
  accepted: string;
  rejected: string;
}

/**
 * The shared scene: one comment and two pending suggestions on a seven
 * paragraph page, then two tabs and an agent editing around all three until
 * every surface converges.
 */
async function editAround(
  page: Page,
  context: BrowserContext,
  agent: AgentClient,
  title: string,
): Promise<Around> {
  const tabs = await TabSet.create(context);
  const id = await createPage(page, title, PARAGRAPHS.join("\n"));
  await enterGateArm(page, id);
  const threadId = await addComment(page, id, anchorIn(PARAGRAPHS, 1, QUOTE));
  const accepted = await suggest(agent, page, id, ACCEPTED);
  const rejected = await suggest(agent, page, id, REJECTED);

  const first = await tabs.open("A", id);
  const second = await tabs.open("B", id);
  for (const [tab, label] of [
    [first, "A"],
    [second, "B"],
  ] as const) {
    await expectHighlight(
      tab,
      `${label} before editing`,
      threadId,
      QUOTE,
      "Bravo",
    );
    await expectSuggestionRenders(
      tab,
      `${label} before editing`,
      accepted,
      ACCEPTED,
      "Delta",
    );
  }

  const markers = new Markers();
  await tabs.showOnly(first);
  await typeAtParagraphEnd(first, "Alpha paragraph", ` ${markers.next("A")}`);
  await tabs.showOnly(second);
  await typeAtParagraphEnd(
    second,
    "Charlie paragraph",
    ` ${markers.next("B")}`,
  );
  await tabs.waitForSaveAnswers(first, 1);
  await tabs.waitForSaveAnswers(second, 1);

  await agent.edit(
    id,
    "Echo paragraph the agent rewrites.",
    `Echo paragraph the agent rewrote ${markers.next("Agent")}.`,
  );
  // The agent's change is still on its way to both tabs while they type.
  await tabs.showOnly(first);
  await typeAtParagraphEnd(first, "Alpha paragraph", ` ${markers.next("A")}`);
  await tabs.showOnly(second);
  await typeAtParagraphEnd(
    second,
    "Charlie paragraph",
    ` ${markers.next("B")}`,
  );

  await waitForConvergence(page, id, tabs, markers);
  return { id, tabs, first, second, markers, threadId, accepted, rejected };
}

test.describe(
  "SF-05 comment anchors and pending suggestions",
  { tag: "@SF-05" },
  () => {
    let agent: AgentClient;

    test.beforeEach(({ page }) => {
      agent = AgentClient.shared(page);
    });

    test("a comment and pending suggestions stay put while two tabs and an agent edit around them", async ({
      page,
      context,
    }) => {
      const scene = await editAround(
        page,
        context,
        agent,
        "SF-05 edits around anchors",
      );
      for (const [tab, label] of [
        [scene.first, "A"],
        [scene.second, "B"],
      ] as const) {
        await expectHighlight(tab, label, scene.threadId, QUOTE, "Bravo");
        await expectSuggestionRenders(
          tab,
          label,
          scene.accepted,
          ACCEPTED,
          "Delta",
        );
        await expectSuggestionRenders(
          tab,
          label,
          scene.rejected,
          REJECTED,
          "Golf",
        );
      }

      const { comments } = await (async () => {
        const response = await page.request.get(
          "/_agent-native/actions/list-comments",
          { params: { documentId: scene.id }, headers: ACTION_HEADERS },
        );
        const text = await response.text();
        expect(response.ok(), `list-comments: ${text}`).toBe(true);
        return JSON.parse(text) as {
          comments: Array<{ thread_id: string; quoted_text: string | null }>;
        };
      })();
      expect(
        comments.find((comment) => comment.thread_id === scene.threadId)
          ?.quoted_text,
        "the stored quote",
      ).toBe(QUOTE);
      // A tab opened now has only the stored anchor to place the highlight.
      const fresh = await scene.tabs.open("fresh", scene.id);
      await expectHighlight(fresh, "fresh tab", scene.threadId, QUOTE, "Bravo");
      for (const id of [scene.accepted, scene.rejected])
        expect(await suggestionStatus(page, scene.id, id)).toBe("pending");
      // The fresh tab's own saves are the known loss checked next.
      expectNoNoise(scene.tabs, ["A", "B"]);
    });

    test(
      "a tab opened after the edits saves nothing",
      knownLossSpec({
        lane: "unowned",
        outcome: "SF-05",
        reason:
          'A tab opened just after two tabs and an agent finished editing replays an open tab\'s draft-journal entry as its own save, which goes to History and shows "Your edits were saved to Version History" though nothing was typed in it (intermittent; seen in CI on Linux). #7683 fixes it.',
      }),
      async ({ page, context }) => {
        const scene = await editAround(
          page,
          context,
          agent,
          "SF-05 tab opened after edits",
        );
        const fresh = await scene.tabs.open("fresh", scene.id);
        await expectHighlight(
          fresh,
          "fresh tab",
          scene.threadId,
          QUOTE,
          "Bravo",
        );
        for (const id of [scene.accepted, scene.rejected])
          expect(await suggestionStatus(page, scene.id, id)).toBe("pending");
        await scene.tabs.quiet();
        expectNoNoise(scene.tabs);
      },
    );

    test(
      "accepting a suggestion after the edits applies its change once, in both tabs",
      knownLossSpec({
        lane: "L7",
        outcome: "SF-05",
        reason:
          "Accepting a suggestion from its card after the page body changed since the suggestion was made crashes the accepting tab with React error #185 (Something went wrong), though the server applies the change once.",
      }),
      async ({ page, context }) => {
        const scene = await editAround(
          page,
          context,
          agent,
          "SF-05 accept after edits",
        );
        const decisions = recordDecisions(scene.first);
        const before = (await getDocument(page, scene.id)).content ?? "";
        expect(countMarkers(before, [ACCEPTED.find])[ACCEPTED.find]).toBe(1);
        const expected = before.replace(ACCEPTED.find, ACCEPTED.replace);

        await decideInUi(scene.first, scene.accepted, "accepted");
        await expect
          .poll(() => suggestionStatus(page, scene.id, scene.accepted), {
            message: "the suggestion is accepted",
            timeout: 30_000,
          })
          .toBe("accepted");
        await expect
          .poll(async () => (await getDocument(page, scene.id)).content, {
            message: "the body with the accepted change",
            timeout: 30_000,
          })
          .toBe(expected);
        await expectShowsAccepted(scene.tabs, scene.second, scene.accepted);
        await expectShowsAccepted(scene.tabs, scene.first, scene.accepted);
        // A tab that saves its older copy after the accept would undo it.
        await delay(POLL_INTERVAL_MS + 3_000);
        await scene.tabs.quiet();
        expect(
          (await getDocument(page, scene.id)).content,
          "the body a poll interval after the accept",
        ).toBe(expected);
        for (const [tab, label] of [
          [scene.first, "A"],
          [scene.second, "B"],
        ] as const)
          expect(
            countMarkers(await editorText(tab), [
              ACCEPTED.replace,
              ...scene.markers.all,
            ]),
            `${label} after the accept`,
          ).toEqual(
            Object.fromEntries(
              [ACCEPTED.replace, ...scene.markers.all].map((word) => [word, 1]),
            ),
          );
        expect(decisions.map((answer) => answer.status)).toEqual([200]);
        expectNoNoise(scene.tabs);
      },
    );

    test("rejecting a suggestion after the edits leaves the body byte for byte", async ({
      page,
      context,
    }) => {
      const scene = await editAround(
        page,
        context,
        agent,
        "SF-05 reject after edits",
      );
      const decisions = recordDecisions(scene.second);
      const before = (await getDocument(page, scene.id)).content;

      await decideInUi(scene.second, scene.rejected, "rejected");
      await expect
        .poll(() => suggestionStatus(page, scene.id, scene.rejected), {
          message: "the suggestion is rejected",
          timeout: 30_000,
        })
        .toBe("rejected");
      for (const tab of [scene.first, scene.second])
        await expect(
          tab.locator(`${EDITOR} [data-suggestion-id="${scene.rejected}"]`),
        ).toHaveCount(0, { timeout: POLL_INTERVAL_MS * 3 });
      await delay(POLL_INTERVAL_MS + 3_000);
      await scene.tabs.quiet();
      expect((await getDocument(page, scene.id)).content).toBe(before);
      for (const [tab, label] of [
        [scene.first, "A"],
        [scene.second, "B"],
      ] as const)
        await expectSuggestionRenders(
          tab,
          label,
          scene.accepted,
          ACCEPTED,
          "Delta",
        );
      expect(decisions.map((answer) => answer.status)).toEqual([200]);
      expectNoNoise(scene.tabs);
    });

    // Agent-form Markdown: blank lines between blocks, an escaped underscore,
    // underscore emphasis, bare dollar signs and a pipe table whose cells
    // carry edge spaces. The first browser save writes it in the stored form.
    const AGENT_FORM = [
      "Alpha paragraph written by an agent.",
      "",
      "Bravo paragraph with __bold__ and snake\\_case words.",
      "",
      "Charlie paragraph costs $60 per seat.",
      "",
      "|  Plan  |  Price  |",
      "| --- | --- |",
      "|  Starter seat  |  $60  |",
      "|  Team seat  |  $90  |",
      "",
      "Delta paragraph the reader types after.",
    ].join("\n");

    const PRICE = { find: "costs $60", replace: "costs $75" };
    // A find/replace suggestion paints only the characters that change.
    const PRICE_MARKS = { deleted: "60", inserted: "75" };

    const AGENT_FORM_LOSS =
      "A pending suggestion on an agent-form page with an escaped underscore before it and a pipe table after it never renders in the editor, and once the first browser save rewrites the page in the stored form, accepting it fails with suggestion_stale.";

    test(
      "an agent-form page keeps its comments anchored and its suggestion placeable after the first browser save",
      knownLossOnArm({
        // SF-11 keeps gate off on main's body path, which stores the agent's
        // bytes as sent, so no lane flips this arm before the old path goes.
        off: { lane: "unowned", outcome: "SF-05", reason: AGENT_FORM_LOSS },
        on: {
          lane: "L3",
          outcome: "SF-05",
          reason: `${AGENT_FORM_LOSS} A switched page stores the agent's body in canonical form once L3's switch and writers land.`,
        },
      }),
      async ({ page, context }) => {
        const { id } = await agent.createPage("SF-05 agent form", AGENT_FORM);
        await enterGateArm(page, id);
        test.info().annotations.push({
          type: "agent-form body kept as sent",
          description: String(
            (await getDocument(page, id)).content === AGENT_FORM,
          ),
        });
        const price = await suggest(agent, page, id, PRICE);

        const tabs = await TabSet.create(context);
        const tab = await tabs.open("A", id);
        // A person's comment quotes the text the editor shows, which on an
        // agent-form page need not be the text its Markdown means.
        const blocks = await renderedBlocks(tab);
        const bravo = blocks.findIndex((block) => block.startsWith("Bravo"));
        const starter = blocks.indexOf("Starter seat");
        expect([bravo, starter], JSON.stringify(blocks)).not.toContain(-1);
        const quote = blocks[bravo].slice(
          blocks[bravo].indexOf("with ") + "with ".length,
          blocks[bravo].indexOf(" words"),
        );
        const words = await addComment(
          page,
          id,
          anchorIn(blocks, bravo, quote),
        );
        const cell = await addComment(
          page,
          id,
          anchorIn(blocks, starter, "Starter seat"),
        );
        // An open tab does not pick up comments added elsewhere until it loads
        // them again.
        await tab.reload({ waitUntil: "domcontentloaded" });
        await expectEditorReady(tab);
        test.info().annotations.push(
          { type: "quote as the editor shows it", description: quote },
          {
            type: "saves before the keystroke",
            description: String(tabs.record(tab).saveRequests),
          },
        );
        const anchored = async (label: string) => {
          await expectHighlight(tab, label, words, quote, "Bravo");
          await expectHighlight(
            tab,
            label,
            cell,
            "Starter seat",
            "Starter seat",
          );
          await expect(
            tab.locator("[data-unanchored-comments]"),
            `${label}: nothing sits under "Highlight unavailable"`,
          ).toHaveCount(0);
          // Soft, so a suggestion the tab cannot place still lets the comment
          // and accept checks after it report.
          await expect.soft
            .poll(() => suggestionMarks(tab, price), {
              message: `${label}: the suggestion paints "${PRICE_MARKS.deleted}" → "${PRICE_MARKS.inserted}" in the Charlie paragraph`,
              timeout: 30_000,
            })
            .toEqual({
              ...PRICE_MARKS,
              blocks: [expect.stringMatching(/^Charlie paragraph/)],
            });
        };
        await anchored("before the first save");

        await typeAtParagraphEnd(tab, "Delta paragraph", "!");
        await tabs.waitForSaveAnswers(tab, 1);
        await expect
          .poll(async () => (await getDocument(page, id)).content, {
            message: "the keystroke is saved",
            timeout: 30_000,
          })
          .toContain("types after.!");
        await tabs.quiet();
        test.info().annotations.push({
          type: "body after the first browser save",
          description: JSON.stringify((await getDocument(page, id)).content),
        });
        await anchored("after the first save");
        await tab.reload({ waitUntil: "domcontentloaded" });
        await expectEditorReady(tab);
        await anchored("reopened after the first save");

        // Accept through the action the Accept button calls: a suggestion the
        // first save left stale fails here as suggestion_stale.
        const pending = (await listSuggestions(page, id)).find(
          (suggestion) => suggestion.id === price,
        );
        expect(pending?.status, "the suggestion before the accept").toBe(
          "pending",
        );
        const decided = await postAction<{ suggestion?: { status?: string } }>(
          page,
          "decide-resource-suggestion",
          {
            id: price,
            decision: "accepted",
            idempotencyKey: `${price}-sf05-accept`,
            observedBase: pending?.baseRevision,
            observedRevision: pending?.revision,
          },
        );
        expect(decided.suggestion?.status, JSON.stringify(decided)).toBe(
          "accepted",
        );
        const after = (await getDocument(page, id)).content ?? "";
        expect(
          after.split("\n").filter((line) => line.startsWith("Charlie")),
          "the accepted line",
        ).toEqual([
          expect.stringMatching(/^Charlie paragraph costs \\?\$75 per seat\.$/),
        ]);
        expect(
          after.match(/\$60/g) ?? [],
          "the table keeps its $60",
        ).toHaveLength(1);
        await expect
          .poll(() => editorText(tab), {
            message: "the tab shows the accepted price",
            timeout: POLL_INTERVAL_MS * 3,
          })
          .toContain("costs $75 per seat.");
        await tabs.quiet();
        expectNoNoise(tabs);
      },
    );

    test("the stored-form backfill keeps anchors, suggestions and drafts", async () => {
      test.skip(
        true,
        "Needs the stored-form backfill, which L6b adds: main has no backfill to run over agent-form pages carrying comments, suggestions and drafts, so no orphan, suggestion_stale or History check can run.",
      );
    });
  },
);
