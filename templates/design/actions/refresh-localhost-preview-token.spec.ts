import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  getRequestUserEmail: vi.fn(),
  resolveScope: vi.fn(),
  eq: vi.fn(),
  connections: [] as Array<{
    id: string;
    previewToken?: string | null;
    bridgeToken?: string | null;
    bridgeUrl: string;
  }>,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: mocks.eq,
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
  mocks.getRequestUserEmail.mockReset();
  mocks.resolveScope.mockReset();
  mocks.eq.mockReset();
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
  it("does not issue a bridge token to a public viewer", async () => {
    mocks.connections = [
      {
        id: "conn_2",
        previewToken: "legacy-random-preview",
        bridgeToken: "owner-bridge-token",
        bridgeUrl: "http://127.0.0.1:7331",
      },
    ];
    await expect(
      action.run({
        designId: "design_1",
        connectionId: "conn_2",
        publicVisualEdit: true,
      }),
    ).resolves.toEqual({
      status: "unavailable",
      errorCode: "public_localhost_preview_unavailable",
    });
    expect(mocks.resolveScope).not.toHaveBeenCalled();
  });

  it("refreshes only requested connections when stale metadata remains", async () => {
    mocks.getRequestUserEmail.mockReturnValue("editor@example.com");
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
    const result = await action.run({
      designId: "design_1",
      connectionIds: ["conn_2"],
    });

    expect(result.connections).toEqual({
      conn_2: {
        status: "available",
        previewToken: "preview",
        bridgeUrl: "http://127.0.0.1:7331",
      },
    });
  });

  it("derives a restart-safe preview token from the stored bridge token", async () => {
    mocks.getRequestUserEmail.mockReturnValue("editor@example.com");
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

  it("does not expose preview or registration credentials to public viewers", async () => {
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

    expect(result).toEqual({
      status: "unavailable",
      errorCode: "public_localhost_preview_unavailable",
    });
    expect(result).not.toHaveProperty("previewToken");
    expect(result).not.toHaveProperty("liveEditRegistrationCapability");
    expect(result).not.toHaveProperty("liveEditCapability");
    expect(mocks.resolveScope).not.toHaveBeenCalled();
  });

  it("withholds public viewer credentials when the request omits or disables the public flag", async () => {
    mocks.connections = [
      {
        id: "conn_2",
        previewToken: "legacy-random-preview",
        bridgeToken: "stored-bridge-token",
        bridgeUrl: "http://127.0.0.1:7331",
      },
    ];

    for (const publicVisualEdit of [undefined, false]) {
      const result = await action.run({
        designId: "design_1",
        connectionId: "conn_2",
        ...(publicVisualEdit === undefined ? {} : { publicVisualEdit }),
      });

      expect(result).toEqual({
        status: "unavailable",
        errorCode: "public_localhost_preview_unavailable",
      });
      expect(result).not.toHaveProperty("previewToken");
      expect(result).not.toHaveProperty("liveEditRegistrationCapability");
      expect(result).not.toHaveProperty("liveEditCapability");
    }

    expect(mocks.resolveScope).not.toHaveBeenCalled();
  });

  it("withholds public credentials from a capability-only session with editor access", async () => {
    mocks.assertAccess.mockResolvedValueOnce({
      role: "editor",
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

    expect(result).toEqual({
      status: "unavailable",
      errorCode: "public_localhost_preview_unavailable",
    });
    expect(mocks.resolveScope).not.toHaveBeenCalled();
  });

  it("withholds credentials from the read-only local visual-edit principal even if it resolves as owner", async () => {
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
    mocks.getRequestUserEmail.mockReturnValue(
      "bridge+abc123@local.visual-edit.agent-native.invalid",
    );
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

    expect(result).toEqual({
      status: "unavailable",
      errorCode: "public_localhost_preview_unavailable",
    });
    expect(mocks.resolveScope).not.toHaveBeenCalled();
  });

  it("does not expose bridge credentials to public commenters", async () => {
    mocks.assertAccess.mockResolvedValueOnce({
      role: "commenter",
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
      publicVisualEdit: true,
    });

    expect(result).toEqual({
      status: "unavailable",
      errorCode: "public_localhost_preview_unavailable",
    });
    expect(mocks.resolveScope).not.toHaveBeenCalled();
  });

  it("issues live-edit capabilities to the design owner", async () => {
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
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

  it("does not expose a design owner's connection to a shared editor", async () => {
    mocks.getRequestUserEmail.mockReturnValue("editor@example.com");
    mocks.connections = [];
    mocks.resolveScope.mockResolvedValueOnce({
      ownerEmail: "editor@example.com",
      orgId: "editor-org",
    });
    mocks.assertAccess.mockResolvedValueOnce({
      role: "editor",
      resource: {
        ownerEmail: "design-owner@example.com",
        orgId: "design-org",
        visibility: "public",
        data: JSON.stringify({
          sourceType: "localhost",
          connectionId: "conn_2",
        }),
      },
    });

    await expect(
      action.run({
        designId: "design_1",
        connectionId: "conn_2",
        publicVisualEdit: true,
      }),
    ).rejects.toMatchObject({
      errorCode: "localhost_preview_credentials_unavailable",
      statusCode: 424,
    });

    expect(mocks.eq).toHaveBeenCalledWith("ownerEmail", "editor@example.com");
    expect(mocks.eq).toHaveBeenCalledWith("orgId", "editor-org");
    expect(mocks.resolveScope).toHaveBeenCalledWith({ designId: "design_1" });
  });

  it("refreshes a shared editor's own localhost connection", async () => {
    mocks.connections = [
      {
        id: "conn_2",
        previewToken: "editor-preview",
        bridgeUrl: "http://127.0.0.1:7331",
      },
    ];
    mocks.resolveScope.mockResolvedValueOnce({
      ownerEmail: "editor@example.com",
      orgId: "editor-org",
    });
    mocks.assertAccess.mockResolvedValueOnce({
      role: "editor",
      resource: {
        ownerEmail: "design-owner@example.com",
        orgId: "design-org",
        visibility: "private",
        data: JSON.stringify({
          sourceType: "localhost",
          connectionId: "conn_2",
        }),
      },
    });

    await expect(
      action.run({
        designId: "design_1",
        connectionId: "conn_2",
      }),
    ).resolves.toMatchObject({
      previewToken: "editor-preview",
      bridgeUrl: "http://127.0.0.1:7331",
    });

    expect(mocks.eq).toHaveBeenCalledWith("ownerEmail", "editor@example.com");
    expect(mocks.eq).toHaveBeenCalledWith("orgId", "editor-org");
    expect(mocks.resolveScope).toHaveBeenCalledWith({ designId: "design_1" });
    expect(mocks.eq).not.toHaveBeenCalledWith(
      "ownerEmail",
      "design-owner@example.com",
    );
  });

  it("resolves the design scope for a capability-only visual-edit caller", async () => {
    mocks.assertAccess.mockResolvedValueOnce({
      role: "editor",
      resource: {
        ownerEmail: "design-owner@example.com",
        orgId: "design-org",
        data: JSON.stringify({
          sourceType: "localhost",
          connectionId: "conn_2",
        }),
      },
    });
    mocks.resolveScope.mockResolvedValueOnce({
      ownerEmail: "design-owner@example.com",
      orgId: "design-org",
    });
    mocks.connections = [
      {
        id: "conn_2",
        previewToken: "owner-preview",
        bridgeUrl: "http://127.0.0.1:7331",
      },
    ];

    await expect(
      action.run({ designId: "design_1", connectionId: "conn_2" }),
    ).resolves.toMatchObject({ previewToken: "owner-preview" });

    expect(mocks.resolveScope).toHaveBeenCalledWith({ designId: "design_1" });
    expect(mocks.eq).toHaveBeenCalledWith(
      "ownerEmail",
      "design-owner@example.com",
    );
    expect(mocks.eq).toHaveBeenCalledWith("orgId", "design-org");
  });

  it("returns caller-owned preview credentials when other Screens use another scope", async () => {
    mocks.assertAccess.mockResolvedValueOnce({
      role: "editor",
      resource: {
        ownerEmail: "design-owner@example.com",
        orgId: "design-org",
        data: JSON.stringify({
          sourceType: "localhost",
          connectionId: "owner-connection",
          screenMetadata: {
            editorScreen: { connectionId: "editor-connection" },
          },
        }),
      },
    });
    mocks.resolveScope.mockResolvedValueOnce({
      ownerEmail: "editor@example.com",
      orgId: "editor-org",
    });
    mocks.connections = [
      {
        id: "editor-connection",
        previewToken: "editor-preview",
        bridgeUrl: "http://127.0.0.1:7332",
      },
    ];

    await expect(
      action.run({
        designId: "design_1",
        connectionIds: ["owner-connection", "editor-connection"],
      }),
    ).resolves.toEqual({
      connections: {
        "owner-connection": {
          status: "unavailable",
          errorCode: "localhost_preview_credentials_unavailable",
        },
        "editor-connection": {
          status: "available",
          previewToken: "editor-preview",
          bridgeUrl: "http://127.0.0.1:7332",
        },
      },
    });

    expect(mocks.resolveScope).toHaveBeenCalledWith({ designId: "design_1" });
    expect(mocks.eq).toHaveBeenCalledWith("ownerEmail", "editor@example.com");
    expect(mocks.eq).not.toHaveBeenCalledWith(
      "ownerEmail",
      "design-owner@example.com",
    );
  });

  it("marks a scoped connection without credentials as unavailable", async () => {
    mocks.getRequestUserEmail.mockReturnValue("editor@example.com");
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
        previewToken: null,
        bridgeUrl: "http://127.0.0.1:7331",
      },
    ];

    await expect(
      action.run({
        designId: "design_1",
        connectionIds: ["conn_2"],
      }),
    ).resolves.toEqual({
      connections: {
        conn_2: {
          status: "unavailable",
          errorCode: "localhost_preview_credentials_unavailable",
        },
      },
    });
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

  it("rejects a requested connection set that contains an unbound connection", async () => {
    await expect(
      action.run({
        designId: "design_1",
        connectionIds: ["conn_2", "other-connection"],
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

  it("marks public localhost screens unavailable in mixed-source designs", async () => {
    mocks.connections = [
      {
        id: "conn_1",
        previewToken: "preview-1",
        bridgeToken: "bridge-token-1",
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
    ).resolves.toEqual({
      status: "unavailable",
      errorCode: "public_localhost_preview_unavailable",
    });
  });

  it("marks each localhost connection unavailable for a public canvas", async () => {
    mocks.connections = [
      {
        id: "conn_1",
        previewToken: "preview-1",
        bridgeToken: "bridge-token-1",
        bridgeUrl: "http://127.0.0.1:7331",
      },
      {
        id: "conn_2",
        previewToken: "preview-2",
        bridgeToken: "bridge-token-2",
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
        conn_1: {
          status: "unavailable",
          errorCode: "public_localhost_preview_unavailable",
        },
        conn_2: {
          status: "unavailable",
          errorCode: "public_localhost_preview_unavailable",
        },
      },
    });
  });

  it("marks public preview unavailable even when only a legacy preview token exists", async () => {
    await expect(
      action.run({
        designId: "design_1",
        connectionId: "conn_2",
        publicVisualEdit: true,
      }),
    ).resolves.toEqual({
      status: "unavailable",
      errorCode: "public_localhost_preview_unavailable",
    });
  });
});
