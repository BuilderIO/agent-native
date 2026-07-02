import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "user@example.com",
  getRequestOrgId: () => "org_1",
}));

vi.mock("nanoid", () => ({ nanoid: () => "fixed_connection_id" }));

type ExistingConnection = {
  id: string;
  bridgeToken: string | null;
};

let existingConnection: ExistingConnection | null = null;
let insertedValues: Record<string, unknown> | null = null;
let updatedSet: Record<string, unknown> | null = null;

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
    select: () =>
      makeSelectChain(existingConnection ? [existingConnection] : []),
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        insertedValues = vals;
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => {
        updatedSet = vals;
        return {
          where: () => Promise.resolve(),
        };
      },
    }),
  }),
  schema: {
    designLocalhostConnections: {
      id: "id",
      bridgeToken: "bridgeToken",
      ownerEmail: "ownerEmail",
    },
  },
}));

import action from "./connect-localhost.js";

beforeEach(() => {
  existingConnection = null;
  insertedValues = null;
  updatedSet = null;
});

describe("connect-localhost", () => {
  it("preserves an existing bridge token when a refresh omits bridgeToken", async () => {
    existingConnection = {
      id: "conn_1",
      bridgeToken: "existing_bridge_token",
    };

    await action.run({
      id: "conn_1",
      devServerUrl: "http://localhost:5173",
      bridgeUrl: "http://127.0.0.1:7666",
      rootPath: "/tmp/app",
    });

    expect(updatedSet?.bridgeToken).toBe("existing_bridge_token");
    expect(insertedValues).toBeNull();
  });

  it("stores a new bridge token when the bridge provides one", async () => {
    existingConnection = {
      id: "conn_1",
      bridgeToken: "old_bridge_token",
    };

    await action.run({
      id: "conn_1",
      devServerUrl: "http://localhost:5173",
      bridgeUrl: "http://127.0.0.1:7666",
      rootPath: "/tmp/app",
      bridgeToken: " new_bridge_token ",
    });

    expect(updatedSet?.bridgeToken).toBe("new_bridge_token");
  });

  it("rejects non-loopback bridge URLs", async () => {
    await expect(
      action.run({
        id: "conn_1",
        devServerUrl: "http://localhost:5173",
        bridgeUrl: "https://example.com:7666",
        rootPath: "/tmp/app",
      }),
    ).rejects.toThrow(/loopback/);
  });
});
