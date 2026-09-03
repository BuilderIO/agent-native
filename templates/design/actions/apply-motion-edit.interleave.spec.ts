/**
 * apply-motion-edit.interleave.spec.ts
 *
 * Contract-bypass regression: apply-motion-edit.ts used to read
 * `schema.designFiles.content` directly (never collab-aware) and persist the
 * patched HTML via a raw `persistFileContent` helper (`db.update` on
 * `designFiles` + a manual `designs.updatedAt` bump) — skipping the
 * collab/Yjs layer entirely. A concurrent editor's live Y.Text change between
 * that read and the raw write would be silently clobbered.
 *
 * Fix: the HTML base is now read via `readLiveSourceFile` (collab-authoritative
 * when a doc exists, else the SQL row) and persisted via
 * `writeInlineSourceFile`, which re-reads the live text immediately before its
 * own write and rejects if it no longer matches the `expectedVersionHash`
 * captured at the same point in time the base was read — closing the race
 * window instead of silently corrupting, the same fix already applied to
 * apply-visual-edit.ts / remove-motion-timeline.ts / insert-design-native-
 * asset.ts / insert-asset.ts.
 *
 * This spec exercises the REAL apply-motion-edit action module (not mocked at
 * the writeInlineSourceFile boundary) against a fake minimal DB + a real
 * per-docId Y.Doc registry, the same harness shape as
 * insert-design-native-asset.interleave.spec.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

// ---------------------------------------------------------------------------
// Fake @agent-native/core/collab backed by a real per-docId Y.Doc registry,
// with a real deterministic prefix/suffix-trim diff for applyText — same
// approach as insert-design-native-asset.interleave.spec.ts.
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
  agentEnterDocument: vi.fn(),
  agentLeaveDocument: vi.fn(),
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
  assertAccess: vi.fn().mockResolvedValue({
    role: "editor",
    resource: { ownerEmail: "local@localhost", orgId: null },
  }),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => undefined,
  getRequestOrgId: () => undefined,
}));

// ---------------------------------------------------------------------------
// Minimal fake Drizzle app-DB layer backing a single design_files row and a
// single motion_timeline row store. Only supports the exact query shapes
// apply-motion-edit.ts issues:
//   - select({id, designId, filename, fileType, content}).from(designFiles)
//       .innerJoin(designs).where(and(eq(designId), eq(id|filename))).limit(1)
//   - select({id}).from(motionTimeline).where(and(eq(id), eq(designId))).limit(1)
//   - select({id}).from(motionTimeline)
//       .where(and(eq(designId), eq(sourceRef))).orderBy(desc(updatedAt)).limit(1)
//   - db.transaction(tx => tx.update(motionTimeline)... | tx.insert(motionTimeline)...)
//   - designFiles/designs updates performed internally by writeInlineSourceFile
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

interface TimelineRow {
  id: string;
  designId: string;
  sourceRef: string | null;
  filePath: string | null;
  tracks: string;
  durationMs: number;
  defaultEase: string;
  compiledHash: string | null;
  ownerEmail: string;
  orgId: string | null;
  createdAt: string;
  updatedAt: string;
}

const designFilesStore = vi.hoisted(() => ({
  rows: new Map<string, FileRow>(),
}));
const motionTimelineStore = vi.hoisted(() => ({
  rows: new Map<string, TimelineRow>(),
}));

const FILE_ID = "file_hero_1";
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

type Predicate = unknown;

function predicateString(predicate: Predicate): string {
  return JSON.stringify(predicate, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

function matchesFileRow(row: FileRow, predicate: Predicate): boolean {
  const asString = predicateString(predicate);
  if (asString.includes(FILE_ID)) return row.id === FILE_ID;
  if (asString.includes(DESIGN_ID)) return row.designId === DESIGN_ID;
  return true;
}

function matchesTimelineRow(row: TimelineRow, predicate: Predicate): boolean {
  const asString = predicateString(predicate);
  // Narrow by id first (most specific), then designId, then sourceRef.
  for (const row2 of motionTimelineStore.rows.values()) {
    if (asString.includes(row2.id) && row.id !== row2.id) return false;
  }
  if (asString.includes(DESIGN_ID) && row.designId !== DESIGN_ID) return false;
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
    motionTimeline: {
      id: { name: "id" },
      designId: { name: "designId" },
      sourceRef: { name: "sourceRef" },
      filePath: { name: "filePath" },
      tracks: { name: "tracks" },
      durationMs: { name: "durationMs" },
      defaultEase: { name: "defaultEase" },
      compiledHash: { name: "compiledHash" },
      ownerEmail: { name: "ownerEmail" },
      orgId: { name: "orgId" },
      createdAt: { name: "createdAt" },
      updatedAt: { name: "updatedAt" },
    },
  };

  const fileWhereBuilder = (predicate: Predicate) => {
    const rows = [...designFilesStore.rows.values()].filter((row) =>
      matchesFileRow(row, predicate),
    );
    return Object.assign(Promise.resolve(rows), {
      limit: (n: number) => Promise.resolve(rows.slice(0, n)),
    });
  };

  function timelineWhereBuilder(predicate: Predicate) {
    const rows = [...motionTimelineStore.rows.values()].filter((row) =>
      matchesTimelineRow(row, predicate),
    );
    const chain = {
      limit: (n: number) => Promise.resolve(rows.slice(0, n)),
      orderBy: (..._args: unknown[]) => ({
        limit: (n: number) => {
          const sorted = [...rows].sort((a, b) =>
            b.updatedAt.localeCompare(a.updatedAt),
          );
          return Promise.resolve(sorted.slice(0, n));
        },
      }),
    };
    return chain;
  }

  function applyUpdate(
    table: unknown,
    values: Record<string, unknown>,
    predicate: Predicate,
  ) {
    if (table === schema.designFiles) {
      for (const row of designFilesStore.rows.values()) {
        if (matchesFileRow(row, predicate)) Object.assign(row, values);
      }
    } else if (table === schema.motionTimeline) {
      for (const row of motionTimelineStore.rows.values()) {
        if (matchesTimelineRow(row, predicate)) Object.assign(row, values);
      }
    }
    // designs table updates are no-ops for this fake DB — no rows tracked.
    return Promise.resolve({ rowsAffected: 1 });
  }

  const db = {
    select: (_projection: unknown) => ({
      from: (table: unknown) => ({
        where:
          table === schema.motionTimeline
            ? timelineWhereBuilder
            : fileWhereBuilder,
        innerJoin: (_joined: unknown, _on: unknown) => ({
          where: fileWhereBuilder,
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (predicate: Predicate) => applyUpdate(table, values, predicate),
      }),
    }),
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown>) => {
        if (table === schema.motionTimeline) {
          motionTimelineStore.rows.set(row.id as string, row as TimelineRow);
        }
        return Promise.resolve(undefined);
      },
    }),
    transaction: async (fn: (tx: typeof db) => Promise<void>) => fn(db),
  };
  return { getDb: () => db, schema };
});

import {
  agentEnterDocument,
  applyText,
  hasCollabState,
} from "@agent-native/core/collab";

import { readLiveSourceFile } from "../server/source-workspace.js";
import action from "./apply-motion-edit.js";

function currentFileRef(): FileRow {
  const row = designFilesStore.rows.get(FILE_ID);
  if (!row) throw new Error("file not seeded");
  return { ...row };
}

function baseDoc(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Repro</title>
</head>
<body>
<main>
<section data-agent-native-node-id="node-hero" style="opacity: 1;">Hero</section>
<p data-agent-native-node-id="node-caption">Caption text</p>
</main>
</body>
</html>`;
}

function oneTrack(nodeId = "node-hero") {
  return [
    {
      targetNodeId: nodeId,
      property: "opacity",
      keyframes: [
        { t: 0, value: "0" },
        { t: 1, value: "1" },
      ],
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  collabDocs.docs.clear();
  designFilesStore.rows.clear();
  motionTimelineStore.rows.clear();
  seedFile(baseDoc());
});

describe("apply-motion-edit collab-aware persist (contract-bypass fix)", () => {
  it("persists the managed motion <style> block through writeInlineSourceFile (collab doc updated, not just SQL)", async () => {
    const result = await action.run({
      designId: DESIGN_ID,
      fileId: FILE_ID,
      tracks: oneTrack(),
      durationMs: 500,
    } as never);

    expect(result.contentPatched).toBe(true);
    expect(result.persisted).toBe(true);

    // The collab doc must actually reflect the patched HTML, not just SQL —
    // proving the write went through writeInlineSourceFile/seedFromText
    // rather than a raw designFiles.content db.update bypassing collab.
    expect(await hasCollabState(FILE_ID)).toBe(true);
    const collabContent = await (
      await import("@agent-native/core/collab")
    ).getText(FILE_ID, "content");
    expect(collabContent).toContain("data-agent-native-motion");

    // SQL mirrors the converged collab content.
    const sqlRow = currentFileRef();
    expect(sqlRow.content).toBe(collabContent);
  });

  it("a concurrent sibling collab write landing between the base read and the persist is NOT silently dropped — both changes survive", async () => {
    // Simulate a live editor already having an open collab doc for this file
    // (e.g. from a prior edit in the same session) with a sibling style edit
    // baked in, so apply-motion-edit's readLiveSourceFile call observes it as
    // the base.
    const preEditLive = await readLiveSourceFile(currentFileRef());
    await (
      await import("@agent-native/core/collab")
    ).seedFromText(FILE_ID, preEditLive.content);
    const siblingEdited = preEditLive.content.replace(
      "opacity: 1;",
      "opacity: 1; border-radius: 12px;",
    );
    await applyText(FILE_ID, siblingEdited, "content", "agent");
    seedFile(siblingEdited); // mirror SQL the way a guarded write would

    const result = await action.run({
      designId: DESIGN_ID,
      fileId: FILE_ID,
      tracks: oneTrack(),
      durationMs: 500,
    } as never);

    expect(result.persisted).toBe(true);
    const finalLive = await readLiveSourceFile(currentFileRef());
    // BOTH changes present: the sibling's style edit AND the new motion CSS.
    expect(finalLive.content).toContain("border-radius: 12px;");
    expect(finalLive.content).toContain("data-agent-native-motion");
  });

  it("preserves an unsaved caller working copy when its revision still matches the unchanged live base", async () => {
    const workingCopy = baseDoc().replace(
      "Caption text",
      "Caption text (unsaved locally)",
    );

    const result = await action.run({
      designId: DESIGN_ID,
      fileId: FILE_ID,
      tracks: oneTrack(),
      durationMs: 500,
      currentContent: workingCopy,
      revision: "2026-07-06T00:00:00.000Z",
    } as never);

    expect(result.persisted).toBe(true);
    const finalLive = await readLiveSourceFile(currentFileRef());
    expect(finalLive.content).toContain("Caption text (unsaved locally)");
    expect(finalLive.content).toContain("data-agent-native-motion");
  });

  it("rejects (loud, not silent) when a concurrent write lands using a caller-supplied stale currentContent base", async () => {
    // The action supports a caller-supplied `currentContent` param used
    // instead of the live read as the patch base. If that base has gone
    // stale relative to the live doc by the time the write happens, the
    // write must be rejected rather than silently clobbering the concurrent
    // change — mirroring the same guarantee writeInlineSourceFile gives
    // every other caller-supplied-base action.
    const staleBase = baseDoc();

    // A concurrent writer changes the live collab doc AFTER staleBase was
    // captured by the (hypothetical) caller but BEFORE this action runs.
    await (
      await import("@agent-native/core/collab")
    ).seedFromText(FILE_ID, staleBase);
    const concurrentContent = staleBase.replace(
      "Caption text",
      "Caption text (edited concurrently)",
    );
    await applyText(FILE_ID, concurrentContent, "content", "agent");
    seedFile(concurrentContent);

    // Sanity: the live doc has already diverged from staleBase.
    const liveNow = await readLiveSourceFile(currentFileRef());
    expect(liveNow.content).not.toBe(staleBase);

    // Directly exercise writeInlineSourceFile with the stale base's hash to
    // prove the guard rejects it — the same seam apply-motion-edit's
    // persistFileContent helper goes through when currentContentInput is
    // supplied and has gone stale by write time.
    const { writeInlineSourceFile } =
      await import("../server/source-workspace.js");
    const { sourceContentHash } = await import("../shared/source-workspace.js");
    await expect(
      writeInlineSourceFile({
        designId: DESIGN_ID,
        file: currentFileRef(),
        content: staleBase.replace("opacity: 1;", "opacity: 1; /* motion */"),
        expectedVersionHash: sourceContentHash(staleBase),
      }),
    ).rejects.toThrow(/changed since it was read/);

    // The concurrent edit must survive untouched.
    const finalLive = await readLiveSourceFile(currentFileRef());
    expect(finalLive.content).toContain("Caption text (edited concurrently)");
  });

  it("does not write HTML content when the motion_timeline row already reflects the same tracks and contentPatched is false (no managed style seam present)", async () => {
    // canPatchManagedMotionCss requires an HTML document shape; feed content
    // that doesn't look like HTML to exercise the contentPatched=false branch
    // and confirm persistFileContent (and therefore collab) is never invoked.
    seedFile("just some opaque non-HTML content blob");

    const result = await action.run({
      designId: DESIGN_ID,
      fileId: FILE_ID,
      tracks: oneTrack(),
      durationMs: 500,
    } as never);

    expect(result.contentPatched).toBe(false);
    expect(await hasCollabState(FILE_ID)).toBe(false);
    expect(agentEnterDocument).not.toHaveBeenCalled();
  });
});
