import { pathToFileURL } from "node:url";

import { closeDbExec, getDbExec } from "@agent-native/core/db";
import { loadEnv } from "@agent-native/core/scripts";
import {
  resolveBuilderRequestAuthorization,
  runWithRequestContext,
} from "@agent-native/core/server";

import {
  openHistoricalIconReceipts,
  historicalIconReceiptPath,
  readHistoricalPrivateIcon,
  replaceHistoricalIconIfUnchanged,
  uploadVerifiedHistoricalIcon,
} from "./historical-icon-apply.js";
import {
  fetchBoundedBuilderImage,
  verifyBuilderSpaceAssetUrl,
} from "./historical-icon-builder.js";
import {
  migrateHistoricalIconUrls,
  type IconReference,
  type RehostDependencies,
} from "./migrate-historical-icon-urls.js";

type Query = (
  sql: string,
  args: unknown[],
) => Promise<Record<string, unknown>[]>;
const LIMIT = 100_000;
const PAGE_SIZE = 500;

export async function listCurrentScalarIconReferences(
  query: Query,
  scope: { ownerEmail: string; orgId: string | null },
): Promise<IconReference[]> {
  if (!scope.ownerEmail.trim()) throw new Error("--owner-email is required");
  const references: IconReference[] = [];
  for (const surface of [
    { table: "documents", field: "icon" },
    { table: "document_property_definitions", field: "icon" },
    { table: "content_databases", field: "view_config_json" },
  ] as const) {
    let lastId = "";
    let scanned = 0;
    while (true) {
      const rows = await query(
        `SELECT id, ${surface.field}, owner_email, org_id FROM ${surface.table} WHERE owner_email = ? AND org_id IS NOT DISTINCT FROM ? AND id > ? ORDER BY id LIMIT ?`,
        [scope.ownerEmail, scope.orgId, lastId, PAGE_SIZE],
      );
      for (const row of rows) {
        if (typeof row.id !== "string" || row.id <= lastId)
          throw new Error(`Invalid ${surface.table} scan order`);
        lastId = row.id;
        if (++scanned > LIMIT)
          throw new Error(
            `${surface.table} exceeds scan limit; report is incomplete`,
          );
        if (surface.table !== "content_databases") {
          if (typeof row.icon === "string" && row.icon)
            references.push({
              table: surface.table,
              rowId: row.id,
              path: "icon",
              raw: row.icon,
              ownerEmail: scope.ownerEmail,
              orgId: scope.orgId,
            });
          continue;
        }
        if (typeof row.view_config_json !== "string")
          throw new Error(`Invalid Content view config for ${row.id}`);
        let config: unknown;
        try {
          config = JSON.parse(row.view_config_json);
        } catch {
          throw new Error(`Unreadable Content view config for ${row.id}`);
        }
        const views =
          config && typeof config === "object" && "views" in config
            ? config.views
            : null;
        if (!Array.isArray(views)) continue;
        for (const [index, view] of views.entries()) {
          if (
            !view ||
            typeof view !== "object" ||
            !("icon" in view) ||
            view.icon == null
          )
            continue;
          if (!("id" in view) || typeof view.id !== "string" || !view.id)
            throw new Error(
              `View ${index} in ${row.id} has an icon without a stable ID`,
            );
          references.push({
            table: surface.table,
            rowId: row.id,
            path: `views[${index}].icon`,
            raw:
              typeof view.icon === "string"
                ? view.icon
                : JSON.stringify(view.icon),
            ownerEmail: scope.ownerEmail,
            orgId: scope.orgId,
            viewId: view.id,
            viewConfigRaw: row.view_config_json,
          });
        }
      }
      if (rows.length < PAGE_SIZE) break;
    }
  }
  return references;
}

async function main(): Promise<void> {
  const ownerEmail = process.argv
    .find((arg) => arg.startsWith("--owner-email="))
    ?.slice("--owner-email=".length)
    .trim()
    .toLowerCase();
  const orgId =
    process.argv
      .find((arg) => arg.startsWith("--org-id="))
      ?.slice("--org-id=".length) ?? null;
  const credentialOrgId = process.argv
    .find((arg) => arg.startsWith("--credential-org-id="))
    ?.slice("--credential-org-id=".length);
  if (!ownerEmail)
    throw new Error(
      "Usage: tsx scripts/historical-icon-cli.ts --owner-email=<email> [--org-id=<id>] [--credential-org-id=<id>]",
    );
  if (orgId && credentialOrgId && orgId !== credentialOrgId)
    throw new Error("Credential organization must match the target workspace");
  const apply = process.argv.includes("--apply");
  loadEnv();
  const receiptFile = apply
    ? historicalIconReceiptPath(
        process.env.DATABASE_URL ?? process.env.NETLIFY_DATABASE_URL ?? "",
      )
    : null;
  await runWithRequestContext(
    { userEmail: ownerEmail, orgId: credentialOrgId ?? orgId ?? undefined },
    async () => {
      const db = getDbExec();
      const authorization = await resolveBuilderRequestAuthorization({
        legacyCredentialKeys: ["BUILDER_PRIVATE_KEY"],
      });
      if (!authorization)
        throw new Error(
          "No Builder credential is connected for this owner and workspace",
        );
      const ownership = new Map<
        string,
        Promise<"owned" | "unmatched" | "ambiguous">
      >();
      const references = await listCurrentScalarIconReferences(
        async (sql, args) =>
          (await db.execute({ sql, args })).rows as Record<string, unknown>[],
        { ownerEmail, orgId },
      );
      let receipts: Awaited<
        ReturnType<typeof openHistoricalIconReceipts>
      > | null = null;
      const dependencies: RehostDependencies = {
        listReferences: async () => references,
        verifyBuilderOwnership: (url) => {
          let result = ownership.get(url);
          if (!result) {
            result = verifyBuilderSpaceAssetUrl(url, authorization);
            ownership.set(url, result);
          }
          return result;
        },
        fetchImage: fetchBoundedBuilderImage,
        uploadPrivate: uploadVerifiedHistoricalIcon,
        readPrivate: readHistoricalPrivateIcon,
        readReceipt: async (fingerprint, email, org) => {
          if (!receipts) throw new Error("receipt store is unavailable");
          return receipts.read(fingerprint, email, org);
        },
        saveReceipt: async (receipt) => {
          if (!receipts) throw new Error("receipt store is unavailable");
          await receipts.save(receipt);
        },
        replaceIfUnchanged: replaceHistoricalIconIfUnchanged,
      };
      try {
        const preflight = await migrateHistoricalIconUrls(dependencies);
        if (!apply) {
          process.stdout.write(`${JSON.stringify(preflight, null, 2)}\n`);
          if (preflight.deferred.length || preflight.ambiguous.length)
            process.exitCode = 2;
          return;
        }
        if (preflight.deferred.length || preflight.ambiguous.length) {
          throw new Error(
            `Apply stopped by ownership preflight: ${preflight.deferred.length} deferred, ${preflight.ambiguous.length} ambiguous`,
          );
        }
        receipts = await openHistoricalIconReceipts(receiptFile!);
        const report = await migrateHistoricalIconUrls(dependencies, {
          apply: true,
        });
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        if (report.deferred.length || report.ambiguous.length)
          process.exitCode = 2;
      } finally {
        await receipts?.close();
      }
    },
  );
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
