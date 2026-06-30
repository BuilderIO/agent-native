import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "user@example.com",
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn().mockResolvedValue(undefined),
}));

const mockVerifyWriteGrant = vi.hoisted(() => vi.fn());
vi.mock("../server/lib/verify-write-grant.js", () => ({
  verifyWriteGrant: (...args: unknown[]) => mockVerifyWriteGrant(...args),
}));

let bridgeUrl = "http://127.0.0.1:7666";

function makeSelectChain(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  };
}

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => makeSelectChain([{ bridgeUrl }]),
  }),
  schema: {
    designLocalhostConnections: {
      id: "id",
      bridgeUrl: "bridgeUrl",
      ownerEmail: "ownerEmail",
    },
  },
}));

import action from "./write-local-file.js";

describe("write-local-file", () => {
  beforeEach(() => {
    bridgeUrl = "http://127.0.0.1:7666";
    mockVerifyWriteGrant.mockResolvedValue({
      rootPath: "/tmp/app",
      bridgeToken: "bridge-token",
      grantId: "grant-1",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
  });

  it("rejects persisted non-loopback bridge URLs before fetching", async () => {
    bridgeUrl = "https://example.com";

    await expect(
      action.run({
        designId: "design_1",
        connectionId: "conn_1",
        relPath: "index.html",
        content: "<h1>Hello</h1>",
      }),
    ).rejects.toThrow(/loopback/);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("writes to loopback bridge URLs with the grant token", async () => {
    await expect(
      action.run({
        designId: "design_1",
        connectionId: "conn_1",
        relPath: "index.html",
        content: "<h1>Hello</h1>",
      }),
    ).resolves.toMatchObject({ operation: "write", written: true });

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:7666/write-file",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Bridge-Token": "bridge-token",
        }),
      }),
    );
  });
});
