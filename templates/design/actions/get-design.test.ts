import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  selectChain.from.mockReturnValue(selectChain);

  return {
    eq: vi.fn((left, right) => ({ left, right })),
    getDb: vi.fn(() => ({
      select: vi.fn(() => selectChain),
    })),
    resolveAccess: vi.fn(),
    selectChain,
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  registerShareableResource: vi.fn(),
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {
    designFiles: { designId: "designFiles.designId" },
  },
}));

import { designDataForAccessRole } from "../server/lib/design-data-access.js";
import action from "./get-design.js";

describe("get-design", () => {
  beforeEach(() => {
    mocks.resolveAccess.mockReset();
    mocks.selectChain.where.mockReset();
    mocks.resolveAccess.mockResolvedValue({
      role: "viewer",
      resource: {
        id: "design_123",
        title: "Public checkout",
        description: "Shared preview",
        projectType: "prototype",
        designSystemId: null,
        data: JSON.stringify({
          canvasFrames: [],
          screenMetadata: {
            file_123: {
              sourceType: "localhost",
              bridgeUrl: "http://127.0.0.1:7331",
              previewToken: "example-read-only-preview-token",
              bridgeToken: "example-private-bridge-token",
            },
          },
        }),
        visibility: "public",
        createdAt: "2026-06-29T00:00:00.000Z",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
    });
    mocks.selectChain.where.mockResolvedValue([
      {
        id: "file_123",
        filename: "index.html",
        fileType: "html",
        content: "<main>Hello</main>",
        createdAt: "2026-06-29T00:00:00.000Z",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
    ]);
  });

  it("exposes a signed-out public read-only surface", () => {
    expect(action.requiresAuth).toBe(false);
    expect(action.publicAgent).toEqual({
      expose: true,
      readOnly: true,
      requiresAuth: false,
    });
  });

  it("returns design files for a public viewer", async () => {
    const result = await action.run({ id: "design_123" });

    expect(mocks.resolveAccess).toHaveBeenCalledWith("design", "design_123");
    expect(result).toMatchObject({
      id: "design_123",
      visibility: "public",
      accessRole: "viewer",
      files: [
        expect.objectContaining({
          filename: "index.html",
          fileType: "html",
        }),
      ],
    });
    expect(result.data).toContain("bridgeUrl");
    expect(result.data).not.toContain("bridgeToken");
    expect(result.data).not.toContain("previewToken");
    expect(result.data).not.toContain("example-private-bridge-token");
  });

  it("returns only the read-only preview token to an editor", async () => {
    mocks.resolveAccess.mockResolvedValueOnce({
      role: "editor",
      resource: {
        id: "design_123",
        title: "Local checkout",
        data: JSON.stringify({
          screenMetadata: {
            file_123: {
              previewToken: "example-read-only-preview-token",
              bridgeToken: "example-private-bridge-token",
            },
          },
        }),
        visibility: "private",
      },
    });

    const result = await action.run({ id: "design_123" });

    expect(result.data).toContain("example-read-only-preview-token");
    expect(result.data).not.toContain("example-private-bridge-token");
    expect(result.data).not.toContain("bridgeToken");
  });

  it("redacts bridge tokens from object-shaped viewer data too", () => {
    expect(
      designDataForAccessRole(
        {
          bridgeToken: "top-secret",
          nested: [{ bridgeToken: "nested-secret", routeId: "route-home" }],
        },
        "viewer",
      ),
    ).toEqual({ nested: [{ routeId: "route-home" }] });
  });

  it("fails closed instead of returning malformed persisted viewer data", () => {
    expect(
      designDataForAccessRole(
        '{"screenMetadata":{"file_123":{"bridgeToken":"example-private-bridge-token"}}',
        "viewer",
      ),
    ).toBeNull();
  });
});
