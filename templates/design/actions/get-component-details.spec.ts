import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accessFilter: vi.fn(() => "access-filter"),
  assertAccess: vi.fn(),
  fetchLocalhostSnapshot: vi.fn(),
  getDb: vi.fn(),
  resolveLocalhostBridgeConnection: vi.fn(),
  resolveLocalhostConnectionScope: vi.fn(),
  resolveAccess: vi.fn(),
  schema: {
    designs: { id: "designs.id", data: "designs.data" },
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
  accessFilter: mocks.accessFilter,
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
vi.mock("../server/lib/localhost-connection.js", () => ({
  fetchLocalhostSnapshot: mocks.fetchLocalhostSnapshot,
  resolveLocalhostBridgeConnection: mocks.resolveLocalhostBridgeConnection,
  resolveLocalhostConnectionScope: mocks.resolveLocalhostConnectionScope,
}));
vi.mock("../shared/source-mode.js", () => ({
  designConnectionIdFromData: () => undefined,
  designSourceTypeFromData: (value: unknown) => {
    if (typeof value !== "string") return "fusion";
    try {
      const parsed = JSON.parse(value) as { sourceType?: unknown };
      return parsed.sourceType === "localhost" ? "localhost" : "fusion";
    } catch {
      return "fusion";
    }
  },
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
  mocks.resolveLocalhostConnectionScope.mockResolvedValue({
    ownerEmail: "user@example.com",
    orgId: null,
  });
  mocks.resolveLocalhostBridgeConnection.mockResolvedValue({
    bridgeUrl: "http://127.0.0.1:7331",
  });
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

  it("maps URL-backed details from a live bridge snapshot and source provenance", async () => {
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.resolveAccess.mockResolvedValue({
      resource: { data: JSON.stringify({ sourceType: "localhost" }) },
    });
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
        data: JSON.stringify({
          screenMetadata: {
            "file-url": {
              connectionId: "connection_1",
              previewToken: "preview-token",
            },
          },
        }),
      },
    ]);
    const indexSelect = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn().mockResolvedValue([]),
    };
    indexSelect.from.mockReturnValue(indexSelect);
    indexSelect.where.mockReturnValue(indexSelect);
    mocks.getDb.mockReturnValue({
      select: vi
        .fn()
        .mockReturnValueOnce(fileSelect)
        .mockReturnValueOnce(indexSelect),
    });
    mocks.fetchLocalhostSnapshot.mockResolvedValue(`
      <main data-agent-native-node-id="react-screen">
        <section
          data-agent-native-node-id="card-main"
          data-agent-native-component="ReusableCard"
          data-source-file="src/App.tsx"
          data-source-line="3"
          data-source-column="1"
          data-component-name="ReusableCard"
        >Open</section>
      </main>
    `);

    await expect(
      action.run(
        {
          designId: "design_1",
          nodeId: "card-main",
          fileId: "file-url",
        } as never,
        {} as never,
      ),
    ).resolves.toMatchObject({
      sourceType: "localhost",
      name: "ReusableCard",
      instance: {
        name: "ReusableCard",
        instanceId: "card-main",
        nodeId: "card-main",
      },
      sourceLocation: {
        filePath: "src/App.tsx",
        line: 3,
        column: 1,
        componentName: "ReusableCard",
      },
    });
    expect(mocks.resolveLocalhostBridgeConnection).toHaveBeenCalledWith({
      connectionId: "connection_1",
      ownerEmail: "user@example.com",
      orgId: null,
    });
    expect(mocks.fetchLocalhostSnapshot).toHaveBeenCalledWith({
      bridgeUrl: "http://127.0.0.1:7331",
      previewToken: "preview-token",
      url: "http://localhost:3000/products/card",
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
