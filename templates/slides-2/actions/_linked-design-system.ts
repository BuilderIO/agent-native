import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { resolveDeckDesignSystemId } from "../shared/deck-content.js";

export type DesignSystemRow = typeof schema.designSystems.$inferSelect;

function deckDesignSystemId(deck: {
  designSystemId?: string | null;
  data?: string | null;
}): string | null {
  if (deck.designSystemId) return deck.designSystemId;
  try {
    return resolveDeckDesignSystemId(deck, JSON.parse(deck.data ?? "null"));
  } catch {
    // coercion-ok: an unparseable deck links no design system, so access stays denied.
    return null;
  }
}

/**
 * A deck's linked design system, readable by anyone who can read the deck.
 * Its colors and fonts reach every deck viewer anyway — share links snapshot
 * them and slide HTML bakes them in — so withholding the row only renders the
 * deck wrong. This grants rendering reads, never edit or reuse.
 */
export async function readDeckLinkedDesignSystem(
  deck: { designSystemId?: string | null; data?: string | null },
  designSystemId: string,
): Promise<{ resource: DesignSystemRow; viaDeck: boolean } | null> {
  const direct = await resolveAccess("design-system", designSystemId);
  if (direct) {
    return { resource: direct.resource as DesignSystemRow, viaDeck: false };
  }
  if (deckDesignSystemId(deck) !== designSystemId) return null;
  // Callers resolved access to `deck`; the design system is reached only
  // through that deck's own link.
  const [row] = await getDb()
    .select()
    .from(schema.designSystems)
    .where(eq(schema.designSystems.id, designSystemId))
    .limit(1);
  return row ? { resource: row, viaDeck: true } : null;
}

const RENDERING_KEYS = [
  "colors",
  "typography",
  "spacing",
  "borders",
  "slideDefaults",
  "logos",
  "customCSS",
] as const;

/**
 * Allowlists the design-system fields that affect how a deck renders, so
 * notes, image-style guidance, and Builder proxy references never leave
 * through deck-inherited access or public share snapshots. Returns null when
 * the stored data is absent or not a JSON object.
 */
export function projectRenderingDesignSystemData(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // coercion-ok: unreadable style data renders as the default tokens.
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const source = parsed as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  for (const key of RENDERING_KEYS) {
    if (source[key] !== undefined) projected[key] = source[key];
  }
  return JSON.stringify(projected);
}
