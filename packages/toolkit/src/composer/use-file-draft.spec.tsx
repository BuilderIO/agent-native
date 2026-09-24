// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  clearFileDraft,
  readFileDraft,
  writeFileDraft,
} from "./file-draft-cache.js";
import { useFileDraft } from "./use-file-draft.js";

vi.mock("./file-draft-cache.js", () => ({
  readFileDraft: vi.fn(),
  writeFileDraft: vi.fn(),
  clearFileDraft: vi.fn(),
}));
let root: Root;
let container: HTMLDivElement;
let result: ReturnType<typeof useFileDraft>;
const file = new File(["actual file contents"], "qa-draft.txt", {
  type: "text/plain",
});
const restore = vi.fn();
function Harness({
  files,
  draftKey,
}: {
  files: File[];
  draftKey: string | null;
}) {
  result = useFileDraft(draftKey, files, restore);
  return null;
}
async function render(
  files: File[],
  draftKey: string | null = "user:org:app:composer",
) {
  await act(async () => {
    root.render(<Harness files={files} draftKey={draftKey} />);
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  vi.mocked(readFileDraft).mockResolvedValue(null);
  vi.mocked(writeFileDraft).mockResolvedValue();
  restore.mockResolvedValue(undefined);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it("does not write an early empty runtime before restored files are committed", async () => {
  vi.mocked(readFileDraft).mockResolvedValue([file]);
  await render([]);
  expect(restore).toHaveBeenCalledExactlyOnceWith(file);
  expect(writeFileDraft).not.toHaveBeenCalled();
  expect(result.restoring).toBe(true);
  await render([file]);
  expect(result.restoring).toBe(false);
  expect(writeFileDraft).toHaveBeenLastCalledWith(
    "user:org:app:composer",
    [file],
    expect.any(String),
  );
});
it("clears the cache after submit or removal without ghost restoration", async () => {
  vi.mocked(readFileDraft).mockResolvedValue([file]);
  await render([]);
  await render([file]);
  await render([]);
  expect(writeFileDraft).toHaveBeenLastCalledWith(
    "user:org:app:composer",
    [],
    expect.any(String),
  );
  expect(restore).toHaveBeenCalledTimes(1);
});
it("preserves mounted files while reading the same draft", async () => {
  vi.mocked(readFileDraft).mockResolvedValue([new File(["old"], "old.txt")]);
  await render([file]);
  expect(restore).not.toHaveBeenCalled();
  expect(writeFileDraft).toHaveBeenLastCalledWith(
    "user:org:app:composer",
    [file],
    expect.any(String),
  );
});
it("distinguishes unreadable from absent and does not overwrite unreadable storage", async () => {
  vi.mocked(readFileDraft).mockRejectedValue(new Error("unreadable"));
  await render([]);
  expect(result).toMatchObject({ error: "restore", restoring: false });
  expect(writeFileDraft).not.toHaveBeenCalled();
});
it("reports a quota failure without removing mounted files", async () => {
  vi.mocked(writeFileDraft).mockRejectedValue(new Error("quota"));
  await render([file]);
  expect(result.error).toBe("save");
  expect(restore).not.toHaveBeenCalled();
});
it("does not restore a stale user's pending read into a new draft", async () => {
  let finish!: (value: File[]) => void;
  vi.mocked(readFileDraft).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render([], "user-a:org:app:draft");
  await render([], "user-b:org:app:draft");
  await act(async () => finish([file]));
  expect(restore).not.toHaveBeenCalled();
  expect(writeFileDraft).not.toHaveBeenCalledWith(
    "user-a:org:app:draft",
    expect.anything(),
    expect.any(String),
  );
});
it("clears the captured submitted revision even after the host unmounts, not a newer draft", async () => {
  await render([file]);
  const revision = vi.mocked(writeFileDraft).mock.calls.at(-1)![2];
  const clearSubmitted = result.captureSubmission();
  await render([new File(["new"], "later.txt")]);
  const newerRevision = vi.mocked(writeFileDraft).mock.calls.at(-1)![2];
  expect(newerRevision).not.toBe(revision);
  await act(async () => root.render(null));
  await act(async () => clearSubmitted());
  expect(clearFileDraft).toHaveBeenCalledExactlyOnceWith(
    "user:org:app:composer",
    revision,
  );
});
it("does not touch storage without authenticated scoped identity", async () => {
  await render([file], null);
  expect(readFileDraft).not.toHaveBeenCalled();
  expect(writeFileDraft).not.toHaveBeenCalled();
});
