import { applyTextToYDoc } from "@agent-native/core/collab";
import { expect, it, vi } from "vitest";
import * as Y from "yjs";

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
