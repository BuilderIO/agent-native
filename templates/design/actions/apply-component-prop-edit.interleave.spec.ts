/**
 * apply-component-prop-edit.interleave.spec.ts
 *
 * Regression test for a FALSE compare-and-swap in
 * apply-component-prop-edit.ts's persistEdit helper: the action computed its
 * patch from `html` (source.currentContent or the SQL row read earlier in
 * run()), but persisted by re-reading the LIVE state again inside persistEdit
 * and using THAT re-read's hash as `expectedVersionHash`. Since the re-read
 * happens right before the write, it always matches "whatever is live now"
 * trivially — it never actually proved that `html` (the real transform base)
 * was still current. A sibling write landing between the read of `html` and
 * the persist call was silently clobbered instead of rejected.
 *
 * Fix: run() now computes `baseVersionHash = sourceContentHash(html)` at the
 * SAME point `html` is read/resolved (the actual transform base), and
 * persistEdit passes THAT hash through as expectedVersionHash instead of
 * re-deriving one at write time — matching apply-visual-edit.ts's
 * resolveEditableDesignFile / persistDesignFileEdit split.
 *
 * Harness: same stateful per-docId Y.Doc collab mock + fake Drizzle app-DB
 * layer as insert-design-native-asset.interleave.spec.ts / apply-a11y-fix
 * .interleave.spec.ts, driving the REAL apply-component-prop-edit module.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

// ---------------------------------------------------------------------------
// Fake @agent-native/core/collab backed by a real per-docId Y.Doc registry.
// ---------------------------------------------------------------------------
const collabDocs = vi.hoisted(() => ({ docs: new Map<string, unknown>() }));
const accessState = vi.hoisted(() => ({ sourceType: "inline" }));

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
  resolveAccess: vi.fn(async () => ({
    role: "editor",
    resource: { data: JSON.stringify({ sourceType: accessState.sourceType }) },
  })),
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
import action from "./apply-component-prop-edit.js";

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
<button data-agent-native-node-id="btn-1" data-agent-native-component="Button" class="bg-blue-500 px-4 py-2">Save</button>
<p data-agent-native-node-id="sibling-1" style="color: #999999;">Sibling text</p>
</body>
</html>`;
}

beforeEach(() => {
  collabDocs.docs.clear();
  designFilesStore.rows.clear();
  accessState.sourceType = "inline";
  seedFile(baseDoc());
});

describe("apply-component-prop-edit CAS safety (false-CAS fix)", () => {
  it("fails closed for localhost sources without touching the SQL HTML mirror", async () => {
    accessState.sourceType = "localhost";
    const original = currentFileRef().content;

    const result = await action.run({
      designId: DESIGN_ID,
      nodeId: "btn-1",
      edit: { kind: "classReplace", from: "bg-blue-500", to: "bg-red-500" },
    } as never);

    expect(result).toMatchObject({
      sourceType: "localhost",
      persisted: false,
      ctaRequired: true,
    });
    expect(result.ctaMessage).toMatch(/dedicated consented/i);
    expect(currentFileRef().content).toBe(original);
    expect(collabDocs.docs.size).toBe(0);
  });

  it("succeeds and preserves a sibling's concurrent edit when the action's own read observes the latest base (no clobber of a landed sibling write)", async () => {
    await seedFromText(FILE_ID, baseDoc());

    // A sibling edit lands on the collab doc + SQL mirror before the prop
    // edit action runs (its own internal DB read will observe this).
    const preEditLive = await readLiveSourceFile(currentFileRef());
    const siblingEdited = preEditLive.content.replace(
      "color: #999999;",
      "color: #123456;",
    );
    await applyText(FILE_ID, siblingEdited, "content", "agent");
    seedFile(siblingEdited);

    const result = (await action.run({
      designId: DESIGN_ID,
      nodeId: "btn-1",
      edit: { kind: "classReplace", from: "bg-blue-500", to: "bg-red-500" },
    } as never)) as { persisted: boolean; content: string };

    expect(result.persisted).toBe(true);
    const finalLive = await readLiveSourceFile(currentFileRef());
    expect(finalLive.content).toContain("color: #123456;");
    expect(finalLive.content).toContain("bg-red-500");
  });

  it("preserves an unsaved caller working copy when its revision still matches the unchanged live base", async () => {
    const workingCopy = baseDoc().replace(
      "Sibling text",
      "Sibling text (unsaved locally)",
    );

    const result = (await action.run({
      designId: DESIGN_ID,
      nodeId: "btn-1",
      edit: { kind: "classReplace", from: "bg-blue-500", to: "bg-red-500" },
      source: {
        currentContent: workingCopy,
        revision: "2026-07-06T00:00:00.000Z",
      },
    } as never)) as { persisted: boolean };

    expect(result.persisted).toBe(true);
    const finalLive = await readLiveSourceFile(currentFileRef());
    expect(finalLive.content).toContain("Sibling text (unsaved locally)");
    expect(finalLive.content).toContain("bg-red-500");
  });

  it("rejects a persist whose expectedVersionHash is stale relative to what's live, instead of silently overwriting the concurrent writer's change", async () => {
    // Prove the CAS is a real check (not a check-against-self no-op): build
    // the exact false-CAS shape the bug had directly against
    // writeInlineSourceFile, the shared guard persistEdit routes through.
    await seedFromText(FILE_ID, baseDoc());
    const staleBase = await readLiveSourceFile(currentFileRef());

    const advanced = staleBase.content.replace("bg-blue-500", "bg-emerald-500");
    await applyText(FILE_ID, advanced, "content", "agent");
    seedFile(advanced);

    const { writeInlineSourceFile } =
      await import("../server/source-workspace.js");
    await expect(
      writeInlineSourceFile({
        designId: DESIGN_ID,
        file: currentFileRef(),
        // A patch computed from the NOW-STALE staleBase.content (simulating
        // persistEdit receiving a stale caller-supplied expectedVersionHash).
        content: staleBase.content.replace(
          'data-agent-native-prop-label="Save"',
          'data-agent-native-prop-label="Saved"',
        ),
        expectedVersionHash: staleBase.versionHash,
      }),
    ).rejects.toThrow(/changed since it was read/);

    const finalLive = await readLiveSourceFile(currentFileRef());
    expect(finalLive.content).toContain("bg-emerald-500");
    expect(finalLive.content).not.toContain("bg-blue-500");
  });

  it("classReplace edit persists and is reflected in the live collab doc, not just the returned content", async () => {
    await seedFromText(FILE_ID, baseDoc());

    const result = (await action.run({
      designId: DESIGN_ID,
      nodeId: "btn-1",
      edit: { kind: "classReplace", from: "bg-blue-500", to: "bg-purple-600" },
    } as never)) as { persisted: boolean };

    expect(result.persisted).toBe(true);
    const finalLive = await readLiveSourceFile(currentFileRef());
    expect(finalLive.content).toContain("bg-purple-600");
    expect(finalLive.content).not.toContain("bg-blue-500");
  });
});
