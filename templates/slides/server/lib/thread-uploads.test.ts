import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  value: null as Record<string, unknown> | null,
  beforeSet: undefined as (() => void) | undefined,
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: async () => store.value,
  compareAndSetAppState: async (
    _key: string,
    expected: Record<string, unknown> | null,
    next: Record<string, unknown> | null,
  ) => {
    const hook = store.beforeSet;
    store.beforeSet = undefined;
    hook?.();
    if (JSON.stringify(store.value) !== JSON.stringify(expected)) return false;
    store.value = next;
    return true;
  },
}));

import { readThreadUploads, rememberThreadUploads } from "./thread-uploads";

describe("rememberThreadUploads", () => {
  beforeEach(() => {
    store.value = null;
    store.beforeSet = undefined;
  });

  it("keeps a file another turn recorded between this turn's read and write", async () => {
    store.value = {
      files: [{ name: "brief.pdf", path: "attachment:v1:brief" }],
    };
    store.beforeSet = () => {
      store.value = {
        files: [
          { name: "brief.pdf", path: "attachment:v1:brief" },
          { name: "notes.docx", path: "attachment:v1:notes" },
        ],
      };
    };

    await rememberThreadUploads("thread-1", [
      { name: "deck.pptx", path: "attachment:v1:deck" },
    ]);

    expect(await readThreadUploads("thread-1")).toEqual([
      { name: "brief.pdf", path: "attachment:v1:brief" },
      { name: "notes.docx", path: "attachment:v1:notes" },
      { name: "deck.pptx", path: "attachment:v1:deck" },
    ]);
  });

  it("ignores paths that are not upload references", async () => {
    await rememberThreadUploads("thread-1", [
      { name: "local.pdf", path: "data/uploads/user/local.pdf" },
    ]);

    expect(store.value).toBeNull();
  });
});
