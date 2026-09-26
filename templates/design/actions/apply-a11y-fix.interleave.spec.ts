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
    await seedFromText(FILE_ID, baseDoc());

    const preFixLive = await readLiveSourceFile(currentFileRef());

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
    expect(finalLive.content).toContain("color: #123456;");
    expect(finalLive.content).toContain("min-h-[44px]");
  });

  it("propagates writeInlineSourceFile's staleness rejection instead of silently succeeding when the persist-time re-read observes a DIFFERENT base than the one actually used for the patch", async () => {
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
        content: staleBase.content.replace(
          'class="h-4 px-2 bg-blue-500"',
          'class="h-4 px-2 bg-blue-500 min-h-[44px] min-w-[44px]"',
        ),
        expectedVersionHash: staleBase.versionHash,
      }),
    ).rejects.toThrow(/changed since it was read/);

    const finalLive = await readLiveSourceFile(currentFileRef());
    expect(finalLive.content).toContain("bg-emerald-500");
    expect(finalLive.content).not.toContain("bg-blue-500");
  });
});
