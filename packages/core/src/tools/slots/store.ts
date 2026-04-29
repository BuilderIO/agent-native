import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDbExec, isPostgres } from "../../db/client.js";
import { createGetDb } from "../../db/create-get-db.js";
import { accessFilter, assertAccess } from "../../sharing/access.js";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "../../server/request-context.js";
import { tools, toolShares } from "../schema.js";
import {
  toolSlots,
  toolSlotInstalls,
  TOOL_SLOTS_CREATE_SQL,
  TOOL_SLOTS_CREATE_SQL_PG,
  TOOL_SLOTS_BY_SLOT_INDEX_SQL,
  TOOL_SLOTS_BY_TOOL_INDEX_SQL,
  TOOL_SLOTS_UNIQUE_INDEX_SQL,
  TOOL_SLOT_INSTALLS_CREATE_SQL,
  TOOL_SLOT_INSTALLS_CREATE_SQL_PG,
  TOOL_SLOT_INSTALLS_BY_USER_SLOT_INDEX_SQL,
  TOOL_SLOT_INSTALLS_UNIQUE_INDEX_SQL,
} from "./schema.js";

const getDb = createGetDb({ tools, toolShares, toolSlots, toolSlotInstalls });

let _initPromise: Promise<void> | undefined;

export async function ensureSlotTables(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const pg = isPostgres();
      await client.execute(
        pg ? TOOL_SLOTS_CREATE_SQL_PG : TOOL_SLOTS_CREATE_SQL,
      );
      await client.execute(TOOL_SLOTS_BY_SLOT_INDEX_SQL);
      await client.execute(TOOL_SLOTS_BY_TOOL_INDEX_SQL);
      await client.execute(TOOL_SLOTS_UNIQUE_INDEX_SQL);
      await client.execute(
        pg ? TOOL_SLOT_INSTALLS_CREATE_SQL_PG : TOOL_SLOT_INSTALLS_CREATE_SQL,
      );
      await client.execute(TOOL_SLOT_INSTALLS_BY_USER_SLOT_INDEX_SQL);
      await client.execute(TOOL_SLOT_INSTALLS_UNIQUE_INDEX_SQL);
    })();
  }
  return _initPromise;
}

export interface ToolSlotRow {
  id: string;
  toolId: string;
  slotId: string;
  config: string | null;
  createdAt: string;
}

export interface ToolSlotInstallRow {
  id: string;
  toolId: string;
  slotId: string;
  ownerEmail: string;
  orgId: string | null;
  position: number;
  enabled: boolean;
  config: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Declare that a tool can render in a slot. Caller must have editor access on
 * the tool (only people who can edit a tool can change its slot targets).
 */
export async function addToolSlotTarget(
  toolId: string,
  slotId: string,
  config?: string,
): Promise<ToolSlotRow> {
  await ensureSlotTables();
  await assertAccess("tool", toolId, "editor");
  const db = getDb();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const row: ToolSlotRow = {
    id,
    toolId,
    slotId,
    config: config ?? null,
    createdAt,
  };
  try {
    await db.insert(toolSlots).values(row);
  } catch (err: any) {
    // Unique index hit — already declared. Treat as idempotent: return existing.
    if (
      String(err?.message ?? err)
        .toLowerCase()
        .includes("unique")
    ) {
      const existing = await db
        .select()
        .from(toolSlots)
        .where(and(eq(toolSlots.toolId, toolId), eq(toolSlots.slotId, slotId)));
      if (existing[0]) return existing[0] as ToolSlotRow;
    }
    throw err;
  }
  return row;
}

export async function removeToolSlotTarget(
  toolId: string,
  slotId: string,
): Promise<boolean> {
  await ensureSlotTables();
  await assertAccess("tool", toolId, "editor");
  const db = getDb();
  await db
    .delete(toolSlots)
    .where(and(eq(toolSlots.toolId, toolId), eq(toolSlots.slotId, slotId)));
  return true;
}

export async function listSlotsForTool(toolId: string): Promise<ToolSlotRow[]> {
  await ensureSlotTables();
  await assertAccess("tool", toolId, "viewer");
  const db = getDb();
  const rows = await db
    .select()
    .from(toolSlots)
    .where(eq(toolSlots.toolId, toolId));
  return rows as ToolSlotRow[];
}

/**
 * List tools that declare a slot — but only tools the current user has access
 * to. Joins through the tools access filter.
 */
export async function listToolsForSlot(slotId: string): Promise<
  Array<{
    toolId: string;
    name: string;
    description: string;
    icon: string | null;
    config: string | null;
  }>
> {
  await ensureSlotTables();
  const db = getDb();
  // Pull tools the user can see, then narrow to ones declaring this slot.
  const accessible = await db
    .select({
      id: tools.id,
      name: tools.name,
      description: tools.description,
      icon: tools.icon,
    })
    .from(tools)
    .where(accessFilter(tools, toolShares));
  if (accessible.length === 0) return [];
  const ids = accessible.map((t: any) => t.id);
  const declarations = await db
    .select()
    .from(toolSlots)
    .where(and(eq(toolSlots.slotId, slotId), inArray(toolSlots.toolId, ids)));
  const byId = new Map(accessible.map((t: any) => [t.id, t]));
  return (declarations as ToolSlotRow[]).map((d) => {
    const t = byId.get(d.toolId)!;
    return {
      toolId: d.toolId,
      name: t.name,
      description: t.description,
      icon: t.icon,
      config: d.config,
    };
  });
}

/**
 * Install a tool into a slot for the current user. Verifies the user has at
 * least viewer access to the tool. Idempotent — re-installing returns the
 * existing row.
 */
export async function installToolSlot(
  toolId: string,
  slotId: string,
  opts?: { position?: number; config?: string },
): Promise<ToolSlotInstallRow> {
  await ensureSlotTables();
  await assertAccess("tool", toolId, "viewer");
  const userEmail = requireUserEmail();
  const orgId = getRequestOrgId();
  const db = getDb();
  const existing = await db
    .select()
    .from(toolSlotInstalls)
    .where(
      and(
        eq(toolSlotInstalls.ownerEmail, userEmail),
        eq(toolSlotInstalls.toolId, toolId),
        eq(toolSlotInstalls.slotId, slotId),
      ),
    );
  if (existing[0]) return existing[0] as ToolSlotInstallRow;

  const id = randomUUID();
  const now = new Date().toISOString();
  let position = opts?.position;
  if (position === undefined) {
    const rows = await db
      .select({ pos: sql<number>`MAX(${toolSlotInstalls.position})` })
      .from(toolSlotInstalls)
      .where(
        and(
          eq(toolSlotInstalls.ownerEmail, userEmail),
          eq(toolSlotInstalls.slotId, slotId),
        ),
      );
    const maxPos = Number((rows[0] as any)?.pos ?? -1);
    position = Number.isFinite(maxPos) ? maxPos + 1 : 0;
  }
  const row: ToolSlotInstallRow = {
    id,
    toolId,
    slotId,
    ownerEmail: userEmail,
    orgId: orgId ?? null,
    position,
    enabled: true,
    config: opts?.config ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(toolSlotInstalls).values(row);
  return row;
}

export async function uninstallToolSlot(
  toolId: string,
  slotId: string,
): Promise<boolean> {
  await ensureSlotTables();
  const userEmail = requireUserEmail();
  const db = getDb();
  await db
    .delete(toolSlotInstalls)
    .where(
      and(
        eq(toolSlotInstalls.ownerEmail, userEmail),
        eq(toolSlotInstalls.toolId, toolId),
        eq(toolSlotInstalls.slotId, slotId),
      ),
    );
  return true;
}

/**
 * List the current user's installs for a slot. Joins with `tools` so the
 * caller gets tool name/description/icon/updatedAt without a second query.
 * Tools the user has lost access to are silently skipped (lazy garbage
 * collection).
 */
export async function listSlotInstallsForUser(slotId: string): Promise<
  Array<{
    installId: string;
    toolId: string;
    name: string;
    description: string;
    icon: string | null;
    updatedAt: string;
    position: number;
    config: string | null;
  }>
> {
  await ensureSlotTables();
  const userEmail = requireUserEmail();
  const db = getDb();

  const installs = await db
    .select()
    .from(toolSlotInstalls)
    .where(
      and(
        eq(toolSlotInstalls.ownerEmail, userEmail),
        eq(toolSlotInstalls.slotId, slotId),
        eq(toolSlotInstalls.enabled, true),
      ),
    );
  if (installs.length === 0) return [];

  const accessible = await db
    .select({
      id: tools.id,
      name: tools.name,
      description: tools.description,
      icon: tools.icon,
      updatedAt: tools.updatedAt,
    })
    .from(tools)
    .where(accessFilter(tools, toolShares));
  const byId = new Map(accessible.map((t: any) => [t.id, t]));

  return (installs as ToolSlotInstallRow[])
    .filter((i) => byId.has(i.toolId))
    .sort((a, b) => a.position - b.position)
    .map((i) => {
      const t = byId.get(i.toolId)!;
      return {
        installId: i.id,
        toolId: i.toolId,
        name: t.name,
        description: t.description,
        icon: t.icon,
        updatedAt: t.updatedAt,
        position: i.position,
        config: i.config,
      };
    });
}

/** Delete every slot/install row referencing a tool. Called from deleteTool. */
export async function cascadeDeleteToolSlots(toolId: string): Promise<void> {
  await ensureSlotTables();
  const db = getDb();
  await db.delete(toolSlots).where(eq(toolSlots.toolId, toolId));
  await db.delete(toolSlotInstalls).where(eq(toolSlotInstalls.toolId, toolId));
}

function requireUserEmail(): string {
  const email = getRequestUserEmail();
  if (!email) {
    throw new Error("Slot operations require an authenticated user.");
  }
  return email;
}
