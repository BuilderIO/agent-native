import crypto from "node:crypto";

import { SQL } from "drizzle-orm";
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
  orgId: string | null;
  bridgeToken: string | null;
  previewToken?: string | null;
};

let existingConnection: ExistingConnection | null = null;
// Row the post-upsert reread sees (the value actually persisted). `undefined`
// mirrors `existingConnection`; set it explicitly to model a race winner or a
// cross-user no-op where the owner-scoped reread finds nothing.
let rereadRow:
  | { bridgeToken: string | null; previewToken?: string | null }
  | null
  | undefined = undefined;
let selectCallCount = 0;
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
    select: () => {
      // 1st select = ownership pre-check; 2nd = post-upsert reread.
      selectCallCount += 1;
      if (selectCallCount >= 2 && rereadRow !== undefined) {
        return makeSelectChain(rereadRow ? [rereadRow] : []);
      }
      return makeSelectChain(existingConnection ? [existingConnection] : []);
    },
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
      previewToken: "previewToken",
      bridgeToken: "bridgeToken",
      ownerEmail: "ownerEmail",
      orgId: "orgId",
    },
  },
}));

import action, { derivePreviewToken } from "./connect-localhost.js";

beforeEach(() => {
  requestContextMock.orgId = "org_1";
  existingConnection = null;
  rereadRow = undefined;
  selectCallCount = 0;
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
      orgId: "org_1",
      bridgeToken: "existing_bridge_token",
    };

    const result = await action.run({
      id: "conn_1",
      devServerUrl: "http://localhost:5173",
      bridgeUrl: "http://127.0.0.1:7666",
      rootPath: "/tmp/app",
    });

    // Insert reuses the existing token; the conflict set uses a coalesce()
    // expression that fills a null token but never clobbers an existing one.
    expect(insertedValues?.bridgeToken).toBe("existing_bridge_token");
    expect(upsertConfig?.set.bridgeToken).toBeInstanceOf(SQL);
    // The action returns the token the row actually holds (read back).
    expect(result.bridgeToken).toBe("existing_bridge_token");
    expect(result.previewToken).toBe(
      derivePreviewToken("existing_bridge_token"),
    );
  });

  it("stores a new bridge token when the bridge provides one", async () => {
    existingConnection = {
      ownerEmail: "user@example.com",
      orgId: "org_1",
      bridgeToken: "old_bridge_token",
    };
    rereadRow = { bridgeToken: "new_bridge_token" }; // DB state after overwrite

    const result = await action.run({
      id: "conn_1",
      devServerUrl: "http://localhost:5173",
      bridgeUrl: "http://127.0.0.1:7666",
      rootPath: "/tmp/app",
      bridgeToken: " new_bridge_token ",
    });

    // An explicit token overwrites unconditionally (literal, not coalesce).
    expect(insertedValues?.bridgeToken).toBe("new_bridge_token");
    expect(upsertConfig?.set.bridgeToken).toBe("new_bridge_token");
    expect(result.bridgeToken).toBe("new_bridge_token");
    expect(result.previewToken).toBe(derivePreviewToken("new_bridge_token"));
  });

  it("mints and persists a token when the existing row has none (legacy null)", async () => {
    existingConnection = {
      ownerEmail: "user@example.com",
      orgId: "org_1",
      bridgeToken: null,
    };

    const result = await action.run({
      id: "conn_1",
      devServerUrl: "http://localhost:5173",
      rootPath: "/tmp/app",
    });

    // A fresh 64-hex token is minted and carried on the insert, and the conflict
    // set coalesces so a null legacy row gets filled instead of staying tokenless.
    expect(insertedValues?.bridgeToken).toMatch(/^[0-9a-f]{64}$/);
    expect(upsertConfig?.set.bridgeToken).toBeInstanceOf(SQL);
    // The caller always receives a usable token (never null/undefined).
    expect(result.bridgeToken).toBe(insertedValues?.bridgeToken);
    expect(result.previewToken).toBe(insertedValues?.previewToken);
  });

  it("returns the token the row actually holds, not the one this call minted", async () => {
    // Two concurrent first-time callers each mint; by read-back time another
    // call's token is what persisted. We must return the persisted winner.
    existingConnection = null;
    rereadRow = { bridgeToken: "winner_token" };

    const result = await action.run({
      id: "conn_race",
      devServerUrl: "http://localhost:5173",
      rootPath: "/tmp/app",
    });

    expect(insertedValues?.bridgeToken).toMatch(/^[0-9a-f]{64}$/);
    expect(selectCallCount).toBe(2); // pre-check + post-upsert reread
    expect(result.bridgeToken).toBe("winner_token");
    expect(result.previewToken).toBe(derivePreviewToken("winner_token"));
  });

  it("never returns another user's token when the guarded upsert is a no-op", async () => {
    // Pre-check passes (no row yet), but the owner-scoped reread finds nothing —
    // a concurrent insert by another user made our upsert a no-op.
    existingConnection = null;
    rereadRow = null;

    const result = await action.run({
      id: "conn_1",
      devServerUrl: "http://localhost:5173",
      rootPath: "/tmp/app",
      bridgeToken: "our_token",
    });

    // Fall back to our own token — never a foreign one from the colliding row.
    expect(result.bridgeToken).toBe("our_token");
    expect(result.previewToken).toBe(derivePreviewToken("our_token"));
  });

  it("stores an explicit read-only preview token separately", async () => {
    rereadRow = {
      bridgeToken: "example-write-token",
      previewToken: "example-preview-token",
    };

    const result = await action.run({
      id: "conn_preview",
      devServerUrl: "http://localhost:5173",
      rootPath: "/tmp/app",
      bridgeToken: "example-write-token",
      previewToken: "example-preview-token",
    });

    expect(insertedValues?.bridgeToken).toBe("example-write-token");
    expect(insertedValues?.previewToken).toBe("example-preview-token");
    expect(result.previewToken).toBe("example-preview-token");
    expect(result.previewToken).not.toBe(result.bridgeToken);
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
      orgId: "org_1",
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
      orgId: "org_1",
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

  it("rejects an explicit connection id owned by the same user in another organization", async () => {
    existingConnection = {
      ownerEmail: "user@example.com",
      orgId: "org_2",
      bridgeToken: "other_org_token",
    };

    await expect(
      action.run({
        id: "conn_1",
        devServerUrl: "http://localhost:5173",
        rootPath: "/tmp/app",
      }),
    ).rejects.toThrow(/another user or organization/);

    expect(insertedValues).toBeNull();
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
