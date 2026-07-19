import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Files database local-folder source entry", () => {
  it("offers the shared folder flow only for canonical Files databases", () => {
    const databaseView = readFileSync(
      new URL("./DatabaseView.tsx", import.meta.url),
      "utf8",
    );
    const localFilesRoute = readFileSync(
      new URL("../../../routes/_app.local-files.tsx", import.meta.url),
      "utf8",
    );

    expect(databaseView).toContain(
      'isFilesDatabase={document.database?.systemRole === "files"}',
    );
    expect(databaseView).toContain('label={t("sidebar.localFolder")}');
    expect(databaseView).toContain(
      "navigate(`/local-files?databaseId=${databaseId}`)",
    );
    expect(localFilesRoute).toContain(
      'const targetDatabaseId = searchParams.get("databaseId") || undefined',
    );
    expect(localFilesRoute).toContain("databaseId: targetDatabaseId");
    expect(localFilesRoute).toContain(
      "createSourceBackedSpace: !targetSpaceId && !targetDatabaseId",
    );
  });

  it("blocks unsafe embedded hosts from the native directory picker", () => {
    const localFilesRoute = readFileSync(
      new URL("../../../routes/_app.local-files.tsx", import.meta.url),
      "utf8",
    );

    expect(localFilesRoute).not.toContain("__agentNativeSafeDirectoryPicker");
    expect(localFilesRoute).toContain("showDirectoryPicker");
    expect(localFilesRoute).toContain("isUnsafeNativeFolderPickerHost()");
  });
});
