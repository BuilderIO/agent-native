import { expect, test, type Page } from "@playwright/test";

import { knownLossSpec } from "../../acceptance/known-loss";
import {
  AGENT_MARKDOWN_BODY,
  AgentClient,
  EDITOR,
  EDITOR_BODY,
  Markers,
  PAGE_PARAGRAPHS,
  SaveGate,
  TabSet,
  countMarkers,
  createPage,
  getDocument,
  noiseFailures,
  typeAtParagraphEnd,
} from "../helpers";
import { enterGateArm, knownLossOnArm } from "../live-body-gate";
import { expectBlocksKept, liveCopyContaining } from "./collab-blocks";

// SF-02: an agent's edit over MCP lands on a page while it is open. Each case
// requires the edit to apply once and read back at once, every open tab to
// show it within one sync interval, every word the tabs typed to survive, an
// identical retry to replay without a second write, and every block nobody
// touched to keep the live-copy item it had.

test.describe.configure({ retries: 0, timeout: 180_000 });

// TabSet refuses the realtime stream, so tabs run on the 12 s poll beta runs
// on. A tab has one interval to pick the edit up, plus a few seconds for a
// loaded local server to answer the poll and the editor to paint it.
const SYNC_INTERVAL_MS = 12_000;
const SHOW_WITHIN_MS = SYNC_INTERVAL_MS + 5_000;
const CONVERGE_WITHIN_MS = 45_000;

const [ALPHA, BRAVO, CHARLIE, DELTA] = PAGE_PARAGRAPHS;

interface EditReceipt {
  applied?: number;
  total?: number;
  receipt?: {
    outcome?: string;
    revisions?: { before: string; after: string };
    idempotency?: { result?: string };
  };
}

interface AgentEdit {
  marker: string;
  args: Record<string, unknown>;
  receipt: EditReceipt;
  appliedAt: number;
}

/** Rewrite the Delta paragraph over MCP, from the revision get-document reads now. */
async function agentEdit(
  agent: AgentClient,
  reader: Page,
  id: string,
  markers: Markers,
): Promise<AgentEdit> {
  const marker = markers.next("Agent");
  const { revision } = await getDocument(reader, id);
  const args = {
    id,
    baseRevision: revision,
    idempotencyKey: `${id}-sf02-${marker}`,
    edits: [
      {
        find: DELTA,
        replace: `Delta paragraph edited by the agent ${marker}.`,
      },
    ],
  };
  const receipt = await agent.callJson<EditReceipt>("edit-document", args);
  const appliedAt = Date.now();
  const evidence = JSON.stringify(receipt);
  expect(receipt.applied, evidence).toBe(1);
  expect(receipt.total, evidence).toBe(1);
  expect(receipt.receipt?.outcome, evidence).toBe("applied");
  expect(receipt.receipt?.idempotency?.result, evidence).toBe("applied");
  const read = await getDocument(reader, id);
  expect(
    countMarkers(read.content ?? "", [marker])[marker],
    `get-document right after the edit: ${read.content}`,
  ).toBe(1);
  return { marker, args, receipt, appliedAt };
}

/** Every open tab shows the agent's words within one sync interval. */
async function expectShownInTime(
  tabs: readonly Page[],
  edit: AgentEdit,
): Promise<void> {
  for (const tab of tabs) {
    const left = SHOW_WITHIN_MS - (Date.now() - edit.appliedAt);
    await expect(
      tab.locator(EDITOR),
      `an open tab shows the agent's edit within ${SHOW_WITHIN_MS} ms`,
    ).toContainText(edit.marker, { timeout: Math.max(left, 1) });
  }
}

/** Every marker appears exactly once in the saved page and in every open tab. */
async function expectEachOnce(
  tabs: readonly Page[],
  reader: Page,
  id: string,
  markers: Markers,
): Promise<void> {
  const once = Object.fromEntries(markers.all.map((marker) => [marker, 1]));
  const expected: Record<string, Record<string, number>> = { saved: once };
  tabs.forEach((_, index) => (expected[`tab ${index + 1}`] = once));
  await expect
    .poll(
      async () => {
        const seen: Record<string, Record<string, number>> = {
          saved: countMarkers(
            (await getDocument(reader, id)).content ?? "",
            markers.all,
          ),
        };
        for (const [index, tab] of tabs.entries())
          seen[`tab ${index + 1}`] = countMarkers(
            await tab.locator(EDITOR).innerText(),
            markers.all,
          );
        return seen;
      },
      {
        message: "every typed and agent-written word, once on every surface",
        timeout: CONVERGE_WITHIN_MS,
      },
    )
    .toEqual(expected);
}

/**
 * Send the same call again once the tabs are quiet: the server answers from
 * its receipt, and the page does not change.
 */
async function expectReplay(
  agent: AgentClient,
  tabs: TabSet,
  reader: Page,
  id: string,
  edit: AgentEdit,
): Promise<void> {
  await tabs.quiet();
  const before = await getDocument(reader, id);
  const again = await agent.callJson<EditReceipt>("edit-document", edit.args);
  const evidence = JSON.stringify({ first: edit.receipt, again });
  expect(again.receipt?.idempotency?.result, evidence).toBe("replayed");
  expect(again.receipt?.revisions, evidence).toEqual(
    edit.receipt.receipt?.revisions,
  );
  const after = await getDocument(reader, id);
  expect(after.revision, "a replayed edit writes nothing").toBe(
    before.revision,
  );
  expect(countMarkers(after.content ?? "", [edit.marker])[edit.marker]).toBe(1);
}

function expectNoRecoveryNoise(tabs: TabSet): void {
  expect(
    noiseFailures([...tabs.tabs.values()]),
    "recovery notices, error toasts or saves sent to History",
  ).toEqual([]);
}

test.describe(
  "SF-02 an agent edits a page while it is open",
  { tag: "@SF-02" },
  () => {
    let agent: AgentClient;

    test.beforeEach(({ page }) => {
      agent = AgentClient.shared(page);
    });

    test(
      "no tab is open",
      knownLossOnArm({
        on: {
          lane: "L3",
          outcome: "SF-02",
          reason:
            "On a switched page the agent's edit-document writes the stored body, not the live copy, so a tab opened just after the edit can load a live copy without it and never show it (intermittent: 2 of 14 runs on L4b's head).",
        },
      }),
      async ({ page, context }) => {
        const tabs = await TabSet.create(context);
        const markers = new Markers();
        const id = await createPage(page, "SF-02 no tab", EDITOR_BODY);
        await enterGateArm(page, id);
        const seed = await tabs.open("seed", id);
        await tabs.quiet();
        await seed.close();
        const before = await liveCopyContaining(page, id, PAGE_PARAGRAPHS);

        const edit = await agentEdit(agent, page, id, markers);
        const opened = await tabs.open("A", id);
        await expectShownInTime([opened], edit);
        await expectEachOnce([opened], page, id, markers);
        expectBlocksKept(
          before,
          await liveCopyContaining(page, id, markers.all),
          [ALPHA, BRAVO, CHARLIE],
        );
        await expectReplay(agent, tabs, page, id, edit);
        expectNoRecoveryNoise(tabs);
      },
    );

    test("one tab is open and idle", async ({ page, context }) => {
      const tabs = await TabSet.create(context);
      const markers = new Markers();
      const id = await createPage(page, "SF-02 idle tab", EDITOR_BODY);
      await enterGateArm(page, id);
      const idle = await tabs.open("A", id);
      await tabs.quiet();
      const before = await liveCopyContaining(page, id, PAGE_PARAGRAPHS);

      const edit = await agentEdit(agent, page, id, markers);
      await expectShownInTime([idle], edit);
      await expectEachOnce([idle], page, id, markers);
      expectBlocksKept(
        before,
        await liveCopyContaining(page, id, markers.all),
        [ALPHA, BRAVO, CHARLIE],
      );
      await expectReplay(agent, tabs, page, id, edit);
      expectNoRecoveryNoise(tabs);
    });

    test(
      "a tab is typing and its save is still on the way",
      knownLossOnArm({
        on: {
          lane: "L3",
          outcome: "SF-02",
          reason:
            "On a switched page the agent's edit-document writes the stored body, not the live copy, so the server answers the typing tab's held collab update not_derived (not_live_copy) and the tab goes back to an update-document save, which shows \"This page changed elsewhere\". No text is lost.",
        },
      }),
      async ({ page, context }) => {
        const tabs = await TabSet.create(context);
        const markers = new Markers();
        const id = await createPage(page, "SF-02 save held", EDITOR_BODY);
        await enterGateArm(page, id);
        const typing = await tabs.open("A", id);
        const gate = await SaveGate.install(typing);
        await tabs.quiet();
        const before = await liveCopyContaining(page, id, PAGE_PARAGRAPHS);

        gate.holdArrivals();
        await typeAtParagraphEnd(
          typing,
          "Alpha paragraph",
          ` ${markers.next("A")}`,
        );
        await gate.waitForHeld();
        const edit = await agentEdit(agent, page, id, markers);
        await expectShownInTime([typing], edit);
        gate.pass();
        await gate.release();

        await expectEachOnce([typing], page, id, markers);
        expectBlocksKept(
          before,
          await liveCopyContaining(page, id, markers.all),
          [BRAVO, CHARLIE],
        );
        await expectReplay(agent, tabs, page, id, edit);
        expectNoRecoveryNoise(tabs);
      },
    );

    test(
      "two tabs are typing",
      knownLossSpec({
        lane: "L5b",
        outcome: "SF-02",
        reason:
          "The agent's edit-document and a tab's save lock the page row and its collection membership in opposite orders, so an agent edit made while tabs save can deadlock and come back as an untyped Failed query error with the edit dropped.",
      }),
      async ({ page, context }) => {
        const tabs = await TabSet.create(context);
        const markers = new Markers();
        const id = await createPage(page, "SF-02 two tabs", EDITOR_BODY);
        await enterGateArm(page, id);
        const first = await tabs.open("A", id);
        const second = await tabs.open("B", id);
        await tabs.quiet();
        const before = await liveCopyContaining(page, id, PAGE_PARAGRAPHS);

        await typeAtParagraphEnd(
          first,
          "Alpha paragraph",
          ` ${markers.next("A")}`,
        );
        const fromSecond = markers.next("B");
        const [edit] = await Promise.all([
          agentEdit(agent, page, id, markers),
          typeAtParagraphEnd(second, "Charlie paragraph", ` ${fromSecond}`),
        ]);
        await typeAtParagraphEnd(
          first,
          "Alpha paragraph",
          ` ${markers.next("A")}`,
        );

        await expectShownInTime([first, second], edit);
        await expectEachOnce([first, second], page, id, markers);
        expectBlocksKept(
          before,
          await liveCopyContaining(page, id, markers.all),
          [BRAVO],
        );
        await expectReplay(agent, tabs, page, id, edit);
        expectNoRecoveryNoise(tabs);
      },
    );

    test("an agent created the page", async ({ page, context }) => {
      const tabs = await TabSet.create(context);
      const markers = new Markers();
      const { id } = await agent.createPage(
        "SF-02 agent-created",
        AGENT_MARKDOWN_BODY,
      );
      await enterGateArm(page, id);
      const open = await tabs.open("A", id);
      await tabs.quiet();
      const before = await liveCopyContaining(page, id, PAGE_PARAGRAPHS);

      const edit = await agentEdit(agent, page, id, markers);
      await expectShownInTime([open], edit);
      await expectEachOnce([open], page, id, markers);
      expectBlocksKept(
        before,
        await liveCopyContaining(page, id, markers.all),
        [ALPHA, BRAVO, CHARLIE],
      );
      await expectReplay(agent, tabs, page, id, edit);
      expectNoRecoveryNoise(tabs);
    });

    test("the browser has just saved the page again", async ({
      page,
      context,
    }) => {
      const tabs = await TabSet.create(context);
      const markers = new Markers();
      const id = await createPage(page, "SF-02 after re-save", EDITOR_BODY);
      await enterGateArm(page, id);
      const open = await tabs.open("A", id);
      await tabs.quiet();
      const before = await liveCopyContaining(page, id, PAGE_PARAGRAPHS);

      await typeAtParagraphEnd(
        open,
        "Alpha paragraph",
        ` ${markers.next("A")}`,
      );
      await tabs.waitForTypingSaved(open, id);
      const edit = await agentEdit(agent, page, id, markers);
      await expectShownInTime([open], edit);
      await expectEachOnce([open], page, id, markers);
      expectBlocksKept(
        before,
        await liveCopyContaining(page, id, markers.all),
        [BRAVO, CHARLIE],
      );
      await expectReplay(agent, tabs, page, id, edit);
      expectNoRecoveryNoise(tabs);
    });
  },
);
