import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { closeDbExec, getDbExec } from "@agent-native/core/db";
import { safeParseIconValue } from "@agent-native/core/icons";
import { loadEnv } from "@agent-native/core/scripts";

type Classification = "candidate" | "external" | "ambiguous";
type Reference = { table: string; rowId: string; path: string };
type IconRow = Record<string, unknown> & { id: string };
type Query = (sql: string, args: unknown[]) => Promise<IconRow[]>;

const BATCH_SIZE = 500;
const MAX_ROWS_PER_TABLE = 100_000;
const MAX_REPORTED_URLS = 100;
const MAX_REPORTED_REFS_PER_URL = 20;

const surfaces = [
  { table: "documents", fields: ["icon", "content"] },
  { table: "document_property_definitions", fields: ["icon"] },
  { table: "content_databases", fields: ["view_config_json"] },
  { table: "document_versions", fields: ["content"] },
  { table: "document_preview_drafts", fields: ["content"] },
  { table: "builder_doc_sidecars", fields: ["content"] },
  { table: "document_block_field_contents", fields: ["content"] },
  { table: "document_blocks", fields: ["markdown"] },
  { table: "organizations", fields: ["icon_json"] },
] as const;

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function classifyIconAsset(
  assetId: string,
  authority: string,
): Classification {
  if (authority !== "url") return "ambiguous";
  try {
    const url = new URL(assetId);
    if (url.protocol !== "https:") return "ambiguous";
    return url.hostname === "cdn.builder.io" ? "candidate" : "external";
  } catch {
    return "ambiguous";
  }
}

function decodeAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function findCalloutIcons(content: string): string[] {
  const icons: string[] = [];
  const opening = /<callout\b[^\r\n]*?\bicon="([^"]*)"/g;
  for (const match of content.matchAll(opening)) {
    icons.push(decodeAttribute(match[1]));
  }
  return icons;
}

export async function inventoryHistoricalIconUrls(query: Query) {
  const available = await query(
    "SELECT table_name AS id FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY(?)",
    [surfaces.map((surface) => surface.table)],
  );
  const availableTables = new Set(available.map((row) => row.id));
  const missingTables = surfaces
    .filter((surface) => !availableTables.has(surface.table))
    .map((surface) => surface.table);
  const grouped = new Map<
    string,
    {
      classification: Classification;
      referenceCount: number;
      references: Reference[];
    }
  >();
  const scannedRows: Record<string, number> = {};
  const malformed: Reference[] = [];
  let malformedCount = 0;
  let imageReferenceCount = 0;

  const record = (raw: unknown, reference: Reference) => {
    const parsed = safeParseIconValue(raw);
    if (!parsed.success) {
      malformedCount++;
      if (malformed.length < 50) malformed.push(reference);
      return;
    }
    const icon = parsed.data;
    if (icon?.kind !== "image") return;
    imageReferenceCount++;
    const key = fingerprint(`${icon.authority}\0${icon.assetId}`);
    const existing = grouped.get(key) ?? {
      classification: classifyIconAsset(icon.assetId, icon.authority),
      referenceCount: 0,
      references: [],
    };
    existing.referenceCount++;
    if (existing.references.length < MAX_REPORTED_REFS_PER_URL) {
      existing.references.push(reference);
    }
    grouped.set(key, existing);
  };

  for (const surface of surfaces) {
    if (!availableTables.has(surface.table)) continue;
    let lastId = "";
    let scanned = 0;
    while (true) {
      const columns = ["id", ...surface.fields].join(", ");
      const rows = await query(
        `SELECT ${columns} FROM ${surface.table} WHERE id > ? ORDER BY id LIMIT ?`,
        [lastId, BATCH_SIZE],
      );
      for (const row of rows) {
        if (typeof row.id !== "string" || row.id <= lastId) {
          throw new Error(
            `Invalid or unordered ${surface.table} inventory row`,
          );
        }
        lastId = row.id;
        scanned++;
        if (scanned > MAX_ROWS_PER_TABLE) {
          throw new Error(
            `${surface.table} exceeded ${MAX_ROWS_PER_TABLE} rows; inventory is incomplete`,
          );
        }
        if (
          surface.table === "documents" ||
          surface.table === "document_property_definitions"
        ) {
          if (row.icon != null)
            record(row.icon, {
              table: surface.table,
              rowId: row.id,
              path: "icon",
            });
        } else if (surface.table === "organizations" && row.icon_json != null) {
          record(row.icon_json, {
            table: surface.table,
            rowId: row.id,
            path: "icon_json",
          });
        } else if (surface.table === "content_databases") {
          let config: unknown;
          try {
            config = JSON.parse(String(row.view_config_json));
          } catch {
            malformedCount++;
            if (malformed.length < 50)
              malformed.push({
                table: surface.table,
                rowId: row.id,
                path: "view_config_json",
              });
          }
          const views =
            config && typeof config === "object" && "views" in config
              ? config.views
              : null;
          if (Array.isArray(views)) {
            views.forEach((view, index) => {
              if (
                view &&
                typeof view === "object" &&
                "icon" in view &&
                view.icon != null
              ) {
                record(view.icon, {
                  table: surface.table,
                  rowId: row.id,
                  path: `views[${index}].icon`,
                });
              }
            });
          }
        }
        for (const field of ["content", "markdown"] as const) {
          if (typeof row[field] !== "string") continue;
          findCalloutIcons(row[field]).forEach((icon, index) => {
            record(icon, {
              table: surface.table,
              rowId: row.id,
              path: `${field}.callout[${index}].icon`,
            });
          });
        }
      }
      if (rows.length < BATCH_SIZE) break;
    }
    scannedRows[surface.table] = scanned;
  }

  const assets = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, MAX_REPORTED_URLS)
    .map(([fingerprint, group]) => ({ fingerprint, ...group }));
  const counts = { candidate: 0, external: 0, ambiguous: 0 };
  for (const group of grouped.values()) counts[group.classification]++;
  const omittedReferenceCount = [...grouped.values()].reduce(
    (total, group) => total + group.referenceCount - group.references.length,
    0,
  );
  return {
    reportVersion: 1,
    readOnly: true,
    ownershipVerified: false,
    complete:
      missingTables.length === 0 &&
      grouped.size <= MAX_REPORTED_URLS &&
      omittedReferenceCount === 0 &&
      malformedCount === 0,
    missingTables,
    scannedRows,
    imageReferenceCount,
    uniqueAssetCounts: counts,
    reportedAssets: assets,
    omittedAssetCount: Math.max(0, grouped.size - assets.length),
    omittedReferenceCount,
    malformedCount,
    malformedExamples: malformed,
    limitations: [
      "A Builder CDN hostname identifies a migration candidate, not upload ownership or exclusive use.",
      "This scans the configured Content database only; federated organization copies and browser recents in other apps require separate inventories.",
      "Historical versions and drafts retain references that must be considered before revoking provider URLs.",
      "Callout tags are found lexically in stored bodies; code samples may produce false-positive candidates and require source review.",
      "Raw URLs and document contents are omitted; use an access-controlled migration process to resolve fingerprints to bytes.",
    ],
  };
}

async function main(): Promise<void> {
  loadEnv();
  const db = getDbExec();
  const report = await inventoryHistoricalIconUrls(async (sql, args) => {
    const result = await db.execute({ sql, args });
    return result.rows as IconRow[];
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.complete) process.exitCode = 2;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main();
  } finally {
    await closeDbExec();
  }
}
