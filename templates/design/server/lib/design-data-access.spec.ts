import { describe, expect, it } from "vitest";

import {
  designDataForAccessRole,
  publicDesignAccessRole,
} from "./design-data-access.js";

describe("design data access policy", () => {
  const persistedData = JSON.stringify({
    sourceMode: "localhost",
    screenMetadata: {
      home: {
        url: "http://localhost:5173/",
        bridgeUrl: "http://127.0.0.1:7331",
        previewToken: "example-read-only-preview-token",
        bridgeToken: "example-private-bridge-token",
      },
    },
  });

  it("always resolves public-by-link access as viewer", () => {
    expect(publicDesignAccessRole()).toBe("viewer");
  });

  it.each(["owner", "admin", "editor"])(
    "preserves only read-only preview metadata for an explicitly resolved %s role",
    (role) => {
      const result = String(designDataForAccessRole(persistedData, role));
      expect(result).toContain("example-read-only-preview-token");
      expect(result).not.toContain("example-private-bridge-token");
      expect(result).not.toContain("bridgeToken");
    },
  );

  it("recursively strips bridge tokens while preserving viewer render metadata", () => {
    const result = designDataForAccessRole(persistedData, "viewer");

    expect(result).toEqual(
      JSON.stringify({
        sourceMode: "localhost",
        screenMetadata: {
          home: {
            url: "http://localhost:5173/",
            bridgeUrl: "http://127.0.0.1:7331",
          },
        },
      }),
    );
  });

  it("fails closed for malformed persisted strings", () => {
    expect(
      designDataForAccessRole(
        '{"bridgeToken":"example-private-bridge-token"',
        "viewer",
      ),
    ).toBeNull();
  });
});
