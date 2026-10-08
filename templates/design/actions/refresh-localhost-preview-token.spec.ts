import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  resolveScope: vi.fn(),
  connections: [] as Array<{
    id: string;
    previewToken: string;
    bridgeToken?: string | null;
    bridgeUrl: string;
  }>,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
}));

vi.mock("../server/lib/localhost-connection.js", () => ({
  resolveLocalhostConnectionScope: mocks.resolveScope,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mocks.connections),
        }),
      }),
    }),
  }),
  schema: {
    designLocalhostConnections: {
      id: "id",
      ownerEmail: "ownerEmail",
      orgId: "orgId",
      previewToken: "previewToken",
      bridgeToken: "bridgeToken",
      bridgeUrl: "bridgeUrl",
    },
  },
}));

import {
  deriveLiveEditCapability,
  deriveLiveEditRegistrationCapability,
} from "./connect-localhost.js";
import action from "./refresh-localhost-preview-token.js";

beforeEach(() => {
  mocks.assertAccess.mockReset();
  mocks.resolveScope.mockReset();
  mocks.connections = [
    {
      id: "conn_2",
      previewToken: "preview",
      bridgeUrl: "http://127.0.0.1:7331",
    },
  ];
  mocks.assertAccess.mockResolvedValue({
    role: "viewer",
    resource: {
      visibility: "public",
      data: JSON.stringify({
        sourceType: "localhost",
        connectionId: "conn_1",
        screenMetadata: { secondary: { connectionId: "conn_2" } },
      }),
    },
  });
  mocks.resolveScope.mockResolvedValue({
    ownerEmail: "owner@example.com",
    orgId: null,
  });
});

describe("refresh-localhost-preview-token", () => {
  it("binds public preview reads to a connection used by the design", async () => {
    await expect(
      action.run({
        designId: "design_1",
        connectionId: "conn_2",
        publicVisualEdit: true,
      }),
    ).resolves.toEqual({
      previewToken: "preview",
      bridgeUrl: "http://127.0.0.1:7331",
    });
    expect(mocks.resolveScope).toHaveBeenCalledWith({
      designId: "design_1",
      allowPublicViewer: true,
    });
  });

  it("derives a restart-safe preview token from the stored bridge token", async () => {
    mocks.assertAccess.mockResolvedValueOnce({
      role: "editor",
      resource: {
        visibility: "public",
        data: JSON.stringify({
          sourceType: "localhost",
          connectionId: "conn_1",
          screenMetadata: { secondary: { connectionId: "conn_2" } },
        }),
      },
    });
    mocks.connections = [
      {
        id: "conn_2",
        previewToken: "legacy-random-preview",
        bridgeToken: "stored-bridge-token",
        bridgeUrl: "http://127.0.0.1:7331",
      },
    ];

    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_2",
      publicVisualEdit: true,
    });

    expect(result.previewToken).not.toBe("legacy-random-preview");
    expect(result.previewToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.liveEditCapability).toBe(
      deriveLiveEditCapability("stored-bridge-token", "design_1"),
    );
    expect(result.liveEditCapability).toBe(
      "35a0a665bdfa09540ba0fa820572e5bdda7b4ce7d3a7906a6d90617063189130",
    );
    expect(result.liveEditCapability).not.toBe(
      deriveLiveEditCapability("stored-bridge-token", "design_2"),
    );
    expect(result.liveEditRegistrationCapability).toBe(
      deriveLiveEditRegistrationCapability("stored-bridge-token", "design_1"),
    );
  });

  it("gives a copied public viewer registration only, never pending access", async () => {
    mocks.connections = [
      {
        id: "conn_2",
        previewToken: "legacy-random-preview",
        bridgeToken: "stored-bridge-token",
        bridgeUrl: "http://127.0.0.1:7331",
      },
    ];

    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_2",
      publicVisualEdit: true,
    });

    expect(result.previewToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.liveEditRegistrationCapability).toBe(
      deriveLiveEditRegistrationCapability("stored-bridge-token", "design_1"),
    );
    expect(result).not.toHaveProperty("liveEditCapability");
    expect(mocks.resolveScope).toHaveBeenCalledWith({
      designId: "design_1",
      allowPublicViewer: true,
    });
  });

  it("issues live-edit capabilities to the design owner", async () => {
    mocks.assertAccess.mockResolvedValueOnce({
      role: "owner",
      resource: {
        visibility: "public",
        data: JSON.stringify({
          sourceType: "localhost",
          connectionId: "conn_2",
        }),
      },
    });
    mocks.connections = [
      {
        id: "conn_2",
        previewToken: "legacy-random-preview",
        bridgeToken: "stored-bridge-token",
        bridgeUrl: "http://127.0.0.1:7331",
      },
    ];

    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_2",
      publicVisualEdit: false,
    });

    expect(result.liveEditCapability).toBe(
      deriveLiveEditCapability("stored-bridge-token", "design_1"),
    );
    expect(result.liveEditRegistrationCapability).toBe(
      deriveLiveEditRegistrationCapability("stored-bridge-token", "design_1"),
    );
  });

  it("rejects a connection that is not part of the design", async () => {
    await expect(
      action.run({
        designId: "design_1",
        connectionId: "other-connection",
        publicVisualEdit: true,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.resolveScope).not.toHaveBeenCalled();
  });

  it("rejects public preview refresh for a private design", async () => {
    mocks.assertAccess.mockResolvedValueOnce({
      role: "viewer",
      resource: {
        visibility: "private",
        data: JSON.stringify({
          sourceType: "localhost",
          connectionId: "conn_1",
        }),
      },
    });

    await expect(
      action.run({
        designId: "design_1",
        connectionId: "conn_1",
        publicVisualEdit: true,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.resolveScope).not.toHaveBeenCalled();
  });

  it("rejects public preview refresh for a non-localhost design", async () => {
    mocks.assertAccess.mockResolvedValueOnce({
      role: "viewer",
      resource: {
        visibility: "public",
        data: JSON.stringify({ sourceType: "inline" }),
      },
    });

    await expect(
      action.run({
        designId: "design_1",
        connectionId: "conn_1",
        publicVisualEdit: true,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.resolveScope).not.toHaveBeenCalled();
  });

  it("allows a public mixed-source design to refresh its localhost screen", async () => {
    mocks.connections = [
      {
        id: "conn_1",
        previewToken: "preview-1",
        bridgeUrl: "http://127.0.0.1:7331",
      },
    ];
    mocks.assertAccess.mockResolvedValueOnce({
      role: "viewer",
      resource: {
        visibility: "public",
        data: JSON.stringify({
          sourceType: "inline",
          screenMetadata: { live: { connectionId: "conn_1" } },
        }),
      },
    });

    await expect(
      action.run({
        designId: "design_1",
        connectionId: "conn_1",
        publicVisualEdit: true,
      }),
    ).resolves.toMatchObject({ previewToken: "preview-1" });
  });

  it("returns every bound connection for the public canvas", async () => {
    mocks.connections = [
      {
        id: "conn_1",
        previewToken: "preview-1",
        bridgeUrl: "http://127.0.0.1:7331",
      },
      {
        id: "conn_2",
        previewToken: "preview-2",
        bridgeUrl: "http://127.0.0.1:7332",
      },
    ];

    await expect(
      action.run({
        designId: "design_1",
        publicVisualEdit: true,
      }),
    ).resolves.toMatchObject({
      connections: {
        conn_1: { previewToken: "preview-1" },
        conn_2: { previewToken: "preview-2" },
      },
    });
  });
});
