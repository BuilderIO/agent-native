import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Files database local-folder source entry", () => {
  it("blocks unsafe embedded hosts from the native directory picker", () => {
    const localFilesRoute = readFileSync(
      new URL("../../../routes/_app.local-files.tsx", import.meta.url),
      "utf8",
    );

    expect(localFilesRoute).not.toContain("__agentNativeSafeDirectoryPicker");
    expect(localFilesRoute).toContain("showDirectoryPicker");
    expect(localFilesRoute).toContain("isUnsafeNativeFolderPickerHost()");
    expect(localFilesRoute).toContain("runNativeFolderPickerWithCrashSentinel");
  });
});
