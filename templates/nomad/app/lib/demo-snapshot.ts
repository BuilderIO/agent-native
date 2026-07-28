/**
 * Fabricated compliance scenario shown when demo mode is on (Settings →
 * Workspace → Enable demo mode). Never touches the database or actions — this
 * is a pure, deterministic substitute for the real `compliance-status`
 * response, built entirely from offsets of `today` so it looks the same
 * regardless of wall-clock date and never needs `Math.random()`/`Date.now()`.
 *
 * Every rule here is `rolling-window` or a rolling `presence-minimum`
 * (windowDays set) rather than `calendar-year` — a calendar-year rule's
 * usable days are capped by how much of the current year has elapsed, so a
 * "90% used" calendar-year fabrication would look broken in early January.
 * Real numbers are computed by the real engine (`computeSnapshot`) from these
 * fabricated inputs, so day counts, severities, and alerts stay internally
 * consistent.
 */

import { addDays, computeSnapshot } from "../../shared/compliance";
import type { NomadProfile, Rule, Stay, Visa } from "../../shared/types";

function demoStays(today: string): Stay[] {
  const ts = today;
  const d = (offset: number) => addDays(today, offset);
  const stay = (
    partial: Pick<Stay, "id" | "countryCode" | "city" | "entryDate"> &
      Partial<Stay>,
  ): Stay => ({
    exitDate: null,
    source: "manual",
    status: "confirmed",
    notes: null,
    createdAt: ts,
    updatedAt: ts,
    ...partial,
  });

  return [
    stay({
      id: "demo-ca-1",
      countryCode: "CA",
      city: "Toronto",
      entryDate: d(-560),
      exitDate: d(-500),
    }),
    stay({
      id: "demo-ca-2",
      countryCode: "CA",
      city: "Montréal",
      entryDate: d(-420),
      exitDate: d(-330),
    }),
    stay({
      id: "demo-th-1",
      countryCode: "TH",
      city: "Bangkok",
      entryDate: d(-300),
      exitDate: d(-200),
    }),
    stay({
      id: "demo-th-2",
      countryCode: "TH",
      city: "Chiang Mai",
      entryDate: d(-190),
      exitDate: d(-130),
    }),
    stay({
      id: "demo-de-1",
      countryCode: "DE",
      city: "Berlin",
      entryDate: d(-140),
      exitDate: d(-90),
    }),
    stay({
      id: "demo-mx-1",
      countryCode: "MX",
      city: "Mexico City",
      entryDate: d(-100),
      exitDate: d(-85),
    }),
    stay({
      id: "demo-ae-1",
      countryCode: "AE",
      city: "Dubai",
      entryDate: d(-80),
      exitDate: d(-62),
    }),
    stay({
      id: "demo-gb-1",
      countryCode: "GB",
      city: "London",
      entryDate: d(-61),
      exitDate: d(-47),
    }),
    stay({
      id: "demo-ca-3",
      countryCode: "CA",
      city: "Toronto",
      entryDate: d(-46),
      exitDate: d(-40),
    }),
    // Open stay — the "you are here" marker, also the current Schengen
    // presence that keeps the Schengen rule and visa "present".
    stay({
      id: "demo-pt-open",
      countryCode: "PT",
      city: "Lisbon",
      entryDate: d(-25),
      exitDate: null,
    }),
    // Auto-detected inbox booking awaiting confirmation.
    stay({
      id: "demo-ge-pending",
      countryCode: "GE",
      city: "Tbilisi",
      entryDate: d(17),
      exitDate: null,
      source: "inbox",
      status: "pending",
      notes: "Flight LIS→TBS found in inbox scan",
    }),
  ];
}

function demoRules(today: string): Rule[] {
  const rule = (
    partial: Pick<Rule, "id" | "name" | "kind" | "limitDays"> & Partial<Rule>,
  ): Rule => ({
    countryCode: null,
    zone: null,
    windowDays: null,
    description: null,
    createdAt: today,
    updatedAt: today,
    ...partial,
  });

  return [
    // ~86% of a 180-day Schengen window → warn.
    rule({
      id: "demo-rule-schengen",
      name: "Schengen 90/180",
      kind: "rolling-window",
      zone: "schengen",
      limitDays: 90,
      windowDays: 180,
      description: "Rolling 180-day window across all Schengen states",
    }),
    // ~90% of a rolling 365-day Thai DTV cap → danger.
    rule({
      id: "demo-rule-th-dtv",
      name: "Thailand DTV — 180-day stay cap",
      kind: "rolling-window",
      countryCode: "TH",
      limitDays: 180,
      windowDays: 365,
      description: "Per-entry stay cap (rolling year)",
    }),
    // Presence minimums are always "safe" until met — a rolling window, not
    // calendar-year, so it never resets mid-scenario.
    rule({
      id: "demo-rule-ca-pr",
      name: "Canadian PR — presence",
      kind: "presence-minimum",
      countryCode: "CA",
      limitDays: 730,
      windowDays: 1825,
      description: "730 days within any rolling 5-year period",
    }),
    rule({
      id: "demo-rule-ae-visitor",
      name: "UAE — visitor allowance",
      kind: "rolling-window",
      countryCode: "AE",
      limitDays: 90,
      windowDays: 180,
      description: "90-day rolling visitor allowance",
    }),
  ];
}

function demoVisas(today: string): Visa[] {
  return [
    {
      id: "demo-visa-schengen",
      label: "Schengen C visa (multi-entry)",
      countryCode: null,
      zone: "schengen",
      validFrom: null,
      expiresOn: addDays(today, 20),
      notes: "Issued via VFS — check remaining entries",
      createdAt: today,
      updatedAt: today,
    },
  ];
}

function demoProfile(today: string): NomadProfile {
  return {
    fiscalHomeCountry: "PT",
    citizenshipCountry: "BR",
    immigrationStatus: "pr",
    goals: ["schengen", "tax", "pr", "log"],
    trackedCountries: ["PT", "TH", "CA", "AE"],
    mailScanEnabled: true,
    scanFrequency: "weekly",
    lastScanAt: addDays(today, -2),
    onboardingCompleted: true,
  };
}

export function getDemoComplianceSnapshot(today: string) {
  return computeSnapshot(
    demoStays(today),
    demoRules(today),
    demoProfile(today),
    today,
    demoVisas(today),
  );
}
