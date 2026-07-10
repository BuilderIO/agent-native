/**
 * update-file.spec.ts
 *
 * Covers the `syncCollab: false` "SQL-mirror-only" staleness-skip behavior:
 * when a caller explicitly opts out of collab sync and supplies an
 * expectedVersionHash that matches NEITHER the live collab text, NOR the
 * content being written (own edit that raced ahead via Yjs), NOR the current
 * SQL mirror content, the content write is skipped instead of throwing, and
 * the action reports `skippedStaleMirror: true` — while filename/fileType
 * updates in the same call still apply. A caller whose hash matches the
 * current mirror is the mirror column's own lineage (mirror-lineage rescue):
 * it writes the mirror normally AND diff-merges its content into the live
 * collab doc.
 *
 * Uses the same harness shape as apply-source-edit.interleave.spec.ts (which
 * already exercises update-file.js directly): a fake Drizzle app-DB backing
 * a single design_files row, plus a real per-docId Y.Doc registry standing in
 * for @agent-native/core/collab with a real deterministic prefix/suffix-trim
 * text diff for applyText.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

// ---------------------------------------------------------------------------
// Fake @agent-native/core/collab backed by a real per-docId Y.Doc registry.
// Same shape as apply-source-edit.interleave.spec.ts.
// ---------------------------------------------------------------------------
const collabDocs = vi.hoisted(() => ({ docs: new Map<string, unknown>() }));

function getOrCreateDoc(docId: string): InstanceType<typeof Y.Doc> {
  let doc = collabDocs.docs.get(docId) as
    | InstanceType<typeof Y.Doc>
    | undefined;
  if (!doc) {
    doc = new Y.Doc();
    collabDocs.docs.set(docId, doc);
  }
  return doc;
}

function applyTextDiff(doc: InstanceType<typeof Y.Doc>, newText: string): void {
  const ytext = doc.getText("content");
  const oldText = ytext.toString();
  if (oldText === newText) return;
  let start = 0;
  const maxStart = Math.min(oldText.length, newText.length);
  while (start < maxStart && oldText[start] === newText[start]) start++;
  let endOld = oldText.length;
  let endNew = newText.length;
  while (
    endOld > start &&
    endNew > start &&
    oldText[endOld - 1] === newText[endNew - 1]
  ) {
    endOld--;
    endNew--;
  }
  doc.transact(() => {
    if (endOld > start) ytext.delete(start, endOld - start);
    if (endNew > start) ytext.insert(start, newText.slice(start, endNew));
  }, "server");
}

vi.mock("@agent-native/core/collab", () => ({
  hasCollabState: async (docId: string) => collabDocs.docs.has(docId),
  getText: async (docId: string) =>
    getOrCreateDoc(docId).getText("content").toString(),
  applyText: async (docId: string, newText: string) => {
    const doc = getOrCreateDoc(docId);
    applyTextDiff(doc, newText);
    return doc.getText("content").toString();
  },
  seedFromText: async (docId: string, text: string) => {
    if (collabDocs.docs.has(docId)) return;
    getOrCreateDoc(docId).getText("content").insert(0, text);
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn().mockResolvedValue({ role: "editor", resource: {} }),
  resolveAccess: vi.fn().mockResolvedValue({
    role: "editor",
    resource: { data: JSON.stringify({ sourceType: "inline" }) },
  }),
  accessFilter: vi.fn().mockReturnValue(undefined),
}));

// update-file.ts imports isPostgres via the public "@agent-native/core/db"
// specifier: force the SQLite branch (no LOCK TABLE path) for these tests.
vi.mock("@agent-native/core/db", () => ({
  isPostgres: () => false,
}));

// ---------------------------------------------------------------------------
// Minimal fake Drizzle app-DB layer: one `design_files` table backing store,
// same query shapes as apply-source-edit.interleave.spec.ts.
// ---------------------------------------------------------------------------
interface FileRow {
  id: string;
  designId: string;
  filename: string;
  fileType: string;
  content: string;
  createdAt: string | null;
  updatedAt: string | null;
}

const designFilesStore = vi.hoisted(() => ({
  rows: new Map<string, FileRow>(),
}));
const designsStore = vi.hoisted(() => ({
  updatedAt: new Map<string, string>(),
}));

const FILE_ID = "file_mirror_1";
const DESIGN_ID = "design_1";

function seedFile(content: string, updatedAt = "2026-07-06T00:00:00.000Z") {
  designFilesStore.rows.set(FILE_ID, {
    id: FILE_ID,
    designId: DESIGN_ID,
    filename: "index.html",
    fileType: "html",
    content,
    createdAt: updatedAt,
    updatedAt,
  });
}

type Predicate = ReturnType<typeof eq> | ReturnType<typeof and>;

function matchesDesignFile(row: FileRow, predicate: Predicate): boolean {
  const asString = JSON.stringify(predicate);
  if (asString.includes('"id"') && asString.includes(FILE_ID)) {
    return row.id === FILE_ID;
  }
  if (asString.includes('"designId"') || asString.includes('"design_id"')) {
    return row.designId === DESIGN_ID;
  }
  return true;
}

vi.mock("../server/db/index.js", () => {
  const schema = {
    designFiles: {
      id: { name: "id" },
      designId: { name: "designId" },
      filename: { name: "filename" },
      fileType: { name: "fileType" },
      content: { name: "content" },
      createdAt: { name: "createdAt" },
      updatedAt: { name: "updatedAt" },
    },
    designs: { id: { name: "id" }, updatedAt: { name: "updatedAt" } },
    designShares: {},
  };
  const fileWhereBuilder = (predicate: Predicate) => {
    const rows = [...designFilesStore.rows.values()].filter((row) =>
      matchesDesignFile(row, predicate),
    );
    return Object.assign(Promise.resolve(rows), {
      limit: (n: number) => Promise.resolve(rows.slice(0, n)),
    });
  };
  const db = {
    select: (_projection: unknown) => ({
      from: (table: unknown) => ({
        where: (predicate: Predicate) => {
          if (table === schema.designs) {
            // Not used directly by update-file's own selects in these tests.
            return Object.assign(Promise.resolve([]), {
              limit: (n: number) => Promise.resolve([]),
            });
          }
          return fileWhereBuilder(predicate);
        },
        // update-file's access lookup joins designs for the accessFilter;
        // every seeded file row belongs to DESIGN_ID, so pass through.
        innerJoin: (_joined: unknown, _on: unknown) => ({
          where: fileWhereBuilder,
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (predicate: Predicate) => {
          if (table === schema.designFiles) {
            for (const row of designFilesStore.rows.values()) {
              if (matchesDesignFile(row, predicate)) Object.assign(row, values);
            }
          } else if (table === schema.designs) {
            designsStore.updatedAt.set(
              DESIGN_ID,
              (values as { updatedAt?: string }).updatedAt ?? "",
            );
          }
          return Promise.resolve({ rowsAffected: 1 });
        },
      }),
    }),
  };
  return { getDb: () => db, schema };
});

import { hasCollabState, applyText } from "@agent-native/core/collab";

import { sourceContentHash } from "../shared/source-workspace.js";
import updateFileAction from "./update-file.js";

function buildDoc(bodyExtra = ""): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Doc</title>
</head>
<body>
<div data-agent-native-node-id="an-node-1">${bodyExtra}Hello</div>
</body>
</html>`;
}

beforeEach(() => {
  collabDocs.docs.clear();
  designFilesStore.rows.clear();
  designsStore.updatedAt.clear();
  seedFile(buildDoc());
});

describe("update-file: expectedVersionHash / syncCollab regression baseline", () => {
  it("1. no expectedVersionHash provided at all: content write proceeds exactly as before", async () => {
    const next = buildDoc(" changed-");
    const result = await updateFileAction.run({
      id: FILE_ID,
      content: next,
      // expectedVersionHash intentionally omitted.
    } as never);

    expect(result).toEqual({ id: FILE_ID, updated: true });
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(next);
    // Default syncCollab is true, so collab should have been seeded/updated.
    expect(await hasCollabState(FILE_ID)).toBe(true);
  });

  it("2. syncCollab:true (default) + mismatched hash: still throws, not skipped", async () => {
    // Establish live collab state that diverges from a caller's stale hash.
    await applyText(FILE_ID, buildDoc(" live-edit-"), "content", "agent");
    const staleHash = sourceContentHash(buildDoc()); // pre-live-edit hash

    await expect(
      updateFileAction.run({
        id: FILE_ID,
        content: buildDoc(" caller-stale-"),
        syncCollab: true,
        expectedVersionHash: staleHash,
      } as never),
    ).rejects.toThrow(/changed since it was read/);

    // Not skipped: no skippedStaleMirror flag could have been produced since
    // the call threw. The SQL row must remain untouched by the rejected call.
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(buildDoc());
  });

  it("3. syncCollab:false + mismatched hash + collab state EXISTS: returns skippedStaleMirror:true, SQL content NOT overwritten", async () => {
    await applyText(FILE_ID, buildDoc(" live-edit-"), "content", "agent");
    // Advance the SQL mirror beyond the caller's base too: under the
    // mirror-lineage rescue, a caller whose hash matches the current mirror
    // proceeds instead of skipping, so pinning the GENUINE-stale skip
    // requires the caller to match neither the live text nor the mirror.
    designFilesStore.rows.get(FILE_ID)!.content = buildDoc(" mirror-advanced-");
    const staleHash = sourceContentHash(buildDoc());
    const sqlContentBefore = designFilesStore.rows.get(FILE_ID)!.content;

    const result = await updateFileAction.run({
      id: FILE_ID,
      content: buildDoc(" caller-stale-mirror-"),
      syncCollab: false,
      expectedVersionHash: staleHash,
    } as never);

    expect(result).toEqual({
      id: FILE_ID,
      updated: true,
      skippedStaleMirror: true,
    });
    // SQL content column must NOT have been overwritten with caller's stale
    // content.
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(sqlContentBefore);
    expect(designFilesStore.rows.get(FILE_ID)!.content).not.toContain(
      "caller-stale-mirror-",
    );
    // Live collab text is also untouched by the skipped write.
    const liveText = getOrCreateDoc(FILE_ID).getText("content").toString();
    expect(liveText).toContain("live-edit-");
    expect(liveText).not.toContain("caller-stale-mirror-");
  });

  it("4. syncCollab:false + mismatched hash + collab state does NOT exist (SQL-only file): falls through to throw-loud behavior", async () => {
    // No applyText/seedFromText call yet in this test — hasCollabState must
    // be false, meaning the guard compares against the SQL row instead.
    expect(await hasCollabState(FILE_ID)).toBe(false);
    const staleHash = sourceContentHash("some completely different content");

    await expect(
      updateFileAction.run({
        id: FILE_ID,
        content: buildDoc(" caller-stale-"),
        syncCollab: false,
        expectedVersionHash: staleHash,
      } as never),
    ).rejects.toThrow(/changed since it was read/);

    // Condition (c) failed (no collab state), so the skip path must not have
    // triggered — the SQL row is untouched by the rejected write, and no
    // collab doc was created as a side effect of the failed attempt.
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(buildDoc());
    expect(await hasCollabState(FILE_ID)).toBe(false);
  });

  it("5. syncCollab:false + MATCHING hash: writes normally (no skip, no throw)", async () => {
    await applyText(FILE_ID, buildDoc(" live-edit-"), "content", "agent");
    const matchingHash = sourceContentHash(
      getOrCreateDoc(FILE_ID).getText("content").toString(),
    );
    const next = buildDoc(" live-edit-plus-more-");

    const result = await updateFileAction.run({
      id: FILE_ID,
      content: next,
      syncCollab: false,
      expectedVersionHash: matchingHash,
    } as never);

    expect(result).toEqual({ id: FILE_ID, updated: true });
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(next);
    // syncCollab:false means collab text should NOT have been touched by
    // this write even though it succeeded.
    const liveText = getOrCreateDoc(FILE_ID).getText("content").toString();
    expect(liveText).not.toBe(next);
  });

  it("6a. filename-only update alongside a stale-mirror-skip case: filename still applies while content is skipped", async () => {
    await applyText(FILE_ID, buildDoc(" live-edit-"), "content", "agent");
    // Advance the mirror past the caller's base so this stays a genuine-stale
    // skip (caller matches neither live nor mirror) under the rescue rule.
    designFilesStore.rows.get(FILE_ID)!.content = buildDoc(" mirror-advanced-");
    const staleHash = sourceContentHash(buildDoc());
    const sqlContentBefore = designFilesStore.rows.get(FILE_ID)!.content;

    const result = await updateFileAction.run({
      id: FILE_ID,
      content: buildDoc(" caller-stale-mirror-"),
      filename: "renamed.html",
      syncCollab: false,
      expectedVersionHash: staleHash,
    } as never);

    expect(result).toEqual({
      id: FILE_ID,
      updated: true,
      skippedStaleMirror: true,
    });
    // Filename update proceeds normally even though content write is skipped.
    expect(designFilesStore.rows.get(FILE_ID)!.filename).toBe("renamed.html");
    // Content remains the pre-write SQL content, unaffected by the skip.
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(sqlContentBefore);
  });

  it("6b. filename-only update (no content at all) is unaffected by the new skip logic", async () => {
    const result = await updateFileAction.run({
      id: FILE_ID,
      filename: "renamed-only.html",
    } as never);

    expect(result).toEqual({ id: FILE_ID, updated: true });
    expect(designFilesStore.rows.get(FILE_ID)!.filename).toBe(
      "renamed-only.html",
    );
    // No skippedStaleMirror flag when content was never provided.
    expect("skippedStaleMirror" in result).toBe(false);
  });

  it("6c. filename-only update alongside a would-be-throw case (syncCollab true) still throws for the whole call", async () => {
    await applyText(FILE_ID, buildDoc(" live-edit-"), "content", "agent");
    const staleHash = sourceContentHash(buildDoc());

    await expect(
      updateFileAction.run({
        id: FILE_ID,
        content: buildDoc(" caller-stale-"),
        filename: "should-not-apply.html",
        syncCollab: true,
        expectedVersionHash: staleHash,
      } as never),
    ).rejects.toThrow(/changed since it was read/);

    // The whole call rejects before any updates.set(...) is issued, so the
    // filename must NOT have been renamed either.
    expect(designFilesStore.rows.get(FILE_ID)!.filename).toBe("index.html");
  });

  // Regression for the within-screen drag-reorder "edits after the first one
  // in a session are silently lost on reload" bug: a single client's own
  // edit reaches the live collab doc via the fast Yjs/websocket path (~80ms
  // debounce) and via THIS guarded update-file call (~400ms debounce) as two
  // independent, unordered transports. In the common case the Yjs path wins
  // the race, so by the time this guarded call's hash check runs, the live
  // collab text already equals the very `content` this call is about to
  // write — that is the client's OWN edit having landed early via a
  // different transport, not a different editor's divergent edit. The old
  // hash-only guard couldn't tell the two apart and treated it as staleness,
  // permanently skipping the SQL mirror write (there's no background job
  // that later reconciles design_files.content from the live collab doc —
  // see hasCollabState/getText usage above), silently losing every edit
  // after the first one applied in a session.
  it("7. syncCollab:false + mismatched hash BUT live collab text already equals the content being written (own edit raced ahead via Yjs): writes normally, not skipped", async () => {
    const next = buildDoc(" own-edit-already-landed-via-yjs-");
    // Simulate the Yjs/websocket path having already applied this exact
    // edit to the live collab doc before this guarded call's hash check runs.
    await applyText(FILE_ID, next, "content", "agent");
    // expectedVersionHash is the hash of content BEFORE this edit (the base
    // this write was queued from) — deliberately stale relative to the live
    // text now, exactly like the real queueFileContentSave call shape.
    const staleHash = sourceContentHash(buildDoc());

    const result = await updateFileAction.run({
      id: FILE_ID,
      content: next,
      syncCollab: false,
      expectedVersionHash: staleHash,
    } as never);

    // Must NOT be skipped: this is the same edit, not a divergent one.
    expect(result).toEqual({ id: FILE_ID, updated: true });
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(next);
  });

  it("8. syncCollab:false + mismatched hash + live text DIFFERS from content being written (genuine concurrent editor): still skipped, own-edit fast-path does not weaken the real guard", async () => {
    // A genuinely different editor's edit lands in the collab doc.
    await applyText(
      FILE_ID,
      buildDoc(" a-different-editors-edit-"),
      "content",
      "agent",
    );
    // Advance the mirror past the caller's base so this stays a genuine-stale
    // skip (caller matches neither live nor mirror) under the rescue rule.
    designFilesStore.rows.get(FILE_ID)!.content = buildDoc(" mirror-advanced-");
    const staleHash = sourceContentHash(buildDoc());
    const sqlContentBefore = designFilesStore.rows.get(FILE_ID)!.content;

    const result = await updateFileAction.run({
      id: FILE_ID,
      // This caller's own content is NOT what's live now — a genuine
      // divergent-base case, must still hit the skip path exactly as before.
      content: buildDoc(" callers-own-different-content-"),
      syncCollab: false,
      expectedVersionHash: staleHash,
    } as never);

    expect(result).toEqual({
      id: FILE_ID,
      updated: true,
      skippedStaleMirror: true,
    });
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(sqlContentBefore);
  });

  // Regression for the sequential-edit data-loss bug (mirror-lineage rescue,
  // verified live): the client's Yjs pipe can lag or silently die, leaving
  // the live collab doc frozen at an old state while the guarded HTTP saves
  // keep advancing the SQL mirror. Each later save's expectedVersionHash then
  // matches the MIRROR it was actually computed from but not the frozen live
  // text — the old live-only comparison mis-classified that as a divergent
  // writer and silently dropped every save after the first.
  it("9. dead transport: live collab doc frozen at base while sequential HTTP saves advance the mirror — second save (hash == mirror tip) writes normally AND diff-merges into the live doc", async () => {
    // Live collab doc exists but stays frozen at the base document (dead
    // client Yjs pipe: no further updates ever arrive on that transport).
    await applyText(FILE_ID, buildDoc(), "content", "agent");

    // Edit one: hash matches the live text (== base), proceeds normally.
    const editOne = buildDoc(" edit-one-");
    await updateFileAction.run({
      id: FILE_ID,
      content: editOne,
      syncCollab: false,
      expectedVersionHash: sourceContentHash(buildDoc()),
    } as never);
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(editOne);
    // The dead pipe never delivered edit one to the live doc.
    expect(getOrCreateDoc(FILE_ID).getText("content").toString()).toBe(
      buildDoc(),
    );

    // Edit two: computed from the mirror tip (edit one). Its hash matches
    // NEITHER the frozen live text NOR the content being written, but DOES
    // match the current mirror — the mirror-lineage rescue must write it.
    const editTwo = buildDoc(" edit-one-and-two-");
    const result = await updateFileAction.run({
      id: FILE_ID,
      content: editTwo,
      syncCollab: false,
      expectedVersionHash: sourceContentHash(editOne),
    } as never);

    expect(result).toEqual({ id: FILE_ID, updated: true });
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(editTwo);
    // Mirror-lineage collab sync: the rescue also pushes the caller's content
    // through the collab layer (exactly like syncCollab:true), so the live
    // doc receives the second edit instead of staying silently frozen.
    expect(getOrCreateDoc(FILE_ID).getText("content").toString()).toContain(
      "edit-one-and-two-",
    );
  });

  it("10. caller matching NEITHER the mirror NOR the live text (genuinely stale writer): still skipped", async () => {
    await applyText(FILE_ID, buildDoc(" live-edit-"), "content", "agent");
    designFilesStore.rows.get(FILE_ID)!.content = buildDoc(" mirror-advanced-");
    const sqlContentBefore = designFilesStore.rows.get(FILE_ID)!.content;
    // The base-document hash matches neither the advanced mirror nor the
    // diverged live text — a genuinely stale caller.
    const staleHash = sourceContentHash(buildDoc());

    const result = await updateFileAction.run({
      id: FILE_ID,
      content: buildDoc(" genuinely-stale-caller-"),
      syncCollab: false,
      expectedVersionHash: staleHash,
    } as never);

    expect(result).toEqual({
      id: FILE_ID,
      updated: true,
      skippedStaleMirror: true,
    });
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(sqlContentBefore);
    // Live doc untouched by the skipped write.
    const liveText = getOrCreateDoc(FILE_ID).getText("content").toString();
    expect(liveText).toContain("live-edit-");
    expect(liveText).not.toContain("genuinely-stale-caller-");
  });

  it("11. mirror-tip caller with a DIVERGENT live doc (concurrent live-only editor): mirror advances and the caller's change is diff-merged into the live doc", async () => {
    // A live-only editor's edit sits in the collab doc...
    await applyText(
      FILE_ID,
      buildDoc(" other-editors-live-only-edit-"),
      "content",
      "agent",
    );
    // ...while the SQL mirror sits at the different lineage the caller read.
    const mirrorState = buildDoc(" mirror-state-");
    designFilesStore.rows.get(FILE_ID)!.content = mirrorState;

    const callerContent = buildDoc(" mirror-state-plus-mine-");
    const result = await updateFileAction.run({
      id: FILE_ID,
      content: callerContent,
      syncCollab: false,
      expectedVersionHash: sourceContentHash(mirrorState),
    } as never);

    // Mirror-lineage rescue: a plain CAS success against the mirror column.
    expect(result).toEqual({ id: FILE_ID, updated: true });
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(callerContent);

    // The caller's change is pushed through the collab layer as a char-diff
    // merge. NOTE: with this fixture shape both editors' markers occupy the
    // SAME single interpolation slot in buildDoc — the one divergent region
    // of the document — so the prefix/suffix-trim char-diff resolves them as
    // one replacement rather than keeping both. A real keep-both CRDT outcome
    // requires edits in DISJOINT regions, which buildDoc cannot express, so
    // assert that the merge ran (live doc received the caller's marker)
    // instead of a vanity keep-both assertion this fixture can't honestly
    // make.
    const liveText = getOrCreateDoc(FILE_ID).getText("content").toString();
    expect(liveText).toContain("mirror-state-plus-mine-");
  });
});
