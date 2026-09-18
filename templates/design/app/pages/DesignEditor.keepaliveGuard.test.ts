import { describe, expect, it } from "vitest";

import {
  flushFileContentSavesOnBackground,
  flushPendingFileContentSavesOnCleanup,
  prepareFileContentSaveKeepalive,
  shouldClearLatestUnloadSave,
  shouldSendKeepalive,
} from "./design-editor/editor-state";

describe("shouldSendKeepalive (§stale-mirror keepalive guard)", () => {
  it("sends when collab is not live", () => {
    expect(shouldSendKeepalive(false, false)).toBe(true);
    expect(shouldSendKeepalive(true, false)).toBe(true);
  });

  it("sends when collab is live and the queued source hash guards the write", () => {
    expect(shouldSendKeepalive(true, true)).toBe(true);
  });

  it("skips when collab is live and no hash is known — an unguarded full-doc write on unload risks clobbering newer content the collab layer already holds", () => {
    expect(shouldSendKeepalive(false, true)).toBe(false);
  });
});

describe("flushPendingFileContentSavesOnCleanup", () => {
  it("enqueues every debounced file through the normal saver before clearing its timer", () => {
    const first = {
      id: "file-a",
      content: "first",
      syncCollab: true,
      operationSource: "tab-a",
      operationRevision: 1,
      expectedVersionHash: "source-a",
    };
    const second = {
      id: "file-b",
      content: "second",
      syncCollab: false,
      operationSource: "tab-a",
      operationRevision: 1,
      expectedVersionHash: "source-b",
    };
    const events: string[] = [];

    flushPendingFileContentSavesOnCleanup(
      { [first.id]: first, [second.id]: second },
      [11, 22],
      (pending) => events.push(`save:${pending.id}`),
      (timerId) => events.push(`clear:${timerId}`),
    );

    expect(events).toEqual([
      "save:file-a",
      "save:file-b",
      "clear:11",
      "clear:22",
    ]);
  });
});

describe("flushFileContentSavesOnBackground", () => {
  it("retries unacknowledged saves and prefers the newest debounced revision", () => {
    const events: string[] = [];

    flushFileContentSavesOnBackground(
      {
        "file-a": {
          id: "file-a",
          content: "newest",
          syncCollab: true,
          operationSource: "tab-a",
          operationRevision: 2,
          expectedVersionHash: "source-newest",
        },
      },
      {
        "file-a": {
          id: "file-a",
          content: "older",
          syncCollab: true,
          operationSource: "tab-a",
          operationRevision: 1,
          expectedVersionHash: "source-older",
        },
        "file-b": {
          id: "file-b",
          content: "retry me",
          syncCollab: false,
          operationSource: "tab-a",
          operationRevision: 3,
          expectedVersionHash: "source-file-b",
        },
      },
      [11, 22],
      (pending) =>
        events.push(
          `save:${pending.id}:${pending.operationRevision}:${pending.content}`,
        ),
      (timerId) => events.push(`clear:${timerId}`),
    );

    expect(events).toEqual([
      "save:file-a:2:newest",
      "save:file-b:3:retry me",
      "clear:11",
      "clear:22",
    ]);
  });
});

describe("shouldClearLatestUnloadSave", () => {
  const completed = {
    id: "file-a",
    content: "saved content",
    syncCollab: true,
    operationSource: "tab-a",
    operationRevision: 1,
    expectedVersionHash: "source-a",
  };

  it("retires an unload retry after that exact save is acknowledged", () => {
    expect(shouldClearLatestUnloadSave(completed, completed)).toBe(true);
  });

  it("preserves a newer edit queued while the completed save was in flight", () => {
    expect(
      shouldClearLatestUnloadSave(
        { ...completed, content: "newer content" },
        completed,
      ),
    ).toBe(false);
  });

  it("does not retire a repeated-content save with a newer revision", () => {
    expect(
      shouldClearLatestUnloadSave(
        { ...completed, operationRevision: 2 },
        completed,
      ),
    ).toBe(false);
  });
});

describe("prepareFileContentSaveKeepalive", () => {
  it("uses the edit's own CAS base instead of the folded unload base", () => {
    const pending = {
      id: "file-a",
      content: "successor",
      syncCollab: true,
      operationSource: "tab-a",
      operationRevision: 2,
      expectedVersionHash: "predecessor",
      unloadExpectedVersionHash: "original",
    };

    expect(prepareFileContentSaveKeepalive(pending)).toEqual({
      ...pending,
      unloadExpectedVersionHash: undefined,
    });
    expect(pending.unloadExpectedVersionHash).toBe("original");
  });
});
