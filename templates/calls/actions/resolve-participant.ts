/**
 * Resolve a participant's identity — attach an email, display name, and
 * (optionally) mark them internal. Back-fills avatarUrl via Gravatar.
 *
 * Usage:
 *   pnpm action resolve-participant --callId=<id> --speakerLabel="Speaker 1" \
 *     --email="alice@customer.com" --displayName="Alice" --isInternal=false
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";

function gravatarUrl(email: string): string {
  const normalized = email.trim().toLowerCase();
  const hash = createHash("md5").update(normalized).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?d=identicon`;
}

const cliBoolean = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

export default defineAction({
  description:
    "Resolve a diarized participant's identity (email, displayName, isInternal). Back-fills avatarUrl from Gravatar.",
  schema: z.object({
    callId: z.string().describe("Call ID"),
    speakerLabel: z.string().describe("Diarized label, e.g. 'Speaker 0'"),
    email: z.string().email().describe("Email of the real person"),
    displayName: z.string().optional().describe("Full name"),
    isInternal: z
      .union([z.boolean(), cliBoolean])
      .optional()
      .describe("Mark as a teammate vs. external"),
  }),
  run: async (args) => {
    await assertAccess("call", args.callId, "editor");

    const db = getDb();

    const [existing] = await db
      .select()
      .from(schema.callParticipants)
      .where(
        and(
          eq(schema.callParticipants.callId, args.callId),
          eq(schema.callParticipants.speakerLabel, args.speakerLabel),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new Error(
        `Participant not found: callId=${args.callId} speakerLabel=${args.speakerLabel}`,
      );
    }

    const patch: Record<string, unknown> = {
      email: args.email.trim().toLowerCase(),
      avatarUrl: gravatarUrl(args.email),
    };
    if (args.displayName !== undefined)
      patch.displayName = args.displayName.trim();
    if (args.isInternal !== undefined) patch.isInternal = args.isInternal;

    await db
      .update(schema.callParticipants)
      .set(patch)
      .where(eq(schema.callParticipants.id, existing.id));

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      id: existing.id,
      callId: args.callId,
      speakerLabel: args.speakerLabel,
      email: patch.email as string,
      displayName: (patch.displayName ?? existing.displayName) as string | null,
      isInternal:
        (patch.isInternal as boolean | undefined) ??
        Boolean(existing.isInternal),
      avatarUrl: patch.avatarUrl as string,
    };
  },
});
