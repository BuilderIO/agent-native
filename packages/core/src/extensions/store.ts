import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDbExec, isPostgres, retryOnDdlRace } from "../db/client.js";
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
  extensions,
  extensionShares,
  EXTENSIONS_CREATE_SQL,
  EXTENSIONS_CREATE_SQL_PG,
  EXTENSION_SHARES_CREATE_SQL,
  EXTENSION_SHARES_CREATE_SQL_PG,
  EXTENSION_DATA_CREATE_SQL,
  EXTENSION_DATA_CREATE_SQL_PG,
  EXTENSION_DATA_ITEM_INDEX_SQL,
  EXTENSION_DATA_ITEM_INDEX_SQL_PG,
  EXTENSION_DATA_DROP_OLD_INDEX_SQL,
  EXTENSION_DATA_DROP_OLD_INDEX_SQL_PG,
  EXTENSIONS_OWNER_INDEX_SQL,
  EXTENSIONS_ORG_INDEX_SQL,
  EXTENSION_SHARES_RESOURCE_INDEX_SQL,
  EXTENSION_CONSENTS_CREATE_SQL,
  EXTENSION_CONSENTS_CREATE_SQL_PG,
  EXTENSION_CONSENTS_VIEWER_INDEX_SQL,
} from "./schema.js";

const getDb = createGetDb({ extensions, extensionShares });

let _initPromise: Promise<void> | undefined;

export async function ensureExtensionsTables(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const pg = isPostgres();
      await retryOnDdlRace(() =>
        client.execute(pg ? EXTENSIONS_CREATE_SQL_PG : EXTENSIONS_CREATE_SQL),
      );
      await retryOnDdlRace(() =>
        client.execute(pg ? EXTENSION_SHARES_CREATE_SQL_PG : EXTENSION_SHARES_CREATE_SQL),
      );
      await retryOnDdlRace(() =>
        client.execute(pg ? EXTENSION_DATA_CREATE_SQL_PG : EXTENSION_DATA_CREATE_SQL),
      );
      await ensureExtensionDataItemId(client, pg);
      await ensureExtensionDataScope(client, pg);
      await client.execute(
        pg ? EXTENSION_DATA_DROP_OLD_INDEX_SQL_PG : EXTENSION_DATA_DROP_OLD_INDEX_SQL,
      );
      await retryOnDdlRace(() =>
        client.execute(
          pg ? EXTENSION_DATA_ITEM_INDEX_SQL_PG : EXTENSION_DATA_ITEM_INDEX_SQL,
        ),
      );
      await retryOnDdlRace(() => client.execute(EXTENSIONS_OWNER_INDEX_SQL));
      await retryOnDdlRace(() => client.execute(EXTENSIONS_ORG_INDEX_SQL));
      await retryOnDdlRace(() =>
        client.execute(EXTENSION_SHARES_RESOURCE_INDEX_SQL),
      );
      // tool_consents was introduced for an audit-C1 per-viewer consent
      // gate that we removed once we settled on intra-org trust as the
      // baseline. The table is kept (additive — never drop) so deploys
      // that already created it stay healthy; the runtime consent code
      // is gone. Idempotent CREATE IF NOT EXISTS for fresh schemas.
      await retryOnDdlRace(() =>
        client.execute(
          pg ? EXTENSION_CONSENTS_CREATE_SQL_PG : EXTENSION_CONSENTS_CREATE_SQL,
        ),
      );
      await retryOnDdlRace(() =>
        client.execute(EXTENSION_CONSENTS_VIEWER_INDEX_SQL),
      );
    })();
  }
  return _initPromise;
}

async function ensureExtensionDataItemId(
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

async function ensureExtensionDataScope(
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

export function registerExtensionsShareable() {
  registerShareableResource({
    type: "extension",
    resourceTable: extensions,
    sharesTable: extensionShares,
    displayName: "Extension",
    titleColumn: "name",
    getDb: () => getDb(),
  });
}

export interface ExtensionRow {
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

export async function listExtensions(): Promise<ExtensionRow[]> {
  await ensureExtensionsTables();
  const db = getDb();
  return db
    .select()
    .from(extensions)
    .where(accessFilter(extensions, extensionShares)) as Promise<ExtensionRow[]>;
}

export async function getExtension(id: string): Promise<ExtensionRow | null> {
  await ensureExtensionsTables();
  const access = await resolveAccess("extension", id);
  return (access?.resource as ExtensionRow | undefined) ?? null;
}

export interface CreateExtensionData {
  name: string;
  description?: string;
  content?: string;
  icon?: string;
}

export async function createExtension(data: CreateExtensionData): Promise<ExtensionRow> {
  await ensureExtensionsTables();
  const db = getDb();
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  const orgId = getRequestOrgId();
  const id = randomUUID();
  const now = new Date().toISOString();
  const row: ExtensionRow = {
    id,
    name: data.name,
    description: data.description ?? "",
    content: data.content ?? "",
    icon: data.icon ?? null,
    createdAt: now,
    updatedAt: now,
    ownerEmail: userEmail,
    orgId: orgId ?? null,
    // Default to org-visibility when the user has an active organization so
    // teammates see the extension in their sidebar — matching how analytics
    // dashboards/analyses are scoped (`templates/analytics/server/lib/
    // dashboards-store.ts:356`). Solo users (no org) get the private
    // default. Owners can still flip back to private via update-extension.
    visibility: orgId ? "org" : "private",
  };
  await db.insert(extensions).values(row);
  return row;
}

export interface UpdateExtensionData {
  name?: string;
  description?: string;
  icon?: string;
  visibility?: "private" | "org" | "public";
}

export async function updateExtension(
  id: string,
  data: UpdateExtensionData,
): Promise<ExtensionRow | null> {
  await ensureExtensionsTables();
  await assertAccess("extension", id, "editor");
  const db = getDb();
  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (data.name !== undefined) updates.name = data.name;
  if (data.description !== undefined) updates.description = data.description;
  if (data.icon !== undefined) updates.icon = data.icon;
  if (data.visibility !== undefined) updates.visibility = data.visibility;
  await db.update(extensions).set(updates).where(eq(extensions.id, id));
  const rows = await db.select().from(extensions).where(eq(extensions.id, id));
  return (rows[0] as ExtensionRow) ?? null;
}

export interface UpdateExtensionContentOpts {
  content?: string;
  patches?: Array<{ find: string; replace: string }>;
}

export async function updateExtensionContent(
  id: string,
  opts: UpdateExtensionContentOpts,
): Promise<ExtensionRow | null> {
  await ensureExtensionsTables();
  await assertAccess("extension", id, "editor");
  const db = getDb();

  let newContent: string;
  if (opts.content !== undefined) {
    newContent = opts.content;
  } else if (opts.patches) {
    const rows = await db.select().from(extensions).where(eq(extensions.id, id));
    if (!rows[0]) return null;
    newContent = (rows[0] as ExtensionRow).content;
    for (const patch of opts.patches) {
      newContent = newContent.replace(patch.find, patch.replace);
    }
  } else {
    return null;
  }

  await db
    .update(extensions)
    .set({ content: newContent, updatedAt: new Date().toISOString() })
    .where(eq(extensions.id, id));
  const rows = await db.select().from(extensions).where(eq(extensions.id, id));
  return (rows[0] as ExtensionRow) ?? null;
}

export async function deleteExtension(id: string): Promise<boolean> {
  await ensureExtensionsTables();
  await assertAccess("extension", id, "admin");
  const db = getDb();
  const rows = await db.select().from(extensions).where(eq(extensions.id, id));
  if (!rows[0]) return false;
  await db.delete(extensionShares).where(eq(extensionShares.resourceId, id));
  await getDbExec().execute({
    sql: `DELETE FROM tool_data WHERE tool_id = ?`,
    args: [id],
  });
  const { cascadeDeleteExtensionSlots } = await import("./slots/store.js");
  await cascadeDeleteExtensionSlots(id);
  await db.delete(extensions).where(eq(extensions.id, id));
  return true;
}
