import { sourceContentHash } from "@shared/source-workspace";
import { describe, expect, it, vi } from "vitest";

import type { ApplyFileContentUpdateResult } from "./apply-file-content-update";
import {
  canPublishAcceptedSource,
  queueServerFirstSourcePublication,
} from "./queue-server-first-source-publication";

const BASE =
  '<!doctype html><html><body style="background-color: #2e4a62"><main>Base</main></body></html>';
const REQUESTED = BASE.replace(
  "</body>",
  '<style>body{background-image:url("data:image/png;base64,abc")}</style></body>',
);
const ACCEPTED = REQUESTED.replace("Base", "Remote title");
const PUBLISHABLE_ACTIVE_SOURCE = {
  activeFileId: "screen-a",
  capturedActiveFileId: "screen-a",
  baseContent: BASE,
  currentContent: BASE,
  acceptedContent: ACCEPTED,
  targetWasActive: true,
  targetDocumentMatches: true,
  targetYTextMatches: true,
  latestActiveContentMatches: true,
  lastLocalContentMatches: true,
};

describe("server-first source publication", () => {
  it("allows the captured source before or after accepted content reaches the getter", () => {
    expect(canPublishAcceptedSource(PUBLISHABLE_ACTIVE_SOURCE)).toBe(true);
    expect(
      canPublishAcceptedSource({
        ...PUBLISHABLE_ACTIVE_SOURCE,
        currentContent: ACCEPTED,
      }),
    ).toBe(true);
  });

  it.each([
    ["a newer server source", { currentContent: BASE + " newer" }],
    ["a switched active file", { activeFileId: "screen-b" }],
    ["a replaced Y.Doc", { targetDocumentMatches: false }],
    ["a newer Y.Text", { targetYTextMatches: false }],
    ["newer active content", { latestActiveContentMatches: false }],
    ["a newer local pending source", { lastLocalContentMatches: false }],
  ] as const)("rejects publication after %s", (_label, change) => {
    expect(
      canPublishAcceptedSource({
        ...PUBLISHABLE_ACTIVE_SOURCE,
        ...change,
      }),
    ).toBe(false);
  });

  it("allows an unchanged inactive target without publishing to the active document", () => {
    expect(
      canPublishAcceptedSource({
        ...PUBLISHABLE_ACTIVE_SOURCE,
        activeFileId: "screen-b",
        capturedActiveFileId: "screen-b",
        targetWasActive: false,
        targetDocumentMatches: false,
        targetYTextMatches: false,
        latestActiveContentMatches: false,
        lastLocalContentMatches: false,
      }),
    ).toBe(true);
  });

  it("publishes only the accepted merged source after the save callback", () => {
    let onPersistedContent: ((content: string) => void) | undefined;
    const queueFileContentSave = vi.fn((_fileId, _content, options) => {
      onPersistedContent = options.onPersistedContent;
      return Promise.resolve("persisted" as const);
    });
    const applyFileContentUpdate = vi.fn(
      (_fileId, content, _options): ApplyFileContentUpdateResult => ({
        status: "accepted",
        content,
        nodeIdMap: new Map(),
      }),
    );
    const onAccepted = vi.fn();

    queueServerFirstSourcePublication(
      {
        applyFileContentUpdate,
        isActiveFile: (fileId) => fileId === "screen-a",
        clearPendingLocalFileContent: vi.fn(),
        shouldPublish: () => true,
        queueFileContentSave,
      },
      "screen-a",
      REQUESTED,
      BASE,
      onAccepted,
    );

    expect(applyFileContentUpdate).not.toHaveBeenCalled();
    expect(onAccepted).not.toHaveBeenCalled();
    expect(queueFileContentSave).toHaveBeenCalledWith(
      "screen-a",
      REQUESTED,
      expect.objectContaining({
        expectedVersionHash: sourceContentHash(BASE),
        syncCollab: false,
        immediate: true,
        deferCollabReconcile: true,
      }),
    );

    onPersistedContent?.(ACCEPTED);

    expect(applyFileContentUpdate).toHaveBeenCalledWith(
      "screen-a",
      ACCEPTED,
      expect.objectContaining({
        serverAccepted: true,
        historyBeforeContent: BASE,
        sourceBaseContent: BASE,
        forcePreviewFullDocument: true,
      }),
    );
    expect(onAccepted).toHaveBeenCalledWith(ACCEPTED);
  });

  it("routes accepted source to its captured file while another file is active", () => {
    let onPersistedContent: ((content: string) => void) | undefined;
    const applyFileContentUpdate = vi.fn(
      (_fileId, content, _options): ApplyFileContentUpdateResult => ({
        status: "accepted",
        content,
        nodeIdMap: new Map(),
      }),
    );

    queueServerFirstSourcePublication(
      {
        applyFileContentUpdate,
        isActiveFile: () => false,
        clearPendingLocalFileContent: vi.fn(),
        shouldPublish: () => true,
        queueFileContentSave: vi.fn((_fileId, _content, options) => {
          onPersistedContent = options.onPersistedContent;
          return Promise.resolve("persisted" as const);
        }),
      },
      "screen-a",
      REQUESTED,
      BASE,
    );
    onPersistedContent?.(ACCEPTED);

    expect(applyFileContentUpdate).toHaveBeenCalledWith(
      "screen-a",
      ACCEPTED,
      expect.objectContaining({
        serverAccepted: true,
        forcePreviewFullDocument: false,
      }),
    );
  });

  it("does not publish when the save never reports accepted content", () => {
    const applyFileContentUpdate = vi.fn();
    const queueFileContentSave = vi.fn(() =>
      Promise.resolve("conflict" as const),
    );

    queueServerFirstSourcePublication(
      {
        applyFileContentUpdate,
        isActiveFile: () => true,
        clearPendingLocalFileContent: vi.fn(),
        shouldPublish: () => true,
        queueFileContentSave,
      },
      "screen-a",
      REQUESTED,
      BASE,
    );

    expect(queueFileContentSave).toHaveBeenCalledOnce();
    expect(applyFileContentUpdate).not.toHaveBeenCalled();
  });

  it("retires deferred local content without local publication over newer selection state", () => {
    let onPersistedContent: ((content: string) => void) | undefined;
    const applyFileContentUpdate = vi.fn();
    const clearPendingLocalFileContent = vi.fn();
    const onPersisted = vi.fn();

    queueServerFirstSourcePublication(
      {
        applyFileContentUpdate,
        isActiveFile: () => false,
        clearPendingLocalFileContent,
        shouldPublish: () => false,
        queueFileContentSave: vi.fn((_fileId, _content, options) => {
          onPersistedContent = options.onPersistedContent;
          return Promise.resolve("persisted" as const);
        }),
      },
      "screen-a",
      REQUESTED,
      BASE,
      onPersisted,
    );

    onPersistedContent?.(ACCEPTED);

    expect(clearPendingLocalFileContent).toHaveBeenCalledWith(
      "screen-a",
      ACCEPTED,
    );
    expect(applyFileContentUpdate).not.toHaveBeenCalled();
    expect(onPersisted).not.toHaveBeenCalled();
  });

  it("does not run local publication callbacks when the accepted source is refused", () => {
    let onPersistedContent: ((content: string) => void) | undefined;
    const clearPendingLocalFileContent = vi.fn();
    const onPersisted = vi.fn();
    const applyFileContentUpdate = vi.fn(
      (): ApplyFileContentUpdateResult => ({
        status: "refused",
      }),
    );

    queueServerFirstSourcePublication(
      {
        applyFileContentUpdate,
        isActiveFile: () => true,
        clearPendingLocalFileContent,
        shouldPublish: () => true,
        queueFileContentSave: vi.fn((_fileId, _content, options) => {
          onPersistedContent = options.onPersistedContent;
          return Promise.resolve("persisted" as const);
        }),
      },
      "screen-a",
      REQUESTED,
      BASE,
      onPersisted,
    );

    onPersistedContent?.(ACCEPTED);

    expect(clearPendingLocalFileContent).toHaveBeenCalledWith(
      "screen-a",
      ACCEPTED,
    );
    expect(applyFileContentUpdate).toHaveBeenCalledOnce();
    expect(onPersisted).not.toHaveBeenCalled();
  });
});
