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
}));

vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {
    designFiles: { designId: "designFiles.designId" },
  },
}));

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
        data: '{"canvasFrames":[]}',
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
  });
});
