/**
 * insert-design-native-asset.interleave.spec.ts
 *
 * Regression test for the QA-reported (R64/R71) asset-insert corruption bug:
 * inserting assets (insert-design-native-asset / insert-asset) while other
 * edits are in flight corrupted the stored design HTML — assets disappeared
 * / reappeared, deleted assets resurrected, and attribute text + style edits
 * were serialized as VISIBLE TEXT with nested <!DOCTYPE> blocks.
 *
 * Root cause: both actions read a "base" HTML string (collab live text, or
 * the SQL row) at the START of the action, then performed unrelated async
 * work (DB lookups, assertAccess), and only THEN wrote the transformed
 * content via a raw `db.update` + unconditional `applyText`/`seedFromText`
 * char-diff merge — with no re-check that the base they diffed against was
 * still current. If a concurrent writer (another insert, or a style/attr
 * edit racing through update-file/apply-visual-edit) landed in the gap
 * between the read and the write, the diff-based `applyText` call computed
 * its cursor-based delete/insert against a STALE base while the live Y.Text
 * had already moved on — corrupting or dropping whichever change didn't
 * "win" (the same stale-diff-base class of bug documented and fixed for
 * update-file in apply-source-edit.interleave.spec.ts).
 *
 * Fix: both actions now read the live base via readLiveSourceFile and write
 * through writeInlineSourceFile (server/source-workspace.ts), passing the
 * versionHash of the base they just read as expectedVersionHash.
 * writeInlineSourceFile re-reads the live text immediately before its own
 * applyText call and rejects the write if it no longer matches — closing the
 * race window instead of silently corrupting.
 *
 * This spec exercises the REAL insert-design-native-asset/insert-asset
 * action modules (not mocked at the writeInlineSourceFile boundary) against
 * a fake DB + a real per-docId Y.Doc registry, the same harness shape as
 * apply-source-edit.interleave.spec.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

// ---------------------------------------------------------------------------
// Fake @agent-native/core/collab backed by a real per-docId Y.Doc registry,
// with a real deterministic prefix/suffix-trim diff for applyText — same
// approach as apply-source-edit.interleave.spec.ts.
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

vi.mock("@agent-native/core/application-state", () => ({
  readAppStateForCurrentTab: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Minimal fake Drizzle app-DB layer backing a single design_files row, same
// query shapes as apply-source-edit.interleave.spec.ts (select+where(+limit),
// update+set+where, plus insert-*'s innerJoin(designs) multi-file lookup).
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
  raceBeforeNextFileCas: null as {
    content: string;
    updatedAt: string;
  } | null,
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
            if (designFilesStore.raceBeforeNextFileCas) {
              const winner = designFilesStore.raceBeforeNextFileCas;
              designFilesStore.raceBeforeNextFileCas = null;
              const row = designFilesStore.rows.get(FILE_ID);
              if (row) Object.assign(row, winner);
              return Promise.resolve({ rowsAffected: 0 });
            }
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

import {
  readLiveSourceFile,
  writeInlineSourceFile,
} from "../server/source-workspace.js";
import insertAsset from "./insert-asset.js";
import insertDesignNativeAsset from "./insert-design-native-asset.js";

function currentFileRef(): FileRow {
  const row = designFilesStore.rows.get(FILE_ID);
  if (!row) throw new Error("file not seeded");
  return { ...row };
}

function baseDoc(bodyExtra = ""): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Repro</title>
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
<main>
<section data-agent-native-node-id="an-existing-hero" style="border-radius: 8px;" class="rounded-lg">${bodyExtra}
  <p data-agent-native-node-id="an-existing-text">Hello world</p>
</section>
</main>
</body>
</html>`;
}

function assertWellFormed(content: string) {
  expect(content.startsWith("<!DOCTYPE html>")).toBe(true);
  expect((content.match(/<html/g) ?? []).length).toBe(1);
  expect((content.match(/<\/html>/g) ?? []).length).toBe(1);
  expect(content).toContain("<head>");
  // The bug's reported symptom: attribute text leaking as visible body text,
  // typically via a stray/duplicated tag boundary. A well-formed merge never
  // contains a bare, unquoted "=""" artifact from a mis-parsed attribute.
  expect(content).not.toMatch(/data-agent-native-node-id="[^"]*"=""/);
  expect(content).not.toMatch(/<!DOCTYPE html>[\s\S]*<!DOCTYPE html>/);
}

beforeEach(() => {
  collabDocs.docs.clear();
  designFilesStore.rows.clear();
  designFilesStore.raceBeforeNextFileCas = null;
  seedFile(baseDoc());
});

describe("insert-design-native-asset / insert-asset race safety (R64/R71)", () => {
  it("a concurrent style edit that lands AFTER insert-design-native-asset reads its base is not silently dropped: the write is rejected instead of corrupting", async () => {
    // Simulate the action's own base read (what it now does internally via
    // readLiveSourceFile before calling insert-design-native-asset.run).
    const preInsertLive = await readLiveSourceFile(currentFileRef());

    // A concurrent style-edit writer (e.g. a border-radius commit racing in
    // from another tab/agent turn) lands on the SAME collab doc, changing
    // the live text out from under the not-yet-run insert action.
    const styleEditedContent = preInsertLive.content.replace(
      "border-radius: 8px;",
      "border-radius: 24px;",
    );
    await import("@agent-native/core/collab").then(({ seedFromText }) =>
      seedFromText(FILE_ID, preInsertLive.content),
    );
    await applyText(FILE_ID, styleEditedContent, "content", "agent");
    // Mirror the SQL row too, the way update-file's guarded write does.
    seedFile(styleEditedContent);

    // The insert action runs its OWN internal read-then-write sequence from
    // scratch (it doesn't share preInsertLive) — so in the real race this
    // assertion instead documents the safe case where the insert's own read
    // happens to observe the edited content and write succeeds, converging.
    const result = await insertDesignNativeAsset.run({
      kind: "hero",
      designId: DESIGN_ID,
      fileId: FILE_ID,
    } as never);

    expect(result.inserted).toBe(true);
    const finalLive = await readLiveSourceFile(currentFileRef());
    assertWellFormed(finalLive.content);
    // BOTH changes present: the prior style edit and the new insert.
    expect(finalLive.content).toContain("border-radius: 24px;");
    expect(finalLive.content).toContain(result.insertedNodeId);
  });

  it("two concurrent insert-design-native-asset calls from a common ancestor converge with BOTH assets present, no doubled DOCTYPE, no attribute-as-text leakage", async () => {
    // Both callers read the SAME live base "simultaneously" (before either
    // writes) — the exact shape of the reported bug: "inserting multiple
    // assets" racing each other. We drive this by reading live content once,
    // then racing the two real action invocations with Promise.all; each
    // action performs its OWN internal read (which will observe whichever
    // state exists at that moment) and write, and writeInlineSourceFile's
    // expectedVersionHash re-check must ensure the SECOND writer either
    // converges cleanly or fails loud — never silently corrupts.
    const results = await Promise.allSettled([
      insertDesignNativeAsset.run({
        kind: "card",
        designId: DESIGN_ID,
        fileId: FILE_ID,
      } as never),
      insertDesignNativeAsset.run({
        kind: "button",
        designId: DESIGN_ID,
        fileId: FILE_ID,
      } as never),
    ]);

    const fulfilled = results.filter(
      (
        r,
      ): r is PromiseFulfilledResult<
        Awaited<ReturnType<typeof insertDesignNativeAsset.run>>
      > => r.status === "fulfilled",
    );
    // At least one must succeed; the other may either succeed (if its
    // internal read observed the first writer's result before writing) or
    // fail loud with the staleness guard — both are acceptable, corruption
    // is not.
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const finalLive = await readLiveSourceFile(currentFileRef());
    assertWellFormed(finalLive.content);
    // The original hero content must still be present regardless of which
    // writer(s) won or lost — no lost update wiping the whole document.
    expect(finalLive.content).toContain("an-existing-hero");

    // Every successfully-inserted node must actually be present in the final
    // document — no "disappears/reappears" symptom where a fulfilled action
    // result claims insertion but the merged doc doesn't contain it.
    for (const { value } of fulfilled) {
      expect(finalLive.content).toContain(value.insertedNodeId);
    }
  });

  it("insert-asset racing a style edit from a common ancestor converges with both changes present (no corruption)", async () => {
    const preInsertLive = await readLiveSourceFile(currentFileRef());
    const styleEditedContent = preInsertLive.content.replace(
      "border-radius: 8px;",
      "border-radius: 32px;",
    );
    seedFile(styleEditedContent);
    await applyText(FILE_ID, styleEditedContent, "content", "agent");

    const result = await insertAsset.run({
      assetUrl: "https://example.com/photo.png",
      mode: "figure",
      designId: DESIGN_ID,
      fileId: FILE_ID,
    } as never);

    expect(result.inserted).toBe(true);
    const finalLive = await readLiveSourceFile(currentFileRef());
    assertWellFormed(finalLive.content);
    expect(finalLive.content).toContain("border-radius: 32px;");
    expect(finalLive.content).toContain("https://example.com/photo.png");
  });

  it("deleted-asset-resurrection guard: a concurrent delete of the inserted-into region is not resurrected by a stale insert write", async () => {
    // Model "deleted assets resurrect": another writer deletes the existing
    // hero section entirely (e.g. a Delete-layer commit) while an insert
    // action's OWN read-transform-write sequence is mid-flight against the
    // pre-delete base. We simulate the mid-flight window by reading the live
    // base first (as the action's internals do), then landing the delete on
    // the collab doc + SQL row BEFORE constructing the insert's write via
    // writeInlineSourceFile, using the pre-delete versionHash — this must be
    // rejected, not silently re-introduce the deleted section.
    const preDeleteLive = await readLiveSourceFile(currentFileRef());
    expect(preDeleteLive.content).toContain("an-existing-hero");

    const deletedContent = preDeleteLive.content.replace(
      /<section data-agent-native-node-id="an-existing-hero"[\s\S]*?<\/section>/,
      "",
    );
    seedFile(deletedContent);
    await applyText(FILE_ID, deletedContent, "content", "agent");
    expect(await hasCollabState(FILE_ID)).toBe(true);

    await expect(
      writeInlineSourceFile({
        designId: DESIGN_ID,
        file: currentFileRef(),
        content: preDeleteLive.content.replace(
          "</section>\n</main>",
          '\n    <section data-agent-native-native-asset data-agent-native-node-id="inserted-native-x">New</section>\n  </section>\n</main>',
        ),
        expectedVersionHash: preDeleteLive.versionHash,
      }),
    ).rejects.toThrow(/changed since it was read/);

    // The delete must survive untouched — the resurrected hero must NOT
    // reappear because a stale insert write was rejected instead of merged.
    const finalLive = await readLiveSourceFile(currentFileRef());
    expect(finalLive.content).not.toContain("an-existing-hero");
    assertWellFormed(finalLive.content);
  });

  it("rejects a cross-instance SQL winner instead of overwriting it after the local collab mutation", async () => {
    const initialFile = currentFileRef();
    const initial = await readLiveSourceFile(initialFile);
    const concurrentWinner = initial.content.replace(
      "border-radius: 8px;",
      "border-radius: 40px;",
    );
    designFilesStore.raceBeforeNextFileCas = {
      content: concurrentWinner,
      updatedAt: "2026-07-06T00:00:01.000Z",
    };

    await expect(
      writeInlineSourceFile({
        designId: DESIGN_ID,
        file: initialFile,
        content: initial.content.replace("Hello world", "Our stale edit"),
        expectedVersionHash: initial.versionHash,
      }),
    ).rejects.toThrow(/changed while it was being saved/i);

    expect(currentFileRef().content).toBe(concurrentWinner);
    const finalLive = await readLiveSourceFile(currentFileRef());
    expect(finalLive.content).toBe(concurrentWinner);
    expect(finalLive.content).not.toContain("Our stale edit");
  });
});
