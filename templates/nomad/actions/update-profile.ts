import { defineAction } from "@agent-native/core/action";
import { and, eq, isNotNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { rules } from "../server/db/schema.js";
import { requireOwner } from "../server/lib/owner.js";
import { saveProfile } from "../server/lib/profile.js";
import { presetsForCountry } from "../shared/countries.js";

export default defineAction({
  description:
    "Patch the nomad profile (fiscal home country, immigration status, goals, tracked countries, inbox-scan preference, onboarding completion). Only provided fields change. ANY ISO 3166-1 country is valid. When tracked countries or the fiscal home change, sensible default rules are seeded per country — curated presets (Schengen 90/180, DTV caps, PR minimums) where known, a generic 183-day tax counter otherwise — without duplicating existing rules.",
  schema: z.object({
    fiscalHomeCountry: z
      .string()
      .length(2)
      .nullable()
      .optional()
      .describe("ISO country code of fiscal residency, e.g. CA"),
    citizenshipCountry: z
      .string()
      .length(2)
      .nullable()
      .optional()
      .describe("ISO country code of the user's passport, e.g. TN"),
    immigrationStatus: z.enum(["pr", "citizen", "visa"]).nullable().optional(),
    goals: z
      .array(z.string())
      .optional()
      .describe(
        "Why the user is here (schengen, tax, pr, log) — personalizes guidance",
      ),
    trackedCountries: z
      .array(z.string().length(2))
      .optional()
      .describe("ISO country codes to track on the map"),
    mailScanEnabled: z.coerce.boolean().optional(),
    onboardingCompleted: z.coerce.boolean().optional(),
  }),
  run: async (args) => {
    const patch = Object.fromEntries(
      Object.entries(args).filter(([, v]) => v !== undefined),
    );
    if (Array.isArray(patch.trackedCountries)) {
      patch.trackedCountries = (patch.trackedCountries as string[]).map((c) =>
        c.toUpperCase(),
      );
    }
    if (typeof patch.fiscalHomeCountry === "string") {
      patch.fiscalHomeCountry = patch.fiscalHomeCountry.toUpperCase();
    }
    if (typeof patch.citizenshipCountry === "string") {
      patch.citizenshipCountry = patch.citizenshipCountry.toUpperCase();
    }
    const profile = await saveProfile(patch);

    const seeded =
      args.trackedCountries !== undefined ||
      args.fiscalHomeCountry !== undefined ||
      args.onboardingCompleted === true
        ? await ensurePresetRules(
            profile.trackedCountries,
            profile.fiscalHomeCountry,
            profile.immigrationStatus,
          )
        : [];

    return { profile, seededRules: seeded };
  },
});

/**
 * Seed default rules for the given countries, skipping any preset whose
 * stable slug already exists (idempotent across re-runs). Works for every
 * ISO country via presetsForCountry's generic fallback.
 */
async function ensurePresetRules(
  trackedCountries: string[],
  fiscalHomeCountry: string | null,
  immigrationStatus: string | null,
): Promise<Array<{ id: string; name: string }>> {
  const owner = requireOwner();
  const db = getDb();
  const existing = await db
    .select({ presetSlug: rules.presetSlug })
    .from(rules)
    .where(and(eq(rules.ownerEmail, owner), isNotNull(rules.presetSlug)));
  const existingSlugs = new Set(existing.map((r) => r.presetSlug));
  const now = new Date().toISOString();
  const seeded: Array<{ id: string; name: string }> = [];

  const codes = new Set(
    [
      ...trackedCountries,
      ...(fiscalHomeCountry ? [fiscalHomeCountry] : []),
    ].map((c) => c.toUpperCase()),
  );
  for (const code of codes) {
    for (const preset of presetsForCountry(code)) {
      if (preset.fiscalHomeOnly && fiscalHomeCountry !== code) continue;
      if (
        preset.prOnly &&
        (fiscalHomeCountry !== code || immigrationStatus !== "pr")
      ) {
        continue;
      }
      // Never arm a stay-under-183 cap on the user's own fiscal home — they
      // are already tax resident there. That counter only matters after they
      // cease residency (add it manually for the departure year).
      if (code === fiscalHomeCountry && preset.kind === "calendar-year") {
        continue;
      }
      if (existingSlugs.has(preset.slug)) continue;
      existingSlugs.add(preset.slug);
      const row = {
        id: nanoid(),
        ownerEmail: owner,
        name: preset.name,
        kind: preset.kind,
        countryCode: preset.zone ? null : code,
        zone: preset.zone ?? null,
        limitDays: preset.limitDays,
        windowDays: preset.windowDays ?? null,
        description: preset.description,
        presetSlug: preset.slug,
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(rules).values(row);
      seeded.push({ id: row.id, name: row.name });
    }
  }
  return seeded;
}
