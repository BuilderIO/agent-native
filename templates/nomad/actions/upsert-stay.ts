import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { stays } from "../server/db/schema.js";
import { requireOwner } from "../server/lib/owner.js";
import { dayNumber, isValidISODate } from "../shared/compliance.js";

const isoDate = z
  .string()
  .refine(isValidISODate, "Expected a valid YYYY-MM-DD calendar date");

export default defineAction({
  description:
    "Create or update a stay in the presence ledger. Pass `id` to patch an existing stay (only provided fields change — e.g. set status='confirmed' to confirm a pending inbox-detected trip, or set exitDate to close an open stay). Omit `id` to log a new stay; countryCode and entryDate are then required. Dates are inclusive YYYY-MM-DD; use exitDate=null (or omit) for an ongoing stay.",
  schema: z.object({
    id: z.string().optional().describe("Existing stay id to update"),
    countryCode: z
      .string()
      .length(2)
      .optional()
      .describe("ISO 3166-1 alpha-2 country code, e.g. PT"),
    city: z.string().nullable().optional().describe("City name (optional)"),
    entryDate: isoDate
      .optional()
      .describe("First day on the ground, YYYY-MM-DD"),
    exitDate: isoDate
      .nullable()
      .optional()
      .describe("Last day on the ground, YYYY-MM-DD; null = still there"),
    source: z.enum(["manual", "inbox", "import"]).optional(),
    status: z
      .enum(["confirmed", "pending"])
      .optional()
      .describe(
        "`pending` stays are excluded from compliance math until confirmed",
      ),
    notes: z.string().nullable().optional(),
  }),
  run: async (args) => {
    const owner = requireOwner();
    const db = getDb();
    const now = new Date().toISOString();
    const owned = (id: string) =>
      and(eq(stays.id, id), eq(stays.ownerEmail, owner));

    if (args.id) {
      const existing = await db.select().from(stays).where(owned(args.id));
      if (existing.length === 0) {
        throw new Error(`No stay found with id ${args.id}`);
      }
      const merged = { ...existing[0], ...stripUndefined(args) };
      validateDates(merged.entryDate, merged.exitDate);
      await db
        .update(stays)
        .set({
          countryCode: merged.countryCode.toUpperCase(),
          city: merged.city,
          entryDate: merged.entryDate,
          exitDate: merged.exitDate,
          source: merged.source,
          status: merged.status,
          notes: merged.notes,
          updatedAt: now,
        })
        .where(owned(args.id));
      const [updated] = await db.select().from(stays).where(owned(args.id));
      return updated;
    }

    if (!args.countryCode || !args.entryDate) {
      throw new Error(
        "countryCode and entryDate are required when creating a stay",
      );
    }
    validateDates(args.entryDate, args.exitDate ?? null);
    const row = {
      id: nanoid(),
      ownerEmail: owner,
      countryCode: args.countryCode.toUpperCase(),
      city: args.city ?? null,
      entryDate: args.entryDate,
      exitDate: args.exitDate ?? null,
      source: args.source ?? "manual",
      status: args.status ?? "confirmed",
      notes: args.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(stays).values(row);
    return row;
  },
});

function validateDates(entryDate: string, exitDate: string | null): void {
  if (exitDate && dayNumber(exitDate) < dayNumber(entryDate)) {
    throw new Error("exitDate must be on or after entryDate");
  }
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
