import { applyTextToYDoc } from "@agent-native/core/collab";
import { expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { PendingLocalFileContent } from "@/pages/design-editor/editor-state";

import { runAdoptDbFileContent } from "./adopt-db-file-content";
import { runObserveCollabText } from "./observe-collab-text";
import { runSeedCollabContent } from "./seed-collab-content";

const fileId = "screen-b";
const before =
  '<!doctype html><html data-agent-native-node-id="html"><head></head><body data-agent-native-node-id="body"></body></html>';
const next = before
  .replace("doctype", "DOCTYPE")
  .replace(
    "</body>",
    '<button data-agent-native-node-id="copy">Paste</button></body>',
  );

function makeSeedHarness(ydoc: Y.Doc) {
  const ref = <T>(current: T) => ({ current });
  const pendingLocalFileContentsRef = ref(
    new Map<string, PendingLocalFileContent>(),
  );
  const latestActiveContentRef = ref<string | null>(before);
  const lastLocalContentRef = ref<string | null>(before);
  const lastAppliedFileContentRef = ref<string | null>(null);
  const lastAppliedFileUpdatedAtRef = ref<string | null>(null);
  const collabContentFileIdRef = ref<string | null>(null);
  const documentFileContentRef = ref<string | null>(next);
  const documentFileUpdatedAtRef = ref<string | null>(
    "2026-09-15T00:00:02.000Z",
  );
  let collabContent: string | null = before;
  let collabFileId: string | null = null;
  let painted: string | null = before;
  const publishCanonicalContent = vi.fn((_id: string, content: string) => {
    pendingLocalFileContentsRef.current.set(_id, {
      content,
      startedAt: Date.now(),
    });
    return content;
  });
  const setCollabContent = (
    value: string | null | ((value: string | null) => string | null),
  ) => {
    collabContent = typeof value === "function" ? value(collabContent) : value;
  };
  const setCollabContentFileId = (
    value: string | null | ((value: string | null) => string | null),
  ) => {
    collabFileId = typeof value === "function" ? value(collabFileId) : value;
    collabContentFileIdRef.current = collabFileId;
  };
  const args = {
    activeFile: {
      id: fileId,
      filename: "screen-b.html",
      fileType: "html",
      content: next,
      createdAt: "2026-09-15T00:00:00.000Z",
      updatedAt: "2026-09-15T00:00:02.000Z",
    },
    activeFileId: fileId,
    agentActive: false,
    fileType: "html",
    clearStaleAgentCollabRecovery: vi.fn(),
    collabContent: before,
    collabContentFileId: fileId,
    collabContentFileIdRef,
    collabContentRef: ref(before),
    documentFileContentRef,
    documentFileUpdatedAtRef,
    isSynced: true,
    lastAppliedFileContentRef,
    lastAppliedFileUpdatedAtRef,
    lastLocalContentRef,
    latestActiveContentRef,
    pendingLocalFileContentsRef,
    publishCanonicalContent,
    recordExternalContentHistoryCheckpoint: vi.fn(),
    replacePreviewContent: (content: string) => {
      painted = content;
      return "applied" as const;
    },
    setCollabContent,
    setCollabContentFileId,
    setContentRenderRevision: vi.fn(),
    setHoveredElement: vi.fn(),
    setSelectedElement: vi.fn(),
    staleAgentCollabRecoveryTimerRef: ref<number | null>(null),
    undoManagerRef: ref<Y.UndoManager | null>(null),
    ydoc,
  };
  return {
    args,
    get collabContent() {
      return collabContent;
    },
    get collabFileId() {
      return collabFileId;
    },
    get painted() {
      return painted;
    },
    lastAppliedFileContentRef,
    lastAppliedFileUpdatedAtRef,
    latestActiveContentRef,
    pendingLocalFileContentsRef,
    publishCanonicalContent,
    runSeed: () => runSeedCollabContent(args),
  };
}

it.each([
  "pending seed",
  "stored seed",
  "pending observer",
  "SQL adoption",
  "SQL malformed",
  "SQL recovery",
])(
  "%s renders an authoritative edit without authoring the same CRDT insertion twice",
  (path) => {
    const server = new Y.Doc();
    server.getText("content").insert(0, before);
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server), "remote");
    const clientUpdates: Uint8Array[] = [];
    client.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== "remote") clientUpdates.push(update);
    });
    const serverUpdate = applyTextToYDoc(server, "content", next, "server");
    let painted: string | null = before;
    const ref = <T>(current: T) => ({ current });
    const pending = new Map();
    if (path.startsWith("pending")) {
      pending.set(fileId, { content: next, startedAt: 1 });
    }
    const args = {
      activeFile: {
        id: fileId,
        filename: "screen-b.html",
        fileType: "html",
        content: next,
        createdAt: "2026-09-15T00:00:00.000Z",
        updatedAt: "2026-09-15T00:00:02.000Z",
      },
      activeFileId: fileId,
      agentActive: false,
      fileType: "html",
      clearStaleAgentCollabRecovery: vi.fn(),
      collabContent: before,
      collabContentFileId: fileId,
      collabContentFileIdRef: ref(fileId),
      collabContentRef: ref(before),
      documentFileContentRef: ref(next),
      documentFileUpdatedAtRef: ref("2026-09-15T00:00:02.000Z"),
      isSynced: true,
      lastAppliedFileContentRef: ref<string | null>(null),
      lastAppliedFileUpdatedAtRef: ref<string | null>(null),
      lastLocalContentRef: ref<string | null>(before),
      latestActiveContentRef: ref<string | null>(before),
      pendingLocalFileContentsRef: ref(pending),
      publishCanonicalContent: (_id: string, content: string) => content,
      recordExternalContentHistoryCheckpoint: vi.fn(),
      replacePreviewContent: (content: string) => {
        painted = content;
        return "applied" as const;
      },
      setCollabContent: vi.fn(),
      setCollabContentFileId: vi.fn(),
      setContentRenderRevision: vi.fn(),
      setHoveredElement: vi.fn(),
      setSelectedElement: vi.fn(),
      staleAgentCollabRecoveryTimerRef: ref<number | null>(null),
      undoManagerRef: ref(null),
      ydoc: client,
    };
    let cleanup: (() => void) | undefined;
    if (path === "pending observer") {
      cleanup = runObserveCollabText(args);
      const peer = new Y.Doc();
      Y.applyUpdate(peer, Y.encodeStateAsUpdate(client));
      const earlierUpdate = applyTextToYDoc(
        peer,
        "content",
        `${before}\n`,
        "server",
      );
      Y.applyUpdate(client, earlierUpdate, "remote");
      peer.destroy();
    } else if (path.startsWith("SQL")) {
      if (path === "SQL malformed")
        args.collabContent = "<!DOCTYPEDOCTYPE html>";
      if (path === "SQL recovery") {
        args.agentActive = true;
        args.lastAppliedFileUpdatedAtRef.current = args.activeFile.updatedAt;
        args.lastAppliedFileContentRef.current = before;
        args.lastLocalContentRef.current = `${before}\n`;
        vi.useFakeTimers();
        vi.stubGlobal("window", { setTimeout });
      }
      try {
        runAdoptDbFileContent(args);
        if (path === "SQL recovery") vi.advanceTimersByTime(1200);
      } finally {
        if (path === "SQL recovery") {
          vi.useRealTimers();
          vi.unstubAllGlobals();
        }
      }
    } else {
      runSeedCollabContent(args);
    }
    expect(painted).toBe(next);
    cleanup?.();
    Y.applyUpdate(client, serverUpdate, "remote");
    for (const update of clientUpdates) Y.applyUpdate(server, update, "remote");
    expect(client.getText("content").toString().trim()).toBe(next);
    expect(server.getText("content").toString().trim()).toBe(next);
    expect(clientUpdates).toHaveLength(0);
    client.destroy();
    server.destroy();
  },
);

it("does not replay an unchanged Y.Text after the acknowledged stored seed", () => {
  const client = new Y.Doc();
  client.getText("content").insert(0, before);
  const clientUpdates: Uint8Array[] = [];
  client.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== "remote") clientUpdates.push(update);
  });
  const harness = makeSeedHarness(client);

  harness.runSeed();
  expect(harness.latestActiveContentRef.current).toBe(next);
  expect(harness.lastAppliedFileUpdatedAtRef.current).toBe(
    harness.args.activeFile.updatedAt,
  );
  expect(client.getText("content").toJSON()).toBe(before);

  // The accepted stored source is pending while the save is in flight.
  harness.runSeed();
  expect(harness.latestActiveContentRef.current).toBe(next);
  harness.pendingLocalFileContentsRef.current.delete(fileId);

  harness.runSeed();
  expect(harness.latestActiveContentRef.current).toBe(next);
  expect(harness.collabContent).toBe(next);
  expect(harness.painted).toBe(next);
  expect(harness.publishCanonicalContent).toHaveBeenCalledTimes(1);
  expect(client.getText("content").toJSON()).toBe(before);

  const cleanup = runObserveCollabText(harness.args);
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(client));
  const remoteEdit = before.replace(
    "</body>",
    '<p data-agent-native-node-id="remote">Remote edit</p></body>',
  );
  Y.applyUpdate(
    client,
    applyTextToYDoc(peer, "content", remoteEdit, "server"),
    "remote",
  );
  expect(harness.latestActiveContentRef.current).toBe(remoteEdit);
  harness.pendingLocalFileContentsRef.current.delete(fileId);
  harness.runSeed();
  expect(harness.latestActiveContentRef.current).toBe(remoteEdit);
  expect(harness.painted).toBe(remoteEdit);

  // A later remote transaction restoring the prior text remains authoritative.
  Y.applyUpdate(
    client,
    applyTextToYDoc(peer, "content", before, "server"),
    "remote",
  );
  expect(harness.latestActiveContentRef.current).toBe(before);
  harness.pendingLocalFileContentsRef.current.delete(fileId);
  harness.runSeed();
  expect(harness.latestActiveContentRef.current).toBe(before);
  expect(harness.painted).toBe(before);
  expect(clientUpdates).toHaveLength(0);

  cleanup?.();
  peer.destroy();
  client.destroy();
});

it("reconsiders a remote Y.Text declined while a local save is pending", () => {
  const client = new Y.Doc();
  client.getText("content").insert(0, before);
  const clientUpdates: Uint8Array[] = [];
  client.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== "remote") clientUpdates.push(update);
  });
  const harness = makeSeedHarness(client);
  harness.pendingLocalFileContentsRef.current.set(fileId, {
    content: next,
    startedAt: 1,
  });
  harness.latestActiveContentRef.current = next;
  harness.lastAppliedFileContentRef.current = next;
  harness.lastAppliedFileUpdatedAtRef.current =
    harness.args.activeFile.updatedAt;
  harness.args.collabContentFileIdRef.current = fileId;

  const cleanup = runObserveCollabText(harness.args);
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(client));
  const remoteEdit = before.replace(
    "</body>",
    '<p data-agent-native-node-id="remote">Remote edit</p></body>',
  );
  Y.applyUpdate(
    client,
    applyTextToYDoc(peer, "content", remoteEdit, "server"),
    "remote",
  );
  expect(harness.latestActiveContentRef.current).toBe(next);

  // The seed still honors the save while it is pending, then accepts the new
  // Y.Text snapshot after the save is acknowledged.
  harness.runSeed();
  expect(harness.latestActiveContentRef.current).toBe(next);
  harness.pendingLocalFileContentsRef.current.delete(fileId);
  harness.runSeed();
  expect(harness.latestActiveContentRef.current).toBe(remoteEdit);
  expect(harness.painted).toBe(remoteEdit);
  expect(clientUpdates).toHaveLength(0);

  cleanup?.();
  peer.destroy();
  client.destroy();
});

it("scopes the last seeded text to its document and file", () => {
  const firstDoc = new Y.Doc();
  firstDoc.getText("content").insert(0, before);
  const harness = makeSeedHarness(firstDoc);
  harness.runSeed();

  harness.pendingLocalFileContentsRef.current.clear();
  harness.args.activeFileId = "screen-c";
  harness.args.activeFile = {
    ...harness.args.activeFile,
    id: "screen-c",
    filename: "screen-c.html",
    content: before,
    updatedAt: "2026-09-15T00:00:03.000Z",
  };
  harness.args.latestActiveContentRef.current = next;
  harness.args.lastAppliedFileUpdatedAtRef.current =
    harness.args.activeFile.updatedAt;
  harness.args.collabContentFileIdRef.current = fileId;
  harness.runSeed();
  expect(harness.latestActiveContentRef.current).toBe(before);
  expect(harness.collabFileId).toBe("screen-c");
  harness.pendingLocalFileContentsRef.current.clear();

  const replacementDoc = new Y.Doc();
  replacementDoc.getText("content").insert(0, before);
  harness.args.activeFileId = fileId;
  harness.args.activeFile = {
    ...harness.args.activeFile,
    id: fileId,
    filename: "screen-b.html",
    content: before,
    updatedAt: "2026-09-15T00:00:04.000Z",
  };
  harness.args.latestActiveContentRef.current = next;
  harness.args.lastAppliedFileUpdatedAtRef.current =
    harness.args.activeFile.updatedAt;
  harness.args.collabContentFileIdRef.current = fileId;
  harness.args.ydoc = replacementDoc;
  harness.runSeed();
  expect(harness.latestActiveContentRef.current).toBe(before);
  expect(harness.collabContent).toBe(before);

  firstDoc.destroy();
  replacementDoc.destroy();
});

it("does not apply the repeat-seed guard during identity migration", () => {
  const client = new Y.Doc();
  client.getText("content").insert(0, before);
  const harness = makeSeedHarness(client);
  harness.runSeed();
  harness.pendingLocalFileContentsRef.current.set(fileId, {
    content: next,
    startedAt: 1,
    identityMigrationSourceContent: before,
  });
  harness.latestActiveContentRef.current = next;
  harness.runSeed();

  expect(harness.latestActiveContentRef.current).toBe(before);
  expect(harness.publishCanonicalContent).toHaveBeenCalledTimes(2);
  client.destroy();
});
