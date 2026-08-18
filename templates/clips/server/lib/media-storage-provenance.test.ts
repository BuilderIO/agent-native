import { describe, expect, it } from "vitest";

import { allowsLegacyS3ObjectForPersistedMedia } from "./media-storage-provenance.js";

describe("legacy media provenance", () => {
  const legacyUrl =
    "https://clips.example.com/api/storage/clips/1722720000000-abc123xy.webm";

  it("allows an existing persisted URL without an external marker", () => {
    expect(
      allowsLegacyS3ObjectForPersistedMedia({
        requestedUrl: legacyUrl,
        persistedUrl: legacyUrl,
        editsJson: "{}",
      }),
    ).toBe(true);
  });

  it("rejects mismatched and externally supplied persisted URLs", () => {
    expect(
      allowsLegacyS3ObjectForPersistedMedia({
        requestedUrl: legacyUrl,
        persistedUrl: "https://clips.example.com/another.webm",
        editsJson: "{}",
      }),
    ).toBe(false);
    expect(
      allowsLegacyS3ObjectForPersistedMedia({
        requestedUrl: legacyUrl,
        persistedUrl: legacyUrl,
        editsJson: JSON.stringify({ mediaStorageLayout: "external" }),
      }),
    ).toBe(false);
    expect(
      allowsLegacyS3ObjectForPersistedMedia({
        requestedUrl: legacyUrl,
        persistedUrl: legacyUrl,
        editsJson: "{invalid",
      }),
    ).toBe(false);
  });
});
