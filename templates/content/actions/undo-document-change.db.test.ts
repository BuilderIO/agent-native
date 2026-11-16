import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { putSetting } from "@agent-native/core/settings";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { DocumentHistoryCause } from "../server/lib/document-history.js";
import { firstRow } from "../server/lib/first-row.js";

vi.mock("@agent-native/core/application-state", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/application-state")
  >()),
  writeAppState: vi.fn(async () => undefined),
}));
vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));

// Runs once, just after the undo next reads an entry's changes, to land an
// edit between the undo's read and its write.
const afterEntryRead = vi.hoisted(() => ({
  run: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("../server/lib/document-history-changes.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../server/lib/document-history-changes.js")
    >();
  return {
    ...original,
    listHistoryEntryChanges: async (
      ...args: Parameters<typeof original.listHistoryEntryChanges>
    ) => {
      const read = await original.listHistoryEntryChanges(...args);
      const { run } = afterEntryRead;
      afterEntryRead.run = undefined;
      await run?.();
      return read;
    },
  };
});

const TEST_DB_PATH = join(
  tmpdir(),
  `undo-document-change-${process.pid}-${Date.now()}.pglite`,
);
// Content's live-body flags are on for the live-copy owner only, so each
// owner's pages take one write path.
const LEGACY_OWNER = "undo-legacy-owner@example.com";
const LIVE_OWNER = "undo-live-owner@example.com";
const previousSyncEventsEnabled =
  process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let canonicalizeNfm: typeof import("../shared/nfm.js").canonicalizeNfm;
let documentRevisionToken: typeof import("./_document-edit-mutation.js").documentRevisionToken;
let switchPageToLiveCopy: typeof import("../server/live-copy/switch.js").switchPageToLiveCopy;
let editDocument: typeof import("./edit-document.js").default;
let undoDocumentChange: typeof import("./undo-document-change.js").default;
let listDocumentHistory: typeof import("./list-document-history.js").default;
let listDocumentHistoryCheckpoints: typeof import("./list-document-history-checkpoints.js").default;
let getDocumentHistoryCheckpoint: typeof import("./get-document-history-checkpoint.js").default;
let getDocumentHistoryChange: typeof import("./get-document-history-change.js").default;
let recordDocumentHistoryTransition: typeof import("../server/lib/document-history.js").recordDocumentHistoryTransition;
let sequence = 0;

beforeAll(async () => {
  process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  ({ getDb, schema } = await import("../server/db/index.js"));
  ({ canonicalizeNfm } = await import("../shared/nfm.js"));
  ({ documentRevisionToken } = await import("./_document-edit-mutation.js"));
  ({ switchPageToLiveCopy } = await import("../server/live-copy/switch.js"));
  ({ recordDocumentHistoryTransition } =
    await import("../server/lib/document-history.js"));
  editDocument = (await import("./edit-document.js")).default;
  undoDocumentChange = (await import("./undo-document-change.js")).default;
  listDocumentHistory = (await import("./list-document-history.js")).default;
  listDocumentHistoryCheckpoints = (
    await import("./list-document-history-checkpoints.js")
  ).default;
  getDocumentHistoryCheckpoint = (
    await import("./get-document-history-checkpoint.js")
  ).default;
  getDocumentHistoryChange = (await import("./get-document-history-change.js"))
    .default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  const { registerFeatureFlags } =
    await import("@agent-native/core/feature-flags");
  const { CONTENT_FEATURE_FLAGS } = await import("../shared/feature-flags.js");
  registerFeatureFlags(CONTENT_FEATURE_FLAGS);
  for (const flag of ["content.live-body-shadow", "content.live-body-writer"])
    await putSetting(`feature-flag:${flag}`, {
      version: 1,
      mode: "rules",
      emails: [LIVE_OWNER],
      orgIds: [],
      percentage: 0,
      updatedAt: null,
      updatedBy: null,
    });
}, 120_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
  if (previousSyncEventsEnabled === undefined)
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;
  else
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS =
      previousSyncEventsEnabled;
});

const PAGE = "One\nTwo\nThree\nFour\nFive";

for (const path of ["legacy", "live_copy"] as const) {
  const owner = path === "live_copy" ? LIVE_OWNER : LEGACY_OWNER;
  const agent = { caller: "mcp" as const, userEmail: owner };
  const person = { caller: "frontend" as const, userEmail: owner };
  const asOwner = <T>(run: () => Promise<T>) =>
    runWithRequestContext({ userEmail: owner }, run);

  async function page(id: string) {
    const row = firstRow(
      await getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, id)),
    );
    if (!row) throw new Error(`No page ${id}`);
    return row;
  }

  async function seedPage() {
    sequence += 1;
    const id = `undo-${path}-${sequence}`;
    const now = new Date(Date.now() - 60_000).toISOString();
    await getDb()
      .insert(schema.documents)
      .values({
        id,
        ownerEmail: owner,
        title: "Plan",
        content: path === "live_copy" ? canonicalizeNfm(PAGE) : PAGE,
        bodyRevision: 1,
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      });
    if (path === "live_copy") {
      await expect(switchPageToLiveCopy(id)).resolves.toEqual({
        writePath: "live_copy",
      });
    }
    return id;
  }

  /** An outside agent's edit over MCP, and the History entry it names. */
  async function agentEdit(
    id: string,
    edits: Array<{ find: string; replace: string }>,
  ) {
    const current = await page(id);
    const result = await asOwner(() =>
      editDocument.run(
        {
          id,
          baseRevision: documentRevisionToken(
            current.bodyRevision,
            current.content,
          ),
          idempotencyKey: `agent-edit-${crypto.randomUUID()}`,
          edits,
          reuseLabels: [],
        },
        agent,
      ),
    );
    const receipt = (
      result as { receipt: { outcome: string; historyGroupId?: string } }
    ).receipt;
    expect(receipt.outcome).toBe("applied");
    const groupId = receipt.historyGroupId;
    if (!groupId) throw new Error("The edit receipt names no History entry.");
    return groupId;
  }

  async function personEdit(id: string, find: string, replace: string) {
    await asOwner(() =>
      editDocument.run({ id, find, replace, reuseLabels: [] }, person),
    );
  }

  /**
   * Writes a legacy page's body straight to its row, as a save History's
   * sampling passed over would, and records it in History under `cause`.
   */
  async function writeLegacy(
    id: string,
    content: string,
    cause?: DocumentHistoryCause,
  ) {
    const current = await page(id);
    const now = new Date().toISOString();
    await getDb()
      .update(schema.documents)
      .set({ content, updatedAt: now })
      .where(eq(schema.documents.id, id));
    if (!cause) return;
    await recordDocumentHistoryTransition({
      db: getDb(),
      ownerEmail: owner,
      documentId: id,
      before: { title: current.title, content: current.content },
      after: { title: current.title, content },
      cause,
      now,
    });
  }
  function agentRun(): Omit<DocumentHistoryCause, "operation"> & {
    groupId: string;
  } {
    return {
      groupId: `agent:${owner}:run-${crypto.randomUUID()}`,
      groupKind: "agent_run",
      actorEmail: owner,
      actorKind: "agent",
      origin: "agent-chat",
    };
  }
  async function undo(
    id: string,
    groupId: string,
    idempotencyKey = `undo-${crypto.randomUUID()}`,
    ctx: { caller: "mcp" | "frontend"; userEmail: string } = agent,
  ) {
    return asOwner(() =>
      undoDocumentChange.run({ documentId: id, groupId, idempotencyKey }, ctx),
    );
  }

  describe(`undo-document-change on the ${path} path`, () => {
    it("takes back an agent's two blocks and keeps a person's later edit to a third (U1)", async () => {
      const id = await seedPage();
      const entry = await agentEdit(id, [
        { find: "Two", replace: "Two by agent" },
        { find: "Four", replace: "Four by agent" },
      ]);
      await personEdit(id, "Five", "Five by person");

      const result = await undo(id, entry);

      // The result is the page as the undo left it, for an open editor.
      expect(result).toMatchObject({
        outcome: "undone",
        keptBack: [],
        undoGroupId: expect.stringMatching(/^undo:/),
        id,
        title: "Plan",
        content: "One\nTwo\nThree\nFour\nFive by person",
      });
      expect((await page(id)).content).toBe(
        "One\nTwo\nThree\nFour\nFive by person",
      );
    });

    it("keeps a person's edit to one of the agent's blocks, takes back the other, and lists the one it kept (U2)", async () => {
      const id = await seedPage();
      const entry = await agentEdit(id, [
        { find: "Two", replace: "Two by agent" },
        { find: "Four", replace: "Four by agent" },
      ]);
      await personEdit(id, "Two by agent", "Two by agent and person");

      const result = await undo(id, entry, undefined, person);

      expect(result).toMatchObject({
        outcome: "partly-undone",
        keptBack: [{ changedTo: "Two by agent", changedFrom: "Two" }],
      });
      expect((await page(id)).content).toBe(
        "One\nTwo by agent and person\nThree\nFour\nFive",
      );
    });

    it("names the entry in the edit receipt, reads it through History, and undoes it once per key (U3)", async () => {
      const id = await seedPage();
      const entry = await agentEdit(id, [
        { find: "Three", replace: "Three by agent" },
      ]);

      const history = await asOwner(() =>
        listDocumentHistory.run({ documentId: id, limit: 30 }, agent),
      );
      expect(history.groups).toContainEqual(
        expect.objectContaining({
          id: entry,
          kind: "agent_run",
          actorKind: "agent",
          operation: "edit-document",
        }),
      );
      const checkpoints = await asOwner(() =>
        listDocumentHistoryCheckpoints.run(
          { documentId: id, groupId: entry, limit: 50 },
          agent,
        ),
      );
      const after = checkpoints.checkpoints.find(
        (checkpoint) => checkpoint.checkpointKind === "after",
      );
      if (!after) throw new Error("The entry has no after checkpoint.");
      const read = await asOwner(() =>
        getDocumentHistoryCheckpoint.run(
          { documentId: id, versionId: after.id },
          agent,
        ),
      );
      expect(read.checkpoint.content).toContain("Three by agent");
      const change = await asOwner(() =>
        getDocumentHistoryChange.run({ documentId: id, groupId: entry }, agent),
      );
      expect(change).toMatchObject({
        groupId: entry,
        hasMore: false,
        changes: [
          {
            before: { title: "Plan", content: PAGE },
            after: {
              checkpointId: after.id,
              title: "Plan",
              content: "One\nTwo\nThree by agent\nFour\nFive",
            },
          },
        ],
      });

      const first = await undo(id, entry, "undo-once");
      expect(first).toMatchObject({
        outcome: "undone",
        idempotency: { key: "undo-once", result: "applied" },
      });
      const undone = await page(id);
      expect(undone.content).toBe(PAGE);
      const versions = await getDb()
        .select({ id: schema.documentVersions.id })
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, id));

      const again = await undo(id, entry, "undo-once");
      expect(again).toMatchObject({
        outcome: "replayed",
        undoGroupId: (first as { undoGroupId?: string }).undoGroupId,
        revision: (first as { revision: string }).revision,
        idempotency: { key: "undo-once", result: "replayed" },
      });
      expect(await page(id)).toEqual(undone);
      expect(
        await getDb()
          .select({ id: schema.documentVersions.id })
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, id)),
      ).toHaveLength(versions.length);

      // The undo is an entry of its own, and undoing it puts the edit back.
      const undoEntry = (first as { undoGroupId: string }).undoGroupId;
      const undoCheckpoint = firstRow(
        await getDb()
          .select({ operation: schema.documentVersions.operation })
          .from(schema.documentVersions)
          .where(
            and(
              eq(schema.documentVersions.documentId, id),
              eq(schema.documentVersions.groupId, undoEntry),
            ),
          )
          .limit(1),
      );
      expect(undoCheckpoint?.operation).toBe("undo-document-change");
      await expect(undo(id, undoEntry)).resolves.toMatchObject({
        outcome: "undone",
      });
      expect((await page(id)).content).toBe(
        "One\nTwo\nThree by agent\nFour\nFive",
      );
    });

    it("changes nothing when a person already took the edit back by hand", async () => {
      const id = await seedPage();
      const entry = await agentEdit(id, [
        { find: "Two", replace: "Two by agent" },
      ]);
      await personEdit(id, "Two by agent", "Two");
      const before = await page(id);

      await expect(undo(id, entry)).resolves.toMatchObject({
        outcome: "already-undone",
        keptBack: [],
      });
      expect(await page(id)).toEqual(before);
    });

    it("returns the first undo to a request with the same key that crossed it", async () => {
      const id = await seedPage();
      const entry = await agentEdit(id, [
        { find: "Four", replace: "Four by agent" },
      ]);

      const results = await Promise.all([
        undo(id, entry, "undo-crossed"),
        undo(id, entry, "undo-crossed"),
      ]);
      expect(results.map((result) => result.outcome).sort()).toEqual([
        "replayed",
        "undone",
      ]);
      expect((await page(id)).content).toBe(PAGE);
      const undoEntries = new Set(
        results.map(
          (result) => (result as { undoGroupId?: string }).undoGroupId,
        ),
      );
      expect(undoEntries.size).toBe(1);
      const [undoEntry] = [...undoEntries];
      expect(
        await getDb()
          .select({ id: schema.documentVersions.id })
          .from(schema.documentVersions)
          .where(
            and(
              eq(schema.documentVersions.documentId, id),
              eq(schema.documentVersions.groupId, undoEntry ?? ""),
              eq(schema.documentVersions.checkpointKind, "after"),
            ),
          ),
      ).toHaveLength(1);
    });

    // These write the legacy page row directly, as a save History's sampling
    // passed over would; a live-copy page's body lives in its live copy.
    if (path === "legacy") {
      it("keeps what a person wrote before the agent's chat started", async () => {
        const id = await seedPage();
        await personEdit(id, "One", "One by person");
        const typed = "One by person\nTwo\nThree\nFour\nFive\nTyped since";
        await writeLegacy(id, typed);
        const run = agentRun();
        // A chat's start records the page as the agent found it, with no
        // "before" checkpoint.
        await writeLegacy(id, typed, {
          ...run,
          operation: "chat start",
          skipBeforeCheckpoint: true,
        });
        await writeLegacy(
          id,
          "One by person\nTwo by agent\nThree\nFour\nFive\nTyped since",
          { ...run, operation: "edit-document" },
        );

        await expect(undo(id, run.groupId)).resolves.toMatchObject({
          outcome: "undone",
          keptBack: [],
        });
        expect((await page(id)).content).toBe(typed);
      });

      it("takes back a change that joined the entry while the undo ran", async () => {
        const id = await seedPage();
        const run = agentRun();
        const first = PAGE.replace("Two", "Two by agent");
        await writeLegacy(id, first, { ...run, operation: "edit-document" });
        afterEntryRead.run = () =>
          writeLegacy(id, first.replace("Four", "Four by agent"), {
            ...run,
            operation: "edit-document",
          });

        await expect(undo(id, run.groupId)).resolves.toMatchObject({
          outcome: "undone",
          keptBack: [],
        });
        expect(afterEntryRead.run).toBeUndefined();
        expect((await page(id)).content).toBe(PAGE);
      });

      it("refuses to merge into a page the parser can't keep in full", async () => {
        const id = await seedPage();
        const lossy =
          "<table>\n<tr><td>Kept cell</td></tr>\nLATER WORDS\n</table>";
        await writeLegacy(id, `${PAGE}\n${lossy}`);
        const run = agentRun();
        const edited = PAGE.replace("Two", "Two by agent");
        await writeLegacy(id, `${edited}\n${lossy}`, {
          ...run,
          operation: "edit-document",
        });
        const later = `${edited.replace("Five", "Five by person")}\n${lossy}`;
        await writeLegacy(id, later);

        await expect(undo(id, run.groupId)).rejects.toMatchObject({
          errorCode: "DOCUMENT_UNDO_UNAVAILABLE",
        });
        expect((await page(id)).content).toBe(later);
      });
    }

    it("refuses an entry the page has no change for", async () => {
      const id = await seedPage();
      await expect(undo(id, "agent:missing")).rejects.toMatchObject({
        errorCode: "DOCUMENT_UNDO_UNAVAILABLE",
      });
      await expect(
        asOwner(() =>
          getDocumentHistoryChange.run(
            { documentId: id, groupId: "agent:missing" },
            agent,
          ),
        ),
      ).resolves.toEqual({
        groupId: "agent:missing",
        changes: [],
        hasMore: false,
      });
    });
  });
}
