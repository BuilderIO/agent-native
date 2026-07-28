import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { rules } from "../server/db/schema.js";
import { requireOwner } from "../server/lib/owner.js";

export default defineAction({
  description:
    "Create or update a compliance rule. Pass `id` to patch an existing rule (only provided fields change). Omit `id` to create; name, kind and limitDays are then required. Kinds: `rolling-window` (limit within a trailing windowDays, e.g. Schengen 90/180), `calendar-year` (limit per calendar year, e.g. 183-day tax residency), `presence-minimum` (must accumulate limitDays within windowDays, e.g. Canadian PR 730/1825; windowDays null = per calendar year, e.g. ≥183 home days/yr as a fiscal-residency heuristic). Scope with countryCode (one country) OR zone='schengen' (all Schengen states).",
  schema: z.object({
    id: z.string().optional().describe("Existing rule id to update"),
    name: z
      .string()
      .optional()
      .describe("Display name, e.g. 'Schengen 90/180'"),
    kind: z
      .enum(["rolling-window", "calendar-year", "presence-minimum"])
      .optional(),
    countryCode: z
      .string()
      .length(2)
      .nullable()
      .optional()
      .describe("ISO country code the rule applies to (null for zone rules)"),
    zone: z
      .enum(["schengen"])
      .nullable()
      .optional()
      .describe("Multi-country zone; days in any member state count together"),
    limitDays: z.coerce.number().int().positive().optional(),
    windowDays: z.coerce
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .describe(
        "Trailing window length in days (rolling rules); null for calendar-year",
      ),
    description: z.string().nullable().optional(),
  }),
  run: async (args) => {
    const owner = requireOwner();
    const db = getDb();
    const now = new Date().toISOString();
    const owned = (id: string) =>
      and(eq(rules.id, id), eq(rules.ownerEmail, owner));

    if (args.id) {
      const existing = await db.select().from(rules).where(owned(args.id));
      if (existing.length === 0) {
        throw new Error(`No rule found with id ${args.id}`);
      }
      const merged = { ...existing[0], ...stripUndefined(args) };
      validateScope(merged.countryCode, merged.zone);
      await db
        .update(rules)
        .set({
          name: merged.name,
          kind: merged.kind,
          countryCode: merged.countryCode?.toUpperCase() ?? null,
          zone: merged.zone,
          limitDays: merged.limitDays,
          windowDays: merged.windowDays,
          description: merged.description,
          updatedAt: now,
        })
        .where(owned(args.id));
      const [updated] = await db.select().from(rules).where(owned(args.id));
      return updated;
    }

    if (!args.name || !args.kind || !args.limitDays) {
      throw new Error(
        "name, kind and limitDays are required when creating a rule",
      );
    }
    validateScope(args.countryCode ?? null, args.zone ?? null);
    const row = {
      id: nanoid(),
      ownerEmail: owner,
      name: args.name,
      kind: args.kind,
      countryCode: args.countryCode?.toUpperCase() ?? null,
      zone: args.zone ?? null,
      limitDays: args.limitDays,
      windowDays: args.windowDays ?? null,
      description: args.description ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(rules).values(row);
    return row;
  },
});

function validateScope(countryCode: string | null, zone: string | null): void {
  if (!countryCode && !zone) {
    throw new Error("A rule needs a countryCode or a zone");
  }
  if (countryCode && zone) {
    throw new Error("Use either countryCode or zone, not both");
  }
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
