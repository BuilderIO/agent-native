import { and, eq } from "drizzle-orm";
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
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn().mockResolvedValue({ role: "editor", resource: {} }),
  resolveAccess: vi.fn().mockResolvedValue({
    role: "editor",
    resource: { data: JSON.stringify({ sourceType: "inline" }) },
  }),
  accessFilter: vi.fn().mockReturnValue(undefined),
}));

const snapshotDesignBeforeAgentEditMock = vi.hoisted(() =>
  vi.fn(async () => null as unknown),
);
vi.mock("../server/lib/design-versions.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/design-versions.js")
  >()),
  snapshotDesignBeforeAgentEdit: snapshotDesignBeforeAgentEditMock,
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
    execute: async () => ({ rows: [], rowsAffected: 1 }),
    transaction: async (callback: (tx: typeof db) => Promise<unknown>) =>
      callback(db),
    select: (_projection: unknown) => ({
      from: (table: unknown) => ({
        where: (predicate: Predicate) => {
          if (table === schema.designs) {
            return Object.assign(Promise.resolve([]), {
              limit: (n: number) => Promise.resolve([]),
            });
          }
          return fileWhereBuilder(predicate);
        },
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
import { assertAccess } from "@agent-native/core/sharing";

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
  snapshotDesignBeforeAgentEditMock.mockReset();
  snapshotDesignBeforeAgentEditMock.mockResolvedValue(null);
  seedFile(buildDoc());
});

describe("update-file: expectedVersionHash / syncCollab regression baseline", () => {
  it("rejects malformed managed-style HTML before SQL or collab mutation", async () => {
    const before = buildDoc();
    const malformed = before.replace(
      "</head>",
      'data-agent-native-breakpoints">@media (max-width: 1279px) { [data-agent-native-node-id="an-node-1"] { color: red; } }</style></head>',
    );

    await expect(
      updateFileAction.run({
        id: FILE_ID,
        content: malformed,
        syncCollab: true,
        expectedVersionHash: sourceContentHash(before),
      } as never),
    ).rejects.toThrow(/DESIGN_HTML_INTEGRITY/);

    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(before);
    expect(await hasCollabState(FILE_ID)).toBe(false);
  });

  it("preserves a URL-backed screen across a rejected route-plus-subtree write and reload", async () => {
    const routeUrl = "http://localhost:8210/dashboard";
    const corruptingWrite =
      `${routeUrl}<section data-agent-native-node-id="group">` +
      "<p>Nested layer</p></section>";
    seedFile(routeUrl);

    await expect(
      updateFileAction.run({
        id: FILE_ID,
        content: corruptingWrite,
        syncCollab: true,
        expectedVersionHash: sourceContentHash(routeUrl),
      } as never),
    ).rejects.toThrow(/DESIGN_HTML_INTEGRITY/);

    const reloadedContent = designFilesStore.rows.get(FILE_ID)!.content;
    expect(reloadedContent).toBe(routeUrl);
    expect(reloadedContent).not.toContain("data-agent-native-node-id");
    expect(await hasCollabState(FILE_ID)).toBe(false);
  });

  it("1. no expectedVersionHash provided at all: content write proceeds exactly as before", async () => {
    const next = buildDoc(" changed-");
    const result = await updateFileAction.run({
      id: FILE_ID,
      content: next,
      // expectedVersionHash intentionally omitted.
    } as never);

    expect(result).toEqual({ id: FILE_ID, updated: true });
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(next);
    expect(await hasCollabState(FILE_ID)).toBe(true);
  });

  it("2. syncCollab:true (default) + mismatched hash: still throws, not skipped", async () => {
    await applyText(FILE_ID, buildDoc(" live-edit-"), "content", "agent");
    const staleHash = sourceContentHash(buildDoc());

    let rejection: unknown = null;
    try {
      await updateFileAction.run({
        id: FILE_ID,
        content: buildDoc(" caller-stale-"),
        syncCollab: true,
        expectedVersionHash: staleHash,
      } as never);
    } catch (error) {
      rejection = error;
    }
    expect((rejection as Error)?.message).toMatch(/changed since it was read/);
    expect((rejection as { statusCode?: number })?.statusCode).toBe(409);

    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(buildDoc());
  });

  it("3. syncCollab:false + mismatched hash + collab state EXISTS: returns skippedStaleMirror:true, SQL content NOT overwritten", async () => {
    await applyText(FILE_ID, buildDoc(" live-edit-"), "content", "agent");
    designFilesStore.rows.get(FILE_ID)!.content = buildDoc(" mirror-advanced-");
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
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(sqlContentBefore);
    expect(designFilesStore.rows.get(FILE_ID)!.content).not.toContain(
      "caller-stale-mirror-",
    );
    const liveText = getOrCreateDoc(FILE_ID).getText("content").toString();
    expect(liveText).toContain("live-edit-");
    expect(liveText).not.toContain("caller-stale-mirror-");
  });

  it("4. syncCollab:false + mismatched hash + collab state does NOT exist (SQL-only file): falls through to throw-loud behavior", async () => {
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
    const liveText = getOrCreateDoc(FILE_ID).getText("content").toString();
    expect(liveText).not.toBe(next);
  });

  it("6a. filename-only update alongside a stale-mirror-skip case: filename still applies while content is skipped", async () => {
    await applyText(FILE_ID, buildDoc(" live-edit-"), "content", "agent");
    designFilesStore.rows.get(FILE_ID)!.content = buildDoc(" mirror-advanced-");
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
    expect(designFilesStore.rows.get(FILE_ID)!.filename).toBe("renamed.html");
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

    expect(designFilesStore.rows.get(FILE_ID)!.filename).toBe("index.html");
  });

  it("7. syncCollab:false + mismatched hash BUT live collab text already equals the content being written (own edit raced ahead via Yjs): writes normally, not skipped", async () => {
    const next = buildDoc(" own-edit-already-landed-via-yjs-");
    await applyText(FILE_ID, next, "content", "agent");
    const staleHash = sourceContentHash(buildDoc());

    const result = await updateFileAction.run({
      id: FILE_ID,
      content: next,
      syncCollab: false,
      expectedVersionHash: staleHash,
    } as never);

    expect(result).toEqual({ id: FILE_ID, updated: true });
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(next);
  });

  it("8. syncCollab:false + mismatched hash + live text DIFFERS from content being written (genuine concurrent editor): still skipped, own-edit fast-path does not weaken the real guard", async () => {
    await applyText(
      FILE_ID,
      buildDoc(" a-different-editors-edit-"),
      "content",
      "agent",
    );
    designFilesStore.rows.get(FILE_ID)!.content = buildDoc(" mirror-advanced-");
    const staleHash = sourceContentHash(buildDoc());
    const sqlContentBefore = designFilesStore.rows.get(FILE_ID)!.content;

    const result = await updateFileAction.run({
      id: FILE_ID,
      content: buildDoc(" callers-own-different-content-"),
      syncCollab: false,
      expectedVersionHash: staleHash,
    } as never);

    expect(result).toEqual({
      id: FILE_ID,
      updated: true,
      skippedStaleMirror: true,
    });
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(sqlContentBefore);
  });

  it("9. delayed client updates converge after two mirror-only SQL saves", async () => {
    const server = getOrCreateDoc(FILE_ID);
    server.getText("content").insert(0, buildDoc());
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server), "remote");
    const delayed: Uint8Array[] = [];
    client.on("update", (update: Uint8Array) => delayed.push(update));

    const editOne = buildDoc(" edit-one-");
    applyTextDiff(client, editOne);
    await updateFileAction.run({
      id: FILE_ID,
      content: editOne,
      syncCollab: false,
      expectedVersionHash: sourceContentHash(buildDoc()),
    } as never);
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(editOne);
    expect(server.getText("content").toString()).toBe(buildDoc());

    const editTwo = buildDoc(" edit-one-and-two-");
    applyTextDiff(client, editTwo);
    const result = await updateFileAction.run({
      id: FILE_ID,
      content: editTwo,
      syncCollab: false,
      expectedVersionHash: sourceContentHash(editOne),
    } as never);
    expect(result).toEqual({ id: FILE_ID, updated: true });
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(editTwo);

    for (const update of delayed) Y.applyUpdate(server, update, "remote");
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server), "remote");
    expect(server.getText("content").toString()).toBe(editTwo);
    expect(client.getText("content").toString()).toBe(editTwo);
    client.destroy();
  });

  it("10. caller matching NEITHER the mirror NOR the live text (genuinely stale writer): still skipped", async () => {
    await applyText(FILE_ID, buildDoc(" live-edit-"), "content", "agent");
    designFilesStore.rows.get(FILE_ID)!.content = buildDoc(" mirror-advanced-");
    const sqlContentBefore = designFilesStore.rows.get(FILE_ID)!.content;
    const staleHash = sourceContentHash(buildDoc());

    const result = await updateFileAction.run({
      id: FILE_ID,
      content: buildDoc(" genuinely-stale-caller-"),
      syncCollab: false,
      expectedVersionHash: staleHash,
    } as never);

    expect(result).toEqual({
      id: FILE_ID,
      updated: true,
      skippedStaleMirror: true,
    });
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(sqlContentBefore);
    const liveText = getOrCreateDoc(FILE_ID).getText("content").toString();
    expect(liveText).toContain("live-edit-");
    expect(liveText).not.toContain("genuinely-stale-caller-");
  });

  it("11. mirror-tip caller preserves a divergent live document while advancing SQL", async () => {
    await applyText(
      FILE_ID,
      buildDoc(" other-editors-live-only-edit-"),
      "content",
      "agent",
    );
    const mirrorState = buildDoc(" mirror-state-");
    designFilesStore.rows.get(FILE_ID)!.content = mirrorState;

    const callerContent = buildDoc(" mirror-state-plus-mine-");
    const result = await updateFileAction.run({
      id: FILE_ID,
      content: callerContent,
      syncCollab: false,
      expectedVersionHash: sourceContentHash(mirrorState),
    } as never);

    expect(result).toEqual({ id: FILE_ID, updated: true });
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(callerContent);

    expect(getOrCreateDoc(FILE_ID).getText("content").toString()).toBe(
      buildDoc(" other-editors-live-only-edit-"),
    );
  });

  it("12. delete-race after the access lookup: inner missing-file guard returns 404 (not a bare 500) so the outbox drops it", async () => {
    vi.mocked(assertAccess).mockImplementationOnce(async () => {
      designFilesStore.rows.clear();
      return { role: "editor", resource: {} } as never;
    });

    let rejection: unknown = null;
    try {
      await updateFileAction.run({
        id: FILE_ID,
        content: buildDoc(" delete-race-"),
        syncCollab: true,
      } as never);
    } catch (error) {
      rejection = error;
    }

    expect((rejection as Error)?.message).toMatch(/file not found/i);
    expect((rejection as { statusCode?: number })?.statusCode).toBe(404);
  });
});

describe("update-file: editor-surface checkpoint skip surfaces in the result", () => {
  it("includes checkpoint: {skipped, reason} when the auxiliary version checkpoint failed, and the write still lands", async () => {
    snapshotDesignBeforeAgentEditMock.mockResolvedValue({
      skipped: true,
      reason: "blob-storage-unavailable",
    });

    const result = await updateFileAction.run(
      {
        id: FILE_ID,
        content: buildDoc(" checkpoint-skip-"),
        syncCollab: true,
        expectedVersionHash: sourceContentHash(buildDoc()),
      } as never,
      { caller: "frontend", actionName: "update-file" } as never,
    );

    expect(result).toMatchObject({
      id: FILE_ID,
      updated: true,
      checkpoint: {
        skipped: true,
        reason: "blob-storage-unavailable",
      },
    });
    expect(designFilesStore.rows.get(FILE_ID)!.content).toBe(
      buildDoc(" checkpoint-skip-"),
    );
    expect(snapshotDesignBeforeAgentEditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { allowCheckpointFailureSkip: true },
    );
  });

  it("omits checkpoint entirely when the version was captured normally", async () => {
    snapshotDesignBeforeAgentEditMock.mockResolvedValue({
      id: "design-version-1",
      createdAt: "2026-09-01T00:00:00.000Z",
      label: "Before editor edit",
    });

    const result = await updateFileAction.run(
      {
        id: FILE_ID,
        content: buildDoc(" checkpoint-ok-"),
        syncCollab: true,
        expectedVersionHash: sourceContentHash(buildDoc()),
      } as never,
      { caller: "frontend", actionName: "update-file" } as never,
    );

    expect(result).not.toHaveProperty("checkpoint");
  });
});
