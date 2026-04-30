import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDbExec, isPostgres } from "../db/client.js";
import { createGetDb } from "../db/create-get-db.js";
import {
  accessFilter,
  assertAccess,
  resolveAccess,
} from "../sharing/access.js";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "../server/request-context.js";
import { registerShareableResource } from "../sharing/registry.js";
import {
  tools,
  toolShares,
  TOOLS_CREATE_SQL,
  TOOLS_CREATE_SQL_PG,
  TOOL_SHARES_CREATE_SQL,
  TOOL_SHARES_CREATE_SQL_PG,
  TOOL_DATA_CREATE_SQL,
  TOOL_DATA_CREATE_SQL_PG,
  TOOL_DATA_ITEM_INDEX_SQL,
  TOOL_DATA_ITEM_INDEX_SQL_PG,
  TOOL_DATA_DROP_OLD_INDEX_SQL,
  TOOL_DATA_DROP_OLD_INDEX_SQL_PG,
  TOOLS_OWNER_INDEX_SQL,
  TOOLS_ORG_INDEX_SQL,
  TOOL_SHARES_RESOURCE_INDEX_SQL,
  TOOL_CONSENTS_CREATE_SQL,
  TOOL_CONSENTS_CREATE_SQL_PG,
  TOOL_CONSENTS_VIEWER_INDEX_SQL,
} from "./schema.js";

const getDb = createGetDb({ tools, toolShares });

let _initPromise: Promise<void> | undefined;

export async function ensureToolsTables(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const pg = isPostgres();
      await client.execute(pg ? TOOLS_CREATE_SQL_PG : TOOLS_CREATE_SQL);
      await client.execute(
        pg ? TOOL_SHARES_CREATE_SQL_PG : TOOL_SHARES_CREATE_SQL,
      );
      await client.execute(pg ? TOOL_DATA_CREATE_SQL_PG : TOOL_DATA_CREATE_SQL);
      await ensureToolDataItemId(client, pg);
      await ensureToolDataScope(client, pg);
      await client.execute(
        pg ? TOOL_DATA_DROP_OLD_INDEX_SQL_PG : TOOL_DATA_DROP_OLD_INDEX_SQL,
      );
      await client.execute(
        pg ? TOOL_DATA_ITEM_INDEX_SQL_PG : TOOL_DATA_ITEM_INDEX_SQL,
      );
      await client.execute(TOOLS_OWNER_INDEX_SQL);
      await client.execute(TOOLS_ORG_INDEX_SQL);
      await client.execute(TOOL_SHARES_RESOURCE_INDEX_SQL);
      // Per-viewer consent gate for non-author tool runs (audit C1).
      await client.execute(
        pg ? TOOL_CONSENTS_CREATE_SQL_PG : TOOL_CONSENTS_CREATE_SQL,
      );
      await client.execute(TOOL_CONSENTS_VIEWER_INDEX_SQL);
    })();
  }
  return _initPromise;
}

async function ensureToolDataItemId(
  client: ReturnType<typeof getDbExec>,
  pg: boolean,
): Promise<void> {
  if (pg) {
    await client.execute(
      `ALTER TABLE tool_data ADD COLUMN IF NOT EXISTS item_id TEXT`,
    );
    return;
  }

  // Keep this additive: legacy rows with item_id=id are still read correctly
  // through COALESCE(item_id, id), so SQLite never needs a table rebuild here.
  try {
    await client.execute(`ALTER TABLE tool_data ADD COLUMN item_id TEXT`);
  } catch (err: any) {
    if (
      !String(err?.message ?? err)
        .toLowerCase()
        .includes("duplicate")
    ) {
      throw err;
    }
  }
}

async function ensureToolDataScope(
  client: ReturnType<typeof getDbExec>,
  pg: boolean,
): Promise<void> {
  const addCol = (name: string, def: string) => {
    if (pg) {
      return client.execute(
        `ALTER TABLE tool_data ADD COLUMN IF NOT EXISTS ${name} ${def}`,
      );
    }
    return client
      .execute(`ALTER TABLE tool_data ADD COLUMN ${name} ${def}`)
      .catch((err: any) => {
        if (
          !String(err?.message ?? err)
            .toLowerCase()
            .includes("duplicate")
        )
          throw err;
      });
  };
  await addCol("scope", "TEXT NOT NULL DEFAULT 'user'");
  await addCol("org_id", "TEXT");
  await addCol("scope_key", "TEXT NOT NULL DEFAULT 'local@localhost'");
  // One-time backfill migration: replaces the dev-mode DEFAULT scope_key
  // with each row's real owner_email. Not a per-request fallback.
  await client.execute(
    // guard:allow-localhost-fallback — one-time backfill migration replacing dev-mode default scope_key with the row's real owner_email
    `UPDATE tool_data SET scope_key = owner_email WHERE scope_key = 'local@localhost' AND owner_email != 'local@localhost'`,
  );
}

export function registerToolsShareable() {
  registerShareableResource({
    type: "tool",
    resourceTable: tools,
    sharesTable: toolShares,
    displayName: "Tool",
    titleColumn: "name",
    getDb: () => getDb(),
  });
}

export interface ToolRow {
  id: string;
  name: string;
  description: string;
  content: string;
  icon: string | null;
  createdAt: string;
  updatedAt: string;
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org" | "public";
}

export async function listTools(): Promise<ToolRow[]> {
  await ensureToolsTables();
  const db = getDb();
  return db
    .select()
    .from(tools)
    .where(accessFilter(tools, toolShares)) as Promise<ToolRow[]>;
}

export async function getTool(id: string): Promise<ToolRow | null> {
  await ensureToolsTables();
  const access = await resolveAccess("tool", id);
  return (access?.resource as ToolRow | undefined) ?? null;
}

export interface CreateToolData {
  name: string;
  description?: string;
  content?: string;
  icon?: string;
}

export async function createTool(data: CreateToolData): Promise<ToolRow> {
  await ensureToolsTables();
  const db = getDb();
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  const orgId = getRequestOrgId();
  const id = randomUUID();
  const now = new Date().toISOString();
  const row: ToolRow = {
    id,
    name: data.name,
    description: data.description ?? "",
    content: data.content ?? "",
    icon: data.icon ?? null,
    createdAt: now,
    updatedAt: now,
    ownerEmail: userEmail,
    orgId: orgId ?? null,
    visibility: "private",
  };
  await db.insert(tools).values(row);
  return row;
}

export interface UpdateToolData {
  name?: string;
  description?: string;
  icon?: string;
  visibility?: "private" | "org" | "public";
}

export async function updateTool(
  id: string,
  data: UpdateToolData,
): Promise<ToolRow | null> {
  await ensureToolsTables();
  await assertAccess("tool", id, "editor");
  const db = getDb();
  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (data.name !== undefined) updates.name = data.name;
  if (data.description !== undefined) updates.description = data.description;
  if (data.icon !== undefined) updates.icon = data.icon;
  if (data.visibility !== undefined) updates.visibility = data.visibility;
  await db.update(tools).set(updates).where(eq(tools.id, id));
  const rows = await db.select().from(tools).where(eq(tools.id, id));
  return (rows[0] as ToolRow) ?? null;
}

export interface UpdateToolContentOpts {
  content?: string;
  patches?: Array<{ find: string; replace: string }>;
}

export async function updateToolContent(
  id: string,
  opts: UpdateToolContentOpts,
): Promise<ToolRow | null> {
  await ensureToolsTables();
  await assertAccess("tool", id, "editor");
  const db = getDb();

  let newContent: string;
  if (opts.content !== undefined) {
    newContent = opts.content;
  } else if (opts.patches) {
    const rows = await db.select().from(tools).where(eq(tools.id, id));
    if (!rows[0]) return null;
    newContent = (rows[0] as ToolRow).content;
    for (const patch of opts.patches) {
      newContent = newContent.replace(patch.find, patch.replace);
    }
  } else {
    return null;
  }

  await db
    .update(tools)
    .set({ content: newContent, updatedAt: new Date().toISOString() })
    .where(eq(tools.id, id));
  const rows = await db.select().from(tools).where(eq(tools.id, id));
  return (rows[0] as ToolRow) ?? null;
}

export async function deleteTool(id: string): Promise<boolean> {
  await ensureToolsTables();
  await assertAccess("tool", id, "admin");
  const db = getDb();
  const rows = await db.select().from(tools).where(eq(tools.id, id));
  if (!rows[0]) return false;
  await db.delete(toolShares).where(eq(toolShares.resourceId, id));
  await getDbExec().execute({
    sql: `DELETE FROM tool_data WHERE tool_id = ?`,
    args: [id],
  });
  const { cascadeDeleteToolSlots } = await import("./slots/store.js");
  await cascadeDeleteToolSlots(id);
  await db.delete(tools).where(eq(tools.id, id));
  return true;
}
