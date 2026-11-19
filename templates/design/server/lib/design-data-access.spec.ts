import { describe, expect, it, vi } from "vitest";

import { LOCAL_VISUAL_EDIT_PRINCIPAL_DOMAIN } from "../../shared/local-visual-edit-principal.js";
import {
  capabilityDesignAccessRole,
  designDataForAccessRole,
} from "./design-data-access.js";

const settings = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock("@agent-native/core/settings", () => ({
  getSetting: async (key: string) => settings.get(key) ?? null,
  putSetting: async (key: string, value: Record<string, unknown>) => {
    settings.set(key, value);
  },
}));

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
    const principal = `workspace+abc@${LOCAL_VISUAL_EDIT_PRINCIPAL_DOMAIN}`;
    const resource = {
      id: "design_1",
      data: JSON.stringify({ sourceType: "localhost" }),
      ownerEmail: principal,
      visibility: "private",
    };
    const capability = "capability:visual-edit:design:design_1";

    it("grants editor only to the matching design capability", async () => {
      await expect(
        capabilityDesignAccessRole(resource, { authCapability: capability }),
      ).resolves.toBe("editor");
      await expect(
        capabilityDesignAccessRole(resource, {
          authCapability: "capability:visual-edit:design:another-design",
        }),
      ).resolves.toBeUndefined();
      await expect(
        capabilityDesignAccessRole(resource, {
          authCapability: "capability:other:design:design_1",
        }),
      ).resolves.toBeUndefined();
    });

    it("matches the capability after decoding the scoped design ID", async () => {
      const encodedResource = { ...resource, id: "design/1" };

      await expect(
        capabilityDesignAccessRole(encodedResource, {
          authCapability: "capability:visual-edit:design:design%2F1",
        }),
      ).resolves.toBe("editor");
      await expect(
        capabilityDesignAccessRole(encodedResource, {
          authCapability: "capability:visual-edit:design:%E0%A4%A",
        }),
      ).resolves.toBeUndefined();
    });

    it("grants editor to the matching capability on a visual-edit board without localhost screens", async () => {
      const board = {
        ...resource,
        data: JSON.stringify({ sourceType: "inline", visualEditBoard: true }),
      };
      await expect(
        capabilityDesignAccessRole(board, { authCapability: capability }),
      ).resolves.toBe("editor");
      await expect(
        capabilityDesignAccessRole(board, {
          authCapability: "capability:visual-edit:design:another-design",
        }),
      ).resolves.toBeUndefined();
    });

    it("stops granting a board once an account owns it", async () => {
      const board = {
        ...resource,
        data: JSON.stringify({ sourceType: "inline", visualEditBoard: true }),
        ownerEmail: "alice@example.com",
      };
      await expect(
        capabilityDesignAccessRole(board, { authCapability: capability }),
      ).resolves.toBeUndefined();
      await expect(
        capabilityDesignAccessRole(
          { ...board, visibility: "public" },
          { authCapability: capability },
        ),
      ).resolves.toBeUndefined();
      await expect(
        capabilityDesignAccessRole(
          { ...resource, ownerEmail: "alice@example.com" },
          { authCapability: capability },
        ),
      ).resolves.toBeUndefined();
    });

    it("keeps a public account-owned localhost design editable until it is claimed", async () => {
      const design = {
        ...resource,
        ownerEmail: "alice@example.com",
        visibility: "public",
      };
      await expect(
        capabilityDesignAccessRole(design, { authCapability: capability }),
      ).resolves.toBe("editor");
      settings.set("design-visual-edit-board-claimed:design_1", {
        claimedAt: "2026-11-17T00:00:00.000Z",
      });
      await expect(
        capabilityDesignAccessRole(design, { authCapability: capability }),
      ).resolves.toBeUndefined();
      settings.clear();
    });

    it.each(["inline", "fusion"])(
      "does not upgrade a matching %s design",
      async (sourceType) => {
        await expect(
          capabilityDesignAccessRole(
            {
              ...resource,
              data: JSON.stringify({ sourceType }),
            },
            { authCapability: capability },
          ),
        ).resolves.toBeUndefined();
      },
    );
  });
});
