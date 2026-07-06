import {
  AGENT_ACCESS_PARAM,
  verifyScopedAgentAccessToken,
} from "@agent-native/core/server";
import { toSharedDeckSlide } from "@shared/api";
import { eq } from "drizzle-orm";
import {
  defineEventHandler,
  getQuery,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { DECK_AGENT_RESOURCE_KIND } from "../../../shared/agent-readable.js";
import { getDb, schema } from "../../db/index.js";

function queryString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

function parseDeckData(value: string): Record<string, any> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");

  const query = getQuery(event);
  const id = queryString(query.id);
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Deck id is required" };
  }

  const token = queryString(query[AGENT_ACCESS_PARAM]);
  const db = getDb();
  // guard:allow-unscoped -- this endpoint returns a deck only when it is public or a deck-scoped agent_access token verifies for this id.
  const [deck] = await db
    .select({
      id: schema.decks.id,
      title: schema.decks.title,
      data: schema.decks.data,
      visibility: schema.decks.visibility,
      designSystemId: schema.decks.designSystemId,
      createdAt: schema.decks.createdAt,
      updatedAt: schema.decks.updatedAt,
    })
    .from(schema.decks)
    .where(eq(schema.decks.id, id))
    .limit(1);

  if (!deck) {
    setResponseStatus(event, 404);
    return { error: "Deck not found" };
  }

  const tokenAccess = token
    ? verifyScopedAgentAccessToken(token, {
        resourceKind: DECK_AGENT_RESOURCE_KIND,
        resourceId: id,
      }).ok
    : false;
  if (deck.visibility !== "public" && !tokenAccess) {
    setResponseStatus(event, 403);
    return { error: "Invalid or expired agent access token" };
  }

  const data = parseDeckData(deck.data);
  const slides = Array.isArray(data.slides)
    ? data.slides.map((slide: unknown, index: number) =>
        toSharedDeckSlide(slide, index),
      )
    : [];

  return {
    resourceType: "deck",
    id: deck.id,
    title: deck.title || data.title || "Untitled",
    visibility: deck.visibility,
    designSystemId: deck.designSystemId ?? null,
    slideCount: slides.length,
    aspectRatio: data.aspectRatio ?? null,
    slides,
    createdAt: deck.createdAt,
    updatedAt: deck.updatedAt,
    url: `/p/${deck.id}`,
  };
});
