import { randomBytes } from "node:crypto";

import { and, eq, lt } from "drizzle-orm";
import { bigint, pgTable, text } from "drizzle-orm/pg-core";

import { getDbExec } from "../db/client.js";
import { createGetDb } from "../db/create-get-db.js";
import { sql } from "../db/sql.js";
import { defineStore } from "../db/store-registry.js";
import {
  signMcpChatTurnProof,
  verifyMcpChatTurnProof,
} from "../integrations/internal-token.js";
import { parseServiceIdentityEmail } from "../org/service-identity.js";
import { mcpChatTurnOwner } from "./chat-turn-scope.js";

export const MCP_CHAT_TURN_FIELD = "__agentNativeMcpChatTurn";
const TTL_MS = 120_000;
// A turn's grant outlives the 120 s proof: the proof only has to survive the
// hop to admission, the grant has to cover the whole async turn (same window
// as an MCP turn grant).
const DURABLE_GRANT_MS = 9 * 60_000;

const chatTurnApps = new Set<string>();

/**
 * Names the apps whose A2A turns accept a verified MCP user's chat-turn proof.
 * `ask_app` mints a proof only for a registered target; with none registered
 * it sends no proof and keeps its usual inline wait.
 */
export function registerMcpChatTurnApps(appIds: Iterable<string>): void {
  for (const appId of appIds) {
    const id = appId.trim().toLowerCase();
    if (id) chatTurnApps.add(id);
  }
}

export function acceptsMcpChatTurn(appId: string): boolean {
  return chatTurnApps.has(appId.trim().toLowerCase());
}

export function hasMcpChatTurnApps(): boolean {
  return chatTurnApps.size > 0;
}

/** For specs: forget every registration. */
export function resetMcpChatTurnAppsForTests(): void {
  chatTurnApps.clear();
}
export const mcpChatTurnsStore = defineStore({
  id: "mcp_chat_turns",
  migrations: [
    {
      name: "baseline",
      sql: `
    CREATE TABLE IF NOT EXISTS mcp_chat_turn_mints (
      owner TEXT PRIMARY KEY, minted_at BIGINT[] NOT NULL
    )`,
    },
    {
      name: "admissions",
      sql: `CREATE TABLE IF NOT EXISTS mcp_chat_turn_admissions (
      nonce TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE, owner TEXT NOT NULL,
      app_id TEXT NOT NULL, expires_at BIGINT NOT NULL, signature TEXT NOT NULL
    )`,
    },
    {
      name: "admissions-expiry-index",
      sql: `CREATE INDEX IF NOT EXISTS mcp_chat_turn_admissions_expires_at_idx ON mcp_chat_turn_admissions (expires_at)`,
    },
  ],
});

const admissions = pgTable("mcp_chat_turn_admissions", {
  nonce: text("nonce").primaryKey(),
  taskId: text("task_id").notNull().unique(),
  owner: text("owner").notNull(),
  appId: text("app_id").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  signature: text("signature").notNull(),
});
const getDb = createGetDb({ admissions });
type Refusal = { status: "refused"; reason: string };

type Claim = {
  v: "mcp-chat-turn-v1";
  owner: string;
  appId: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;
};
export type McpChatTurnBinding = {
  owner: string;
  appId: string;
  runId: string;
  turnId: string;
  expiresAt: number;
};
function claimPayload(c: Omit<Claim, "signature">): readonly unknown[] {
  return [c.v, c.owner, c.appId, c.nonce, c.issuedAt, c.expiresAt];
}
function durablePayload(c: McpChatTurnBinding): readonly unknown[] {
  return ["durable", c.owner, c.appId, c.runId, c.turnId, c.expiresAt];
}
function refused(reason: string, appId: string): Refusal {
  console.info("[mcp-chat-turn] refused", { reason, appId });
  return { status: "refused", reason };
}

export async function mintMcpChatTurn(
  appId: string,
): Promise<
  { status: "minted"; claim: Claim } | { status: "not-registered" } | Refusal
> {
  if (!acceptsMcpChatTurn(appId)) return { status: "not-registered" };
  const owner = mcpChatTurnOwner();
  if (!owner) {
    return refused("not-user-call", appId);
  }
  try {
    const issuedAt = Date.now();
    const claim = {
      v: "mcp-chat-turn-v1" as const,
      owner,
      appId,
      nonce: randomBytes(32).toString("base64url"),
      issuedAt,
      expiresAt: issuedAt + TTL_MS,
    };
    const signature = signMcpChatTurnProof(claimPayload(claim));
    await mcpChatTurnsStore.ready();
    // The owner row serializes concurrent mints; the predicate and pruning use
    // the locked row, so concurrent HTTP requests cannot overrun the cap.
    const { rows } = await getDbExec().execute(sql`
      INSERT INTO mcp_chat_turn_mints (owner, minted_at) VALUES (${sql.value(owner)}, ARRAY[${sql.value(issuedAt)}]::BIGINT[])
      ON CONFLICT (owner) DO UPDATE SET minted_at =
        ARRAY(SELECT t FROM unnest(mcp_chat_turn_mints.minted_at) t WHERE t > ${sql.value(issuedAt - 600_000)}) || ARRAY[${sql.value(issuedAt)}]::BIGINT[]
      WHERE cardinality(ARRAY(SELECT t FROM unnest(mcp_chat_turn_mints.minted_at) t WHERE t > ${sql.value(issuedAt - 600_000)})) < 30
      RETURNING owner`);
    if (rows.length !== 1) {
      return refused("cap", appId);
    }
    return { status: "minted", claim: { ...claim, signature } };
  } catch {
    return refused("storage-or-signing-unavailable", appId);
  }
}

// A replayed proof is refused until it expires; keep a day of admissions, then drop them.
const ADMISSION_RETENTION_MS = 24 * 60 * 60_000;

async function pruneExpiredChatTurnAdmissions(): Promise<void> {
  try {
    await getDb()
      .delete(admissions)
      .where(lt(admissions.expiresAt, Date.now() - ADMISSION_RETENTION_MS));
  } catch (error) {
    // A failed prune never blocks an admission; the next one retries it.
    console.warn("[mcp-chat-turn] could not prune expired admissions", error);
  }
}

/**
 * The task metadata that carries a freshly minted proof, or none when the
 * target takes no proof or the caller is not a verified user turn (both mean
 * "send as an ordinary turn"). Any other refusal (owner cap, storage or
 * signing failure) throws, so an intended interactive turn never quietly
 * loses its grant.
 */
export async function mintMcpChatTurnMetadata(
  appId: string,
): Promise<Record<string, unknown> | undefined> {
  const mint = await mintMcpChatTurn(appId);
  if (mint.status === "minted") return { [MCP_CHAT_TURN_FIELD]: mint.claim };
  if (mint.status === "refused" && mint.reason !== "not-user-call") {
    throw new Error(`MCP chat-turn proof refused: ${mint.reason}`);
  }
  return undefined;
}

export async function admitMcpChatTurn(
  candidate: unknown,
  binding: {
    owner: string | undefined;
    assurance: string | undefined;
    appId: string;
    taskId: string;
  },
): Promise<{ status: "admitted" | "absent" } | Refusal> {
  const { appId, taskId } = binding;
  if (candidate === undefined) return { status: "absent" };
  if (
    binding.assurance !== "user" ||
    !binding.owner ||
    parseServiceIdentityEmail(binding.owner)
  ) {
    return refused("not-user", appId);
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return refused("invalid", appId);
  }
  const c = candidate as Partial<Claim>;
  if (
    c.v !== "mcp-chat-turn-v1" ||
    typeof c.owner !== "string" ||
    typeof c.appId !== "string" ||
    typeof c.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(c.nonce) ||
    typeof c.issuedAt !== "number" ||
    !Number.isSafeInteger(c.issuedAt) ||
    typeof c.expiresAt !== "number" ||
    c.expiresAt !== c.issuedAt + TTL_MS ||
    c.issuedAt > Date.now() ||
    c.expiresAt <= Date.now()
  ) {
    return refused("invalid-or-expired", appId);
  }
  if (c.owner !== binding.owner.trim().toLowerCase()) {
    return refused("owner-mismatch", appId);
  }
  if (c.appId !== appId) {
    return refused("app-mismatch", appId);
  }
  try {
    if (!verifyMcpChatTurnProof(claimPayload(c as Claim), c.signature)) {
      return refused("signature", appId);
    }
    const grant: McpChatTurnBinding = {
      owner: c.owner,
      appId,
      runId: taskId,
      turnId: taskId,
      expiresAt: Date.now() + DURABLE_GRANT_MS,
    };
    const signature = signMcpChatTurnProof(durablePayload(grant));
    await mcpChatTurnsStore.ready();
    const rows = await getDb()
      .insert(admissions)
      .values({
        nonce: c.nonce,
        taskId,
        owner: c.owner,
        appId,
        expiresAt: grant.expiresAt,
        signature,
      })
      .onConflictDoNothing()
      .returning({ nonce: admissions.nonce });
    if (rows.length !== 1) {
      return refused("replay", appId);
    }
    await pruneExpiredChatTurnAdmissions();
    console.info("[mcp-chat-turn] admitted", { appId });
    return { status: "admitted" };
  } catch {
    return refused("storage-or-signing-unavailable", appId);
  }
}

export async function readMcpChatTurn(binding: {
  owner: string | undefined;
  assurance: string | undefined;
  appId: string;
  taskId: string;
}): Promise<
  | { status: "admitted"; grant: McpChatTurnBinding }
  | { status: "absent" }
  | Refusal
> {
  const { appId, taskId } = binding;
  if (
    binding.assurance !== "user" ||
    !binding.owner ||
    parseServiceIdentityEmail(binding.owner)
  )
    return { status: "absent" };
  try {
    await mcpChatTurnsStore.ready();
    const rows = await getDb()
      .select({
        expiresAt: admissions.expiresAt,
        signature: admissions.signature,
      })
      .from(admissions)
      .where(
        and(
          eq(admissions.taskId, taskId),
          eq(admissions.appId, appId),
          eq(admissions.owner, binding.owner.trim().toLowerCase()),
        ),
      )
      .limit(1);
    const row = rows.at(0);
    if (!row) return { status: "absent" };
    const grant = {
      owner: binding.owner.trim().toLowerCase(),
      appId,
      runId: taskId,
      turnId: taskId,
      expiresAt: row.expiresAt,
    };
    if (
      !Number.isSafeInteger(grant.expiresAt) ||
      grant.expiresAt <= Date.now() ||
      !verifyMcpChatTurnProof(durablePayload(grant), row.signature)
    ) {
      return refused("durable-invalid-or-expired", appId);
    }
    return { status: "admitted", grant };
  } catch {
    return refused("storage-or-signing-unavailable", appId);
  }
}
