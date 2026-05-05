import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDbExec, isPostgres } from "../../db/client.js";
import { createGetDb } from "../../db/create-get-db.js";
import { accessFilter, assertAccess } from "../../sharing/access.js";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "../../server/request-context.js";
import { extensions, extensionShares } from "../schema.js";
import {
  extensionSlots,
  extensionSlotInstalls,
  EXTENSION_SLOTS_CREATE_SQL,
  EXTENSION_SLOTS_CREATE_SQL_PG,
  EXTENSION_SLOTS_BY_SLOT_INDEX_SQL,
  EXTENSION_SLOTS_BY_EXTENSION_INDEX_SQL,
  EXTENSION_SLOTS_UNIQUE_INDEX_SQL,
  EXTENSION_SLOT_INSTALLS_CREATE_SQL,
  EXTENSION_SLOT_INSTALLS_CREATE_SQL_PG,
  EXTENSION_SLOT_INSTALLS_BY_USER_SLOT_INDEX_SQL,
  EXTENSION_SLOT_INSTALLS_UNIQUE_INDEX_SQL,
} from "./schema.js";

const getDb = createGetDb({ extensions, extensionShares, extensionSlots, extensionSlotInstalls });

let _initPromise: Promise<void> | undefined;

export async function ensureSlotTables(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const pg = isPostgres();
      await client.execute(
        pg ? EXTENSION_SLOTS_CREATE_SQL_PG : EXTENSION_SLOTS_CREATE_SQL,
      );
      await client.execute(EXTENSION_SLOTS_BY_SLOT_INDEX_SQL);
      await client.execute(EXTENSION_SLOTS_BY_EXTENSION_INDEX_SQL);
      await client.execute(EXTENSION_SLOTS_UNIQUE_INDEX_SQL);
      await client.execute(
        pg ? EXTENSION_SLOT_INSTALLS_CREATE_SQL_PG : EXTENSION_SLOT_INSTALLS_CREATE_SQL,
      );
      await client.execute(EXTENSION_SLOT_INSTALLS_BY_USER_SLOT_INDEX_SQL);
      await client.execute(EXTENSION_SLOT_INSTALLS_UNIQUE_INDEX_SQL);
    })();
  }
  return _initPromise;
}

export interface ExtensionSlotRow {
  id: string;
  extensionId: string;
  slotId: string;
  config: string | null;
  createdAt: string;
}

export interface ExtensionSlotInstallRow {
  id: string;
  extensionId: string;
  slotId: string;
  ownerEmail: string;
  orgId: string | null;
  position: number;
  config: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Declare that a extension can render in a slot. Caller must have editor access on
 * the extension (only people who can edit a extension can change its slot targets).
 */
export async function addExtensionSlotTarget(
  extensionId: string,
  slotId: string,
  config?: string,
): Promise<ExtensionSlotRow> {
  await ensureSlotTables();
  await assertAccess("extension", extensionId, "editor");
  const db = getDb();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const row: ExtensionSlotRow = {
    id,
    extensionId,
    slotId,
    config: config ?? null,
    createdAt,
  };
  try {
    await db.insert(extensionSlots).values(row);
  } catch (err: any) {
    // Unique index hit — already declared. Treat as idempotent: return existing.
    if (
      String(err?.message ?? err)
        .toLowerCase()
        .includes("unique")
    ) {
      const existing = await db
        .select()
        .from(extensionSlots)
        .where(and(eq(extensionSlots.extensionId, extensionId), eq(extensionSlots.slotId, slotId)));
      if (existing[0]) return existing[0] as ExtensionSlotRow;
    }
    throw err;
  }
  return row;
}

export async function removeExtensionSlotTarget(
  extensionId: string,
  slotId: string,
): Promise<boolean> {
  await ensureSlotTables();
  await assertAccess("extension", extensionId, "editor");
  const db = getDb();
  await db
    .delete(extensionSlots)
    .where(and(eq(extensionSlots.extensionId, extensionId), eq(extensionSlots.slotId, slotId)));
  return true;
}

export async function listSlotsForExtension(extensionId: string): Promise<ExtensionSlotRow[]> {
  await ensureSlotTables();
  await assertAccess("extension", extensionId, "viewer");
  const db = getDb();
  const rows = await db
    .select()
    .from(extensionSlots)
    .where(eq(extensionSlots.extensionId, extensionId));
  return rows as ExtensionSlotRow[];
}

/**
 * List extensions that declare a slot — but only extensions the current user has access
 * to. Joins through the extensions access filter.
 */
export async function listExtensionsForSlot(slotId: string): Promise<
  Array<{
    extensionId: string;
    name: string;
    description: string;
    icon: string | null;
    config: string | null;
  }>
> {
  await ensureSlotTables();
  const db = getDb();
  // Pull extensions the user can see, then narrow to ones declaring this slot.
  const accessible = await db
    .select({
      id: extensions.id,
      name: extensions.name,
      description: extensions.description,
      icon: extensions.icon,
    })
    .from(extensions)
    .where(accessFilter(extensions, extensionShares));
  if (accessible.length === 0) return [];
  const ids = accessible.map((t: any) => t.id);
  const declarations = await db
    .select()
    .from(extensionSlots)
    .where(and(eq(extensionSlots.slotId, slotId), inArray(extensionSlots.extensionId, ids)));
  const byId = new Map(accessible.map((t: any) => [t.id, t]));
  return (declarations as ExtensionSlotRow[]).map((d) => {
    const t = byId.get(d.extensionId)!;
    return {
      extensionId: d.extensionId,
      name: t.name,
      description: t.description,
      icon: t.icon,
      config: d.config,
    };
  });
}

/**
 * Install a extension into a slot for the current user. Verifies the user has at
 * least viewer access to the extension. Idempotent — re-installing returns the
 * existing row.
 */
export async function installExtensionSlot(
  extensionId: string,
  slotId: string,
  opts?: { position?: number; config?: string },
): Promise<ExtensionSlotInstallRow> {
  await ensureSlotTables();
  await assertAccess("extension", extensionId, "viewer");
  const userEmail = requireUserEmail();
  const orgId = getRequestOrgId();
  const db = getDb();
  const existing = await db
    .select()
    .from(extensionSlotInstalls)
    .where(
      and(
        eq(extensionSlotInstalls.ownerEmail, userEmail),
        eq(extensionSlotInstalls.extensionId, extensionId),
        eq(extensionSlotInstalls.slotId, slotId),
      ),
    );
  if (existing[0]) return existing[0] as ExtensionSlotInstallRow;

  const id = randomUUID();
  const now = new Date().toISOString();
  let position = opts?.position;
  if (position === undefined) {
    const rows = await db
      .select({ pos: sql<number>`MAX(${extensionSlotInstalls.position})` })
      .from(extensionSlotInstalls)
      .where(
        and(
          eq(extensionSlotInstalls.ownerEmail, userEmail),
          eq(extensionSlotInstalls.slotId, slotId),
        ),
      );
    const maxPos = Number((rows[0] as any)?.pos ?? -1);
    position = Number.isFinite(maxPos) ? maxPos + 1 : 0;
  }
  const row: ExtensionSlotInstallRow = {
    id,
    extensionId,
    slotId,
    ownerEmail: userEmail,
    orgId: orgId ?? null,
    position,
    config: opts?.config ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(extensionSlotInstalls).values(row);
  return row;
}

export async function uninstallExtensionSlot(
  extensionId: string,
  slotId: string,
): Promise<boolean> {
  await ensureSlotTables();
  const userEmail = requireUserEmail();
  const db = getDb();
  await db
    .delete(extensionSlotInstalls)
    .where(
      and(
        eq(extensionSlotInstalls.ownerEmail, userEmail),
        eq(extensionSlotInstalls.extensionId, extensionId),
        eq(extensionSlotInstalls.slotId, slotId),
      ),
    );
  return true;
}

/**
 * List the current user's installs for a slot. Joins with `extensions` so the
 * caller gets extension name/description/icon/updatedAt without a second query.
 * Extensions the user has lost access to are silently skipped (lazy garbage
 * collection).
 */
export async function listSlotInstallsForUser(slotId: string): Promise<
  Array<{
    installId: string;
    extensionId: string;
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
    .from(extensionSlotInstalls)
    .where(
      and(
        eq(extensionSlotInstalls.ownerEmail, userEmail),
        eq(extensionSlotInstalls.slotId, slotId),
      ),
    );
  if (installs.length === 0) return [];

  const accessible = await db
    .select({
      id: extensions.id,
      name: extensions.name,
      description: extensions.description,
      icon: extensions.icon,
      updatedAt: extensions.updatedAt,
    })
    .from(extensions)
    .where(accessFilter(extensions, extensionShares));
  const byId = new Map(accessible.map((t: any) => [t.id, t]));

  return (installs as ExtensionSlotInstallRow[])
    .filter((i) => byId.has(i.extensionId))
    .sort((a, b) => a.position - b.position)
    .map((i) => {
      const t = byId.get(i.extensionId)!;
      return {
        installId: i.id,
        extensionId: i.extensionId,
        name: t.name,
        description: t.description,
        icon: t.icon,
        updatedAt: t.updatedAt,
        position: i.position,
        config: i.config,
      };
    });
}

/** Delete every slot/install row referencing a extension. Called from deleteExtension. */
export async function cascadeDeleteExtensionSlots(extensionId: string): Promise<void> {
  await ensureSlotTables();
  const db = getDb();
  await db.delete(extensionSlots).where(eq(extensionSlots.extensionId, extensionId));
  await db.delete(extensionSlotInstalls).where(eq(extensionSlotInstalls.extensionId, extensionId));
}

function requireUserEmail(): string {
  const email = getRequestUserEmail();
  if (!email) {
    throw new Error("Slot operations require an authenticated user.");
  }
  return email;
}
