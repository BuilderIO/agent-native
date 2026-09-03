import { describe, expect, it } from "vitest";

import {
  localFolderObservedRevision,
  localFolderSourceIdentityFromMetadata,
} from "./_local-folder-source.js";

describe("local-folder source identity", () => {
  it("binds an observed revision to both source body and metadata", () => {
    const baseline = localFolderObservedRevision({
      contentHash: "content-a",
      metadataHash: "metadata-a",
    });
    expect(
      localFolderObservedRevision({
        contentHash: "content-a",
        metadataHash: "metadata-a",
      }),
    ).toBe(baseline);
    expect(
      localFolderObservedRevision({
        contentHash: "content-a",
        metadataHash: "metadata-b",
      }),
    ).not.toBe(baseline);
  });

  it("does not expose malformed or path-bearing stored local identity", () => {
    expect(
      localFolderSourceIdentityFromMetadata({
        workingCopy: {
          id: "/Users/alice/worktree",
          kind: "temporary",
          name: "Fix local sync",
          deviceId: "desktop-alice",
        },
      }),
    ).toBeUndefined();
  });
});
