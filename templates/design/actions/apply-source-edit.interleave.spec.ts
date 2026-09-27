/**
 * apply-source-edit.interleave.spec.ts
 *
 * Regression test for the shader/base-style cross-pipeline data-loss bug
 * (ship-blocker repro): applying a GLSL shader fill (apply-source-edit,
 * full-replace + expectedVersionHash) followed immediately by a base Fill
 * "Add layer" / "Remove layer" style commit (update-file) corrupted
 * design_files.content — the persisted file ended up truncated mid-attribute
 * inside the shader element's opening tag, or (in the isolated repro built
 * while investigating this) duplicated into two concatenated
 * <!DOCTYPE>...</html> documents.
 *
 * Root cause: both actions ultimately call into the SAME per-file Yjs collab
 * document (server/source-workspace.ts's writeInlineSourceFile for
 * apply-source-edit; @agent-native/core/collab's applyText directly for
 * update-file), and BOTH use expectedVersionHash/diff-based writes. Whenever
 * one write's collab mutation lands on the SAME document a second,
 * independently-computed write is still in flight for, the two Y.Text diffs
 * are each individually consistent but their CRDT merge does not converge to
 * either intended document.
 *
 * `@agent-native/core/collab`'s package export resolves to its built `dist/`
 * bundle (see packages/core/package.json's "./collab" export), which imports
 * its OWN DB client module by relative path internally — a `vi.mock` for the
 * public `@agent-native/core/db` specifier from this app-level package never
 * intercepts that internal edge, so faking the SQL layer underneath the real
 * collab package (the way packages/core/src/collab/ydoc-manager.merge.spec.ts
 * does from *inside* packages/core) isn't reachable from here. Instead this
 * test mocks `@agent-native/core/collab` itself (the established pattern this
 * app's other action specs already use — see actions/insert-asset.spec.ts),
 * but backs the mock with a REAL per-doc-id Y.Doc registry and a real,
 * deterministic prefix/suffix-trim text diff — the same cursor-based
 * delete/insert shape ydoc-manager.ts's applyTextToYDoc uses — so the
 * MERGE behavior under test (two independently-computed Y.Text mutations
 * landing on the same document) is genuine CRDT semantics via real `yjs`,
 * not a hand-waved stand-in.
 *
 * Covers:
 *  1. A clean sequential apply-source-edit -> update-file round trip stays
 *     well-formed (baseline, no interleave).
 *  2. update-file's own write landing WHILE apply-source-edit's
 *     expectedVersionHash guard is checked against a since-changed document
 *     is rejected (stale hash -> throws), instead of silently corrupting.
 *  3. A genuine interleave — an update-file write's diff-based collab mutation
 *     computed from a stale pre-shader base landing on top of the
 *     already-shader-mutated collab doc — still leaves the persisted content
 *     well-formed (starts with <!DOCTYPE html>, exactly one <html>/</html>
 *     pair, head/script intact), asserting the actual persisted invariant the
 *     bug violated rather than which edit "won".
 *  4. The exact reported corruption shape (two concatenated <!DOCTYPE>...
 *     </html> documents) reproduced from a client-style raw ydoc.transact
 *     rewrite racing a diff-based shader write on a realistically large
 *     document, via real `yjs` Y.Doc/applyUpdate merge semantics.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const collabDocs = vi.hoisted(() => ({
  docs: new Map<string, unknown>(),
  rows: new Map<
    string,
    { yjs_state: string; text_snapshot: string; version: number }
  >(),
}));
const collabTestControl = vi.hoisted(() => ({
  corruptNextValidatedApply: false,
  peerContentBeforeNextValidatedApply: null as string | null,
}));

function getOrCreateDoc(docId: string): InstanceType<typeof Y.Doc> {
  let doc = collabDocs.docs.get(docId) as
    | InstanceType<typeof Y.Doc>
    | undefined;
  if (!doc) {
    doc = new Y.Doc();
    const row = collabDocs.rows.get(docId);
    if (row?.yjs_state) {
      doc.getText("content").insert(0, row.text_snapshot);
    }
    collabDocs.docs.set(docId, doc);
  }
  return doc;
}

function persistMockCollabRow(
  docId: string,
  text: string,
  expectedVersion?: number | null,
): void {
  const existing = collabDocs.rows.get(docId);
  if (expectedVersion !== undefined) {
    if (
      expectedVersion === null
        ? existing !== undefined
        : existing?.version !== expectedVersion
    ) {
      throw new Error("mock collaboration version conflict");
    }
  }
  collabDocs.rows.set(docId, {
    yjs_state: "mock-yjs-state",
    text_snapshot: text,
    version:
      existing === undefined || expectedVersion === null
        ? 0
        : existing.version + 1,
  });
}

function persistChangedMockCollabText(
  docId: string,
  before: string,
  doc: InstanceType<typeof Y.Doc>,
): void {
  const after = doc.getText("content").toString();
  if (after !== before) persistMockCollabRow(docId, after);
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
  hasCollabState: async (docId: string) => {
    const row = collabDocs.rows.get(docId);
    return row ? row.yjs_state.length > 0 : collabDocs.docs.has(docId);
  },
  getText: async (docId: string) =>
    getOrCreateDoc(docId).getText("content").toString(),
  applyText: async (
    docId: string,
    newText: string,
    _fieldName?: string,
    _requestSource?: string,
    options?: {
      validateBase?: (base: string) => void;
      validateSnapshot?: (snapshot: string) => void;
    },
  ) => {
    const doc = getOrCreateDoc(docId);
    const beforePeer = doc.getText("content").toString();
    if (collabTestControl.peerContentBeforeNextValidatedApply !== null) {
      const peerContent = collabTestControl.peerContentBeforeNextValidatedApply;
      collabTestControl.peerContentBeforeNextValidatedApply = null;
      applyTextDiff(doc, peerContent);
      persistChangedMockCollabText(docId, beforePeer, doc);
    }
    const before = doc.getText("content").toString();
    options?.validateBase?.(doc.getText("content").toString());
    applyTextDiff(doc, newText);
    if (
      collabTestControl.corruptNextValidatedApply &&
      options?.validateSnapshot
    ) {
      collabTestControl.corruptNextValidatedApply = false;
      applyTextDiff(
        doc,
        `${doc.getText("content").toString()}<!DOCTYPE html><html><body>concurrent</body></html>`,
      );
    }
    const snapshot = doc.getText("content").toString();
    options?.validateSnapshot?.(snapshot);
    persistChangedMockCollabText(docId, before, doc);
    return snapshot;
  },
  seedFromText: async (docId: string, text: string) => {
    const row = collabDocs.rows.get(docId);
    if (row ? row.yjs_state.length > 0 : collabDocs.docs.has(docId)) return;
    const doc = getOrCreateDoc(docId);
    doc.getText("content").insert(0, text);
    persistMockCollabRow(
      docId,
      text,
      collabDocs.rows.get(docId)?.version ?? null,
    );
  },
  applyTextToYDoc: (
    doc: InstanceType<typeof Y.Doc>,
    _fieldName: string,
    text: string,
  ) => {
    if (collabTestControl.peerContentBeforeNextValidatedApply !== null) {
      const peerContent = collabTestControl.peerContentBeforeNextValidatedApply;
      collabTestControl.peerContentBeforeNextValidatedApply = null;
      const peerDoc = getOrCreateDoc(FILE_ID);
      const beforePeer = peerDoc.getText("content").toString();
      applyTextDiff(peerDoc, peerContent);
      persistChangedMockCollabText(FILE_ID, beforePeer, peerDoc);
      throw new Error("Source file changed while the edit was being applied.");
    }
    applyTextDiff(doc, text);
    if (collabTestControl.corruptNextValidatedApply) {
      collabTestControl.corruptNextValidatedApply = false;
      applyTextDiff(
        doc,
        `${doc.getText("content").toString()}<!DOCTYPE html><html><body>concurrent</body></html>`,
      );
    }
  },
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
    const baseVersion = collabDocs.rows.get(docId)?.version ?? null;
    const doc = new Y.Doc();
    if (base) {
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(base));
    } else if (baseVersion !== null) {
      const row = collabDocs.rows.get(docId);
      if (row?.yjs_state) doc.getText("content").insert(0, row.text_snapshot);
    }
    let persisted = false;
    try {
      const result = await run({
        doc,
        baseVersion,
        persist: async (_tx, text) => {
          persistMockCollabRow(docId, text, baseVersion);
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
  getDoc: async (docId: string) => getOrCreateDoc(docId),
  applyUpdate: async (docId: string, update: Uint8Array) => {
    const doc = getOrCreateDoc(docId);
    const before = doc.getText("content").toString();
    Y.applyUpdate(doc, update);
    persistChangedMockCollabText(docId, before, doc);
  },
  releaseDoc: (docId: string) => {
    collabDocs.docs.delete(docId);
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

vi.mock("../server/lib/design-versions.js", () => ({
  snapshotDesignBeforeAgentEdit: vi.fn().mockResolvedValue(null),
  checkpointSkippedResultField: (result: unknown) =>
    result && typeof result === "object" && "skipped" in (result as object)
      ? { checkpoint: result }
      : {},
}));

interface FileRow {
  id: string;
  designId: string;
  filename: string;
  fileType: string;
  content: string;
  contentOperationSource: string | null;
  contentOperationRevision: number | null;
  contentOperationResultHash: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

const designFilesStore = vi.hoisted(() => ({
  rows: new Map<string, FileRow>(),
}));

const FILE_ID = "file_shader_container";
const DESIGN_ID = "design_1";

function seedFile(
  content: string,
  updatedAt = "2026-07-06T00:00:00.000Z",
  fileType = "html",
) {
  designFilesStore.rows.set(FILE_ID, {
    id: FILE_ID,
    designId: DESIGN_ID,
    filename: "index.html",
    fileType,
    content,
    contentOperationSource: null,
    contentOperationRevision: null,
    contentOperationResultHash: null,
    createdAt: updatedAt,
    updatedAt,
  });
}

type Predicate = ReturnType<typeof eq> | ReturnType<typeof and>;

function matches(row: FileRow, predicate: Predicate): boolean {
  const p = predicate as unknown as {
    queryChunks?: unknown[];
    left?: { name?: string };
    right?: unknown;
  };
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
      contentOperationSource: { name: "contentOperationSource" },
      contentOperationRevision: { name: "contentOperationRevision" },
      contentOperationResultHash: { name: "contentOperationResultHash" },
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
    const withLimit = Object.assign(Promise.resolve(rows), {
      limit: (_n: number) => Promise.resolve(rows.slice(0, _n)),
    });
    return withLimit;
  };
  const db = {
    execute: async () => {
      const row = collabDocs.rows.get(FILE_ID);
      return { rows: row ? [row] : [], rowsAffected: 1 };
    },
    transaction: async (callback: (tx: typeof db) => Promise<unknown>) =>
      callback(db),
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

import {
  applyUpdate,
  getDoc,
  hasCollabState,
  applyText,
} from "@agent-native/core/collab";

import {
  readLiveSourceFile,
  writeInlineSourceFile,
} from "../server/source-workspace.js";
import { ensureCodeLayerNodeIdsInHtml } from "../shared/code-layer.js";
import { sourceContentHash } from "../shared/source-workspace.js";
import updateFileAction from "./update-file.js";

function buildDoc(bodyExtra = ""): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Repro</title>
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
<div data-agent-native-node-id="an-node-container-1" style="position:absolute;left:100px;top:100px;width:300px;height:200px;background:#ffffff;" class="rounded-lg">${bodyExtra}
  <p data-agent-native-node-id="an-node-text-1">Hello world</p>
</div>
</body>
</html>`;
}

function buildLargeDoc(bodyExtra = ""): string {
  const sections: string[] = [];
  for (let i = 0; i < 40; i++) {
    sections.push(
      `  <section class="py-12 px-6 bg-white" data-agent-native-node-id="an-node-section-${i}">
    <h2 data-agent-native-node-id="an-node-h2-${i}">Section heading ${i}</h2>
    <p data-agent-native-node-id="an-node-p-${i}">Paragraph copy ${i} with enough text to give this document realistic bulk.</p>
  </section>`,
    );
  }
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Repro</title>
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
<div data-agent-native-node-id="an-node-container-1" style="position:absolute;left:100px;top:100px;width:900px;height:2000px;background:#ffffff;" class="rounded-lg">${bodyExtra}
${sections.join("\n")}
</div>
</body>
</html>`;
}

function assertWellFormed(content: string) {
  expect(content.startsWith("<!DOCTYPE html>")).toBe(true);
  expect((content.match(/<html/g) ?? []).length).toBe(1);
  expect((content.match(/<\/html>/g) ?? []).length).toBe(1);
  expect(content).toContain("<head>");
  expect(content).toContain('<script src="https://cdn.tailwindcss.com">');
}

function currentFileRef(): FileRow {
  const row = designFilesStore.rows.get(FILE_ID);
  if (!row) throw new Error("file not seeded");
  return { ...row };
}

beforeEach(() => {
  collabDocs.docs.clear();
  collabDocs.rows.clear();
  collabTestControl.corruptNextValidatedApply = false;
  collabTestControl.peerContentBeforeNextValidatedApply = null;
  designFilesStore.rows.clear();
  seedFile(buildDoc());
});

describe("HTML integrity write boundary", () => {
  it("rejects malformed managed-style source and leaves live + SQL content unchanged", async () => {
    const before = buildDoc();
    const live = await readLiveSourceFile(currentFileRef());
    const malformed = before.replace(
      "</head>",
      'data-agent-native-breakpoints">@media (max-width: 1279px) { [data-agent-native-node-id="an-node-text-1"] { color: red; } }</style></head>',
    );

    await expect(
      writeInlineSourceFile({
        designId: DESIGN_ID,
        file: currentFileRef(),
        content: malformed,
        expectedVersionHash: live.versionHash,
      }),
    ).rejects.toThrow(/DESIGN_HTML_INTEGRITY/);

    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(before);
    expect((await readLiveSourceFile(currentFileRef())).content).toBe(before);
  });

  it("reports an invalid concurrent collab merge as a retryable conflict", async () => {
    const before = buildDoc();
    await applyText(FILE_ID, before, "content", "seed");
    const live = await readLiveSourceFile(currentFileRef());
    const validAgentEdit = before.replace("Hello world", "Hello from agent");
    collabTestControl.corruptNextValidatedApply = true;

    await expect(
      writeInlineSourceFile({
        designId: DESIGN_ID,
        file: currentFileRef(),
        content: validAgentEdit,
        expectedVersionHash: live.versionHash,
      }),
    ).rejects.toThrow(/changed while the edit was being applied/);

    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(before);
  });
});

describe("locked-layer write boundaries", () => {
  const lockedDoc = buildDoc().replace(
    'data-agent-native-node-id="an-node-container-1"',
    'data-agent-native-node-id="an-node-container-1" data-agent-native-locked="true"',
  );

  it("blocks locked subtree mutations through the shared inline writer", async () => {
    designFilesStore.rows.clear();
    seedFile(lockedDoc);
    const live = await readLiveSourceFile(currentFileRef());

    await expect(
      writeInlineSourceFile({
        designId: DESIGN_ID,
        file: currentFileRef(),
        content: lockedDoc.replace("Hello world", "Changed"),
        expectedVersionHash: live.versionHash,
      }),
    ).rejects.toThrow(/locked layer/i);
  });

  it("blocks agent update-file bypasses but permits the frontend unlock path", async () => {
    designFilesStore.rows.clear();
    seedFile(lockedDoc);
    const unlocked = lockedDoc.replace(' data-agent-native-locked="true"', "");

    await expect(
      updateFileAction.run({ id: FILE_ID, content: unlocked }, {
        caller: "tool",
      } as any),
    ).rejects.toThrow(/locked layer/i);

    await expect(
      updateFileAction.run({ id: FILE_ID, content: unlocked }, {
        caller: "frontend",
      } as any),
    ).resolves.toMatchObject({ updated: true });
  });
});

describe("verified identity-only source publication", () => {
  const raw = buildDoc().replace(
    ' data-agent-native-node-id="an-node-text-1"',
    "",
  );
  const canonical = ensureCodeLayerNodeIdsInHtml(raw, {
    source: { kind: "design-file", fileId: FILE_ID },
  }).content;
  const operationSource = "tab-identity-migration";
  const operationRevision = 17;

  const publish = (
    content: string,
    expectedVersionHash = sourceContentHash(raw),
  ) =>
    updateFileAction.run(
      {
        id: FILE_ID,
        content,
        identityOnly: true,
        expectedVersionHash,
        operationSource,
        operationRevision,
      } as any,
      undefined as any,
    );

  it("accepts only the exact server-derived annotation and stores its operation lineage", async () => {
    seedFile(raw);
    await applyText(FILE_ID, raw, "content", "seed");

    const result = await publish(canonical);

    expect(result).toMatchObject({
      id: FILE_ID,
      updated: true,
      versionHash: sourceContentHash(canonical),
    });
    expect(designFilesStore.rows.get(FILE_ID)).toMatchObject({
      content: canonical,
      contentOperationSource: operationSource,
      contentOperationRevision: operationRevision,
      contentOperationResultHash: sourceContentHash(canonical),
    });
    expect((await readLiveSourceFile(currentFileRef())).content).toBe(
      canonical,
    );

    await expect(publish(canonical)).resolves.toMatchObject({
      updated: true,
      versionHash: sourceContentHash(canonical),
    });

    const laterUserEdit = canonical.replace(
      "Hello world",
      "Hello after migration",
    );
    await expect(
      updateFileAction.run(
        {
          id: FILE_ID,
          content: laterUserEdit,
          syncCollab: true,
          expectedVersionHash: sourceContentHash(canonical),
          operationSource,
          operationRevision: operationRevision + 1,
        } as any,
        { caller: "frontend" } as any,
      ),
    ).resolves.toMatchObject({
      updated: true,
      versionHash: sourceContentHash(laterUserEdit),
    });
    expect(designFilesStore.rows.get(FILE_ID)).toMatchObject({
      content: laterUserEdit,
      contentOperationSource: operationSource,
      contentOperationRevision: operationRevision + 1,
      contentOperationResultHash: sourceContentHash(laterUserEdit),
    });
  });

  it("rejects a higher same-source revision built from a stale full-document snapshot", async () => {
    const base = buildDoc();
    const afterReparent = base.replace(
      "Hello world",
      '<section data-parent="card">Hello world</section>',
    );
    const staleAutoLayout = base.replace(
      "background:#ffffff;",
      "background:#ffffff;display:flex;gap:10px;",
    );
    const composedAutoLayout = afterReparent.replace(
      "background:#ffffff;",
      "background:#ffffff;display:flex;gap:10px;",
    );
    const rapidSource = "tab-rapid-structure";

    seedFile(base);
    await applyText(FILE_ID, base, "content", "seed");
    await expect(
      updateFileAction.run({
        id: FILE_ID,
        content: afterReparent,
        syncCollab: true,
        expectedVersionHash: sourceContentHash(base),
        operationSource: rapidSource,
        operationRevision: 1,
      } as never),
    ).resolves.toMatchObject({ updated: true });

    await expect(
      updateFileAction.run({
        id: FILE_ID,
        content: staleAutoLayout,
        syncCollab: true,
        expectedVersionHash: sourceContentHash(base),
        operationSource: rapidSource,
        operationRevision: 2,
      } as never),
    ).rejects.toThrow(/changed since it was read/i);
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(afterReparent);

    await expect(
      updateFileAction.run({
        id: FILE_ID,
        content: composedAutoLayout,
        syncCollab: true,
        expectedVersionHash: sourceContentHash(afterReparent),
        operationSource: rapidSource,
        operationRevision: 2,
      } as never),
    ).resolves.toMatchObject({ updated: true });
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(
      composedAutoLayout,
    );
  });

  it("repairs SQL when local publication already put canonical bytes in Yjs", async () => {
    seedFile(raw);
    await applyText(FILE_ID, canonical, "content", "local-preview");
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(raw);

    await expect(publish(canonical)).resolves.toMatchObject({
      updated: true,
      versionHash: sourceContentHash(canonical),
    });
    expect(designFilesStore.rows.get(FILE_ID)).toMatchObject({
      content: canonical,
      contentOperationSource: operationSource,
      contentOperationRevision: operationRevision,
      contentOperationResultHash: sourceContentHash(canonical),
    });
  });

  it("allows an exact identity stamp inside a locked legacy subtree while preserving the lock", async () => {
    const lockedRaw = raw.replace(
      'data-agent-native-node-id="an-node-container-1"',
      'data-agent-native-node-id="an-node-container-1" data-agent-native-locked="true"',
    );
    const lockedCanonical = ensureCodeLayerNodeIdsInHtml(lockedRaw, {
      source: { kind: "design-file", fileId: FILE_ID },
    }).content;
    seedFile(lockedRaw);
    await applyText(FILE_ID, lockedRaw, "content", "seed");

    await expect(
      updateFileAction.run(
        {
          id: FILE_ID,
          content: lockedCanonical,
          identityOnly: true,
          expectedVersionHash: sourceContentHash(lockedRaw),
          operationSource,
          operationRevision,
        } as any,
        undefined as any,
      ),
    ).resolves.toMatchObject({ updated: true });
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(lockedCanonical);
    expect(lockedCanonical).toContain('data-agent-native-locked="true"');
  });

  it("does not let an older identity revision reset the accepted operation lineage", async () => {
    seedFile(raw);
    await applyText(FILE_ID, raw, "content", "seed");
    await updateFileAction.run(
      {
        id: FILE_ID,
        content: canonical,
        identityOnly: true,
        expectedVersionHash: sourceContentHash(raw),
        operationSource,
        operationRevision: operationRevision + 1,
      } as any,
      undefined as any,
    );

    await expect(
      updateFileAction.run(
        {
          id: FILE_ID,
          content: canonical,
          identityOnly: true,
          expectedVersionHash: sourceContentHash(canonical),
          operationSource,
          operationRevision,
        } as any,
        undefined as any,
      ),
    ).rejects.toThrow(/newer source operation/i);
    expect(designFilesStore.rows.get(FILE_ID)).toMatchObject({
      content: canonical,
      contentOperationSource: operationSource,
      contentOperationRevision: operationRevision + 1,
      contentOperationResultHash: sourceContentHash(canonical),
    });
  });

  it("rejects malformed identity-only action shapes before source publication", async () => {
    seedFile(raw);
    const validShape = {
      id: FILE_ID,
      content: canonical,
      identityOnly: true,
      expectedVersionHash: sourceContentHash(raw),
      operationSource,
      operationRevision,
    };
    const invalidShapes = [
      { ...validShape, content: undefined },
      { ...validShape, expectedVersionHash: undefined },
      { ...validShape, operationRevision: undefined },
      { ...validShape, filename: "renamed.html" },
      { ...validShape, fileType: "jsx" },
      { ...validShape, syncCollab: false },
    ];
    for (const shape of invalidShapes) {
      await expect(
        updateFileAction.run(shape as any, undefined as any),
      ).rejects.toThrow(/identity-only updates (require|cannot)/i);
    }
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(raw);
    expect(
      designFilesStore.rows.get(FILE_ID)!.contentOperationRevision,
    ).toBeNull();
  });

  it("rejects script, style, text, lock, and structure edits in the identity-only channel", async () => {
    const lockedRaw = raw.replace(
      'data-agent-native-node-id="an-node-container-1"',
      'data-agent-native-node-id="an-node-container-1" data-agent-native-locked="true"',
    );
    const lockedCanonical = ensureCodeLayerNodeIdsInHtml(lockedRaw, {
      source: { kind: "design-file", fileId: FILE_ID },
    }).content;
    const invalid = [
      canonical.replace("Hello world", "changed text"),
      canonical.replace("background:#ffffff", "background:#123456"),
      canonical.replace(
        "https://cdn.tailwindcss.com",
        "https://example.com/x.js",
      ),
      lockedCanonical.replace(' data-agent-native-locked="true"', ""),
      canonical.replace(
        "<p data-agent-native-node-id",
        "<section data-agent-native-node-id",
      ),
    ];

    for (const candidate of invalid) {
      seedFile(raw);
      await applyText(FILE_ID, raw, "content", "seed");
      await expect(publish(candidate)).rejects.toThrow(
        /identity-only publication/i,
      );
      expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(raw);
      expect((await readLiveSourceFile(currentFileRef())).content).toBe(raw);
    }
  });

  it("rejects a peer edit that lands after identity validation but before the Yjs apply", async () => {
    seedFile(raw);
    await applyText(FILE_ID, raw, "content", "seed");
    const peerContent = raw.replace("Hello world", "Peer's newer text");
    collabTestControl.peerContentBeforeNextValidatedApply = peerContent;

    await expect(publish(canonical)).rejects.toThrow(
      /changed while the edit was being applied/i,
    );
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(raw);
    expect((await readLiveSourceFile(currentFileRef())).content).toBe(
      peerContent,
    );
  });

  it("rejects URL-backed and non-HTML files", async () => {
    const url = "https://preview.example.test";
    seedFile(url);
    await expect(
      updateFileAction.run(
        {
          id: FILE_ID,
          content: url,
          identityOnly: true,
          expectedVersionHash: sourceContentHash(url),
          operationSource,
          operationRevision,
        } as any,
        undefined as any,
      ),
    ).rejects.toThrow(/inline HTML/i);

    seedFile(raw, "2026-07-06T00:00:00.000Z", "css");
    await expect(publish(canonical)).rejects.toThrow(/inline HTML/i);
  });
});

describe("apply-source-edit / update-file cross-pipeline interleave", () => {
  it("sequential apply-source-edit then update-file stays well-formed (baseline)", async () => {
    const live = await readLiveSourceFile(currentFileRef());
    const shaderContent = buildDoc(
      ' data-an-shader-fill="an-shader-1" style="background:#59d9ff"',
    );
    const write1 = await writeInlineSourceFile({
      designId: DESIGN_ID,
      file: currentFileRef(),
      content: shaderContent,
      expectedVersionHash: live.versionHash,
    });
    expect(write1.changed).toBe(true);

    const afterShader = await readLiveSourceFile(currentFileRef());
    const addLayerContent = afterShader.content.replace(
      "background:#59d9ff",
      "background:#59d9ff;background-image:linear-gradient(180deg,#fff,#fff)",
    );
    expect(await hasCollabState(FILE_ID)).toBe(true);
    await applyText(FILE_ID, addLayerContent, "content", "agent");

    const finalLive = await readLiveSourceFile(currentFileRef());
    assertWellFormed(finalLive.content);
    expect(finalLive.content).toContain("data-an-shader-fill");
    expect(finalLive.content).toContain("linear-gradient");
  });

  it("rejects a stale expectedVersionHash instead of corrupting the document", async () => {
    const live = await readLiveSourceFile(currentFileRef());

    await writeInlineSourceFile({
      designId: DESIGN_ID,
      file: currentFileRef(),
      content: buildDoc(" data-an-layer-added"),
    });

    await expect(
      writeInlineSourceFile({
        designId: DESIGN_ID,
        file: currentFileRef(),
        content: buildDoc(' data-an-shader-fill="an-shader-1"'),
        expectedVersionHash: live.versionHash,
      }),
    ).rejects.toThrow(/changed since it was read/);

    const finalContent = designFilesStore.rows.get(FILE_ID)!.content;
    assertWellFormed(finalContent);
    expect(finalContent).toContain("data-an-layer-added");
    expect(finalContent).not.toContain("data-an-shader-fill");
  });

  it("a diff-based collab write computed from a stale pre-shader base still leaves the document well-formed once it lands on the shader-mutated doc", async () => {
    const preShaderLive = await readLiveSourceFile(currentFileRef());

    await writeInlineSourceFile({
      designId: DESIGN_ID,
      file: currentFileRef(),
      content: buildDoc(
        ' data-an-shader-fill="an-shader-1" style="background:#59d9ff"',
      ),
      expectedVersionHash: preShaderLive.versionHash,
    });
    expect(await hasCollabState(FILE_ID)).toBe(true);

    const staleAddLayerContent = preShaderLive.content.replace(
      "background:#ffffff;",
      "background:#ffffff;background-image:linear-gradient(180deg,#fff,#fff);",
    );

    await applyText(FILE_ID, staleAddLayerContent, "content", "agent");

    const finalLive = await readLiveSourceFile(currentFileRef());

    // The core invariant the reported bug violated: whichever edit "wins"
    // the race, the persisted document must stay a single well-formed HTML
    // document — never truncated mid-attribute, never duplicated into two
    // concatenated documents. At this document size diff-match-patch
    // resolves the stale diff as a clean (if lossy — see the note below)
    // full-document replace rather than a corrupted merge; the genuine
    // duplicated-document corruption this bug produced needed a client-side
    // untracked full ydoc.transact rewrite racing a diff-based server write
    // (reproduced separately against the real ydoc-manager — see
    // GlslShaderPanel.tsx's write-race guard, which closes that exact path)
    // rather than two diff-based server writes. This assertion is the
    // documented, always-true floor: never corrupt, regardless of document
    // size or which write wins.
    assertWellFormed(finalLive.content);
    expect(finalLive.content.includes("data-an-shader-fill")).toBe(false);
    expect(finalLive.content).toContain("linear-gradient");
  });

  it("reproduces the exact reported corruption: a client-style raw ydoc rewrite racing a diff-based shader write on a realistically large document duplicates the content instead of converging", async () => {
    const largeBase = buildLargeDoc();
    seedFile(largeBase);

    const preShaderLive = await readLiveSourceFile(currentFileRef());
    expect(preShaderLive.content.length).toBe(largeBase.length);

    const clientDoc = new Y.Doc();
    clientDoc.getText("content").insert(0, largeBase);
    const addLayerContent = largeBase.replace(
      "background:#ffffff;",
      "background:#ffffff;background-image:linear-gradient(180deg,#fff,#fff);",
    );
    clientDoc.transact(() => {
      const ytext = clientDoc.getText("content");
      ytext.delete(0, ytext.length);
      ytext.insert(0, addLayerContent);
    }, "TAB_ID");
    const clientUpdate = Y.encodeStateAsUpdate(clientDoc);

    const shaderContent = buildLargeDoc(
      ' data-an-shader-fill="an-shader-1" style="background:#59d9ff"',
    );
    await writeInlineSourceFile({
      designId: DESIGN_ID,
      file: currentFileRef(),
      content: shaderContent,
      expectedVersionHash: preShaderLive.versionHash,
    });
    expect(await hasCollabState(FILE_ID)).toBe(true);

    await applyUpdate(FILE_ID, clientUpdate, "network");

    const mergedDoc = await getDoc(FILE_ID);
    const merged = mergedDoc.getText("content").toString();

    const isCorrupted =
      (merged.match(/<!DOCTYPE/g) ?? []).length > 1 ||
      (merged.match(/<\/html>/g) ?? []).length > 1;
    expect(isCorrupted).toBe(true);
    expect(merged.length).toBe(shaderContent.length + addLayerContent.length);

    // Documents why the fix must live where the CLIENT decides whether to
    // push its own raw ydoc rewrite at all: DesignEditor.tsx's
    // commitVisualStyles now checks isShaderWriteInFlight(fileId) and defers
    // via waitForShaderWriteToSettle(fileId) BEFORE computing clientUpdate
    // in the first place (see GlslShaderPanel.tsx), so in the real app this
    // clientUpdate is never built from the stale pre-shader base to begin
    // with — this test's job is only to prove the merge really would
    // corrupt the document if that guard were bypassed or removed.
  });
});

describe("update-file expectedVersionHash guard (server-discipline layer)", () => {
  it("fails loud on a stale hash: the original repro's residual write path cannot silently merge", async () => {
    const preShaderLive = await readLiveSourceFile(currentFileRef());
    const preShaderHash = preShaderLive.versionHash;

    const shaderContent = buildDoc(
      ' data-an-shader-fill="an-shader-1" style="background:#59d9ff"',
    );
    await writeInlineSourceFile({
      designId: DESIGN_ID,
      file: currentFileRef(),
      content: shaderContent,
      expectedVersionHash: preShaderHash,
    });
    expect(await hasCollabState(FILE_ID)).toBe(true);

    const staleAddLayerContent = preShaderLive.content.replace(
      "background:#ffffff;",
      "background:#ffffff;background-image:linear-gradient(180deg,#fff,#fff);",
    );
    await expect(
      updateFileAction.run({
        id: FILE_ID,
        content: staleAddLayerContent,
        syncCollab: true,
        expectedVersionHash: preShaderHash,
      } as never),
    ).rejects.toThrow(/changed since it was read/);

    const finalLive = await readLiveSourceFile(currentFileRef());
    assertWellFormed(finalLive.content);
    expect(finalLive.content).toContain("data-an-shader-fill");
    expect(finalLive.content).not.toContain("linear-gradient");
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(shaderContent);
  });

  it("accepts a matching hash and mirrors the write into collab", async () => {
    const live = await readLiveSourceFile(currentFileRef());
    const next = buildDoc(" data-an-layer-added");
    const result = await updateFileAction.run({
      id: FILE_ID,
      content: next,
      syncCollab: true,
      expectedVersionHash: live.versionHash,
    } as never);
    expect(result).toMatchObject({ id: FILE_ID, updated: true });
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(next);
    const finalLive = await readLiveSourceFile(currentFileRef());
    expect(finalLive.content).toBe(next);
    assertWellFormed(finalLive.content);
  });

  it("rejects a newer same-tab replay against the oldest queued base", async () => {
    const initial = await readLiveSourceFile(currentFileRef());
    const first = buildDoc(" data-first");
    const final = buildDoc(" data-first data-final");

    await updateFileAction.run({
      id: FILE_ID,
      content: first,
      syncCollab: true,
      operationSource: "tab-a",
      operationRevision: 1,
      expectedVersionHash: initial.versionHash,
    } as never);

    await expect(
      updateFileAction.run({
        id: FILE_ID,
        content: final,
        syncCollab: true,
        operationSource: "tab-a",
        operationRevision: 2,
        expectedVersionHash: initial.versionHash,
      } as never),
    ).rejects.toThrow(/changed since it was read/);
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(first);
    expect((await readLiveSourceFile(currentFileRef())).content).toBe(first);
  });

  it("rejects a same-tab replay after a later writer moves the mirror and collab text", async () => {
    const initial = await readLiveSourceFile(currentFileRef());
    const first = buildDoc(" data-first");
    const intervening = buildDoc(" data-intervening");
    const final = buildDoc(" data-first data-final");

    await updateFileAction.run({
      id: FILE_ID,
      content: first,
      syncCollab: true,
      operationSource: "tab-a",
      operationRevision: 1,
      expectedVersionHash: initial.versionHash,
    } as never);

    await applyText(FILE_ID, intervening, "content", "agent");
    designFilesStore.rows.get(FILE_ID)!.content = intervening;

    await expect(
      updateFileAction.run({
        id: FILE_ID,
        content: final,
        syncCollab: true,
        operationSource: "tab-a",
        operationRevision: 2,
        expectedVersionHash: initial.versionHash,
      } as never),
    ).rejects.toThrow(/changed since it was read/);
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(intervening);
    expect((await readLiveSourceFile(currentFileRef())).content).toBe(
      intervening,
    );
  });

  it("checks the hash against LIVE collab text once collab state exists, not the SQL row", async () => {
    const sqlContent = designFilesStore.rows.get(FILE_ID)!.content;
    const liveOnlyContent = buildDoc(" data-live-only");
    await applyText(FILE_ID, liveOnlyContent, "content", "agent");
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(sqlContent);

    await expect(
      updateFileAction.run({
        id: FILE_ID,
        content: buildDoc(" data-next"),
        syncCollab: true,
        expectedVersionHash: sourceContentHash(sqlContent),
      } as never),
    ).rejects.toThrow(/changed since it was read/);

    await expect(
      updateFileAction.run({
        id: FILE_ID,
        content: buildDoc(" data-next"),
        syncCollab: true,
        expectedVersionHash: sourceContentHash(liveOnlyContent),
      } as never),
    ).resolves.toMatchObject({ updated: true });
  });

  it("preserves legacy last-write-wins behavior when no hash is provided", async () => {
    const next = buildDoc(" data-unguarded");
    await expect(
      updateFileAction.run({
        id: FILE_ID,
        content: next,
        syncCollab: true,
      } as never),
    ).resolves.toMatchObject({ updated: true });
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(next);
  });
});

describe("update-file TOCTOU fix: hash check + write serialized under withSourceFileWriteLock", () => {
  it("two concurrent update-file calls carrying the SAME valid base hash: exactly one succeeds, the other fails loud with the version error", async () => {
    const live = await readLiveSourceFile(currentFileRef());
    const contentA = buildDoc(" data-writer-a");
    const contentB = buildDoc(" data-writer-b");

    const results = await Promise.allSettled([
      updateFileAction.run({
        id: FILE_ID,
        content: contentA,
        syncCollab: true,
        expectedVersionHash: live.versionHash,
      } as never),
      updateFileAction.run({
        id: FILE_ID,
        content: contentB,
        syncCollab: true,
        expectedVersionHash: live.versionHash,
      } as never),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(
      ((rejected[0] as PromiseRejectedResult).reason as Error).message,
    ).toMatch(/changed since it was read/);

    const finalContent = designFilesStore.rows.get(FILE_ID)!.content;
    assertWellFormed(finalContent);
    const winnerWasA = finalContent === contentA;
    const winnerWasB = finalContent === contentB;
    expect(winnerWasA || winnerWasB).toBe(true);
    expect(winnerWasA && winnerWasB).toBe(false);

    const finalLive = await readLiveSourceFile(currentFileRef());
    expect(finalLive.content).toBe(finalContent);
  });

  it("a concurrent guarded + legacy (no-hash) pair doesn't corrupt: both are serialized under the same per-file lock", async () => {
    const live = await readLiveSourceFile(currentFileRef());
    const guardedContent = buildDoc(" data-guarded-writer");
    const legacyContent = buildDoc(" data-legacy-writer");

    const results = await Promise.allSettled([
      updateFileAction.run({
        id: FILE_ID,
        content: guardedContent,
        syncCollab: true,
        expectedVersionHash: live.versionHash,
      } as never),
      updateFileAction.run({
        id: FILE_ID,
        content: legacyContent,
        syncCollab: true,
      } as never),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const finalContent = designFilesStore.rows.get(FILE_ID)!.content;
    assertWellFormed(finalContent);
    expect(
      finalContent === guardedContent || finalContent === legacyContent,
    ).toBe(true);

    const finalLive = await readLiveSourceFile(currentFileRef());
    expect(finalLive.content).toBe(finalContent);
  });
});

describe("sourceContentHash", () => {
  it("changes whenever content changes (sanity for the expectedVersionHash guard)", () => {
    const a = sourceContentHash(buildDoc());
    const b = sourceContentHash(buildDoc(" data-x"));
    expect(a).not.toBe(b);
    expect(sourceContentHash(buildDoc())).toBe(a);
  });
});
