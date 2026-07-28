import {
  ensureAdditiveColumns,
  getDbExec,
  runMigrations,
} from "@agent-native/core/db";
import { nanoid } from "nanoid";

import { addDays, todayISO } from "../../shared/compliance.js";
import type { Rule, Stay } from "../../shared/types.js";
import { getDb } from "../db/index.js";
import * as schema from "../db/schema.js";

function isDrizzleTable(value: unknown): value is object {
  return (
    !!value &&
    typeof value === "object" &&
    Object.getOwnPropertySymbols(value).some((s) =>
      s.toString().includes("drizzle"),
    )
  );
}

const schemaTables = Object.values(schema).filter(isDrizzleTable);

// Convention: every migration entry carries a unique `name:` slug so parallel
// branches can never claim each other's version numbers (see the storing-data
// skill for the full rationale).
const runNomadMigrations = runMigrations(
  [
    {
      version: 1,
      name: "nomad-stays-table",
      sql: `CREATE TABLE IF NOT EXISTS stays (
    id TEXT PRIMARY KEY,
    country_code TEXT NOT NULL,
    city TEXT,
    entry_date TEXT NOT NULL,
    exit_date TEXT,
    source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'inbox', 'import')),
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'pending')),
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
    },
    {
      version: 2,
      name: "nomad-rules-table",
      sql: `CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('rolling-window', 'calendar-year', 'presence-minimum')),
    country_code TEXT,
    zone TEXT,
    limit_days INTEGER NOT NULL,
    window_days INTEGER,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
    },
    {
      version: 3,
      name: "nomad-stays-entry-date-idx",
      sql: `CREATE INDEX IF NOT EXISTS stays_entry_date_idx ON stays (entry_date)`,
    },
    {
      version: 4,
      name: "nomad-stays-country-idx",
      sql: `CREATE INDEX IF NOT EXISTS stays_country_code_idx ON stays (country_code)`,
    },
    {
      version: 5,
      name: "nomad-visas-table",
      sql: `CREATE TABLE IF NOT EXISTS visas (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    country_code TEXT,
    zone TEXT,
    expires_on TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
    },
    {
      version: 6,
      name: "nomad-visas-valid-from",
      sql: `ALTER TABLE visas ADD COLUMN IF NOT EXISTS valid_from TEXT`,
    },
    {
      version: 7,
      name: "nomad-per-user-owner-email",
      sql: `ALTER TABLE stays ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT 'local@localhost';
ALTER TABLE rules ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT 'local@localhost';
ALTER TABLE visas ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT 'local@localhost'`,
    },
    {
      version: 8,
      name: "nomad-stays-owner-idx",
      sql: `CREATE INDEX IF NOT EXISTS stays_owner_email_idx ON stays (owner_email)`,
    },
  ],
  { table: "nomad_migrations" },
);

/**
 * Demo seed: a coherent travel year that exercises every rule kind — an amber
 * Schengen window (the cockpit countdown), a watched Thai DTV cap, safe tax
 * counters, a PR presence minimum, and one pending inbox-detected booking.
 * Only runs on a completely empty database.
 */
async function seedDemoData(): Promise<void> {
  const db = getDb();
  const existing = await db
    .select({ id: schema.stays.id })
    .from(schema.stays)
    .limit(1);
  if (existing.length > 0) return;
  const existingRules = await db
    .select({ id: schema.rules.id })
    .from(schema.rules)
    .limit(1);
  if (existingRules.length > 0) return;

  const today = todayISO();
  const ts = new Date().toISOString();
  const d = (offset: number) => addDays(today, offset);

  const stayRows: Array<
    Pick<Stay, "countryCode" | "city" | "entryDate"> & Partial<Stay>
  > = [
    // Older history that feeds the Canadian PR minimum and Thai DTV window.
    {
      countryCode: "CA",
      city: "Toronto",
      entryDate: d(-560),
      exitDate: d(-500),
    },
    {
      countryCode: "CA",
      city: "Montréal",
      entryDate: d(-420),
      exitDate: d(-330),
    },
    {
      countryCode: "TH",
      city: "Chiang Mai",
      entryDate: d(-320),
      exitDate: d(-270),
    },
    // The current travel year: Bangkok → Berlin → Dubai → London → Toronto → Lisbon.
    {
      countryCode: "TH",
      city: "Bangkok",
      entryDate: d(-190),
      exitDate: d(-110),
    },
    { countryCode: "DE", city: "Berlin", entryDate: d(-109), exitDate: d(-81) },
    { countryCode: "AE", city: "Dubai", entryDate: d(-80), exitDate: d(-62) },
    { countryCode: "GB", city: "London", entryDate: d(-61), exitDate: d(-47) },
    { countryCode: "CA", city: "Toronto", entryDate: d(-46), exitDate: d(-42) },
    // Open stay — the "you are here" marker.
    { countryCode: "PT", city: "Lisbon", entryDate: d(-41), exitDate: null },
    // Auto-detected from the (simulated) weekly inbox scan, awaiting confirmation.
    {
      countryCode: "GE",
      city: "Tbilisi",
      entryDate: d(17),
      exitDate: null,
      source: "inbox",
      status: "pending",
      notes: "Flight LIS→TBS found in inbox scan",
    },
  ];

  await db.insert(schema.stays).values(
    stayRows.map((s) => ({
      id: nanoid(),
      countryCode: s.countryCode,
      city: s.city ?? null,
      entryDate: s.entryDate,
      exitDate: s.exitDate ?? null,
      source: s.source ?? "manual",
      status: s.status ?? "confirmed",
      notes: s.notes ?? null,
      createdAt: ts,
      updatedAt: ts,
    })),
  );

  const ruleRows: Array<
    Pick<Rule, "id" | "name" | "kind" | "limitDays"> & Partial<Rule>
  > = [
    {
      id: "schengen-90-180",
      name: "Schengen 90/180",
      kind: "rolling-window",
      zone: "schengen",
      limitDays: 90,
      windowDays: 180,
      description: "Rolling 180-day window across all Schengen states",
    },
    {
      id: "th-183-day-tax",
      name: "Thailand — 183-day tax",
      kind: "calendar-year",
      countryCode: "TH",
      limitDays: 183,
      description:
        "Physical presence in a calendar year triggers tax residency",
    },
    {
      id: "th-dtv-180",
      name: "DTV visa — 180-day stay cap",
      kind: "rolling-window",
      countryCode: "TH",
      limitDays: 180,
      windowDays: 365,
      description: "Per-entry stay cap (simplified rolling year)",
    },
    {
      id: "ca-pr-presence",
      name: "Canadian PR — presence",
      kind: "presence-minimum",
      countryCode: "CA",
      limitDays: 730,
      windowDays: 1825,
      description: "730 days within any rolling 5-year period",
    },
  ];

  await db.insert(schema.rules).values(
    ruleRows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      countryCode: r.countryCode ?? null,
      zone: r.zone ?? null,
      limitDays: r.limitDays,
      windowDays: r.windowDays ?? null,
      description: r.description ?? null,
      createdAt: ts,
      updatedAt: ts,
    })),
  );

  // A zone visa with a hard expiry — demonstrates exit projections being
  // capped by document validity, not just day-count math.
  await db.insert(schema.visas).values({
    id: "schengen-c-visa",
    label: "Schengen C visa (multi-entry)",
    countryCode: null,
    zone: "schengen",
    expiresOn: d(43),
    notes: "Issued via VFS — check remaining entries",
    createdAt: ts,
    updatedAt: ts,
  });
  // Demo rows stay under the dev sentinel owner (column default). Profiles
  // are per-user settings written at onboarding — authenticated deployments
  // intentionally start each user empty, with the wizard as the first run.
}

export default async (nitroApp: unknown): Promise<void> => {
  await runNomadMigrations(nitroApp);
  try {
    const summary = await ensureAdditiveColumns({
      db: getDbExec(),
      tables: schemaTables,
    });
    if (summary.errors.length > 0) {
      console.warn(
        "[db] ensureAdditiveColumns completed with errors:",
        summary.errors,
      );
    }
  } catch (err) {
    console.warn(
      "[db] ensureAdditiveColumns failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
  try {
    await seedDemoData();
  } catch (err) {
    console.warn(
      "[db] demo seed failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
};
