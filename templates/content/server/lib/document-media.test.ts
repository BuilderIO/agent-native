import { describe, expect, it } from "vitest";

import {
  documentMediaUrl,
  isSupportedDocumentMediaType,
  parsePrivateBlobHandle,
  safeDocumentMediaFilename,
  serializePrivateBlobHandle,
} from "./document-media";

describe("document media handles", () => {
  it("keeps provider handles opaque and builds only Content delivery URLs", () => {
    const serialized = serializePrivateBlobHandle({
      id: "opaque-provider-handle",
      provider: "test-provider",
      opaque: true,
      encrypted: true,
    });
    expect(parsePrivateBlobHandle(serialized)).toMatchObject({ opaque: true });
    expect(documentMediaUrl("media id", "/content")).toBe(
      "/content/api/document-media/media%20id",
    );
  });

  it("accepts supported media types and sanitizes filenames", () => {
    expect(isSupportedDocumentMediaType("image/png")).toBe(true);
    expect(isSupportedDocumentMediaType("text/html")).toBe(false);
    expect(safeDocumentMediaFilename("../secret\\name.png")).toBe(
      ".._secret_name.png",
    );
  });
});
