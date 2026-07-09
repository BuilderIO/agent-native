import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  applyText: vi.fn(),
  hasCollabState: vi.fn(),
  seedFromText: vi.fn(),
  mutateDesignData: vi.fn(),
  schema: {
    designLocalhostConnections: {
      id: "connections.id",
      ownerEmail: "connections.ownerEmail",
      orgId: "connections.orgId",
      updatedAt: "connections.updatedAt",
    },
    designs: { id: "designs.id", data: "designs.data" },
    designFiles: { id: "files.id", designId: "files.designId" },
  },
  state: {
    connection: {} as Record<string, unknown>,
    designData: {} as Record<string, unknown>,
    files: [] as Array<{
      id: string;
      designId: string;
      filename: string;
      fileType: string;
      content: string;
    }>,
    selectCount: 0,
    insertedFile: null as Record<string, unknown> | null,
    updatedFiles: [] as Array<{
      values: Record<string, unknown>;
      where: unknown;
    }>,
    updatedDesignData: null as Record<string, unknown> | null,
  },
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (config: unknown) => config,
  embedApp: (config: unknown) => config,
}));
vi.mock("@agent-native/core/collab", () => ({
  applyText: mocks.applyText,
  hasCollabState: mocks.hasCollabState,
  seedFromText: mocks.seedFromText,
}));
vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: ({ to }: { to: string }) => to,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "user@example.com",
  getRequestOrgId: () => "org_1",
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));
vi.mock("../server/lib/design-data-mutation.js", () => ({
  mutateDesignData: mocks.mutateDesignData,
}));
vi.mock("drizzle-orm", () => ({
  and: (...values: unknown[]) => values,
  desc: (value: unknown) => value,
  eq: (left: unknown, right: unknown) => ({ left, right }),
  isNull: (value: unknown) => ({ isNull: value }),
}));

vi.mock("../server/db/index.js", () => ({
  schema: mocks.schema,
  getDb: () => ({
    select: () => {
      mocks.state.selectCount += 1;
      if (mocks.state.selectCount === 1) {
        return {
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: () => Promise.resolve([mocks.state.connection]),
              }),
            }),
          }),
        };
      }
      if (mocks.state.selectCount === 2) {
        return {
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([
                  { data: JSON.stringify(mocks.state.designData) },
                ]),
            }),
          }),
        };
      }
      return {
        from: () => ({ where: () => Promise.resolve(mocks.state.files) }),
      };
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        mocks.state.insertedFile = values;
        return Promise.resolve();
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (where: unknown) => {
          if (table === mocks.schema.designs) {
            mocks.state.updatedDesignData = JSON.parse(
              String(values.data),
            ) as Record<string, unknown>;
          } else {
            mocks.state.updatedFiles.push({ values, where });
          }
          return Promise.resolve();
        },
      }),
    }),
  }),
}));

import action from "./add-localhost-screens.js";

describe("add-localhost-screens refresh behavior", () => {
  beforeEach(() => {
    mocks.state.selectCount = 0;
    mocks.state.insertedFile = null;
    mocks.state.updatedFiles = [];
    mocks.state.updatedDesignData = null;
    mocks.assertAccess.mockReset().mockResolvedValue(undefined);
    mocks.applyText.mockReset().mockResolvedValue(undefined);
    mocks.hasCollabState.mockReset().mockResolvedValue(false);
    mocks.seedFromText.mockReset().mockResolvedValue(undefined);
    mocks.mutateDesignData
      .mockReset()
      .mockImplementation(
        async ({
          mutate,
          isApplied,
        }: {
          mutate: (
            data: Record<string, unknown>,
            context: { updatedAt: string },
          ) => Record<string, unknown>;
          isApplied: (data: Record<string, unknown>) => boolean;
        }) => {
          const updatedAt = "2026-07-09T00:00:01.000Z";
          const data = mutate(mocks.state.designData, { updatedAt });
          if (!isApplied(data)) throw new Error("mutation intent not applied");
          mocks.state.designData = data;
          mocks.state.updatedDesignData = data;
          return { data, updatedAt };
        },
      );
    mocks.state.connection = {
      id: "conn_1",
      devServerUrl: "http://localhost:5173",
      bridgeUrl: "http://127.0.0.1:7331",
      bridgeToken: "example-bridge-token",
      previewToken: "example-preview-token",
      rootPath: "/tmp/example-app",
      updatedAt: "2026-07-09T00:00:00.000Z",
      routeManifest: JSON.stringify({
        version: 1,
        sourceType: "localhost",
        devServerUrl: "http://localhost:5173",
        routes: [
          {
            id: "route-settings",
            path: "/settings",
            title: "Settings",
            sourceFile: "app/routes/settings.tsx",
            sourceKind: "react-router",
            metadata: { snapshotRef: "snapshot-current" },
          },
        ],
        generatedAt: "2026-07-09T00:00:00.000Z",
      }),
    };
    mocks.state.designData = {};
    mocks.state.files = [];
  });

  it("refreshes a URL without moving/resizing its arranged frame or dropping metadata", async () => {
    mocks.state.files = [
      {
        id: "file_1",
        designId: "design_1",
        filename: "localhost-settings.html",
        fileType: "html",
        content: "http://localhost:5173/settings?old=1",
      },
    ];
    mocks.state.designData = {
      sourceMode: "localhost",
      canvasFrames: {
        file_1: { x: 620, y: 340, width: 390, height: 844, z: 7 },
      },
      screenMetadata: {
        file_1: {
          sourceType: "localhost",
          connectionId: "conn_1",
          routeId: "route-settings",
          path: "/settings",
          url: "http://localhost:5173/settings?old=1",
          stateRef: "state-selected-tab",
          routeMetadata: { stateName: "selected-tab" },
        },
      },
      localhostScreens: {},
    };

    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_1",
      paths: ["/settings"],
      startX: 0,
      startY: 0,
      gap: 160,
    });

    expect(mocks.state.insertedFile).toBeNull();
    expect(mocks.state.updatedFiles).toHaveLength(1);
    expect(result.placedFrames[0]?.frame).toMatchObject({
      x: 620,
      y: 340,
      width: 390,
      height: 844,
      z: 7,
    });
    expect(mocks.state.updatedDesignData).toMatchObject({
      sourceType: "localhost",
      sourceMode: "localhost",
      connectionId: "conn_1",
      canvasFrames: {
        file_1: { x: 620, y: 340, width: 390, height: 844, z: 7 },
      },
      screenMetadata: {
        file_1: {
          stateRef: "state-selected-tab",
          sourceFile: "app/routes/settings.tsx",
          sourceKind: "react-router",
          routeMetadata: {
            stateName: "selected-tab",
            snapshotRef: "snapshot-current",
          },
        },
      },
    });
    const metadata = (
      mocks.state.updatedDesignData?.screenMetadata as Record<
        string,
        Record<string, unknown>
      >
    ).file_1;
    expect(metadata.previewToken).toBe("example-preview-token");
    expect(metadata).not.toHaveProperty("bridgeToken");
  });

  it("never overwrites an unrelated inline file that uses the generated localhost filename", async () => {
    mocks.state.connection.routeManifest = JSON.stringify({
      version: 1,
      sourceType: "localhost",
      devServerUrl: "http://localhost:5173",
      routes: [{ id: "route-root", path: "/", title: "Home" }],
      generatedAt: "2026-07-09T00:00:00.000Z",
    });
    mocks.state.files = [
      {
        id: "inline_file",
        designId: "design_1",
        filename: "localhost-home.html",
        fileType: "html",
        content: "<main>Keep me</main>",
      },
    ];
    mocks.state.designData = {
      screenMetadata: {
        inline_file: { sourceType: "inline" },
      },
    };

    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_1",
      paths: ["/"],
      startX: 0,
      startY: 0,
      gap: 160,
    });

    expect(mocks.state.updatedFiles).toHaveLength(0);
    expect(mocks.state.insertedFile).toMatchObject({
      filename: "localhost-home-2.html",
      content: "http://localhost:5173/",
    });
    expect(result.screens[0]?.filename).toBe("localhost-home-2.html");
  });
});
