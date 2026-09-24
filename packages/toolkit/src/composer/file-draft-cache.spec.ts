import { afterEach, expect, it, vi } from "vitest";

import {
  FILE_DRAFT_MAX_BYTES,
  readFileDraft,
  validateFileDraft,
  writeFileDraft,
} from "./file-draft-cache.js";

afterEach(() => vi.unstubAllGlobals());
it("bounds individual unsent drafts by count and bytes before writing", () => {
  expect(validateFileDraft([new File(["qa"], "qa.txt")])).toBe(2);
  expect(() =>
    validateFileDraft(
      Array.from({ length: 13 }, () => new File(["x"], "qa.txt")),
    ),
  ).toThrow("draft_file_limit");
  expect(() =>
    validateFileDraft([{ size: FILE_DRAFT_MAX_BYTES + 1 } as File]),
  ).toThrow("draft_file_limit");
});
it("rejects unavailable storage rather than returning an absent draft", async () => {
  vi.stubGlobal("indexedDB", undefined);
  await expect(readFileDraft("qa")).rejects.toThrow(
    "draft_storage_unavailable",
  );
  await expect(writeFileDraft("qa", [])).rejects.toThrow(
    "draft_storage_unavailable",
  );
});
