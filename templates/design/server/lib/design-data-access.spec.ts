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

  describe("public preview URLs", () => {
    const mapped = JSON.stringify({
      screenMetadata: {
        home: {
          url: "http://localhost:5173/",
          tunnelUrl: "https://demo.ngrok-free.app",
        },
      },
    });

    it("hides a tunnel URL from viewers while live collaboration is off", () => {
      expect(String(designDataForAccessRole(mapped, "viewer"))).not.toContain(
        "tunnelUrl",
      );
      expect(
        String(
          designDataForAccessRole(mapped, "viewer", {
            liveCollaborationEnabled: false,
          }),
        ),
      ).not.toContain("tunnelUrl");
    });

    it("shows it to viewers once live collaboration is on", () => {
      expect(
        String(
          designDataForAccessRole(mapped, "viewer", {
            liveCollaborationEnabled: true,
          }),
        ),
      ).toContain("https://demo.ngrok-free.app");
    });

    it.each(["owner", "admin", "editor"])(
      "keeps it for a %s so they can manage the mapping",
      (role) => {
        expect(String(designDataForAccessRole(mapped, role))).toContain(
          "https://demo.ngrok-free.app",
        );
      },
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

  describe("local visual-edit capability", () => {
    const resource = {
      id: "design_1",
      data: JSON.stringify({ sourceType: "localhost" }),
    };
    const capability = "capability:visual-edit:design:design_1";

    it("keeps an ordinary public localhost design viewer-only", () => {
      expect(publicDesignAccessRole(resource)).toBe("viewer");
    });

    it("grants editor only to the matching design capability", () => {
      expect(
        publicDesignAccessRole(resource, { authCapability: capability }),
      ).toBe("editor");
      expect(
        publicDesignAccessRole(resource, {
          authCapability: "capability:visual-edit:design:another-design",
        }),
      ).toBe("viewer");
    });

    it("matches the capability after decoding the scoped design ID", () => {
      const encodedResource = {
        id: "design/1",
        data: JSON.stringify({ sourceType: "localhost" }),
      };

      expect(
        publicDesignAccessRole(encodedResource, {
          authCapability: "capability:visual-edit:design:design%2F1",
        }),
      ).toBe("editor");
    });

    it("grants editor to the matching capability on a visual-edit board without localhost screens", () => {
      const board = {
        id: resource.id,
        data: JSON.stringify({ sourceType: "inline", visualEditBoard: true }),
      };
      expect(
        publicDesignAccessRole(board, { authCapability: capability }),
      ).toBe("editor");
      expect(
        publicDesignAccessRole(board, {
          authCapability: "capability:visual-edit:design:another-design",
        }),
      ).toBe("viewer");
      expect(publicDesignAccessRole(board)).toBe("viewer");
    });

    it.each(["inline", "fusion"])(
      "does not upgrade a matching %s design",
      (sourceType) => {
        expect(
          publicDesignAccessRole(
            {
              ...resource,
              data: JSON.stringify({ sourceType }),
            },
            { authCapability: capability },
          ),
        ).toBe("viewer");
      },
    );
  });
});
