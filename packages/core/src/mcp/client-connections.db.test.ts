import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";

let db: Awaited<ReturnType<typeof createTestPglite>>;
let failRead = false;
vi.mock("./connect-store.js", () => ({ ensureConnectTables: async () => {} }));
vi.mock("./oauth-store.js", () => ({ ensureOAuthTables: async () => {} }));
vi.mock("../db/client.js", () => ({
  getDbExec: () => ({
    execute: async (input: Parameters<DbExec["execute"]>[0]) => {
      if (failRead) throw new Error("database unavailable");
      const sql = typeof input === "string" ? input : input.sql;
      const args = typeof input === "string" ? [] : input.args;
      const result = await db.query(sql, args ? [...args] : undefined);
      return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
    },
  }),
}));
import { listMcpClientConnections } from "./client-connections.js";

const email = "reader@example.test";
const issuer = "https://app.example.test";
const orgId = "org-a";
const resource = `${issuer}/mcp`;
const now = 1_800_000_000_000;

beforeEach(async () => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  failRead = false;
  db = await createTestPglite();
  await db.exec(`CREATE TABLE mcp_oauth_clients(client_id TEXT PRIMARY KEY,client_name TEXT);
 CREATE TABLE mcp_oauth_refresh_tokens(client_id TEXT,owner_email TEXT,issued_for_email TEXT,org_id TEXT,resource TEXT,expires_at BIGINT,revoked_at BIGINT,last_used_at BIGINT);
 CREATE TABLE mcp_connect_tokens(id TEXT,client_name TEXT,owner_email TEXT,org_id TEXT,resource TEXT,kind TEXT,created_at BIGINT,expires_at BIGINT,revoked_at BIGINT,last_used_at BIGINT);`);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.close();
});
async function oauth(
  id: string,
  name: string,
  options: {
    owner?: string;
    issuedFor?: string | null;
    org?: string | null;
    audience?: string;
    expiry?: number;
    revoked?: number;
    used?: number;
  } = {},
) {
  await db.query(
    "INSERT INTO mcp_oauth_clients VALUES (?, ?) ON CONFLICT DO NOTHING",
    [id, name],
  );
  await db.query(
    "INSERT INTO mcp_oauth_refresh_tokens VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      options.owner ?? email,
      options.issuedFor === undefined ? email : options.issuedFor,
      options.org === undefined ? orgId : options.org,
      options.audience ?? resource,
      options.expiry ?? null,
      options.revoked ?? null,
      options.used ?? null,
    ],
  );
}
async function token(
  id: string,
  client: string | null,
  options: {
    org?: string | null;
    audience?: string | null;
    expiry?: number;
    revoked?: number;
    used?: number;
  } = {},
) {
  await db.query(
    "INSERT INTO mcp_connect_tokens VALUES (?, ?, ?, ?, ?, 'personal', ?, ?, ?, ?)",
    [
      id,
      client,
      email,
      options.org === undefined ? orgId : options.org,
      options.audience === undefined ? resource : options.audience,
      now,
      options.expiry ?? null,
      options.revoked ?? null,
      options.used ?? null,
    ],
  );
}
const read = () => listMcpClientConnections({ email, orgId, issuer });

describe("external MCP client metadata", () => {
  it("isolates authorizations by owner, organization and app resource", async () => {
    await oauth("mine", "Claude", { used: now - 1000 });
    await oauth("other-user", "Grok", { owner: "someone@example.test" });
    await oauth("other-org", "Cursor", { org: "org-b" });
    await oauth("other-app", "VS Code", {
      audience: "https://different.example.test/mcp",
    });
    const { connections } = await read();
    expect(connections.filter((row) => row.status === "connected")).toEqual([
      { client: "claude", status: "connected", lastUsedAt: now - 1000 },
    ]);
    expect(connections).toHaveLength(8);
    expect(JSON.stringify(connections)).not.toContain(email);
  });
  it("uses live authorization state while preserving real activity across refresh rotation", async () => {
    await oauth("claude", "Claude", { revoked: now - 100, used: now - 100 });
    await oauth("claude", "Claude");
    await oauth("expired", "Cursor", { expiry: now - 1, used: now - 200 });
    await oauth("revoked", "ChatGPT", { revoked: now - 1 });
    await oauth("transferred", "Grok", { issuedFor: "previous@example.test" });
    const { connections } = await read();
    expect(connections.find((row) => row.client === "claude")).toEqual({
      client: "claude",
      status: "connected",
      lastUsedAt: now - 100,
    });
    expect(
      connections
        .filter((row) => ["cursor", "chatgpt", "grok"].includes(row.client))
        .every((row) => row.status === "disconnected"),
    ).toBe(true);
  });
  it("checks static-token expiration and never guesses the validity of older credentials", async () => {
    await token("valid", "codex", { expiry: now + 60_000, used: now - 500 });
    await token("expired", "cursor", { expiry: now });
    await token("legacy", null, { audience: null, used: now - 1000 });
    await oauth("legacy-oauth", "VS Code", { issuedFor: null });
    const { connections } = await read();
    expect(connections.find((row) => row.client === "codex")).toEqual({
      client: "codex",
      status: "connected",
      lastUsedAt: now - 500,
    });
    expect(connections.find((row) => row.client === "cursor")?.status).toBe(
      "disconnected",
    );
    expect(connections.find((row) => row.client === "other")).toEqual({
      client: "other",
      status: "unknown",
      lastUsedAt: now - 1000,
    });
    expect(connections.find((row) => row.client === "vscode")?.status).toBe(
      "unknown",
    );
  });
  it("does not treat a failed or truncated status check as an empty connection list", async () => {
    failRead = true;
    await expect(read()).rejects.toThrow("database unavailable");
    failRead = false;
    await db.query(
      "INSERT INTO mcp_connect_tokens SELECT n::TEXT, n::TEXT, ?, ?, ?, 'personal', ?, ?, NULL, NULL FROM generate_series(1, 201) n",
      [email, orgId, resource, now, now + 60_000],
    );
    await expect(read()).rejects.toThrow("result limit");
  });
  it("summarizes historical tokens without losing active status or last use", async () => {
    await db.query(
      "INSERT INTO mcp_connect_tokens SELECT n::TEXT, 'codex', ?, ?, ?, 'personal', ?, ?, ?, ? FROM generate_series(1, 201) n",
      [email, orgId, resource, now, now - 1, now - 1, now - 500],
    );
    await token("active", "codex", { expiry: now + 60_000, used: now - 1000 });
    const { connections } = await read();
    expect(connections.find((row) => row.client === "codex")).toEqual({
      client: "codex",
      status: "connected",
      lastUsedAt: now - 500,
    });
  });
});
