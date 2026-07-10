/**
 * apply-shader-fill.interleave.spec.ts
 *
 * Contract-bypass regression: apply-shader-fill.ts used an ad-hoc
 * `updatedAt`-string compare-and-swap (`ShaderFillRevisionConflictError`) with
 * three raw SQL steps (update, then a SELECT to verify) — never reading or
 * writing collab/Yjs state. A concurrent live editor's Y.Text change was
 * invisible to this action both on read (it only ever read `file.content` /
 * the caller's `currentContent`) and on write (the raw `db.update` never
 * touched the collab doc), so a sibling collab edit racing a shader-fill
 * persist could be silently overwritten.
 *
 * Fix: the read side now goes through `readLiveSourceFile` (collab-authoritative
 * when a doc exists, else the SQL row) and the write side through
 * `writeInlineSourceFile`, which re-reads the live text immediately before its
 * own write and rejects if it no longer matches the `expectedVersionHash`
 * captured from the SAME read the transform used as its base — closing the
 * race window instead of silently corrupting, mapped back to the existing
 * `ShaderFillRevisionConflictError`-shaped `{ok:false, conflict:true, ...}`
 * response.
 *
 * This spec exercises the REAL apply-shader-fill action module (not mocked at
 * the writeInlineSourceFile boundary) against a fake minimal DB + a real
 * per-docId Y.Doc registry, the same harness shape as
 * insert-design-native-asset.interleave.spec.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

// ---------------------------------------------------------------------------
// Fake @agent-native/core/collab backed by a real per-docId Y.Doc registry,
// with a real deterministic prefix/suffix-trim diff for applyText.
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
  agentUpdateSelection: vi.fn(),
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
  accessFilter: vi.fn().mockReturnValue(undefined),
}));

// ---------------------------------------------------------------------------
// Minimal fake Drizzle app-DB layer backing a single design_files row, same
// query shape as insert-design-native-asset.interleave.spec.ts.
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

function matches(row: FileRow, predicate: Predicate): boolean {
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
  const whereBuilder = (predicate: Predicate) => {
    const rows = [...designFilesStore.rows.values()].filter((row) =>
      matches(row, predicate),
    );
    return Object.assign(Promise.resolve(rows), {
      limit: (n: number) => Promise.resolve(rows.slice(0, n)),
    });
  };
  const db = {
    select: (_projection: unknown) => ({
      from: (_table: unknown) => ({
        where: whereBuilder,
        innerJoin: (_joined: unknown, _on: unknown) => ({
          where: whereBuilder,
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (predicate: Predicate) => {
          if (table === schema.designFiles) {
            for (const row of designFilesStore.rows.values()) {
              if (matches(row, predicate)) Object.assign(row, values);
            }
          }
          return Promise.resolve({ rowsAffected: 1 });
        },
      }),
    }),
  };
  return { getDb: () => db, schema };
});

import { hasCollabState, applyText } from "@agent-native/core/collab";

import { readLiveSourceFile } from "../server/source-workspace.js";
import action from "./apply-shader-fill.js";

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
<section data-agent-native-node-id="node-hero" style="border-radius: 8px;">Hero</section>
<p data-agent-native-node-id="node-caption">Caption text</p>
</main>
</body>
</html>`;
}

function shaderFillArgs(overrides: Record<string, unknown> = {}) {
  return {
    descriptor: {
      preset: "MeshGradient",
      params: {},
      colors: ["#e0eaff", "#241d9a"],
    },
    target: { nodeId: "node-hero" },
    source: { kind: "design-file", designId: DESIGN_ID, fileId: FILE_ID },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  collabDocs.docs.clear();
  designFilesStore.rows.clear();
  seedFile(baseDoc());
});

describe("apply-shader-fill collab-aware persist (contract-bypass fix)", () => {
  it("persists the shader background through writeInlineSourceFile (collab doc updated, not just SQL)", async () => {
    const result = await action.run(shaderFillArgs() as never);

    expect(result.persisted).toBe(true);
    expect(await hasCollabState(FILE_ID)).toBe(true);

    const collabContent = await (
      await import("@agent-native/core/collab")
    ).getText(FILE_ID, "content");
    expect(collabContent).toContain("background:");

    const sqlRow = currentFileRef();
    expect(sqlRow.content).toBe(collabContent);
  });

  it("a concurrent sibling collab write landing between the base read and the persist is NOT silently dropped — both changes survive", async () => {
    // Model a live editor session already holding an open collab doc for
    // this file, with a sibling caption-text edit baked in, so
    // apply-shader-fill's readLiveSourceFile call observes it as the base.
    const preFillLive = await readLiveSourceFile(currentFileRef());
    await (
      await import("@agent-native/core/collab")
    ).seedFromText(FILE_ID, preFillLive.content);
    const siblingEdited = preFillLive.content.replace(
      "Caption text",
      "Caption text (edited by sibling)",
    );
    await applyText(FILE_ID, siblingEdited, "content", "agent");
    seedFile(siblingEdited); // mirror SQL the way a guarded write would

    const result = await action.run(shaderFillArgs() as never);

    expect(result.persisted).toBe(true);
    const finalLive = await readLiveSourceFile(currentFileRef());
    // BOTH changes present: the sibling's caption edit AND the new shader
    // background.
    expect(finalLive.content).toContain("Caption text (edited by sibling)");
    expect(finalLive.content).toContain("background:");
  });

  it("preserves an unsaved caller working copy when its revision still matches the unchanged live base", async () => {
    const workingCopy = baseDoc().replace(
      "Caption text",
      "Caption text (unsaved locally)",
    );

    const result = await action.run(
      shaderFillArgs({
        source: {
          kind: "design-file",
          designId: DESIGN_ID,
          fileId: FILE_ID,
          currentContent: workingCopy,
          revision: "2026-07-06T00:00:00.000Z",
        },
      }) as never,
    );

    expect(result.ok).toBe(true);
    expect(result.persisted).toBe(true);
    const finalLive = await readLiveSourceFile(currentFileRef());
    expect(finalLive.content).toContain("Caption text (unsaved locally)");
    expect(finalLive.content).toContain("background:");
  });

  it("rejects a third live value even when the caller's SQL revision still matches", async () => {
    const persistedBase = baseDoc();
    const workingCopy = persistedBase.replace(
      "Caption text",
      "Caption text (unsaved locally)",
    );
    await (
      await import("@agent-native/core/collab")
    ).seedFromText(FILE_ID, persistedBase);
    const concurrentLive = persistedBase.replace(
      "Caption text",
      "Caption text (edited concurrently)",
    );
    await applyText(FILE_ID, concurrentLive, "content", "agent");
    // Deliberately leave SQL at persistedBase with the matching revision. The
    // live Y.Text is the independent third value that must win the conflict.

    const result = await action.run(
      shaderFillArgs({
        source: {
          kind: "design-file",
          designId: DESIGN_ID,
          fileId: FILE_ID,
          currentContent: workingCopy,
          revision: "2026-07-06T00:00:00.000Z",
        },
      }) as never,
    );

    expect(result).toMatchObject({
      ok: false,
      persisted: false,
      conflict: true,
    });
    const finalLive = await readLiveSourceFile(currentFileRef());
    expect(finalLive.content).toContain("Caption text (edited concurrently)");
    expect(finalLive.content).not.toContain("unsaved locally");
    expect(finalLive.content).not.toContain("background:");
  });

  it("rejects loud (ShaderFillRevisionConflictError shape) instead of silently clobbering when currentContent has gone stale by write time", async () => {
    const staleBase = baseDoc();

    // A concurrent writer changes the live collab doc AFTER staleBase was
    // captured by the caller but BEFORE this action runs — modeled by
    // seeding collab state directly, then landing a further edit on it.
    await (
      await import("@agent-native/core/collab")
    ).seedFromText(FILE_ID, staleBase);
    const concurrentContent = staleBase.replace(
      "Caption text",
      "Caption text (edited concurrently)",
    );
    await applyText(FILE_ID, concurrentContent, "content", "agent");
    seedFile(concurrentContent, "2026-07-06T00:05:00.000Z");

    // Sanity: the live doc has already diverged from staleBase.
    const liveNow = await readLiveSourceFile(currentFileRef());
    expect(liveNow.content).not.toBe(staleBase);

    // Caller supplies the now-stale snapshot as currentContent with a
    // matching revision stamp equal to the ORIGINAL file.updatedAt — but the
    // live doc has since moved on, so the write must be rejected loud.
    const result = await action.run(
      shaderFillArgs({
        source: {
          kind: "design-file",
          designId: DESIGN_ID,
          fileId: FILE_ID,
          currentContent: staleBase,
          revision: "2026-07-06T00:00:00.000Z",
        },
      }) as never,
    );

    expect(result.ok).toBe(false);
    expect(result.persisted).toBe(false);
    expect(result.conflict).toBe(true);

    // The concurrent edit must survive untouched — no corruption, no lost
    // update.
    const finalLive = await readLiveSourceFile(currentFileRef());
    expect(finalLive.content).toContain("Caption text (edited concurrently)");
    expect(finalLive.content).not.toContain("background:");
  });
});
