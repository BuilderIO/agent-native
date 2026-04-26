/**
 * Add a custom dictionary term.
 *
 * Usage:
 *   pnpm action add-dictionary-term --term="Kubernetes" --correction="Kubernetes"
 *   pnpm action add-dictionary-term --term="k8s" --correction="Kubernetes"
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail, nanoid } from "../server/lib/helpers.js";

export default defineAction({
  description:
    "Add a term to the custom dictionary. Used to teach the transcription model specific words, names, or corrections.",
  schema: z.object({
    term: z.string().min(1).describe("The word or phrase to recognize"),
    correction: z
      .string()
      .nullish()
      .describe(
        "Optional correction (if null, the term is added as-is to the vocabulary)",
      ),
    source: z
      .enum(["auto", "manual"])
      .default("manual")
      .describe("Whether this was auto-learned or manually added"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const id = nanoid();
    const now = new Date().toISOString();

    await db.insert(schema.dictationDictionary).values({
      id,
      term: args.term.trim(),
      correction: args.correction ?? null,
      source: args.source,
      ownerEmail,
      createdAt: now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Added dictionary term "${args.term}"`);

    return { id, term: args.term, correction: args.correction ?? null };
  },
});
