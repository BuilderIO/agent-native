import {
  deleteAppState,
  listAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { deleteUploadedFile, uploadFile } from "@agent-native/core/file-upload";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, inArray, isNull, or } from "@agent-native/core/db/schema";
import { nanoid } from "nanoid";

import { appStorageKey } from "../../shared/app-storage.js";
import type {
  SlideDesignTokens,
  SlideFontAsset,
} from "../../shared/slide-design-tokens.js";
import {
  isBuiltinSlideDesignFont,
  isSafeSlideFontFamily,
  SLIDE_FONT_VARIANT_PATTERN,
} from "../../shared/slide-design-tokens.js";
import { getDb, schema } from "../db/index.js";
import {
  assertDeckAssetUploadScope,
  registerDeckUploadedAsset,
} from "./deck-asset-scope.js";
import { type DownloadedGoogleFont } from "./google-fonts.js";
import { deleteUploadedAssetObject } from "./uploaded-asset-object-lifecycle.js";

const MAX_STORED_FONT_BYTES = 8 * 1024 * 1024;
const FONT_MIME_EXTENSIONS: Record<string, string> = {
  "font/otf": ".otf",
  "font/ttf": ".ttf",
  "font/woff": ".woff",
  "font/woff2": ".woff2",
};
const ORPHAN_FONT_ASSET_PREFIX = appStorageKey(
  "slides-upload-orphan-font-asset-",
);

type OrphanedFontAssetCleanup = {
  version: 1;
  ownerEmail: string;
  orgId: string | null;
  deckId: string;
  assetId: string;
  provider: string;
  providerObjectId: string | null;
  url: string;
  createdAt: string;
};

export type RegisteredSlideFont = SlideFontAsset;

export class UploadedFontError extends Error {
  constructor(
    message: string,
    readonly errorCode: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "UploadedFontError";
  }
}

function fontFailure(
  message: string,
  errorCode: string,
  statusCode: number,
): UploadedFontError {
  return new UploadedFontError(message, errorCode, statusCode);
}

function fontFilename(font: DownloadedGoogleFont): string {
  const family = font.family
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const variant = font.variant.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return `font-${family || "google-font"}-${variant}.${font.extension}`;
}

function assertFontUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw fontFailure(
      "Font storage returned an invalid URL.",
      "google_font_storage_url_invalid",
      502,
    );
  }
  const localHttp =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !localHttp) ||
    url.username ||
    url.password ||
    url.hash ||
    url.href !== value
  ) {
    throw fontFailure(
      "Font storage returned an unsupported URL.",
      "google_font_storage_url_invalid",
      502,
    );
  }
  return value;
}

function selectedFonts(tokens: SlideDesignTokens): Array<{
  family: string;
  assetId: string | undefined;
}> {
  return [
    { family: tokens.displayFont, assetId: tokens.displayFontAssetId },
    { family: tokens.bodyFont, assetId: tokens.bodyFontAssetId },
  ];
}

function assertFontSelectionShape(
  tokens: SlideDesignTokens,
): Map<string, string> {
  const selected = new Map<string, string>();
  for (const { family, assetId } of selectedFonts(tokens)) {
    if (!isSafeSlideFontFamily(family)) {
      throw fontFailure(
        "The selected font family is invalid.",
        "slide_font_selection_invalid",
        400,
      );
    }
    if (!assetId) {
      if (!isBuiltinSlideDesignFont(family)) {
        throw fontFailure(
          "Import this font before applying it to a deck.",
          "slide_font_asset_required",
          400,
        );
      }
      continue;
    }
    const existingFamily = selected.get(assetId);
    if (existingFamily && existingFamily !== family) {
      throw fontFailure(
        "A selected font asset does not match its family.",
        "slide_font_asset_mismatch",
        422,
      );
    }
    selected.set(assetId, family);
  }
  return selected;
}

function slideFontAssetScope(
  ownerEmail: string,
  orgId: string | null | undefined,
) {
  const ownerScope = and(
    eq(schema.uploadedAssets.ownerEmail, ownerEmail),
    orgId
      ? eq(schema.uploadedAssets.orgId, orgId)
      : isNull(schema.uploadedAssets.orgId),
  );
  return orgId
    ? or(ownerScope, eq(schema.uploadedAssets.orgId, orgId))
    : ownerScope;
}

function exactFontAssetScope(
  assetId: string,
  ownerEmail: string,
  orgId: string | null | undefined,
  deckId: string,
) {
  return and(
    eq(schema.uploadedAssets.id, assetId),
    eq(schema.uploadedAssets.ownerEmail, ownerEmail),
    orgId
      ? eq(schema.uploadedAssets.orgId, orgId)
      : isNull(schema.uploadedAssets.orgId),
    eq(schema.uploadedAssets.deckId, deckId),
  );
}

async function fontAssetExists(
  assetId: string,
  ownerEmail: string,
  orgId: string | null | undefined,
  deckId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: schema.uploadedAssets.id })
    .from(schema.uploadedAssets)
    .where(exactFontAssetScope(assetId, ownerEmail, orgId, deckId))
    .limit(1);
  return Boolean(row);
}

async function recordOrphanedFontAssetCleanup(
  cleanup: OrphanedFontAssetCleanup,
): Promise<void> {
  await writeAppState(
    `${ORPHAN_FONT_ASSET_PREFIX}${cleanup.assetId}`,
    cleanup as unknown as Record<string, unknown>,
  );
}

function isOrphanedFontAssetCleanup(
  value: unknown,
  ownerEmail: string,
  orgId: string | undefined,
): value is OrphanedFontAssetCleanup {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cleanup = value as Record<string, unknown>;
  return (
    cleanup.version === 1 &&
    cleanup.ownerEmail === ownerEmail &&
    (cleanup.orgId === null || typeof cleanup.orgId === "string") &&
    cleanup.orgId === (orgId ?? null) &&
    typeof cleanup.deckId === "string" &&
    cleanup.deckId.length > 0 &&
    typeof cleanup.assetId === "string" &&
    cleanup.assetId.length > 0 &&
    typeof cleanup.provider === "string" &&
    cleanup.provider.length > 0 &&
    (cleanup.providerObjectId === null ||
      typeof cleanup.providerObjectId === "string") &&
    typeof cleanup.url === "string" &&
    cleanup.url.length > 0
  );
}

export async function reapOrphanedFontAssetObjects(
  ownerEmail: string,
  orgId: string | undefined,
): Promise<void> {
  const requestContext = {
    userEmail: ownerEmail,
    ...(orgId === undefined ? {} : { orgId }),
  };
  let entries: Array<{ key: string; value: Record<string, unknown> }>;
  try {
    entries = await runWithRequestContext(requestContext, () =>
      listAppState(ORPHAN_FONT_ASSET_PREFIX),
    );
  } catch {
    console.warn("[slides-upload] could not read orphaned font receipts");
    return;
  }

  await Promise.all(
    entries.map(async ({ key, value }) => {
      if (!isOrphanedFontAssetCleanup(value, ownerEmail, orgId)) return;
      try {
        const registered = await runWithRequestContext(requestContext, () =>
          fontAssetExists(value.assetId, ownerEmail, orgId, value.deckId),
        );
        if (registered) {
          await runWithRequestContext(requestContext, () =>
            deleteAppState(key),
          );
          return;
        }
        const deletion = await runWithRequestContext(requestContext, () =>
          deleteUploadedAssetObject({
            identity: {
              url: value.url,
              provider: value.provider,
              providerObjectId: value.providerObjectId,
            },
            excludeAssetId: value.assetId,
            deleteObject: () =>
              deleteUploadedFile(value.provider, {
                id: value.providerObjectId ?? undefined,
                url: value.url,
              }),
          }),
        );
        if (deletion.status !== "failed") {
          await runWithRequestContext(requestContext, () =>
            deleteAppState(key),
          );
        }
      } catch {
        console.warn("[slides-upload] orphaned font object retry failed", {
          assetId: value.assetId,
        });
      }
    }),
  );
}

async function recordAndReapFailedFontRegistration(args: {
  email: string;
  orgId?: string | null;
  deckId: string;
  assetId: string;
  provider: string;
  providerObjectId: string | null;
  url: string;
}): Promise<void> {
  const orgId = args.orgId ?? undefined;
  const requestContext = {
    userEmail: args.email,
    ...(orgId === undefined ? {} : { orgId }),
  };
  const cleanup: OrphanedFontAssetCleanup = {
    version: 1,
    ownerEmail: args.email,
    orgId: args.orgId ?? null,
    deckId: args.deckId,
    assetId: args.assetId,
    provider: args.provider,
    providerObjectId: args.providerObjectId,
    url: args.url,
    createdAt: new Date().toISOString(),
  };

  let receiptRecorded = false;
  try {
    await runWithRequestContext(requestContext, () =>
      recordOrphanedFontAssetCleanup(cleanup),
    );
    receiptRecorded = true;
  } catch {
    try {
      receiptRecorded = await runWithRequestContext(requestContext, async () =>
        (await listAppState(ORPHAN_FONT_ASSET_PREFIX)).some(
          ({ key }) => key === `${ORPHAN_FONT_ASSET_PREFIX}${args.assetId}`,
        ),
      );
    } catch {
      receiptRecorded = false;
    }
  }

  if (receiptRecorded) {
    try {
      await reapOrphanedFontAssetObjects(args.email, orgId);
    } catch {
      console.warn("[slides-upload] orphaned font object cleanup deferred", {
        assetId: args.assetId,
      });
    }
    return;
  }

  let registered: boolean | undefined;
  try {
    registered = await runWithRequestContext(requestContext, () =>
      fontAssetExists(args.assetId, args.email, orgId, args.deckId),
    );
  } catch {
    // coercion-ok: Undefined preserves the uncertain lookup state and records cleanup instead of deleting bytes.
    registered = undefined;
  }
  if (registered === false) {
    try {
      const deletion = await runWithRequestContext(requestContext, () =>
        deleteUploadedAssetObject({
          identity: {
            url: args.url,
            provider: args.provider,
            providerObjectId: args.providerObjectId,
          },
          excludeAssetId: args.assetId,
          deleteObject: () =>
            deleteUploadedFile(args.provider, {
              id: args.providerObjectId ?? undefined,
              url: args.url,
            }),
        }),
      );
      if (deletion.status !== "failed") return;
    } catch (error) {
      console.warn(
        "[slides-upload] could not immediately delete unregistered font",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  } else if (registered) {
    return;
  }

  try {
    await runWithRequestContext(requestContext, () =>
      recordOrphanedFontAssetCleanup(cleanup),
    );
  } catch {
    let receiptRecorded = false;
    try {
      receiptRecorded = await runWithRequestContext(requestContext, async () =>
        (await listAppState(ORPHAN_FONT_ASSET_PREFIX)).some(
          ({ key }) => key === `${ORPHAN_FONT_ASSET_PREFIX}${args.assetId}`,
        ),
      );
    } catch {
      receiptRecorded = false;
    }
    if (!receiptRecorded) {
      console.error("[slides-upload] orphaned font object is untracked", {
        assetId: args.assetId,
      });
    }
  }
}

export async function importGoogleFontAsset(args: {
  email: string;
  orgId?: string | null;
  deckId: string;
  font: DownloadedGoogleFont;
}): Promise<RegisteredSlideFont & { filename: string; size: number }> {
  const { email, orgId, deckId, font } = args;
  if (
    !isSafeSlideFontFamily(font.family) ||
    !SLIDE_FONT_VARIANT_PATTERN.test(font.variant) ||
    font.data.byteLength === 0 ||
    font.data.byteLength > MAX_STORED_FONT_BYTES ||
    FONT_MIME_EXTENSIONS[font.mimeType] !== `.${font.extension}`
  ) {
    throw fontFailure(
      "The selected font file is not supported.",
      "google_font_file_invalid",
      422,
    );
  }

  try {
    await assertDeckAssetUploadScope({ deckId, email, orgId });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      typeof (error as { errorCode?: unknown }).errorCode === "string"
    ) {
      throw error;
    }
    throw fontFailure(
      "Could not verify deck access for the font import.",
      "slide_font_deck_scope_failed",
      500,
    );
  }

  await reapOrphanedFontAssetObjects(email, orgId ?? undefined);

  const db = getDb();
  const [existing] = await db
    .select({
      id: schema.uploadedAssets.id,
      filename: schema.uploadedAssets.filename,
      url: schema.uploadedAssets.url,
      type: schema.uploadedAssets.type,
      size: schema.uploadedAssets.size,
      fontFamily: schema.uploadedAssets.fontFamily,
      fontVariant: schema.uploadedAssets.fontVariant,
    })
    .from(schema.uploadedAssets)
    .where(
      and(
        eq(schema.uploadedAssets.ownerEmail, email),
        orgId
          ? eq(schema.uploadedAssets.orgId, orgId)
          : isNull(schema.uploadedAssets.orgId),
        eq(schema.uploadedAssets.deckId, deckId),
        eq(schema.uploadedAssets.fontFamily, font.family),
        eq(schema.uploadedAssets.fontVariant, font.variant),
        eq(schema.uploadedAssets.type, font.mimeType),
      ),
    )
    .limit(1);
  if (existing) {
    if (!isRegisteredFontRow(existing)) {
      throw fontFailure(
        "The previously imported font asset is invalid.",
        "slide_font_asset_invalid",
        500,
      );
    }
    return {
      assetId: existing.id,
      family: existing.fontFamily,
      variant: existing.fontVariant,
      mimeType: existing.type,
      url: assertFontUrl(existing.url),
      filename: existing.filename,
      size: existing.size,
    };
  }

  const filename = fontFilename(font);
  let uploaded: Awaited<ReturnType<typeof uploadFile>>;
  try {
    uploaded = await runWithRequestContext(
      { userEmail: email, ...(orgId ? { orgId } : {}) },
      () =>
        uploadFile({
          data: font.data,
          filename,
          mimeType: font.mimeType,
          ownerEmail: email,
        }),
    );
  } catch {
    throw fontFailure(
      "The font file could not be saved to file storage.",
      "google_font_storage_failed",
      503,
    );
  }
  if (!uploaded) {
    throw fontFailure(
      "Connect file storage before importing fonts.",
      "google_font_storage_unavailable",
      503,
    );
  }

  let url: string;
  try {
    url = assertFontUrl(uploaded.url);
  } catch (error) {
    try {
      await deleteUploadedAssetObject({
        identity: {
          url: uploaded.url,
          provider: uploaded.provider,
          providerObjectId: uploaded.id ?? null,
        },
        deleteObject: () =>
          deleteUploadedFile(uploaded.provider, {
            url: uploaded.url,
            id: uploaded.id,
          }),
      });
    } catch {
      // Preserve the typed URL error; the provider may retry its orphan cleanup.
    }
    throw error;
  }

  const id = nanoid();
  try {
    await registerDeckUploadedAsset({
      row: {
        id,
        filename,
        url,
        type: font.mimeType,
        size: font.data.byteLength,
        provider: uploaded.provider,
        providerObjectId: uploaded.id ?? null,
        fontFamily: font.family,
        fontVariant: font.variant,
        deckId,
        orgId: orgId ?? null,
        ownerEmail: email,
        createdAt: new Date().toISOString(),
      },
      deckId,
      email,
      orgId,
    });
  } catch (registrationError) {
    await recordAndReapFailedFontRegistration({
      email,
      orgId,
      deckId,
      assetId: id,
      provider: uploaded.provider,
      providerObjectId: uploaded.id ?? null,
      url,
    });
    const errorCode = (registrationError as { errorCode?: unknown })?.errorCode;
    if (
      errorCode === "asset_deck_scope_forbidden" ||
      errorCode === "deck_not_found"
    ) {
      throw registrationError;
    }
    throw fontFailure(
      "The uploaded font could not be registered.",
      "google_font_registration_failed",
      500,
    );
  }

  return {
    assetId: id,
    family: font.family,
    variant: font.variant,
    mimeType: font.mimeType,
    url,
    filename,
    size: font.data.byteLength,
  };
}

function isRegisteredFontRow(row: {
  id: string;
  filename: string;
  url: string;
  type: string;
  fontFamily: string | null;
  fontVariant: string | null;
}): row is typeof row & { fontFamily: string; fontVariant: string } {
  const extension = FONT_MIME_EXTENSIONS[row.type];
  return Boolean(
    row.fontFamily &&
    isSafeSlideFontFamily(row.fontFamily) &&
    row.fontVariant &&
    SLIDE_FONT_VARIANT_PATTERN.test(row.fontVariant) &&
    extension &&
    row.filename.toLowerCase().endsWith(extension),
  );
}

export async function resolveSlideDesignFontAssets(
  tokens: SlideDesignTokens,
  scope: { deckId: string; ownerEmail: string; orgId?: string | null },
): Promise<RegisteredSlideFont[]> {
  const selected = assertFontSelectionShape(tokens);
  const ids = [...selected.keys()];
  if (ids.length === 0) return [];

  let rows: Array<{
    id: string;
    deckId: string | null;
    filename: string;
    url: string;
    type: string;
    fontFamily: string | null;
    fontVariant: string | null;
  }>;
  try {
    rows = await getDb()
      .select({
        id: schema.uploadedAssets.id,
        deckId: schema.uploadedAssets.deckId,
        filename: schema.uploadedAssets.filename,
        url: schema.uploadedAssets.url,
        type: schema.uploadedAssets.type,
        fontFamily: schema.uploadedAssets.fontFamily,
        fontVariant: schema.uploadedAssets.fontVariant,
      })
      .from(schema.uploadedAssets)
      .where(
        and(
          inArray(schema.uploadedAssets.id, ids),
          eq(schema.uploadedAssets.deckId, scope.deckId),
          slideFontAssetScope(scope.ownerEmail, scope.orgId),
        ),
      );
  } catch {
    throw fontFailure(
      "Could not load the selected font assets.",
      "slide_font_asset_lookup_failed",
      500,
    );
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  const result: RegisteredSlideFont[] = [];
  for (const [assetId, family] of selected) {
    const row = byId.get(assetId);
    if (
      !row ||
      row.deckId !== scope.deckId ||
      !isRegisteredFontRow(row) ||
      row.fontFamily !== family
    ) {
      throw fontFailure(
        "The selected font asset is unavailable to this deck.",
        "slide_font_asset_unavailable",
        404,
      );
    }
    result.push({
      assetId: row.id,
      family: row.fontFamily,
      variant: row.fontVariant,
      mimeType: row.type,
      url: assertFontUrl(row.url),
    });
  }
  return result;
}
