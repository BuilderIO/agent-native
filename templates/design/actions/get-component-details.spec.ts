import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  getDb: vi.fn(),
  resolveAccess: vi.fn(),
  schema: {
    designs: { id: "designs.id" },
    designShares: "designShares",
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      content: "designFiles.content",
    },
    componentIndex: {
      designId: "componentIndex.designId",
      name: "componentIndex.name",
    },
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(),
  assertAccess: mocks.assertAccess,
  resolveAccess: mocks.resolveAccess,
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => conditions),
  eq: vi.fn((left, right) => ({ left, right })),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: mocks.schema,
}));
vi.mock("../shared/source-mode.js", () => ({
  designSourceTypeFromData: () => "fusion",
}));

import {
  COMPONENT_ARCHIVE_ATTR,
  encodeComponentArchivePointer,
} from "../shared/component-archive.js";
import { COMPONENT_REF_ATTR } from "../shared/component-model.js";
import action from "./get-component-details.js";
import { canRestoreComponentMain } from "./get-component-details.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveAccess.mockResolvedValue({ resource: { data: "{}" } });
  mocks.assertAccess.mockRejectedValue(new Error("editor access required"));
});

describe("get-component-details", () => {
  it("requires editor access before reading connected-app metadata", async () => {
    await expect(
      action.run(
        { designId: "design_1", nodeId: "node_1" } as never,
        {} as never,
      ),
    ).rejects.toThrow("editor access required");

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design_1",
      "editor",
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("reports URL-backed details as typed unsupported instead of parsing the route as HTML", async () => {
    mocks.assertAccess.mockResolvedValue(undefined);
    const fileSelect = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
    };
    fileSelect.from.mockReturnValue(fileSelect);
    fileSelect.innerJoin.mockReturnValue(fileSelect);
    fileSelect.where.mockReturnValue(fileSelect);
    fileSelect.limit.mockResolvedValue([
      {
        id: "file-url",
        designId: "design_1",
        filename: "react-screen.html",
        content: "http://localhost:3000/products/card",
      },
    ]);
    mocks.getDb.mockReturnValue({
      select: vi.fn(() => fileSelect),
    });

    await expect(
      action.run(
        {
          designId: "design_1",
          nodeId: "card-main",
          fileId: "file-url",
        } as never,
        {} as never,
      ),
    ).rejects.toMatchObject({
      name: "ComponentDetailsUnsupportedError",
      code: "UNSUPPORTED_SOURCE",
      statusCode: 422,
    });
  });

  it("exposes restore only for an instance with a matching valid archive pointer", () => {
    const archive = encodeComponentArchivePointer({
      schemaVersion: 1,
      versionId: "checkpoint-1",
      fileId: "file-main",
      componentId: "cmp-card",
      mainNodeId: "main-root",
      sourceVersionHash: "hash-main",
    });
    const node = (dataAttributes: Record<string, string>) =>
      ({ dataAttributes }) as never;

    expect(
      canRestoreComponentMain(
        node({
          [COMPONENT_REF_ATTR]: "cmp-card",
          [COMPONENT_ARCHIVE_ATTR]: archive,
        }),
      ),
    ).toBe(true);
    expect(
      canRestoreComponentMain(
        node({
          [COMPONENT_REF_ATTR]: "cmp-other",
          [COMPONENT_ARCHIVE_ATTR]: archive,
        }),
      ),
    ).toBe(false);
    expect(
      canRestoreComponentMain(
        node({
          [COMPONENT_REF_ATTR]: "cmp-card",
          [COMPONENT_ARCHIVE_ATTR]: encodeURIComponent("{}"),
        }),
      ),
    ).toBe(false);
    expect(canRestoreComponentMain(node({}))).toBe(false);
  });
});
