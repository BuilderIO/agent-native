import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  resolveScope: vi.fn(),
  connection: null as { previewToken: string; bridgeUrl: string } | null,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
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
          limit: () =>
            Promise.resolve(mocks.connection ? [mocks.connection] : []),
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
      bridgeUrl: "bridgeUrl",
    },
  },
}));

import action from "./refresh-localhost-preview-token.js";

beforeEach(() => {
  mocks.assertAccess.mockReset();
  mocks.resolveScope.mockReset();
  mocks.connection = {
    previewToken: "preview",
    bridgeUrl: "http://127.0.0.1:7331",
  };
  mocks.assertAccess.mockResolvedValue({
    role: "viewer",
    resource: {
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
});
