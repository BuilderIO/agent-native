/**
 * Persist agent-proposed snippet suggestions for a call.
 *
 * These are "proposed" snippets — not yet saved to the `snippets` table. They
 * live in app-state so the UI can render a "Suggested" row the user can
 * accept/dismiss.
 *
 * Usage (agent-only):
 *   pnpm action write-suggested-snippets --callId=<id> --snippets='[{"title":"...","startMs":<n>,"endMs":<n>,"reason":"..."}]'
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";

const SuggestionSchema = z
  .object({
    title: z.string().min(1),
    startMs: z.coerce.number().int().min(0),
    endMs: z.coerce.number().int().min(0),
    reason: z.string().default(""),
  })
  .refine((s) => s.endMs > s.startMs, {
    message: "endMs must be greater than startMs",
  });

export default defineAction({
  description:
    "Persist agent-proposed snippet suggestions under call-suggested-snippets-<callId> in application_state. Called by the agent after suggest-snippets.",
  schema: z.object({
    callId: z.string().describe("Call ID"),
    snippets: z
      .union([z.string(), z.array(SuggestionSchema)])
      .describe(
        "Array of {title,startMs,endMs,reason} — JSON-encoded string (CLI) or array (agent).",
      ),
  }),
  run: async (args) => {
    await assertAccess("call", args.callId, "editor");

    let snippets: Array<z.infer<typeof SuggestionSchema>>;
    if (typeof args.snippets === "string") {
      let raw: unknown;
      try {
        raw = JSON.parse(args.snippets);
      } catch (e) {
        throw new Error(`Invalid --snippets JSON: ${(e as Error).message}`);
      }
      snippets = z.array(SuggestionSchema).parse(raw);
    } else {
      snippets = z.array(SuggestionSchema).parse(args.snippets);
    }

    snippets = snippets
      .map((s) => ({
        title: s.title.trim(),
        startMs: Math.max(0, s.startMs),
        endMs: Math.max(0, s.endMs),
        reason: s.reason.trim(),
      }))
      .filter((s) => s.endMs > s.startMs && s.title.length > 0)
      .sort((a, b) => a.startMs - b.startMs);

    await writeAppState(`call-suggested-snippets-${args.callId}`, {
      callId: args.callId,
      snippets,
      generatedAt: new Date().toISOString(),
    });
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Wrote ${snippets.length} suggested snippet(s) for ${args.callId}`,
    );
    return { callId: args.callId, snippets };
  },
});
