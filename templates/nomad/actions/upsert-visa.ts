import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { visas } from "../server/db/schema.js";
import { requireOwner } from "../server/lib/owner.js";
import { isValidISODate } from "../shared/compliance.js";

export default defineAction({
  description:
    "Create or update a visa/permit/entry authorization with a hard validity window. Pass `id` to patch (only provided fields change); omit to create — label and expiresOn are then required. Scope with countryCode (one country) OR zone='schengen' (a Schengen visa grants the whole area). The compliance engine caps every matching 'must exit by' projection at the visa expiry and raises expiry alerts (warn ≤30 days, danger ≤14 days while inside).",
  schema: z.object({
    id: z.string().optional().describe("Existing visa id to update"),
    label: z
      .string()
      .optional()
      .describe("Display name, e.g. 'Schengen C visa (multi-entry)'"),
    countryCode: z
      .string()
      .length(2)
      .nullable()
      .optional()
      .describe("ISO country the visa applies to (null for zone visas)"),
    zone: z
      .enum(["schengen"])
      .nullable()
      .optional()
      .describe("Zone the visa grants access to; days valid in any member"),
    validFrom: z
      .string()
      .nullable()
      .optional()
      .describe(
        "First valid day (inclusive), YYYY-MM-DD; null = already valid",
      ),
    expiresOn: z
      .string()
      .optional()
      .describe("Last valid day (inclusive), YYYY-MM-DD"),
    notes: z.string().nullable().optional(),
  }),
  run: async (args) => {
    if (args.expiresOn && !isValidISODate(args.expiresOn)) {
      throw new Error("expiresOn must be a valid YYYY-MM-DD date");
    }
    if (args.validFrom && !isValidISODate(args.validFrom)) {
      throw new Error("validFrom must be a valid YYYY-MM-DD date");
    }
    const owner = requireOwner();
    const db = getDb();
    const now = new Date().toISOString();
    const owned = (id: string) =>
      and(eq(visas.id, id), eq(visas.ownerEmail, owner));

    if (args.id) {
      const existing = await db.select().from(visas).where(owned(args.id));
      if (existing.length === 0) {
        throw new Error(`No visa found with id ${args.id}`);
      }
      const merged = { ...existing[0], ...stripUndefined(args) };
      validateScope(merged.countryCode, merged.zone);
      await db
        .update(visas)
        .set({
          label: merged.label,
          countryCode: merged.countryCode?.toUpperCase() ?? null,
          zone: merged.zone,
          validFrom: merged.validFrom,
          expiresOn: merged.expiresOn,
          notes: merged.notes,
          updatedAt: now,
        })
        .where(owned(args.id));
      const [updated] = await db.select().from(visas).where(owned(args.id));
      return updated;
    }

    if (!args.label || !args.expiresOn) {
      throw new Error("label and expiresOn are required when creating a visa");
    }
    validateScope(args.countryCode ?? null, args.zone ?? null);
    const row = {
      id: nanoid(),
      ownerEmail: owner,
      label: args.label,
      countryCode: args.countryCode?.toUpperCase() ?? null,
      zone: args.zone ?? null,
      validFrom: args.validFrom ?? null,
      expiresOn: args.expiresOn,
      notes: args.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(visas).values(row);
    return row;
  },
});

function validateScope(countryCode: string | null, zone: string | null): void {
  if (!countryCode && !zone) {
    throw new Error("A visa needs a countryCode or a zone");
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
