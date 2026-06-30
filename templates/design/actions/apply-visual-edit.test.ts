import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  selectChain.from.mockReturnValue(selectChain);
  selectChain.innerJoin.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);

  return {
    accessFilter: vi.fn(() => ({ kind: "access-filter" })),
    and: vi.fn((...parts) => ({ parts })),
    eq: vi.fn((left, right) => ({ left, right })),
    assertAccess: vi.fn(),
    applyVisualEdit: vi.fn(),
    getDb: vi.fn(() => ({
      select: vi.fn(() => selectChain),
    })),
    hasCollabState: vi.fn().mockResolvedValue(false),
    getText: vi.fn(),
    selectChain,
  };
});

vi.mock("@agent-native/core/collab", () => ({
  agentEnterDocument: vi.fn(),
  agentLeaveDocument: vi.fn(),
  agentUpdateSelection: vi.fn(),
  applyText: vi.fn(),
  getText: mocks.getText,
  hasCollabState: mocks.hasCollabState,
  seedFromText: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: mocks.accessFilter,
  assertAccess: mocks.assertAccess,
  registerShareableResource: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      content: "designFiles.content",
      updatedAt: "designFiles.updatedAt",
    },
    designs: { id: "designs.id" },
    designShares: {},
  },
}));

vi.mock("../shared/code-layer.js", () => ({
  applyVisualEdit: mocks.applyVisualEdit,
}));

import action from "./apply-visual-edit.js";

describe("apply-visual-edit", () => {
  beforeEach(() => {
    mocks.assertAccess.mockReset();
    mocks.applyVisualEdit.mockReset();
    mocks.selectChain.limit.mockReset();
    mocks.selectChain.limit.mockResolvedValue([
      {
        id: "file_123",
        designId: "design_123",
        filename: "index.html",
        fileType: "html",
        content: "<main>Hello</main>",
      },
    ]);
  });

  it("rejects malformed intents that do not identify a target node", () => {
    expect(
      action.schema.safeParse({
        source: { kind: "design-file", designId: "design_123" },
        intent: {
          kind: "style",
          target: {},
          property: "color",
          value: "red",
        },
      }).success,
    ).toBe(false);
  });

  it("fails fast when fileId and designId disagree", async () => {
    await expect(
      action.run({
        source: {
          kind: "design-file",
          fileId: "file_123",
          designId: "design_other",
        },
        intent: {
          kind: "style",
          target: { selector: "main" },
          property: "color",
          value: "red",
        },
      }),
    ).rejects.toThrow(
      'source.designId "design_other" does not match file "file_123"',
    );

    expect(mocks.applyVisualEdit).not.toHaveBeenCalled();
    expect(mocks.assertAccess).not.toHaveBeenCalled();
  });

  it("allows fileId-only edits against non-index design files", async () => {
    mocks.selectChain.limit.mockResolvedValueOnce([
      {
        id: "file_details",
        designId: "design_123",
        filename: "details.html",
        fileType: "html",
        content: "<main>Details</main>",
      },
    ]);
    mocks.applyVisualEdit.mockReturnValueOnce({
      result: { status: "applied", changed: false },
      projection: { nodes: [] },
      content: "<main>Updated details</main>",
    });

    await expect(
      action.run({
        source: {
          kind: "design-file",
          fileId: "file_details",
        },
        intent: {
          kind: "style",
          target: { selector: "main" },
          property: "color",
          value: "red",
        },
      }),
    ).resolves.toMatchObject({
      designId: "design_123",
      fileId: "file_details",
      filename: "details.html",
      persisted: false,
    });

    expect(mocks.applyVisualEdit).toHaveBeenCalledWith(
      "<main>Details</main>",
      expect.any(Object),
      {
        source: {
          kind: "design-file",
          designId: "design_123",
          fileId: "file_details",
          filename: "details.html",
          revision: undefined,
        },
      },
    );
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design_123",
      "editor",
    );
  });
});
