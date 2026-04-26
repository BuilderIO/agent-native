/**
 * Get style presets for all categories.
 *
 * Usage:
 *   pnpm action get-style-settings
 */

import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/helpers.js";

const DEFAULT_STYLES = [
  { category: "personal_messages" as const, preset: "casual" as const },
  { category: "work_messages" as const, preset: "casual" as const },
  { category: "email" as const, preset: "formal" as const },
  { category: "other" as const, preset: "casual" as const },
];

export default defineAction({
  description:
    "Get the user's style presets for all dictation categories. Returns defaults for categories that have not been customized.",
  http: { method: "GET" },
  run: async () => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    const rows = await db
      .select()
      .from(schema.dictationStyles)
      .where(eq(schema.dictationStyles.ownerEmail, ownerEmail));

    // Merge with defaults — user rows override
    const byCategory = new Map(rows.map((r) => [r.category, r]));
    const styles = DEFAULT_STYLES.map((d) => {
      const existing = byCategory.get(d.category);
      if (existing) {
        return {
          id: existing.id,
          category: existing.category,
          preset: existing.preset,
          customPrompt: existing.customPrompt,
          updatedAt: existing.updatedAt,
        };
      }
      return {
        id: null,
        category: d.category,
        preset: d.preset,
        customPrompt: null,
        updatedAt: null,
      };
    });

    return { styles };
  },
});
