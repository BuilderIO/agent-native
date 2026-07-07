import crypto from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const requestContextMock = vi.hoisted(() => ({
  orgId: "org_1" as string | null,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "user@example.com",
  getRequestOrgId: () => requestContextMock.orgId,
}));

type ExistingConnection = {
  ownerEmail: string;
  bridgeToken: string | null;
};

let existingConnection: ExistingConnection | null = null;
let insertedValues: Record<string, unknown> | null = null;
let upsertConfig: {
  target: unknown;
  set: Record<string, unknown>;
  setWhere?: unknown;
} | null = null;

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
        return {
          onConflictDoUpdate: (config: {
            target: unknown;
            set: Record<string, unknown>;
            setWhere?: unknown;
          }) => {
            upsertConfig = config;
            return Promise.resolve();
          },
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
  requestContextMock.orgId = "org_1";
  existingConnection = null;
  insertedValues = null;
  upsertConfig = null;
});

describe("connect-localhost", () => {
  it("derives the stable per-user connection id when id is omitted", async () => {
    await action.run({
      devServerUrl: "http://localhost:5173/",
      bridgeUrl: "http://127.0.0.1:7666",
      rootPath: "/tmp/app",
      bridgeToken: "bridge_token",
    });

    const hash = crypto
      .createHash("sha256")
      .update("user@example.com\norg_1\nhttp://localhost:5173\n/tmp/app")
      .digest("base64url")
      .slice(0, 16);
    const expectedId = `localhost_${hash}`;
    expect(insertedValues?.id).toBe(expectedId);
    expect(upsertConfig?.set.id).toBe(expectedId);
  });

  it("scopes derived connection ids by org", async () => {
    await action.run({
      devServerUrl: "http://localhost:5173/",
      bridgeUrl: "http://127.0.0.1:7666",
      rootPath: "/tmp/app",
    });
    const firstOrgId = insertedValues?.id;

    requestContextMock.orgId = "org_2";
    insertedValues = null;
    upsertConfig = null;

    await action.run({
      devServerUrl: "http://localhost:5173/",
      bridgeUrl: "http://127.0.0.1:7666",
      rootPath: "/tmp/app",
    });

    expect(insertedValues?.id).not.toBe(firstOrgId);
  });

  it("preserves an existing bridge token when a refresh omits bridgeToken", async () => {
    existingConnection = {
      ownerEmail: "user@example.com",
      bridgeToken: "existing_bridge_token",
    };

    await action.run({
      id: "conn_1",
      devServerUrl: "http://localhost:5173",
      bridgeUrl: "http://127.0.0.1:7666",
      rootPath: "/tmp/app",
    });

    expect(insertedValues?.bridgeToken).toBe("existing_bridge_token");
    expect(upsertConfig?.set.bridgeToken).toBe("existing_bridge_token");
  });

  it("stores a new bridge token when the bridge provides one", async () => {
    existingConnection = {
      ownerEmail: "user@example.com",
      bridgeToken: "old_bridge_token",
    };

    await action.run({
      id: "conn_1",
      devServerUrl: "http://localhost:5173",
      bridgeUrl: "http://127.0.0.1:7666",
      rootPath: "/tmp/app",
      bridgeToken: " new_bridge_token ",
    });

    expect(insertedValues?.bridgeToken).toBe("new_bridge_token");
    expect(upsertConfig?.set.bridgeToken).toBe("new_bridge_token");
  });

  it("writes through a single upsert guarded by ownerEmail (no check-then-insert race)", async () => {
    await action.run({
      id: "conn_new",
      devServerUrl: "http://localhost:5173",
      bridgeUrl: "http://127.0.0.1:7666",
      rootPath: "/tmp/app",
    });

    // Insert values and upsert set carry the same owner scoping.
    expect(insertedValues?.ownerEmail).toBe("user@example.com");
    expect(upsertConfig?.set.ownerEmail).toBe("user@example.com");
    // setWhere must be present so a cross-user conflict filters to a no-op
    // instead of overwriting the other user's row.
    expect(upsertConfig?.setWhere).toBeDefined();
  });

  it("rejects a connection id that belongs to another user (VE3 regression)", async () => {
    existingConnection = {
      ownerEmail: "someone-else@example.com",
      bridgeToken: "their_token",
    };

    await expect(
      action.run({
        id: "conn_1",
        devServerUrl: "http://localhost:5173",
        bridgeUrl: "http://127.0.0.1:7666",
        rootPath: "/tmp/app",
      }),
    ).rejects.toThrow(/another user/);

    // Nothing may be written for the colliding id.
    expect(insertedValues).toBeNull();
    expect(upsertConfig).toBeNull();
  });

  it("does not reuse another user's bridge token on a colliding id", async () => {
    existingConnection = {
      ownerEmail: "someone-else@example.com",
      bridgeToken: "their_token",
    };

    await expect(
      action.run({
        id: "conn_1",
        devServerUrl: "http://localhost:5173",
        rootPath: "/tmp/app",
      }),
    ).rejects.toThrow(/another user/);
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
