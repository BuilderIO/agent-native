import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { eq } from "drizzle-orm";
import { bigint, pgTable, text } from "drizzle-orm/pg-core";

import { ActionContractError } from "../action.js";
import { createGetDb } from "../db/create-get-db.js";
import { defineStore } from "../db/store-registry.js";
import type { MCPCallerIdentity } from "./build-server.js";
import { isDeviceConnectToken } from "./connect-store.js";
import { turnGrantConnectCredential } from "./turn-grant-identity.js";

export const MCP_TURN_GRANT_TTL_MS = 9 * 60_000;
const turnGrants = pgTable("mcp_turn_grants", {
  grantHash: text("grant_hash").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  appId: text("app_id").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  revokedAt: bigint("revoked_at", { mode: "number" }),
});
const getDb = createGetDb({ turnGrants });

export const mcpTurnGrantsStore = defineStore({
  id: "mcp_turn_grants",
  migrations: [
    {
      name: "baseline",
      sql: `CREATE TABLE IF NOT EXISTS mcp_turn_grants (
      grant_hash TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      app_id TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      revoked_at BIGINT
    )`,
    },
  ],
});

export class TurnGrantUnavailableError extends ActionContractError {
  constructor() {
    super("Turn grant storage is unavailable.", {
      errorCode: "turn_grant_unavailable",
      statusCode: 503,
    });
    this.name = "TurnGrantUnavailableError";
  }
}

function grantHash(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}

export async function mintMcpTurnGrant(
  ownerEmail: string,
  appId: string,
): Promise<{ grantId: string }> {
  const grantId = randomBytes(32).toString("base64url");
  const createdAt = Date.now();
  try {
    await mcpTurnGrantsStore.ready();
    await getDb()
      .insert(turnGrants)
      .values({
        grantHash: grantHash(grantId),
        ownerEmail: ownerEmail.trim().toLowerCase(),
        appId,
        createdAt,
        expiresAt: createdAt + MCP_TURN_GRANT_TTL_MS,
      });
  } catch {
    throw new TurnGrantUnavailableError();
  }
  return { grantId };
}

export type TurnGrantRefusalReason =
  | "missing"
  | "unknown"
  | "expired"
  | "revoked"
  | "owner-mismatch"
  | "app-mismatch"
  | "not-device"
  | "unavailable"
  | "agent-context"
  | "action-not-allowlisted";
export type TurnGrantAdmission =
  | { status: "admitted"; expiresAt: number }
  | { status: "refused"; reason: TurnGrantRefusalReason };

export async function admitMcpTurnGrant(
  id: string | undefined,
  appId: string,
  identity: MCPCallerIdentity | undefined,
): Promise<TurnGrantAdmission> {
  if (id === undefined) return { status: "refused", reason: "missing" };
  if (!/^[A-Za-z0-9_-]{22,128}$/.test(id))
    return { status: "refused", reason: "unknown" };
  if (identity?.identityAssurance !== "user" || !identity.userEmail)
    return { status: "refused", reason: "not-device" };
  const connectJti = turnGrantConnectCredential(identity);
  if (!connectJti) return { status: "refused", reason: "not-device" };
  try {
    await mcpTurnGrantsStore.ready();
    const hash = grantHash(id);
    const rows = await getDb()
      .select()
      .from(turnGrants)
      .where(eq(turnGrants.grantHash, hash))
      .limit(1);
    const row = rows.at(0);
    if (!row) return { status: "refused", reason: "unknown" };
    if (
      !/^[a-f0-9]{64}$/.test(row.grantHash) ||
      !timingSafeEqual(
        Buffer.from(row.grantHash, "hex"),
        Buffer.from(hash, "hex"),
      )
    )
      return { status: "refused", reason: "unavailable" };
    if (row.ownerEmail !== identity.userEmail.trim().toLowerCase())
      return { status: "refused", reason: "owner-mismatch" };
    if (row.appId !== appId)
      return { status: "refused", reason: "app-mismatch" };
    if (
      !Number.isSafeInteger(row.createdAt) ||
      !Number.isSafeInteger(row.expiresAt) ||
      row.expiresAt !== row.createdAt + MCP_TURN_GRANT_TTL_MS ||
      row.createdAt > Date.now()
    )
      return { status: "refused", reason: "unavailable" };
    if (row.revokedAt !== null) return { status: "refused", reason: "revoked" };
    if (Date.now() >= row.expiresAt)
      return { status: "refused", reason: "expired" };
    if (!(await isDeviceConnectToken(connectJti, identity.userEmail)))
      return { status: "refused", reason: "not-device" };
    return { status: "admitted", expiresAt: row.expiresAt };
  } catch {
    return { status: "refused", reason: "unavailable" };
  }
}
