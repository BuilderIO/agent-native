import { describe, expect, it } from "vitest";

import {
  flushPendingFileContentSavesOnCleanup,
  shouldClearLatestUnloadSave,
  shouldSendKeepalive,
} from "./design-editor/editor-state";

describe("shouldSendKeepalive (§stale-mirror keepalive guard)", () => {
  it("sends when collab is not live, regardless of whether a hash is known", () => {
    expect(shouldSendKeepalive(false, false)).toBe(true);
    expect(shouldSendKeepalive(true, false)).toBe(true);
  });

  it("sends when collab is live but a known acked hash can guard the write", () => {
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
    };
    const second = {
      id: "file-b",
      content: "second",
      syncCollab: false,
      operationSource: "tab-a",
      operationRevision: 1,
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

describe("shouldClearLatestUnloadSave", () => {
  const completed = {
    id: "file-a",
    content: "saved content",
    syncCollab: true,
    operationSource: "tab-a",
    operationRevision: 1,
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

  it("keeps the retry when the server skipped a stale mirror write", () => {
    expect(shouldClearLatestUnloadSave(completed, completed, true)).toBe(false);
  });
});
