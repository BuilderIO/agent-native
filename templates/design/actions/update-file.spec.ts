/**
 * update-file.spec.ts
 *
 * Covers the `syncCollab: false` "SQL-mirror-only" staleness-skip behavior:
 * when a caller explicitly opts out of collab sync and supplies an
 * expectedVersionHash that no longer matches the LIVE collab text (a real
 * live editor has moved the document on since the caller's read), the
 * content write is skipped instead of throwing, and the action reports
 * `skippedStaleMirror: true` — while filename/fileType updates in the same
 * call still apply.
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
});
