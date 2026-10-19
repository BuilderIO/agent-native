import type { DesignSystemData, SharedDeckResponse } from "@shared/api";
import { eq } from "drizzle-orm";
import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";

import { getDb, schema } from "../db";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

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
      const parsed = JSON.parse(shared.designSystemData);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        response.designSystem = parsed as DesignSystemData;
      }
      // coercion-ok: malformed optional snapshots remain viewable with default tokens.
    } catch {
      // Keep legacy or malformed snapshots viewable with default tokens.
    }
  }
  return response;
});
