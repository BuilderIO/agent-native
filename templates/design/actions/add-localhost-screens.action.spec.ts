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
    designFiles: {
      id: "files.id",
      designId: "files.designId",
      filename: "files.filename",
      fileType: "files.fileType",
      content: "files.content",
    },
  },
  state: {
    connection: {} as Record<string, unknown>,
    scopedConnections: [] as Array<Record<string, unknown>>,
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
    insertedFiles: [] as Array<Record<string, unknown>>,
    updatedFiles: [] as Array<{
      values: Record<string, unknown>;
      where: unknown;
    }>,
    updatedDesignData: null as Record<string, unknown> | null,
    insertConflictOnce: false,
    winnerFile: null as Record<string, unknown> | null,
    insertGenericErrorOnce: false,
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
  getRequestAuthCapability: () => undefined,
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
  sql: (...values: unknown[]) => values,
}));

vi.mock("../server/db/index.js", () => {
  const db = {
    select: () => {
      mocks.state.selectCount += 1;
      return {
        from: (table: unknown) => {
          if (table === mocks.schema.designLocalhostConnections) {
            const ordered = Object.assign(
              Promise.resolve(mocks.state.scopedConnections),
              {
                limit: () => Promise.resolve([mocks.state.connection]),
              },
            );
            return { where: () => ({ orderBy: () => ordered }) };
          }
          if (table === mocks.schema.designs) {
            return {
              where: () => ({
                limit: () =>
                  Promise.resolve([
                    { data: JSON.stringify(mocks.state.designData) },
                  ]),
              }),
            };
          }
          return {
            where: (condition: unknown) => {
              const conditions = Array.isArray(condition)
                ? condition
                : [condition];
              const matches = (file: Record<string, unknown>) =>
                conditions.every((entry) => {
                  const comparison = entry as {
                    left?: unknown;
                    right?: unknown;
                  };
                  const column = String(comparison.left).split(".").pop();
                  return column ? file[column] === comparison.right : true;
                });
              const matchedFiles = mocks.state.files.filter(matches);
              const candidates = mocks.state.winnerFile
                ? [mocks.state.winnerFile].filter(matches)
                : matchedFiles;
              return Object.assign(Promise.resolve(matchedFiles), {
                limit: () => Promise.resolve(candidates.slice(0, 1)),
              });
            },
          };
        },
      };
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        if (mocks.state.insertGenericErrorOnce) {
          mocks.state.insertGenericErrorOnce = false;
          throw new Error("boom: unrelated insert failure");
        }
        if (mocks.state.insertConflictOnce) {
          mocks.state.insertConflictOnce = false;
          const err = new Error(
            'duplicate key value violates unique constraint "design_files_design_filename_unique_idx"',
          );
          (err as unknown as { code: string }).code = "23505";
          throw err;
        }
        mocks.state.insertedFile = values;
        mocks.state.insertedFiles.push(values);
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
  };
  return {
    schema: mocks.schema,
    getDb: () => ({
      ...db,
      transaction: async (
        callback: (
          tx: typeof db & { execute: () => Promise<unknown> },
        ) => Promise<unknown>,
      ) => callback({ ...db, execute: async () => ({ rows: [] }) }),
    }),
  };
});

import { makeLocalhostRouteId } from "../shared/source-mode.js";
import action from "./add-localhost-screens.js";

describe("add-localhost-screens refresh behavior", () => {
  beforeEach(() => {
    mocks.state.selectCount = 0;
    mocks.state.insertedFile = null;
    mocks.state.insertedFiles = [];
    mocks.state.updatedFiles = [];
    mocks.state.updatedDesignData = null;
    mocks.state.insertConflictOnce = false;
    mocks.state.winnerFile = null;
    mocks.state.insertGenericErrorOnce = false;
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
    mocks.state.scopedConnections = [mocks.state.connection];
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
        content: "http://localhost:5173/settings",
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
          url: "http://localhost:5173/settings",
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

  it("refreshes a legacy primary screen when its URL content identifies the route", async () => {
    mocks.state.files = [
      {
        id: "legacy_file",
        designId: "design_1",
        filename: "localhost-settings.html",
        fileType: "html",
        content: "http://localhost:5173/settings",
      },
    ];
    mocks.state.designData = {
      screenMetadata: {
        legacy_file: { sourceType: "localhost", path: "/settings" },
      },
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
    expect(result.screens[0]?.id).toBe("legacy_file");
  });

  it("refreshes a legacy localhost screen when its content is inline HTML", async () => {
    mocks.state.files = [
      {
        id: "legacy_file",
        designId: "design_1",
        filename: "localhost-settings.html",
        fileType: "html",
        content: "<main>Existing screen</main>",
      },
    ];
    mocks.state.designData = {
      screenMetadata: {
        legacy_file: {
          sourceType: "localhost",
          connectionId: "conn_1",
          routeId: "route-settings",
          path: "/settings",
        },
      },
    };

    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_1",
      paths: ["/settings"],
      startX: 0,
      startY: 0,
      gap: 160,
    });

    expect(result.screens[0]?.id).toBe("legacy_file");
    expect(mocks.state.insertedFile).toBeNull();
    expect(mocks.state.updatedFiles).toHaveLength(1);
  });

  it("keeps query-backed routes distinct from the same pathname", async () => {
    mocks.state.files = [
      {
        id: "base_file",
        designId: "design_1",
        filename: "localhost-settings.html",
        fileType: "html",
        content: "http://localhost:5173/settings",
      },
    ];
    mocks.state.designData = {
      screenMetadata: {
        base_file: {
          sourceType: "localhost",
          connectionId: "conn_1",
          routeId: "route-settings",
          path: "/settings",
          url: "http://localhost:5173/settings",
        },
      },
    };

    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_1",
      paths: ["/settings?onboarding=preview"],
      startX: 0,
      startY: 0,
      gap: 160,
    });

    expect(result.screens[0]?.id).not.toBe("base_file");
    expect(mocks.state.insertedFile).toMatchObject({
      content: "http://localhost:5173/settings?onboarding=preview",
    });
  });

  it("keeps query variants distinct within one request", async () => {
    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_1",
      routes: [
        { routeId: "route-settings", path: "/settings" },
        {
          routeId: "route-settings",
          url: "http://localhost:5173/settings?onboarding=preview",
        },
      ],
      startX: 0,
      startY: 0,
      gap: 160,
    });

    expect(result.screens).toHaveLength(2);
    expect(result.screens.map((screen) => screen.url)).toEqual([
      "http://localhost:5173/settings",
      "http://localhost:5173/settings?onboarding=preview",
    ]);
    expect(mocks.state.insertedFiles).toHaveLength(2);
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

  it("never inserts two design_files rows for the same route requested twice in one call", async () => {
    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_1",
      paths: ["/settings", "/settings"],
      startX: 0,
      startY: 0,
      gap: 160,
    });

    expect(mocks.state.insertedFiles).toHaveLength(1);
    expect(mocks.state.insertedFiles[0]).toMatchObject({
      filename: "localhost-settings.html",
    });
    expect(result.screens).toHaveLength(1);
  });

  it("still creates distinct screens when the same route is requested twice with different explicit viewports", async () => {
    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_1",
      routes: [
        { path: "/settings", width: 1280, height: 900 },
        { path: "/settings", width: 390, height: 844 },
      ],
      startX: 0,
      startY: 0,
      gap: 160,
    });

    expect(mocks.state.insertedFiles).toHaveLength(2);
    expect(result.screens).toHaveLength(2);
  });

  it("deduplicates routes using their effective default viewport", async () => {
    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_1",
      defaultWidth: 1280,
      defaultHeight: 900,
      routes: [
        { path: "/settings" },
        { path: "/settings", width: 1280, height: 900 },
      ],
      startX: 0,
      startY: 0,
      gap: 160,
    });

    expect(mocks.state.insertedFiles).toHaveLength(1);
    expect(result.screens).toHaveLength(1);
  });

  it("routes an absolute URL to its registered loopback connection", async () => {
    mocks.state.scopedConnections.push({
      id: "conn_2",
      devServerUrl: "http://localhost:4173",
      bridgeUrl: "http://127.0.0.1:7332",
      bridgeToken: "example-bridge-token-2",
      previewToken: "example-preview-token-2",
      rootPath: "/tmp/example-app-2",
      updatedAt: "2026-07-09T00:00:02.000Z",
      routeManifest: JSON.stringify({
        version: 1,
        sourceType: "localhost",
        devServerUrl: "http://localhost:4173",
        routes: [],
      }),
    });

    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_1",
      routes: [{ url: "http://localhost:4173/settings" }],
      startX: 0,
      startY: 0,
      gap: 160,
    });

    expect(result.screens[0]).toMatchObject({
      connectionId: "conn_2",
      devServerUrl: "http://localhost:4173",
      bridgeUrl: "http://127.0.0.1:7332",
      previewToken: "example-preview-token-2",
      url: "http://localhost:4173/settings",
    });
    expect(mocks.state.insertedFile).toMatchObject({
      filename: expect.stringMatching(
        /^localhost-localhost-4173-settings-[a-z0-9]+\.html$/,
      ),
    });
    expect(mocks.state.updatedDesignData).toMatchObject({
      screenMetadata: {
        [result.screens[0]!.id]: {
          connectionId: "conn_2",
          bridgeUrl: "http://127.0.0.1:7332",
          previewToken: "example-preview-token-2",
        },
      },
    });
  });

  it("lets an explicit absolute URL choose the connection before path inference", async () => {
    mocks.state.scopedConnections.push({
      id: "conn_2",
      devServerUrl: "http://127.0.0.2:5173",
      bridgeUrl: "http://127.0.0.1:7332",
      bridgeToken: "example-bridge-token-2",
      previewToken: "example-preview-token-2",
      rootPath: "/tmp/example-app-2",
      updatedAt: "2026-07-09T00:00:02.000Z",
      routeManifest: JSON.stringify({
        version: 1,
        sourceType: "localhost",
        devServerUrl: "http://127.0.0.2:5173",
        routes: [],
      }),
    });
    mocks.state.connection.routeManifest = JSON.stringify({
      version: 1,
      sourceType: "localhost",
      devServerUrl: "http://localhost:5173",
      routes: [
        {
          id: "primary-settings",
          connectionId: "conn_1",
          path: "/settings",
        },
      ],
    });

    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_1",
      routes: [
        {
          path: "/settings",
          url: "http://127.0.0.2:5173/settings",
        },
      ],
      startX: 0,
      startY: 0,
      gap: 160,
    });

    expect(result.screens[0]).toMatchObject({
      connectionId: "conn_2",
      url: "http://127.0.0.2:5173/settings",
    });
  });

  it("keeps placed ids connection-aware for same-origin secondary routes", async () => {
    mocks.state.scopedConnections.push({
      id: "conn_2",
      devServerUrl: "http://localhost:5173",
      bridgeUrl: "http://127.0.0.1:7332",
      bridgeToken: "example-bridge-token-2",
      previewToken: "example-preview-token-2",
      rootPath: "/tmp/example-app-2",
      updatedAt: "2026-07-09T00:00:02.000Z",
      routeManifest: JSON.stringify({
        version: 1,
        sourceType: "localhost",
        devServerUrl: "http://localhost:5173",
        routes: [],
      }),
    });

    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_1",
      routes: [{ connectionId: "conn_2", path: "/settings" }],
      startX: 0,
      startY: 0,
      gap: 160,
    });

    expect(result.screens[0]?.routeId).toBe(
      makeLocalhostRouteId("conn_2:/settings"),
    );
    expect(result.screens[0]?.routeId).not.toBe(
      makeLocalhostRouteId("/settings"),
    );
  });

  it("rejects an ambiguous same-origin URL without route connection identity", async () => {
    mocks.state.scopedConnections.push({
      id: "conn_2",
      devServerUrl: "http://localhost:5173",
      bridgeUrl: "http://127.0.0.1:7332",
      bridgeToken: "example-bridge-token-2",
      previewToken: "example-preview-token-2",
      rootPath: "/tmp/example-app-2",
      updatedAt: "2026-07-09T00:00:02.000Z",
      routeManifest: JSON.stringify({
        version: 1,
        sourceType: "localhost",
        devServerUrl: "http://localhost:5173",
        routes: [],
      }),
    });

    await expect(
      action.run({
        designId: "design_1",
        connectionId: "conn_1",
        routes: [{ url: "http://localhost:5173/settings" }],
        startX: 0,
        startY: 0,
        gap: 160,
      }),
    ).rejects.toThrow(/Multiple localhost connections/);
  });

  it("does not reuse a connectionless legacy screen across same-origin roots", async () => {
    mocks.state.scopedConnections.push({
      id: "conn_2",
      devServerUrl: "http://localhost:5173",
      bridgeUrl: "http://127.0.0.1:7332",
      bridgeToken: "example-bridge-token-2",
      previewToken: "example-preview-token-2",
      rootPath: "/tmp/example-app-2",
      updatedAt: "2026-07-09T00:00:02.000Z",
      routeManifest: JSON.stringify({
        version: 1,
        sourceType: "localhost",
        devServerUrl: "http://localhost:5173",
        routes: [],
      }),
    });
    mocks.state.files = [
      {
        id: "legacy_file",
        designId: "design_1",
        filename: "localhost-settings.html",
        fileType: "html",
        content: "http://localhost:5173/settings?old=1",
      },
    ];
    mocks.state.designData = {
      screenMetadata: {
        legacy_file: { sourceType: "localhost", path: "/settings" },
      },
    };

    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_1",
      routes: [{ connectionId: "conn_2", path: "/settings" }],
      startX: 0,
      startY: 0,
      gap: 160,
    });

    expect(result.screens[0]?.id).not.toBe("legacy_file");
    expect(mocks.state.insertedFile).toMatchObject({
      filename: expect.stringMatching(
        /^localhost-conn-2-settings-[a-z0-9]+\.html$/,
      ),
    });
  });

  it("normalizes loopback URL aliases before matching manifest routes", async () => {
    mocks.state.scopedConnections.push({
      id: "conn_2",
      devServerUrl: "http://127.0.0.1:4173",
      bridgeUrl: "http://127.0.0.1:7332",
      bridgeToken: "example-bridge-token-2",
      previewToken: "example-preview-token-2",
      rootPath: "/tmp/example-app-2",
      updatedAt: "2026-07-09T00:00:02.000Z",
      routeManifest: JSON.stringify({
        version: 1,
        sourceType: "localhost",
        devServerUrl: "http://127.0.0.1:4173",
        routes: [
          {
            id: "secondary-settings",
            path: "/settings",
            url: "http://127.0.0.1:4173/settings",
          },
        ],
      }),
    });

    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_1",
      routes: [{ url: "http://localhost:4173/settings" }],
      startX: 0,
      startY: 0,
      gap: 160,
    });

    expect(result.screens[0]).toMatchObject({
      connectionId: "conn_2",
      routeId: "secondary-settings",
      url: "http://127.0.0.1:4173/settings",
    });
  });

  it("does not reuse a legacy path-only screen from another connection", async () => {
    mocks.state.scopedConnections.push({
      id: "conn_2",
      devServerUrl: "http://127.0.0.2:5173",
      bridgeUrl: "http://127.0.0.1:7332",
      bridgeToken: "example-bridge-token-2",
      previewToken: "example-preview-token-2",
      rootPath: "/tmp/example-app-2",
      updatedAt: "2026-07-09T00:00:02.000Z",
      routeManifest: JSON.stringify({
        version: 1,
        sourceType: "localhost",
        devServerUrl: "http://127.0.0.2:5173",
        routes: [],
      }),
    });
    mocks.state.files = [
      {
        id: "legacy_file",
        designId: "design_1",
        filename: "localhost-127-0-0-2-5173-settings.html",
        fileType: "html",
        content: "http://localhost:5173/settings?old=1",
      },
    ];
    mocks.state.designData = {
      screenMetadata: {
        legacy_file: { sourceType: "localhost", path: "/settings" },
      },
    };

    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_1",
      routes: [{ url: "http://127.0.0.2:5173/settings" }],
      startX: 0,
      startY: 0,
      gap: 160,
    });

    expect(result.screens[0]?.id).not.toBe("legacy_file");
    expect(mocks.state.insertedFile).toMatchObject({
      filename: expect.stringMatching(
        /^localhost-127-0-0-2-5173-settings-[a-z0-9]+\.html$/,
      ),
    });
  });

  it("resolves a persisted secondary route before selecting its connection", async () => {
    const secondaryConnection = {
      id: "conn_2",
      devServerUrl: "http://127.0.0.2:5173",
      bridgeUrl: "http://127.0.0.1:7332",
      bridgeToken: "example-bridge-token-2",
      previewToken: "example-preview-token-2",
      rootPath: "/tmp/example-app-2",
      updatedAt: "2026-07-09T00:00:02.000Z",
      routeManifest: JSON.stringify({
        version: 1,
        sourceType: "localhost",
        devServerUrl: "http://127.0.0.2:5173",
        routes: [],
      }),
    };
    mocks.state.scopedConnections.push(secondaryConnection);
    mocks.state.connection.routeManifest = JSON.stringify({
      version: 1,
      sourceType: "localhost",
      devServerUrl: "http://localhost:5173",
      routes: [
        {
          id: "route-secondary",
          connectionId: "conn_2",
          path: "/settings",
          url: "http://127.0.0.2:5173/settings",
          title: "Secondary settings",
        },
      ],
      generatedAt: "2026-07-09T00:00:00.000Z",
    });

    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_1",
      routes: [{ routeId: "route-secondary" }],
      startX: 0,
      startY: 0,
      gap: 160,
    });

    expect(result.screens[0]).toMatchObject({
      connectionId: "conn_2",
      devServerUrl: "http://127.0.0.2:5173",
      url: "http://127.0.0.2:5173/settings",
    });
    expect(mocks.state.insertedFile).toMatchObject({
      content: "http://127.0.0.2:5173/settings",
    });
  });

  it("does not inherit a primary route id for an explicit secondary connection", async () => {
    mocks.state.scopedConnections.push({
      id: "conn_2",
      devServerUrl: "http://127.0.0.2:5173",
      bridgeUrl: "http://127.0.0.1:7332",
      bridgeToken: "example-bridge-token-2",
      previewToken: "example-preview-token-2",
      rootPath: "/tmp/example-app-2",
      updatedAt: "2026-07-09T00:00:02.000Z",
      routeManifest: JSON.stringify({
        version: 1,
        sourceType: "localhost",
        devServerUrl: "http://127.0.0.2:5173",
        routes: [],
      }),
    });

    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_1",
      routes: [
        {
          connectionId: "conn_2",
          url: "http://127.0.0.2:5173/settings",
        },
      ],
      startX: 0,
      startY: 0,
      gap: 160,
    });

    expect(result.screens[0]?.routeId).not.toBe("route-settings");
  });

  it("recovers when a concurrent request wins the insert race for the same route/filename", async () => {
    mocks.state.insertConflictOnce = true;
    mocks.state.winnerFile = {
      id: "winner_file",
      designId: "design_1",
      filename: "localhost-settings.html",
      fileType: "html",
      content: "http://localhost:5173/settings",
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
    expect(result.screens).toHaveLength(1);
    expect(result.screens[0]?.id).toBe("winner_file");
    expect(result.placedFrames[0]?.fileId).toBe("winner_file");
  });

  it("does not adopt a colliding filename winner for another route", async () => {
    mocks.state.insertConflictOnce = true;
    mocks.state.winnerFile = {
      id: "winner_file",
      designId: "design_1",
      filename: "localhost-account-settings.html",
      fileType: "html",
      content: "http://localhost:5173/account-settings",
    };

    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_1",
      paths: ["/account/settings"],
      startX: 0,
      startY: 0,
      gap: 160,
    });

    expect(result.screens[0]?.id).not.toBe("winner_file");
    expect(mocks.state.updatedFiles).toHaveLength(0);
    expect(mocks.state.insertedFile).toMatchObject({
      filename: "localhost-account-settings-2.html",
      content: "http://localhost:5173/account/settings",
    });
  });

  it("rethrows a non-conflict insert error instead of silently swallowing it", async () => {
    mocks.state.insertGenericErrorOnce = true;

    await expect(
      action.run({
        designId: "design_1",
        connectionId: "conn_1",
        paths: ["/settings"],
        startX: 0,
        startY: 0,
        gap: 160,
      }),
    ).rejects.toThrow("boom: unrelated insert failure");
  });
});
