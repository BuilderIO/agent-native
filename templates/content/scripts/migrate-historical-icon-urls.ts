import { createHash } from "node:crypto";

import {
  safeParseIconValue,
  serializeIconValue,
} from "@agent-native/core/icons";

const MAX_ICON_BYTES = 5 * 1024 * 1024;
const SUPPORTED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

export type IconReference = {
  table: "documents" | "document_property_definitions" | "content_databases";
  rowId: string;
  path: string;
  raw: string;
  ownerEmail: string;
  orgId: string | null;
  viewId?: string;
  viewConfigRaw?: string;
};

export type RehostReceipt = {
  sourceFingerprint: string;
  sourceSha256: string;
  privateAssetId: string;
  privateSha256: string;
  ownerEmail: string;
  orgId: string | null;
};

export type RehostReport = {
  dryRun: boolean;
  scanned: number;
  candidates: number;
  external: number;
  ownershipVerified: number;
  migrated: number;
  alreadyMigrated: number;
  deferred: Array<{ reference: string; reason: string }>;
  ambiguous: Array<{ reference: string; reason: string }>;
  providerRevocationEligible: false;
  remainingReferenceSurfaces: string[];
};

export type RehostDependencies = {
  listReferences: () => Promise<IconReference[]>;
  verifyBuilderOwnership: (
    url: string,
  ) => Promise<"owned" | "unmatched" | "ambiguous">;
  fetchImage: (url: string) => Promise<{ data: Uint8Array; mimeType: string }>;
  uploadPrivate: (input: {
    data: Uint8Array;
    mimeType: string;
    ownerEmail: string;
    orgId: string | null;
  }) => Promise<{ id: string; sha256: string }>;
  readPrivate: (
    receipt: RehostReceipt,
  ) => Promise<{ data: Uint8Array; sha256: string } | null>;
  readReceipt: (
    sourceFingerprint: string,
    ownerEmail: string,
    orgId: string | null,
  ) => Promise<RehostReceipt | null>;
  saveReceipt: (receipt: RehostReceipt) => Promise<void>;
  replaceIfUnchanged: (
    reference: IconReference,
    newRaw: string,
  ) => Promise<boolean>;
};

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizedBuilderAssetUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== "cdn.builder.io")
      return null;
    if (
      !url.pathname.startsWith("/api/v1/image/") &&
      !url.pathname.startsWith("/api/v1/file/")
    )
      return null;
    if (url.search || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function referenceKey(reference: IconReference): string {
  return `${reference.table}:${reference.rowId}:${reference.path}`;
}

function replacement(raw: string, assetId: string): string {
  const parsed = safeParseIconValue(raw);
  if (!parsed.success || parsed.data?.kind !== "image")
    throw new Error("Icon changed during migration");
  return serializeIconValue({
    ...parsed.data,
    assetId,
    authority: "private-icon",
  })!;
}

export function nextViewConfigRaw(
  reference: IconReference,
  newRaw: string,
): string {
  if (
    reference.table !== "content_databases" ||
    !reference.viewConfigRaw ||
    !reference.viewId
  ) {
    throw new Error("View icon has no stable compare-and-swap source");
  }
  const config = JSON.parse(reference.viewConfigRaw) as {
    views?: Array<{ id?: string; icon?: unknown }>;
  };
  const index = Number(reference.path.match(/^views\[(\d+)\]\.icon$/)?.[1]);
  const view = config.views?.[index];
  if (
    !Number.isInteger(index) ||
    !view ||
    view.id !== reference.viewId ||
    (typeof view.icon === "string" ? view.icon : JSON.stringify(view.icon)) !==
      reference.raw
  ) {
    throw new Error("View icon source changed");
  }
  view.icon = JSON.parse(newRaw) as unknown;
  return JSON.stringify(config);
}

export async function migrateHistoricalIconUrls(
  dependencies: RehostDependencies,
  options: { apply?: boolean } = {},
): Promise<RehostReport> {
  const references = (await dependencies.listReferences()).map((reference) => ({
    ...reference,
  }));
  const report: RehostReport = {
    dryRun: options.apply !== true,
    scanned: references.length,
    candidates: 0,
    external: 0,
    ownershipVerified: 0,
    migrated: 0,
    alreadyMigrated: 0,
    deferred: [],
    ambiguous: [],
    providerRevocationEligible: false,
    remainingReferenceSurfaces: [
      "document versions, preview drafts, sidecars, block fields, and callout bodies",
      "organization copies and other applications",
      "browser caches and recent-item stores",
    ],
  };
  for (const reference of references) {
    const key = referenceKey(reference);
    const parsed = safeParseIconValue(reference.raw);
    if (!parsed.success) {
      report.ambiguous.push({ reference: key, reason: "malformed icon" });
      continue;
    }
    if (parsed.data?.kind !== "image") continue;
    if (parsed.data.authority === "private-icon") {
      report.alreadyMigrated++;
      continue;
    }
    if (parsed.data.authority !== "url") {
      report.ambiguous.push({
        reference: key,
        reason: "unknown image authority",
      });
      continue;
    }
    try {
      if (new URL(parsed.data.assetId).hostname !== "cdn.builder.io") {
        report.external++;
        continue;
      }
    } catch {
      report.ambiguous.push({ reference: key, reason: "invalid image URL" });
      continue;
    }
    const liveUrl = new URL(parsed.data.assetId);
    if (liveUrl.search || liveUrl.hash) {
      report.candidates++;
      report.deferred.push({
        reference: key,
        reason:
          "Builder image URL has query parameters or a fragment; rendered variant needs separate preservation",
      });
      continue;
    }
    const url = normalizedBuilderAssetUrl(parsed.data.assetId);
    if (!url) {
      report.ambiguous.push({
        reference: key,
        reason: "not a canonical Builder asset URL",
      });
      continue;
    }
    report.candidates++;
    let ownership: Awaited<
      ReturnType<RehostDependencies["verifyBuilderOwnership"]>
    >;
    try {
      ownership = await dependencies.verifyBuilderOwnership(url);
    } catch (error) {
      report.deferred.push({
        reference: key,
        reason:
          error instanceof Error && error.message.includes("Space private key")
            ? "Builder Admin listing requires a Space private key; current OAuth grant cannot verify ownership"
            : "Builder asset ownership query failed",
      });
      continue;
    }
    if (ownership !== "owned") {
      report.ambiguous.push({
        reference: key,
        reason:
          ownership === "unmatched"
            ? "no exact Space asset match"
            : "multiple or untrusted Space asset matches",
      });
      continue;
    }
    report.ownershipVerified++;
    if (!options.apply) continue;

    const sourceFingerprint = sha256(
      `${url}\0${reference.ownerEmail}\0${reference.orgId ?? ""}`,
    );
    try {
      let receipt = await dependencies.readReceipt(
        sourceFingerprint,
        reference.ownerEmail,
        reference.orgId,
      );
      if (receipt) {
        if (
          receipt.sourceFingerprint !== sourceFingerprint ||
          receipt.ownerEmail !== reference.ownerEmail ||
          receipt.orgId !== reference.orgId
        )
          throw new Error("receipt scope mismatch");
      } else {
        const source = await dependencies.fetchImage(url);
        if (
          !SUPPORTED_MIME_TYPES.has(source.mimeType) ||
          source.data.byteLength < 1 ||
          source.data.byteLength > MAX_ICON_BYTES
        )
          throw new Error("unsupported image MIME or size");
        const uploaded = await dependencies.uploadPrivate({
          ...source,
          ownerEmail: reference.ownerEmail,
          orgId: reference.orgId,
        });
        receipt = {
          sourceFingerprint,
          sourceSha256: sha256(source.data),
          privateAssetId: uploaded.id,
          privateSha256: uploaded.sha256,
          ownerEmail: reference.ownerEmail,
          orgId: reference.orgId,
        };
        const read = await dependencies.readPrivate(receipt);
        if (
          !read ||
          read.sha256 !== receipt.privateSha256 ||
          sha256(read.data) !== receipt.privateSha256
        )
          throw new Error("private image readback failed integrity check");
        await dependencies.saveReceipt(receipt);
      }
      const read = await dependencies.readPrivate(receipt);
      if (
        !read ||
        read.sha256 !== receipt.privateSha256 ||
        sha256(read.data) !== receipt.privateSha256
      )
        throw new Error("private receipt is unreadable or changed");
      const newRaw = replacement(reference.raw, receipt.privateAssetId);
      const previousViewConfig = reference.viewConfigRaw;
      const rolledViewConfig =
        reference.table === "content_databases"
          ? nextViewConfigRaw(reference, newRaw)
          : null;
      if (await dependencies.replaceIfUnchanged(reference, newRaw)) {
        report.migrated++;
        if (rolledViewConfig && previousViewConfig) {
          for (const sibling of references) {
            if (
              sibling.table === "content_databases" &&
              sibling.rowId === reference.rowId &&
              sibling.viewConfigRaw === previousViewConfig
            ) {
              sibling.viewConfigRaw = rolledViewConfig;
            }
          }
        }
      } else {
        report.deferred.push({
          reference: key,
          reason: "current icon changed before compare-and-swap",
        });
      }
    } catch (error) {
      report.deferred.push({
        reference: key,
        reason:
          error instanceof Error &&
          [
            "unsupported image MIME or size",
            "private image readback failed integrity check",
            "private receipt is unreadable or changed",
            "receipt scope mismatch",
          ].includes(error.message)
            ? error.message
            : "image fetch, upload, receipt, or icon update failed",
      });
    }
  }
  return report;
}
