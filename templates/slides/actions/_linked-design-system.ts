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
