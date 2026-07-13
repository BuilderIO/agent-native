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

// ---------------------------------------------------------------------------
// Fake @agent-native/core/collab backed by a real per-docId Y.Doc registry.
// `applyText` uses a real, deterministic common-prefix/suffix-trim diff
// (the same cursor-based delete/insert shape the real
// packages/core/src/collab/text-to-yjs.ts's applyTextToYDoc uses, just
// without pulling in diff-match-patch as an undeclared dependency of this
// app package) so cursor-based Y.Text mutations behave exactly like the real
// collab layer's. `applyUpdate`/`getDoc` are the REAL Y.Doc CRDT merge —
// nothing about the merge semantics under test is faked.
// ---------------------------------------------------------------------------
const collabDocs = vi.hoisted(() => ({ docs: new Map<string, unknown>() }));
const collabTestControl = vi.hoisted(() => ({
  corruptNextValidatedApply: false,
}));

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

/** Minimal common-prefix/suffix-trim diff -> cursor-based Y.Text delete+insert. */
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
  applyText: async (
    docId: string,
    newText: string,
    _fieldName?: string,
    _requestSource?: string,
    options?: { validateSnapshot?: (snapshot: string) => void },
  ) => {
    const doc = getOrCreateDoc(docId);
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
    return snapshot;
  },
  seedFromText: async (docId: string, text: string) => {
    if (collabDocs.docs.has(docId)) return;
    const doc = getOrCreateDoc(docId);
    doc.getText("content").insert(0, text);
  },
  getDoc: async (docId: string) => getOrCreateDoc(docId),
  applyUpdate: async (docId: string, update: Uint8Array) => {
    Y.applyUpdate(getOrCreateDoc(docId), update);
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
  // Returning undefined makes drizzle's and(eq(...), accessFilter(...))
  // collapse to just the eq predicate — the fake matches() below only needs
  // the id filter, and real and() drops undefined operands.
  accessFilter: vi.fn().mockReturnValue(undefined),
}));

// update-file.ts imports isPostgres via the public "@agent-native/core/db"
// specifier (unlike the collab package's internal relative import), so this
// mock DOES intercept it: force the SQLite branch (no LOCK TABLE path).
vi.mock("@agent-native/core/db", () => ({
  isPostgres: () => false,
}));

// ---------------------------------------------------------------------------
// Minimal fake Drizzle app-DB layer: one `design_files` table backing store,
// supporting exactly the query shapes writeInlineSourceFile/
// resolveSourceWorkspace/readLiveSourceFile issue (select+where(+limit),
// update+set+where). Real `eq`/`and` from drizzle-orm build the same
// predicate objects the real query builder would receive; this fake just
// evaluates them structurally instead of compiling SQL.
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

const FILE_ID = "file_shader_container";
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

function matches(row: FileRow, predicate: Predicate): boolean {
  const p = predicate as unknown as {
    queryChunks?: unknown[];
    left?: { name?: string };
    right?: unknown;
  };
  // drizzle-orm's eq()/and() internal shape isn't a stable public API, so
  // rather than reverse-engineer it, just check the two fields our schema
  // actually filters on: id and designId. This fake only needs to support
  // the exact predicates writeInlineSourceFile/resolveSourceWorkspace issue.
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
    const withLimit = Object.assign(Promise.resolve(rows), {
      limit: (_n: number) => Promise.resolve(rows.slice(0, _n)),
    });
    return withLimit;
  };
  const db = {
    select: (_projection: unknown) => ({
      from: (_table: unknown) => ({
        where: whereBuilder,
        // update-file's access lookup joins designs for the accessFilter;
        // the join adds no row filtering the fake needs to model (every
        // seeded file row belongs to DESIGN_1), so pass through to where.
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
          // designs.updatedAt touch — no separate backing store needed for
          // this test, the design_files row is what we assert on.
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

/** A realistically large document (many sections) — the size the standalone
 * repro needed before diff-match-patch's Diff_Timeout-bounded diff stopped
 * cleanly resolving stale writes as a full replace and a client-style raw
 * ydoc rewrite (not a diff) started producing a genuinely corrupted,
 * doubled document when merged with a concurrent diff-based write. */
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

/** Always resolve the file reference fresh from the fake DB store, the same
 * way the real actions do via findSourceWorkspaceFile/resolveSourceWorkspace
 * — never a stale, hand-held `content` snapshot from an earlier step. */
function currentFileRef(): FileRow {
  const row = designFilesStore.rows.get(FILE_ID);
  if (!row) throw new Error("file not seeded");
  return { ...row };
}

beforeEach(() => {
  collabDocs.docs.clear();
  collabTestControl.corruptNextValidatedApply = false;
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

    // update-file's own persistence: content write + syncCollab applyText,
    // computed from the ALREADY-shader-mutated content (correct sequential
    // read-before-write — the baseline this bug's fix must preserve).
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

    // A concurrent write lands first (simulating update-file's Add-layer
    // commit landing between this caller's read and its own write).
    await writeInlineSourceFile({
      designId: DESIGN_ID,
      file: currentFileRef(),
      content: buildDoc(" data-an-layer-added"),
    });

    // The shader apply, still holding the FIRST (now-stale) versionHash, must
    // be rejected rather than blindly overwriting the concurrent edit.
    await expect(
      writeInlineSourceFile({
        designId: DESIGN_ID,
        file: currentFileRef(),
        content: buildDoc(' data-an-shader-fill="an-shader-1"'),
        expectedVersionHash: live.versionHash,
      }),
    ).rejects.toThrow(/changed since it was read/);

    // The concurrent edit must survive untouched — no partial/corrupted write.
    const finalContent = designFilesStore.rows.get(FILE_ID)!.content;
    assertWellFormed(finalContent);
    expect(finalContent).toContain("data-an-layer-added");
    expect(finalContent).not.toContain("data-an-shader-fill");
  });

  it("a diff-based collab write computed from a stale pre-shader base still leaves the document well-formed once it lands on the shader-mutated doc", async () => {
    // This is the actual reported repro shape: the shader's apply-source-edit
    // round trip (read -> transform -> write) completes and mutates the
    // collab doc FIRST. A base-style commit (update-file's syncCollab
    // applyText) that had already read the PRE-shader content and computed
    // its own diff-based patch against that stale base then lands on top.
    const preShaderLive = await readLiveSourceFile(currentFileRef());

    // Shader write lands (this is what apply-source-edit's writeInlineSourceFile
    // does end to end: re-read, hash-check, seed/applyText, persist SQL).
    await writeInlineSourceFile({
      designId: DESIGN_ID,
      file: currentFileRef(),
      content: buildDoc(
        ' data-an-shader-fill="an-shader-1" style="background:#59d9ff"',
      ),
      expectedVersionHash: preShaderLive.versionHash,
    });
    expect(await hasCollabState(FILE_ID)).toBe(true);

    // The stale Add-layer content was computed from preShaderLive.content
    // (BEFORE the shader write), exactly like a base style commit whose
    // queued update-file save was in flight while the shader mutation landed.
    const staleAddLayerContent = preShaderLive.content.replace(
      "background:#ffffff;",
      "background:#ffffff;background-image:linear-gradient(180deg,#fff,#fff);",
    );

    // update-file's syncCollab path calls applyText unconditionally — no
    // expectedVersionHash guard exists there (unlike apply-source-edit) — so
    // this stale, diff-based write proceeds and merges directly against the
    // now-shader-mutated live Y.Text.
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
    // Documents the OTHER real risk this exact ordering exposes: update-file
    // has no expectedVersionHash guard (unlike apply-source-edit), so its
    // diff-based write silently overwrites the shader's attribute here
    // instead of composing with it — a lost update, not corruption. Flagging
    // this explicitly rather than silently asserting on it as "expected"
    // behavior: closing this gap (giving update-file the same staleness
    // guard apply-source-edit already has) is a reasonable follow-up beyond
    // this ship-blocker's exact reproduced corruption.
    expect(finalLive.content.includes("data-an-shader-fill")).toBe(false);
    expect(finalLive.content).toContain("linear-gradient");
  });

  it("reproduces the exact reported corruption: a client-style raw ydoc rewrite racing a diff-based shader write on a realistically large document duplicates the content instead of converging", async () => {
    // This is the mechanism DesignEditor.tsx's GlslShaderPanel write-race
    // guard exists to prevent: the host's OWN client-side ydoc.transact
    // untracked full rewrite (applyLocalContentUpdate/commitVisualStyles —
    // "delete everything, insert nextContent", not a diff) is what the
    // browser pushes to the server as a binary Yjs update, separate from
    // update-file's server-side diff-based applyText call this spec's other
    // tests exercise. Simulated here directly against the real
    // getDoc/applyUpdate/applyText from @agent-native/core/collab.
    const largeBase = buildLargeDoc();
    seedFile(largeBase);

    const preShaderLive = await readLiveSourceFile(currentFileRef());
    expect(preShaderLive.content.length).toBe(largeBase.length);

    // Client A's local replica starts at the pre-shader base and does its
    // own untracked full-document rewrite for a base Fill "Add layer" /
    // "Remove layer" commit — exactly commitVisualStyles' ydoc.transact
    // shape — BEFORE the shader's server round trip has completed.
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

    // Meanwhile, the shader's apply-source-edit round trip completes on the
    // server FIRST: writeInlineSourceFile re-reads, hash-checks, and applies
    // its diff-based write to the SAME collab doc.
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

    // The client's already-computed raw update (from BEFORE the shader
    // write landed) now arrives at the server and gets merged into the
    // live doc via the real applyUpdate/getDoc — exactly what happens when
    // the browser's Yjs provider POSTs its pending update to
    // /_agent-native/collab/:docId/update.
    await applyUpdate(FILE_ID, clientUpdate, "network");

    const mergedDoc = await getDoc(FILE_ID);
    const merged = mergedDoc.getText("content").toString();

    // Without the write-race guard, this merge produces a corrupted, doubled
    // document: two full <!DOCTYPE>...</html> copies concatenated together
    // (verified length === shaderContent.length + addLayerContent.length).
    // This assertion documents the CORRUPTION SHAPE itself, so a regression
    // that reintroduces the race is caught here even if the guard elsewhere
    // is bypassed or removed.
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
    // The reported repro, with the server guard in place of luck: the shader
    // apply-source-edit lands first; a base Fill Add/Remove-layer save that
    // was computed from the PRE-shader content then arrives carrying the
    // pre-shader hash (what DesignEditor's saveFileContent now sends on
    // syncCollab saves). The server must reject it outright — no applyText
    // char-diff against the shader-mutated doc, no truncation, no lost
    // shader.
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

    // Both stores untouched by the rejected write: SQL row and live collab
    // text still hold the shader content, fully well-formed.
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

  it("checks the hash against LIVE collab text once collab state exists, not the SQL row", async () => {
    // Seed collab with content that diverges from SQL (a collab write whose
    // SQL mirror hasn't landed yet). The guard must compare against the live
    // text — the content applyText would actually diff against.
    const sqlContent = designFilesStore.rows.get(FILE_ID)!.content;
    const liveOnlyContent = buildDoc(" data-live-only");
    await applyText(FILE_ID, liveOnlyContent, "content", "agent");
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(sqlContent);

    // Hash of the SQL row (stale relative to live text) must be rejected...
    await expect(
      updateFileAction.run({
        id: FILE_ID,
        content: buildDoc(" data-next"),
        syncCollab: true,
        expectedVersionHash: sourceContentHash(sqlContent),
      } as never),
    ).rejects.toThrow(/changed since it was read/);

    // ...while the live text's hash is accepted.
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
  // PR review finding (bot, legitimate): expectedVersionHash was validated
  // BEFORE the per-file critical section update-file/writeInlineSourceFile
  // share. Two concurrent update-file callers could each read the same live
  // text, each pass the hash check, and then both proceed to write serially
  // — the second one silently winning over a base it never actually
  // re-validated against. The fix routes update-file's hash-check -> write ->
  // collab-sync section through the SAME withSourceFileWriteLock(fileId, ...)
  // primitive writeInlineSourceFile uses, so the second caller's hash check
  // now runs AFTER the first caller's write has fully landed.

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

    // Without the lock, both callers could observe the same live text, both
    // pass the hash check, and both write — this asserts the TOCTOU is
    // closed: only one of the two same-base writers may succeed.
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(
      ((rejected[0] as PromiseRejectedResult).reason as Error).message,
    ).toMatch(/changed since it was read/);

    // The persisted content must be EXACTLY the winner's content — never a
    // merge/corruption of both, and never silently overwritten by the loser.
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
      // Legacy caller: no expectedVersionHash, still today's last-write-wins
      // for the VALUE written, but the write itself must be serialized under
      // the same lock rather than interleaving with the guarded writer's own
      // read-check-write.
      updateFileAction.run({
        id: FILE_ID,
        content: legacyContent,
        syncCollab: true,
      } as never),
    ]);

    // The legacy caller never fails (it carries no guard), and the guarded
    // caller may either succeed (if it happened to run first) or fail loud
    // (if the legacy write landed first and invalidated its hash) — either
    // outcome is acceptable, corruption is not.
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const finalContent = designFilesStore.rows.get(FILE_ID)!.content;
    assertWellFormed(finalContent);
    // The persisted document must be exactly one writer's full content, never
    // an interleaved/partial merge of both.
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
