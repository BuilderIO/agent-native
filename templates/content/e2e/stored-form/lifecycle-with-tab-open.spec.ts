import { expect, test, type Page } from "@playwright/test";

import { knownLossSpec } from "../../acceptance/known-loss";
import {
  ACTION_HEADERS,
  AgentClient,
  EDITOR,
  EDITOR_BODY,
  TabSet,
  createPage,
  noiseFailures,
  postAction,
} from "../helpers";
import { enterGateArm } from "../live-body-gate";

// SF-03: restoring a page, from Trash or from History, brings back what it
// held while a tab has it open, and a page in Trash takes no edits. Moving a
// page and the lock cycle belong to L5's harness.

test.describe.configure({ retries: 0, timeout: 180_000 });

// The open tab polls every 12 s on beta, where the realtime stream answers
// 204; TabSet refuses the stream the same way. One poll plus its refetch.
const SYNC_MS = 30_000;

// Read from app/i18n-data.ts (empty.pageInTrash).
const IN_TRASH = "This page is in the trash";

// Ordinary paragraphs carry no block ID on main; a registry block is the one
// block whose ID is stored in the body and rendered as data-block-id. Its
// node view repeats the attribute on an inner section, so count only the node.
const BLOCK_ID = "sf03-endpoint";
const BLOCK_NODE = `${EDITOR} .plan-block-node[data-block-id]`;
const TARGET_BODY = [
  ...EDITOR_BODY.split("\n").slice(0, 2),
  `<Endpoint id="${BLOCK_ID}" method="GET" path="/sf03/restore" summary="SF-03 block" />`,
  ...EDITOR_BODY.split("\n").slice(2),
].join("\n");

interface PageRead {
  id: string;
  content: string;
  revision: string;
  bodyRevision: number;
  updatedAt: string;
}

interface LifecycleReceipt {
  trashRootId: string | null;
  trashedAt: string | null;
  receipt: { outcome: string };
}

async function readAction<T>(
  page: Page,
  name: string,
  params: Record<string, string>,
): Promise<T> {
  const response = await page.request.get(`/_agent-native/actions/${name}`, {
    params,
    headers: ACTION_HEADERS,
  });
  const text = await response.text();
  expect(response.ok(), `${name} (${response.status()}): ${text}`).toBe(true);
  return JSON.parse(text) as T;
}

function readPage(page: Page, id: string): Promise<PageRead> {
  return readAction<PageRead>(page, "get-document", { id });
}

async function createChild(
  page: Page,
  parentId: string,
  title: string,
  content: string,
): Promise<string> {
  const created = await postAction<{ id?: string }>(page, "create-document", {
    title,
    content,
    parentId,
  });
  expect(created.id, `create-document under ${parentId}`).toEqual(
    expect.any(String),
  );
  return created.id!;
}

async function trash(page: Page, id: string): Promise<LifecycleReceipt> {
  const { updatedAt } = await readPage(page, id);
  const receipt = await postAction<LifecycleReceipt>(page, "delete-document", {
    id,
    expectedUpdatedAt: updatedAt,
    idempotencyKey: `${id}-sf03-trash-${Date.now()}`,
  });
  expect(receipt.receipt.outcome, JSON.stringify(receipt)).toBe("trashed");
  expect(receipt.trashRootId, JSON.stringify(receipt)).toBe(id);
  return receipt;
}

async function restore(page: Page, trashed: LifecycleReceipt): Promise<void> {
  const receipt = await postAction<LifecycleReceipt>(page, "restore-document", {
    id: trashed.trashRootId,
    expectedTrashedAt: trashed.trashedAt,
    idempotencyKey: `${trashed.trashRootId}-sf03-restore-${Date.now()}`,
  });
  expect(receipt.receipt.outcome, JSON.stringify(receipt)).toBe("restored");
}

async function tabBlockIds(tab: Page): Promise<string[]> {
  return tab
    .locator(BLOCK_NODE)
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-block-id") ?? ""),
    );
}

/** What the server holds that a restore from Trash must bring back unchanged. */
async function storedSnapshot(reader: Page, parentId: string, id: string) {
  const document = await readPage(reader, id);
  const { comments } = await readAction<{ comments: unknown[] }>(
    reader,
    "list-comments",
    { documentId: id },
  );
  const { suggestions } = await readAction<{
    suggestions: Array<{ status: string }>;
  }>(reader, "list-resource-suggestions", {
    resourceType: "document",
    resourceId: id,
  });
  const { documents } = await readAction<{
    documents: Array<{ id: string; position: number }>;
  }>(reader, "list-documents", { parentId });
  return {
    content: document.content,
    revision: document.revision,
    comments,
    pendingSuggestions: suggestions.filter(
      (suggestion) => suggestion.status === "pending",
    ),
    storedBlockIds: [...document.content.matchAll(/\bid="([^"]+)"/g)].map(
      (match) => match[1],
    ),
    siblings: documents.map(({ id, position }) => ({ id, position })),
  };
}

async function historyGroups(page: Page, documentId: string) {
  const { groups } = await readAction<{
    groups: Array<{ id: string; operation: string | null }>;
  }>(page, "list-document-history", { documentId, limit: "100" });
  return groups;
}

test.describe(
  "SF-03 restore keeps the page whole with a tab open",
  {
    tag: "@SF-03",
  },
  () => {
    test(
      "trash then restore keeps body, revision, comments, suggestions, block IDs and sibling order, and the open tab shows it",
      knownLossSpec({
        lane: "unowned",
        outcome: "SF-03",
        reason:
          "At beta's 12 s poll cadence, a tab open on the page keeps showing “This page is in the trash” for about 150 s after restore-document brings the page back.",
      }),
      async ({ page, context }) => {
        const tabs = await TabSet.create(context);
        const parent = await createPage(page, "SF-03 parent", "Parent page.");
        await enterGateArm(page, parent);
        const first = await createChild(page, parent, "SF-03 first", "First.");
        await enterGateArm(page, first);
        const target = await createChild(
          page,
          parent,
          "SF-03 middle",
          TARGET_BODY,
        );
        await enterGateArm(page, target);
        const last = await createChild(page, parent, "SF-03 last", "Last.");
        await enterGateArm(page, last);

        const tab = await tabs.open("open tab", target);
        await expect(
          tab.locator(`${BLOCK_NODE}[data-block-id="${BLOCK_ID}"]`),
        ).toBeVisible({ timeout: SYNC_MS });

        await postAction(page, "add-comment", {
          documentId: target,
          content: "SF-03 comment that must survive Trash.",
          quotedText: "Bravo paragraph",
          anchorSuffix: " stays untouched.",
          idempotencyKey: `${target}-sf03-comment`,
        });
        const agent = AgentClient.shared(page);
        const read = await agent.callJson<PageRead>("get-document", {
          id: target,
        });
        const suggested = await agent.call("suggest-document-edit", {
          id: target,
          baseRevision: read.revision,
          idempotencyKey: `${target}-sf03-suggestion`,
          find: "Delta paragraph stays untouched.",
          replace: "Delta paragraph, as suggested.",
        });
        expect(suggested.isError, suggested.raw).toBe(false);
        await tabs.quiet();

        const before = await storedSnapshot(page, parent, target);
        const evidence = JSON.stringify(before);
        expect(before.comments, evidence).toHaveLength(1);
        expect(before.pendingSuggestions.length, evidence).toBeGreaterThan(0);
        expect(before.storedBlockIds, evidence).toEqual([BLOCK_ID]);
        expect(
          await tabBlockIds(tab),
          "block IDs the open tab renders",
        ).toEqual([BLOCK_ID]);
        expect(
          before.siblings.map(({ id }) => id),
          evidence,
        ).toEqual([first, target, last]);

        const trashed = await trash(page, target);
        await expect(tab.getByText(IN_TRASH)).toBeVisible({ timeout: SYNC_MS });

        await restore(page, trashed);
        // The pending suggestion renders inline in the Delta paragraph.
        await expect
          .soft(
            tab.locator(EDITOR),
            "the open tab shows the restored page without a reload",
          )
          .toContainText("Charlie paragraph edited from the second tab.", {
            timeout: SYNC_MS,
          });
        await tabs.quiet();

        const after = await storedSnapshot(page, parent, target);
        for (const key of Object.keys(before) as Array<keyof typeof before>)
          expect.soft(after[key], `${key} after restore`).toEqual(before[key]);
        expect
          .soft(await tabBlockIds(tab), "block IDs the open tab renders")
          .toEqual([BLOCK_ID]);
        expect
          .soft(tab.url(), "the open tab stayed on the page")
          .toContain(`/page/${target}`);
        expect
          .soft(tabs.record(tab).loads, "the open tab was not reloaded")
          .toBe(1);
        expect
          .soft(noiseFailures([tabs.record(tab)]), "noise in the open tab")
          .toEqual([]);
      },
    );

    test(
      "a version restore writes one History checkpoint and reaches the open tab",
      knownLossSpec({
        lane: "L3",
        outcome: "SF-03",
        reason:
          "With a tab open on the page, restore-document-version answers 500 because the open editor never acknowledges the flush the action waits 4 s for (“The open document editor did not finish saving before sync timed out”).",
      }),
      async ({ page, context }) => {
        const tabs = await TabSet.create(context);
        const id = await createPage(page, "SF-03 version restore", EDITOR_BODY);
        await enterGateArm(page, id);
        const original = await readPage(page, id);
        await AgentClient.shared(page).edit(
          id,
          "Bravo paragraph stays untouched.",
          "Bravo paragraph after the agent edit.",
        );

        const tab = await tabs.open("open tab", id);
        await expect(tab.locator(EDITOR)).toContainText(
          "Bravo paragraph after the agent edit.",
        );
        await tabs.quiet();

        const { versions } = await readAction<{
          versions: Array<{ id: string; content?: string }>;
        }>(page, "list-document-versions", { documentId: id });
        const checkpoint = versions.find(
          (version) => version.content === original.content,
        );
        expect(
          checkpoint,
          `no History checkpoint holds the original body: ${JSON.stringify(versions)}`,
        ).toBeDefined();
        const groupsBefore = await historyGroups(page, id);
        const current = await readPage(page, id);

        const restored = await postAction<{ content?: string }>(
          page,
          "restore-document-version",
          {
            documentId: id,
            versionId: checkpoint!.id,
            expectedUpdatedAt: current.updatedAt,
          },
        );
        expect(restored.content, JSON.stringify(restored)).toBe(
          original.content,
        );

        await expect(tab.locator(EDITOR)).toContainText(
          "Bravo paragraph stays untouched.",
          { timeout: SYNC_MS },
        );
        await expect(tab.locator(EDITOR)).not.toContainText(
          "after the agent edit",
        );
        // A tab that writes its old copy back does so on its next save; give it
        // one more poll to try before counting.
        await tab.waitForTimeout(SYNC_MS / 2);
        await tabs.quiet();

        const after = await readPage(page, id);
        expect
          .soft(after.content, "the body after the tab settled")
          .toBe(original.content);
        const before = new Set(groupsBefore.map((group) => group.id));
        const added = (await historyGroups(page, id)).filter(
          (group) => !before.has(group.id),
        );
        expect
          .soft(
            added.map((group) => group.operation),
            `History entries the restore added: ${JSON.stringify(added)}`,
          )
          .toEqual(["restore-document-version"]);
        expect
          .soft(noiseFailures([tabs.record(tab)]), "noise in the open tab")
          .toEqual([]);
      },
    );

    test(
      "an edit to a trashed page is refused as get-document refuses to read it",
      knownLossSpec({
        lane: "L5a",
        outcome: "SF-03",
        reason:
          "edit-document applies an edit to a trashed page (applied 1 of 1, body revision 0 to 1) that get-document refuses to read as not found, and the edit is still there after restore.",
      }),
      async ({ page, context }) => {
        const tabs = await TabSet.create(context);
        const id = await createPage(page, "SF-03 edit in Trash", EDITOR_BODY);
        await enterGateArm(page, id);
        const tab = await tabs.open("open tab", id);

        const agent = AgentClient.shared(page);
        const read = await agent.callJson<PageRead>("get-document", { id });
        const trashed = await trash(page, id);
        await expect(tab.getByText(IN_TRASH)).toBeVisible({
          timeout: SYNC_MS,
        });

        const refusedRead = await agent.call("get-document", { id });
        expect(refusedRead.isError, refusedRead.raw).toBe(true);
        expect(refusedRead.text, refusedRead.raw).toMatch(/not found/i);

        const edit = await agent.call("edit-document", {
          id,
          baseRevision: read.revision,
          idempotencyKey: `${id}-sf03-trashed-edit`,
          edits: [
            {
              find: "Delta paragraph stays untouched.",
              replace: "Delta paragraph edited in Trash.",
            },
          ],
        });
        const inTrash = await readAction<{
          content: string;
          bodyRevision: number;
        }>(page, "get-trashed-document", { id });
        const evidence = `get-document: ${refusedRead.text}\nedit-document: ${edit.raw}`;
        expect.soft(edit.isError, evidence).toBe(true);
        expect.soft(edit.text, evidence).toMatch(/not found/i);
        expect
          .soft(inTrash.content, "the trashed body after the edit")
          .toBe(read.content);
        expect
          .soft(inTrash.bodyRevision, "the trashed body revision")
          .toBe(read.bodyRevision);

        await restore(page, trashed);
        const after = await agent.callJson<PageRead>("get-document", { id });
        expect
          .soft(after.revision, "revision after restore")
          .toBe(read.revision);
        expect.soft(after.content, "body after restore").toBe(read.content);
      },
    );
  },
);
