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
  CollabBaseVersionConflictError: class CollabBaseVersionConflictError extends Error {},
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
  applyTextToYDoc: (
    doc: InstanceType<typeof Y.Doc>,
    _fieldName: string,
    text: string,
  ) => applyTextDiff(doc, text),
  withPreparedYDocMutation: async (
    docId: string,
    _requestSource: string | undefined,
    run: (lease: {
      doc: InstanceType<typeof Y.Doc>;
      baseVersion: number | null;
      persist: (_tx: unknown, text: string) => Promise<void>;
    }) => Promise<unknown>,
  ) => {
    const base = collabDocs.docs.get(docId) as
      | InstanceType<typeof Y.Doc>
      | undefined;
    const doc = new Y.Doc();
    if (base) Y.applyUpdate(doc, Y.encodeStateAsUpdate(base));
    let persisted = false;
    try {
      const result = await run({
        doc,
        baseVersion: base ? 0 : null,
        persist: async (_tx, _text) => {
          collabDocs.docs.set(docId, doc);
          persisted = true;
        },
      });
      if (!persisted) doc.destroy();
      return result;
    } catch (error) {
      doc.destroy();
      throw error;
    }
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn().mockResolvedValue({ role: "editor", resource: {} }),
  accessFilter: vi.fn().mockReturnValue(undefined),
}));

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
    execute: () => Promise.resolve({ rows: [] }),
    transaction: async (fn: (tx: typeof db) => Promise<void>) => fn(db),
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
    const preFillLive = await readLiveSourceFile(currentFileRef());
    await (
      await import("@agent-native/core/collab")
    ).seedFromText(FILE_ID, preFillLive.content);
    const siblingEdited = preFillLive.content.replace(
      "Caption text",
      "Caption text (edited by sibling)",
    );
    await applyText(FILE_ID, siblingEdited, "content", "agent");
    seedFile(siblingEdited);

    const result = await action.run(shaderFillArgs() as never);

    expect(result.persisted).toBe(true);
    const finalLive = await readLiveSourceFile(currentFileRef());
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

    await (
      await import("@agent-native/core/collab")
    ).seedFromText(FILE_ID, staleBase);
    const concurrentContent = staleBase.replace(
      "Caption text",
      "Caption text (edited concurrently)",
    );
    await applyText(FILE_ID, concurrentContent, "content", "agent");
    seedFile(concurrentContent, "2026-07-06T00:05:00.000Z");

    const liveNow = await readLiveSourceFile(currentFileRef());
    expect(liveNow.content).not.toBe(staleBase);

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

    const finalLive = await readLiveSourceFile(currentFileRef());
    expect(finalLive.content).toContain("Caption text (edited concurrently)");
    expect(finalLive.content).not.toContain("background:");
  });
});
