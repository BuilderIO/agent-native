import { getDbExec } from "@agent-native/core/db";
import {
  getRequestOrgId,
  runWithRequestContext,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";

import { isSlides2DeckData } from "../../shared/deck-app-scope.js";
import { getDb, schema } from "../db/index.js";
import { registerUploadedAssetObjectIdentities } from "./uploaded-asset-object-lifecycle.js";

type SlidesTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

function assetScopeError(
  message: string,
  statusCode: number,
  errorCode: string,
): Error & { statusCode: number; errorCode: string } {
  return Object.assign(new Error(message), { statusCode, errorCode });
}

export function parseOptionalDeckId(
  parts: readonly { name?: string; data?: Uint8Array }[],
): string | undefined {
  const fields = parts.filter((part) => part.name === "deckId");
  if (fields.length === 0) return undefined;
  if (fields.length !== 1 || !fields[0]?.data || fields[0].data.length > 200) {
    throw assetScopeError("Invalid deckId field.", 400, "invalid_deck_id");
  }

  let deckId: string;
  try {
    deckId = new TextDecoder("utf-8", { fatal: true })
      .decode(fields[0].data)
      .trim();
  } catch {
    throw assetScopeError("Invalid deckId field.", 400, "invalid_deck_id");
  }
  if (!deckId || deckId.length > 200) {
    throw assetScopeError("Invalid deckId field.", 400, "invalid_deck_id");
  }
  return deckId;
}

export async function assertDeckAssetUploadScope(args: {
  deckId?: string;
  email: string;
  orgId?: string | null;
}): Promise<void> {
  const deckId = args.deckId;
  if (!deckId) return;
  const orgId =
    args.orgId === undefined ? getRequestOrgId() : (args.orgId ?? null);
  const normalizedOrgId = orgId ?? null;
  await runWithRequestContext(
    { userEmail: args.email, orgId: normalizedOrgId ?? undefined },
    () => assertAccess("deck", deckId, "editor"),
  );

  const [deck] = await getDb()
    .select({
      data: schema.decks.data,
      ownerEmail: schema.decks.ownerEmail,
      orgId: schema.decks.orgId,
    })
    .from(schema.decks)
    .where(eq(schema.decks.id, deckId))
    .limit(1);
  if (!deck) {
    throw assetScopeError("Deck not found.", 404, "deck_not_found");
  }

  let data: unknown;
  try {
    data = JSON.parse(deck.data);
  } catch {
    throw assetScopeError("Deck data is invalid.", 500, "invalid_deck_data");
  }
  if (!isSlides2DeckData(data)) {
    throw assetScopeError("Deck not found.", 404, "deck_not_found");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw assetScopeError("Deck data is invalid.", 500, "invalid_deck_data");
  }

  if (
    (deck.orgId ?? null) !== normalizedOrgId ||
    (!deck.orgId && deck.ownerEmail !== args.email)
  ) {
    throw assetScopeError(
      "This upload cannot be added to the deck asset collection.",
      403,
      "asset_deck_scope_forbidden",
    );
  }
}

export async function registerDeckUploadedAsset(args: {
  deckId: string;
  email: string;
  orgId?: string | null;
  row: typeof schema.uploadedAssets.$inferInsert;
  onRegistered?: (transaction: SlidesTransaction) => Promise<void>;
}): Promise<void> {
  const normalizedOrgId =
    args.orgId === undefined ? getRequestOrgId() : (args.orgId ?? null);
  await getDb().transaction(async (tx) => {
    const [deck] = await tx
      .select({
        data: schema.decks.data,
        ownerEmail: schema.decks.ownerEmail,
        orgId: schema.decks.orgId,
      })
      .from(schema.decks)
      .where(eq(schema.decks.id, args.deckId))
      .for("update");
    if (!deck || !isSlides2DeckData(deck.data)) {
      throw assetScopeError("Deck not found.", 404, "deck_not_found");
    }
    if (
      (deck.orgId ?? null) !== normalizedOrgId ||
      (!deck.orgId && deck.ownerEmail !== args.email)
    ) {
      throw assetScopeError(
        "This upload cannot be added to the deck asset collection.",
        403,
        "asset_deck_scope_forbidden",
      );
    }

    await assertAccess("deck", args.deckId, "editor", {
      userEmail: args.email,
      ...(normalizedOrgId ? { orgId: normalizedOrgId } : {}),
      transaction: getDbExec(),
    });

    await registerUploadedAssetObjectIdentities(tx, [
      {
        url: args.row.url,
        provider: args.row.provider ?? null,
        providerObjectId: args.row.providerObjectId ?? null,
      },
    ]);
    await tx.insert(schema.uploadedAssets).values(args.row);
    await args.onRegistered?.(tx);
  });
}
