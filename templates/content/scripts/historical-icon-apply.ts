import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  writeFile,
  unlink,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  readPrivateIcon,
  uploadPrivateIcon,
} from "../server/lib/private-icon-authority.js";
import {
  syncPrivateIconReference,
  verifyPrivateIconAssignment,
} from "../server/lib/private-icon-references.js";
import {
  nextViewConfigRaw,
  type IconReference,
  type RehostReceipt,
} from "./migrate-historical-icon-urls.js";

const RECEIPT_DIRECTORY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../.tmp",
);

export function historicalIconReceiptPath(databaseIdentity: string): string {
  if (!databaseIdentity)
    throw new Error(
      "A database identity is required for durable historical icon receipts",
    );
  const fingerprint = createHash("sha256")
    .update(databaseIdentity)
    .digest("hex")
    .slice(0, 24);
  return resolve(
    RECEIPT_DIRECTORY,
    `historical-icon-rehost-${fingerprint}.json`,
  );
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function receiptKey(
  fingerprint: string,
  ownerEmail: string,
  orgId: string | null,
): string {
  return `${fingerprint}:${ownerEmail}:${orgId ?? ""}`;
}

export async function openHistoricalIconReceipts(filename: string) {
  await mkdir(dirname(filename), { recursive: true });
  const lock = await open(`${filename}.lock`, "wx");
  let entries: Record<string, RehostReceipt>;
  try {
    const raw = await readFile(filename, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "{}";
        throw error;
      },
    );
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Historical icon receipts are malformed");
    entries = parsed as Record<string, RehostReceipt>;
  } catch (error) {
    await lock.close();
    await unlink(`${filename}.lock`);
    throw error;
  }
  return {
    read(
      fingerprint: string,
      ownerEmail: string,
      orgId: string | null,
    ): RehostReceipt | null {
      return entries[receiptKey(fingerprint, ownerEmail, orgId)] ?? null;
    },
    async save(receipt: RehostReceipt): Promise<void> {
      const key = receiptKey(
        receipt.sourceFingerprint,
        receipt.ownerEmail,
        receipt.orgId,
      );
      const existing = entries[key];
      if (existing && JSON.stringify(existing) !== JSON.stringify(receipt))
        throw new Error("Conflicting historical icon receipt");
      const nextEntries = { ...entries, [key]: receipt };
      const temporary = `${filename}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(nextEntries, null, 2), {
        mode: 0o600,
      });
      await rename(temporary, filename);
      entries = nextEntries;
    },
    async close(): Promise<void> {
      await lock.close();
      await unlink(`${filename}.lock`);
    },
  };
}

export async function uploadVerifiedHistoricalIcon(input: {
  data: Uint8Array;
  mimeType: string;
  ownerEmail: string;
  orgId: string | null;
}): Promise<{ id: string; sha256: string }> {
  const id = await uploadPrivateIcon(input);
  const read = await readPrivateIcon({ assetId: id, orgId: input.orgId });
  if (!read) throw new Error("Uploaded private icon cannot be read");
  return { id, sha256: sha256(read.data) };
}

export async function readHistoricalPrivateIcon(
  receipt: RehostReceipt,
): Promise<{ data: Uint8Array; sha256: string } | null> {
  await verifyPrivateIconAssignment({
    icon: {
      version: 1,
      kind: "image",
      authority: "private-icon",
      assetId: receipt.privateAssetId,
    },
    userEmail: receipt.ownerEmail,
    orgId: receipt.orgId,
  });
  const read = await readPrivateIcon({
    assetId: receipt.privateAssetId,
    orgId: receipt.orgId,
  });
  return read ? { data: read.data, sha256: sha256(read.data) } : null;
}

export async function replaceHistoricalIconIfUnchanged(
  reference: IconReference,
  newRaw: string,
): Promise<boolean> {
  await verifyPrivateIconAssignment({
    icon: newRaw,
    userEmail: reference.ownerEmail,
    orgId: reference.orgId,
  });
  const db = getDb();
  const org = reference.orgId;
  const owner = reference.ownerEmail;
  return db.transaction(async (tx) => {
    const scopedOrg = (column: typeof schema.documents.orgId) =>
      org === null ? isNull(column) : eq(column, org);
    if (reference.table === "documents") {
      const changed = await tx
        .update(schema.documents)
        .set({ icon: newRaw })
        .where(
          and(
            eq(schema.documents.id, reference.rowId),
            eq(schema.documents.ownerEmail, owner),
            scopedOrg(schema.documents.orgId),
            eq(schema.documents.icon, reference.raw),
          ),
        )
        .returning({ id: schema.documents.id });
      if (!changed.length) return false;
      await syncPrivateIconReference(
        tx as unknown as ReturnType<typeof getDb>,
        {
          elementType: "document",
          elementId: reference.rowId,
          documentId: reference.rowId,
          icon: newRaw,
          ownerEmail: owner,
          orgId: org,
        },
      );
      return true;
    }
    if (reference.table === "document_property_definitions") {
      const changed = await tx
        .update(schema.documentPropertyDefinitions)
        .set({ icon: newRaw })
        .where(
          and(
            eq(schema.documentPropertyDefinitions.id, reference.rowId),
            eq(schema.documentPropertyDefinitions.ownerEmail, owner),
            org === null
              ? isNull(schema.documentPropertyDefinitions.orgId)
              : eq(schema.documentPropertyDefinitions.orgId, org),
            eq(schema.documentPropertyDefinitions.icon, reference.raw),
          ),
        )
        .returning({
          databaseId: schema.documentPropertyDefinitions.databaseId,
        });
      if (!changed.length) return false;
      const databaseId = changed[0].databaseId;
      if (!databaseId)
        throw new Error("Property has no parent Content database");
      const [database] = await tx
        .select({ documentId: schema.contentDatabases.documentId })
        .from(schema.contentDatabases)
        .where(
          and(
            eq(schema.contentDatabases.id, databaseId),
            eq(schema.contentDatabases.ownerEmail, owner),
            org === null
              ? isNull(schema.contentDatabases.orgId)
              : eq(schema.contentDatabases.orgId, org),
          ),
        )
        .limit(1);
      if (!database)
        throw new Error("Property parent Content database is unavailable");
      await syncPrivateIconReference(
        tx as unknown as ReturnType<typeof getDb>,
        {
          elementType: "property",
          elementId: reference.rowId,
          documentId: database.documentId,
          icon: newRaw,
          ownerEmail: owner,
          orgId: org,
        },
      );
      return true;
    }
    const previousConfigRaw = reference.viewConfigRaw;
    if (!previousConfigRaw)
      throw new Error("View icon has no stable compare-and-swap source");
    const nextConfigRaw = nextViewConfigRaw(reference, newRaw);
    const changed = await tx
      .update(schema.contentDatabases)
      .set({ viewConfigJson: nextConfigRaw })
      .where(
        and(
          eq(schema.contentDatabases.id, reference.rowId),
          eq(schema.contentDatabases.ownerEmail, owner),
          org === null
            ? isNull(schema.contentDatabases.orgId)
            : eq(schema.contentDatabases.orgId, org),
          eq(schema.contentDatabases.viewConfigJson, previousConfigRaw),
        ),
      )
      .returning({ documentId: schema.contentDatabases.documentId });
    if (!changed.length) return false;
    await syncPrivateIconReference(tx as unknown as ReturnType<typeof getDb>, {
      elementType: "view",
      elementId: `${reference.rowId}:${reference.viewId}`,
      documentId: changed[0].documentId,
      icon: newRaw,
      ownerEmail: owner,
      orgId: org,
    });
    return true;
  });
}
