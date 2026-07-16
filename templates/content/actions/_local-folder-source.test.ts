import { describe, expect, it } from "vitest";

import {
  localFolderSourceCapabilities,
  localFolderSourceId,
  localFolderSourceMetadata,
} from "./_local-folder-source";

describe("local folder source metadata", () => {
  it("uses stable opaque identity without storing a filesystem path", () => {
    const first = localFolderSourceId("files-db", "desktop-folder-7");
    const second = localFolderSourceId("files-db", "desktop-folder-7");
    expect(first).toBe(second);
    expect(first).not.toContain("desktop-folder-7");

    const metadata = localFolderSourceMetadata({
      connectionId: "desktop-folder-7",
      label: "Product docs",
      truthPolicy: "source_primary",
    });
    expect(metadata).toMatchObject({
      connectionId: "desktop-folder-7",
      connectionLabel: "Product docs",
      truthPolicy: "source_primary",
      readMode: "trusted-local-bridge",
    });
    expect(JSON.stringify(metadata)).not.toContain("/Users/");
  });

  it("advertises local editing without pretending a folder publishes", () => {
    expect(localFolderSourceCapabilities()).toMatchObject({
      canRefresh: true,
      canWriteBody: true,
      canPublish: false,
      canRename: true,
      canReveal: true,
      canUseLocalComponents: true,
    });
  });
});
