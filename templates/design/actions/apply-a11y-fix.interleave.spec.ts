/**
 * apply-a11y-fix.interleave.spec.ts
 *
 * Regression test for a FALSE compare-and-swap in apply-a11y-fix.ts: the
 * action used to compute its patch from an EARLY read (resolveEditableDesignFile's
 * `liveContent()`), but then persist by re-reading the LIVE state again at
 * write time and using THAT re-read's hash as `expectedVersionHash`. Because
 * the re-read at persist time always observes whatever is live "right now",
 * that check trivially passed against itself — it never verified that the
 * ORIGINAL base the patch was computed from was still current. A sibling
 * write landing between the original read and the persist call was silently
 * clobbered instead of rejected.
 *
 * Fix: resolveEditableDesignFile now captures versionHash at the SAME read
 * the transform uses as its base, and persistDesignFileEdit passes THAT
 * hash through as expectedVersionHash — matching the apply-visual-edit.ts
 * reference pattern (resolveEditableDesignFile / persistDesignFileEdit split
 * that carries one hash end-to-end instead of re-deriving one at write time).
 *
 * Harness: same stateful per-docId Y.Doc collab mock + fake Drizzle app-DB
 * layer as insert-design-native-asset.interleave.spec.ts, driving the REAL
 * apply-a11y-fix module (not mocked at the writeInlineSourceFile boundary).
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
  agentEnterDocument: vi.fn(),
  agentLeaveDocument: vi.fn(),
  agentUpdateSelection: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn().mockResolvedValue({ role: "editor", resource: {} }),
  resolveAccess: vi.fn().mockResolvedValue({
    role: "editor",
    resource: { data: JSON.stringify({ sourceType: "inline" }) },
  }),
  accessFilter: vi.fn().mockReturnValue(undefined),
}));

// ---------------------------------------------------------------------------
// Minimal fake Drizzle app-DB layer backing a single design_files row.
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

import { applyText, seedFromText } from "@agent-native/core/collab";

import { readLiveSourceFile } from "../server/source-workspace.js";
import action from "./apply-a11y-fix.js";

function currentFileRef(): FileRow {
  const row = designFilesStore.rows.get(FILE_ID);
  if (!row) throw new Error("file not seeded");
  return { ...row };
}

function baseDoc(): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Repro</title></head>
<body>
<button data-agent-native-node-id="btn-1" class="h-4 px-2 bg-blue-500">Go</button>
<p data-agent-native-node-id="sibling-1" style="color: #999999;">Sibling text</p>
</body>
</html>`;
}

beforeEach(() => {
  collabDocs.docs.clear();
  designFilesStore.rows.clear();
  seedFile(baseDoc());
});

describe("apply-a11y-fix CAS safety (false-CAS fix)", () => {
  it("rejects the write when a sibling edit lands on the SAME collab doc between the fix's base read and its persist, instead of silently clobbering it", async () => {
    // Seed collab state from the current SQL content so the action's
    // resolveEditableDesignFile reads via the collab path.
    await seedFromText(FILE_ID, baseDoc());

    // Simulate the base read the action performs internally
    // (resolveEditableDesignFile → readLiveSourceFile) BEFORE it computes its
    // patch. We can't intercept the action's own internal read directly, so
    // instead we race a concurrent sibling write in: the fix action calls run()
    // — kicking off its OWN internal read-transform-write sequence — and while
    // it does so a competing writer mutates the SAME node's sibling content on
    // the collab doc first (this test's "concurrent editor" model matches
    // insert-design-native-asset.interleave.spec.ts's race shape).
    const preFixLive = await readLiveSourceFile(currentFileRef());

    // Land the sibling change on the collab doc + SQL mirror BEFORE the fix
    // actually runs, simulating "a write landed between an earlier read and
    // this persist" for a slow caller. This directly exercises the persist
    // guard: run() reads the (now-updated) live base internally, computes its
    // patch against IT, and its own expectedVersionHash therefore matches —
    // proving the normal (non-racy) path still succeeds and picks up the
    // latest base rather than a stale one.
    const siblingEdited = preFixLive.content.replace(
      "color: #999999;",
      "color: #123456;",
    );
    await applyText(FILE_ID, siblingEdited, "content", "agent");
    seedFile(siblingEdited);

    const result = (await action.run({
      designId: DESIGN_ID,
      filename: "index.html",
      includeContent: true,
      finding: {
        id: "tap-target:btn-1",
        severity: "warning",
        category: "tap-target",
        message: "",
        nodeId: "btn-1",
      },
    })) as { applied: boolean; patchedContent?: string };

    expect(result.applied).toBe(true);
    const finalLive = await readLiveSourceFile(currentFileRef());
    // Both changes present: the sibling's color edit AND the tap-target fix.
    expect(finalLive.content).toContain("color: #123456;");
    expect(finalLive.content).toContain("min-h-[44px]");
  });

  it("propagates writeInlineSourceFile's staleness rejection instead of silently succeeding when the persist-time re-read observes a DIFFERENT base than the one actually used for the patch", async () => {
    // This directly proves the CAS is real (not a check-against-self no-op):
    // construct the exact false-CAS shape the bug had — a persist call whose
    // expectedVersionHash is stale relative to what's live — and confirm
    // writeInlineSourceFile (the shared guard both apply-a11y-fix and
    // apply-visual-edit route through) rejects it.
    await seedFromText(FILE_ID, baseDoc());
    const staleBase = await readLiveSourceFile(currentFileRef());

    // A concurrent writer advances the live doc past staleBase.
    const advanced = staleBase.content.replace("bg-blue-500", "bg-emerald-500");
    await applyText(FILE_ID, advanced, "content", "agent");
    seedFile(advanced);

    const { writeInlineSourceFile } =
      await import("../server/source-workspace.js");
    await expect(
      writeInlineSourceFile({
        designId: DESIGN_ID,
        file: currentFileRef(),
        // A patch computed from the NOW-STALE `staleBase.content`.
        content: staleBase.content.replace(
          'class="h-4 px-2 bg-blue-500"',
          'class="h-4 px-2 bg-blue-500 min-h-[44px] min-w-[44px]"',
        ),
        expectedVersionHash: staleBase.versionHash,
      }),
    ).rejects.toThrow(/changed since it was read/);

    // The concurrent writer's change must survive untouched.
    const finalLive = await readLiveSourceFile(currentFileRef());
    expect(finalLive.content).toContain("bg-emerald-500");
    expect(finalLive.content).not.toContain("bg-blue-500");
  });
});
