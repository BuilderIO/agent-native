import crypto from "crypto";

import { readBody } from "@agent-native/core/server";
import {
  assertAccess,
  ForbiddenError,
  resolveAccess,
} from "@agent-native/core/sharing";
import { toSharedDeckSlide } from "@shared/api";
import type {
  DesignSystemData,
  ShareDeckRequest,
  ShareDeckResponse,
  SharedDeckResponse,
} from "@shared/api";
import { eq, lt } from "drizzle-orm";
import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";

import { getDb, schema } from "../db";
import {
  resolveSlidesRequestAuth,
  withSlidesRequestContext,
} from "./request-auth-context.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

interface DeckShareResource {
  title?: string | null;
  data: string;
  designSystemId?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pickStyleStrings(value: unknown, keys: readonly string[]) {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    keys
      .filter((key) => typeof value[key] === "string")
      .map((key) => [key, value[key]]),
  );
}

// Snapshot only presentation tokens, never authoring context or provider data.
// Apply this on reads too: older share links stored the entire system record.
function toSharedDesignSystem(value: unknown): DesignSystemData | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, unknown> = {};
  const groups = {
    colors: [
      "primary",
      "secondary",
      "accent",
      "background",
      "surface",
      "text",
      "textMuted",
    ],
    typography: ["headingFont", "bodyFont", "headingWeight", "bodyWeight"],
    spacing: ["slidePadding", "elementGap"],
    borders: ["radius", "accentWidth"],
    slideDefaults: ["background", "labelStyle"],
  };
  for (const [group, keys] of Object.entries(groups)) {
    const fields = pickStyleStrings(value[group], keys);
    if (fields) result[group] = fields;
  }
  if (isRecord(value.typography)) {
    const headingSizes = pickStyleStrings(value.typography.headingSizes, [
      "h1",
      "h2",
      "h3",
    ]);
    if (headingSizes) {
      (result.typography as Record<string, unknown>).headingSizes =
        headingSizes;
    }
  }
  if (Array.isArray(value.logos)) {
    result.logos = value.logos
      .filter(
        (logo) =>
          isRecord(logo) &&
          typeof logo.url === "string" &&
          typeof logo.name === "string" &&
          ["light", "dark", "auto"].includes(logo.variant as string),
      )
      .map((logo) => pickStyleStrings(logo, ["url", "name", "variant"]));
  }
  if (typeof value.customCSS === "string") result.customCSS = value.customCSS;
  // The presentation merges partial legacy token sets with its defaults.
  return result as unknown as DesignSystemData;
}

/**
 * POST /api/share
 * Persist a deck snapshot with a random token.
 */
export const shareDeck = defineEventHandler(async (event) => {
  const body = await readBody<ShareDeckRequest>(event);
  const { deck } = body;

  if (!deck?.id) {
    setResponseStatus(event, 400);
    return { error: "Deck id is required" };
  }

  // Pre-resolve so we can 401 before opening the request-context scope,
  // and pass the resolved context into `withSlidesRequestContext` so it
  // doesn't re-resolve session + org on the same request (which would
  // double the session/getOrgContext I/O per share).
  const auth = await resolveSlidesRequestAuth(event);
  if (!auth.ok) {
    setResponseStatus(event, auth.statusCode);
    return { error: auth.error };
  }
  const session = auth.context;
  if (!session.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  return withSlidesRequestContext(
    event,
    async () => createShareLink(event, deck.id),
    session,
  );
});

async function createShareLink(event: any, deckId: string) {
  const db = getDb();
  let storedDeck: any;
  let title = "Untitled";
  let deckResource: DeckShareResource;

  try {
    const access = await assertAccess("deck", deckId, "admin");
    deckResource = access.resource as DeckShareResource;
    title = deckResource.title ?? "Untitled";
    storedDeck = JSON.parse(deckResource.data);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      setResponseStatus(event, err.statusCode);
      return { error: err.message };
    }
    throw err;
  }

  if (!Array.isArray(storedDeck?.slides) || storedDeck.slides.length === 0) {
    setResponseStatus(event, 400);
    return { error: "Deck with slides is required" };
  }

  const token = crypto.randomBytes(12).toString("base64url");
  const now = new Date().toISOString();
  const designSystemId =
    deckResource.designSystemId ?? storedDeck.designSystemId;
  let designSystemData: string | null = null;

  if (typeof designSystemId === "string" && designSystemId.trim()) {
    // Publishing an existing deck is not a DSI operation. Resource access still
    // applies; only the rendering projection below may leave this boundary.
    const designSystemAccess = await resolveAccess(
      "design-system",
      designSystemId,
    );
    const rawData = designSystemAccess?.resource?.data;
    if (typeof rawData === "string") {
      try {
        const presentation = toSharedDesignSystem(JSON.parse(rawData));
        if (presentation) designSystemData = JSON.stringify(presentation);
        // coercion-ok: malformed optional style data keeps a valid deck shareable.
      } catch {
        // A malformed style record should not make an otherwise valid deck
        // impossible to share; the presentation will use its default tokens.
      }
    }
  }

  const slides = storedDeck.slides.map((slide: unknown, index: number) =>
    toSharedDeckSlide(slide, index, { includeNotes: false }),
  );

  await db.insert(schema.deckShareLinks).values({
    token,
    title: title || storedDeck.title || "Untitled",
    slides: JSON.stringify(slides),
    aspectRatio: storedDeck.aspectRatio ?? null,
    designSystemData,
    createdAt: now,
  });

  // Prune expired rows opportunistically (no await — background)
  db.delete(schema.deckShareLinks)
    .where(
      lt(
        schema.deckShareLinks.createdAt,
        new Date(Date.now() - THIRTY_DAYS_MS).toISOString(),
      ),
    )
    .catch(() => {});

  const response: ShareDeckResponse = { shareToken: token };
  return response;
}

/**
 * GET /api/share/:token
 * Retrieve a shared deck by token.
 */
export const getSharedDeck = defineEventHandler(async (event) => {
  const token = getRouterParam(event, "token");
  if (!token) {
    setResponseStatus(event, 400);
    return { error: "Token is required" };
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.deckShareLinks)
    .where(eq(schema.deckShareLinks.token, token))
    .limit(1);

  const shared = rows[0];
  if (!shared) {
    setResponseStatus(event, 404);
    return { error: "Shared presentation not found or has expired" };
  }

  // Check expiry
  const age = Date.now() - new Date(shared.createdAt).getTime();
  if (age > THIRTY_DAYS_MS) {
    setResponseStatus(event, 404);
    return { error: "Shared presentation not found or has expired" };
  }

  const response: SharedDeckResponse = {
    title: shared.title,
    slides: JSON.parse(shared.slides),
    aspectRatio: shared.aspectRatio as SharedDeckResponse["aspectRatio"],
  };
  if (shared.designSystemData) {
    try {
      const presentation = toSharedDesignSystem(
        JSON.parse(shared.designSystemData),
      );
      if (presentation) response.designSystem = presentation;
      // coercion-ok: malformed optional snapshots remain viewable with default tokens.
    } catch {
      // Keep legacy or malformed snapshots viewable with default tokens.
    }
  }
  return response;
});
