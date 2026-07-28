/**
 * Pure presence-compliance engine.
 *
 * Everything here is deterministic math over calendar dates — no I/O — so the
 * same module powers the `compliance-status` action, seeds, and unit tests.
 *
 * Counting convention: entry and exit days both count as presence days (the
 * standard Schengen and tax-residency convention). An open stay (null exit)
 * counts through "today".
 */

import { isSchengen } from "./countries";
import type {
  ComplianceAlert,
  ComplianceSnapshot,
  CountryComputation,
  CurrentLocation,
  NomadProfile,
  Rule,
  RuleComputation,
  Severity,
  StatusKey,
  Stay,
  Visa,
  VisaComputation,
} from "./types";

const MS_PER_DAY = 86_400_000;

/** Days since the Unix epoch for a YYYY-MM-DD calendar date. */
export function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/** YYYY-MM-DD for a days-since-epoch number. */
export function dateFromDayNumber(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Today's calendar date in the given timezone-free local sense. */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date: string, days: number): string {
  return dateFromDayNumber(dayNumber(date) + days);
}

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/** Does this stay fall inside the rule's country/zone scope? */
export function stayMatchesRule(stay: Stay, rule: Rule): boolean {
  if (rule.zone === "schengen") return isSchengen(stay.countryCode);
  if (rule.countryCode)
    return stay.countryCode === rule.countryCode.toUpperCase();
  return false;
}

export function ruleAppliesToCountry(rule: Rule, countryCode: string): boolean {
  if (rule.zone === "schengen") return isSchengen(countryCode);
  return rule.countryCode?.toUpperCase() === countryCode.toUpperCase();
}

export function visaAppliesToCountry(visa: Visa, countryCode: string): boolean {
  if (visa.zone === "schengen") return isSchengen(countryCode);
  return visa.countryCode?.toUpperCase() === countryCode.toUpperCase();
}

/** A visa constrains a rule when both cover the same country/zone scope. */
function visaMatchesRule(visa: Visa, rule: Rule): boolean {
  if (visa.zone && rule.zone) return visa.zone === rule.zone;
  if (visa.countryCode && rule.countryCode) {
    return visa.countryCode.toUpperCase() === rule.countryCode.toUpperCase();
  }
  // Zone visa vs. country rule (or vice versa): match via membership.
  if (visa.zone === "schengen" && rule.countryCode) {
    return isSchengen(rule.countryCode);
  }
  if (rule.zone === "schengen" && visa.countryCode) {
    return isSchengen(visa.countryCode);
  }
  return false;
}

/**
 * Inclusive day-count of one stay clipped to [from, to] (day numbers).
 * Open stays are clipped at `to`.
 */
function stayDaysInWindow(stay: Stay, from: number, to: number): number {
  const start = Math.max(dayNumber(stay.entryDate), from);
  const end = Math.min(stay.exitDate ? dayNumber(stay.exitDate) : to, to);
  return Math.max(0, end - start + 1);
}

/** Total presence days across stays inside [from, to], both inclusive. */
export function countDays(stays: Stay[], from: string, to: string): number {
  const f = dayNumber(from);
  const t = dayNumber(to);
  return stays.reduce((sum, s) => sum + stayDaysInWindow(s, f, t), 0);
}

/** The set of individual presence day-numbers inside [from, to]. */
function presenceDaySet(stays: Stay[], from: number, to: number): Set<number> {
  const days = new Set<number>();
  for (const stay of stays) {
    const start = Math.max(dayNumber(stay.entryDate), from);
    const end = Math.min(stay.exitDate ? dayNumber(stay.exitDate) : to, to);
    for (let d = start; d <= end; d++) days.add(d);
  }
  return days;
}

/** Minimum rules without a window count per calendar year (resets Jan 1). */
function isCalendarYearMinimum(rule: Rule): boolean {
  return rule.kind === "presence-minimum" && rule.windowDays === null;
}

function usedDaysForRule(rule: Rule, stays: Stay[], today: string): number {
  const t = dayNumber(today);
  const from =
    rule.kind === "calendar-year" || isCalendarYearMinimum(rule)
      ? dayNumber(`${today.slice(0, 4)}-01-01`)
      : t - (rule.windowDays ?? 365) + 1;
  // Overlapping stays in the same country/zone must not double-count a day.
  return presenceDaySet(stays, from, t).size;
}

/** Is the user currently (as of `today`) inside this rule's scope? */
function presentUnderRule(rule: Rule, stays: Stay[], today: string): boolean {
  const t = dayNumber(today);
  return stays.some(
    (s) =>
      dayNumber(s.entryDate) <= t &&
      (s.exitDate === null || dayNumber(s.exitDate) >= t),
  );
}

/**
 * For someone currently inside a max rule's scope: the last day they can stay
 * without exceeding the limit, assuming they remain every day from today on.
 *
 * This is a day-by-day simulation, which correctly handles rolling windows
 * where old presence days age out while new ones accrue (the case naive
 * `limit - used` math gets wrong). Returns null if a full extra year of
 * staying never breaks the limit.
 */
export function computeMustExitBy(
  rule: Rule,
  stays: Stay[],
  today: string,
): string | null {
  const t = dayNumber(today);
  const limit = rule.limitDays;

  if (rule.kind === "calendar-year") {
    const used = usedDaysForRule(rule, stays, today);
    const remaining = limit - used;
    if (remaining < 0) return addDays(today, -1);
    const lastByLimit = t + remaining; // today already counted in `used`
    const yearEnd = dayNumber(`${today.slice(0, 4)}-12-31`);
    // The counter resets on Jan 1, so the cap only binds within this year.
    return lastByLimit > yearEnd ? null : dateFromDayNumber(lastByLimit);
  }

  const window = rule.windowDays ?? 365;
  // Precompute historical presence days once; simulated future days are
  // implicit (every day from today+1 onward counts).
  const history = presenceDaySet(stays, t - window + 1, t);
  const historyArr = [...history].sort((a, b) => a - b);

  for (let future = t; future <= t + 366; future++) {
    const windowStart = future - window + 1;
    // Historical days still inside the window:
    let count = 0;
    for (const d of historyArr) if (d >= windowStart && d <= t) count++;
    // Simulated stayed days (today+1 .. future):
    count += Math.max(0, future - t);
    if (count > limit) return dateFromDayNumber(future - 1);
  }
  return null;
}

/**
 * For an exhausted max rule: the earliest date a 1-day visit becomes legal
 * again (enough old days have aged out of the window / the year has reset).
 */
export function computeReEnterOn(
  rule: Rule,
  stays: Stay[],
  today: string,
): string | null {
  if (rule.kind === "calendar-year") {
    return `${Number(today.slice(0, 4)) + 1}-01-01`;
  }
  const window = rule.windowDays ?? 365;
  const t = dayNumber(today);
  const history = [...presenceDaySet(stays, t - window + 1, t)].sort(
    (a, b) => a - b,
  );
  for (let future = t + 1; future <= t + window + 1; future++) {
    const windowStart = future - window + 1;
    const stillCounted = history.filter((d) => d >= windowStart).length;
    if (stillCounted + 1 <= rule.limitDays) return dateFromDayNumber(future);
  }
  return null;
}

function severityFor(
  rule: Rule,
  pct: number,
  remaining: number,
  present: boolean,
  daysUntilExit: number | null,
): { severity: Severity; statusKey: StatusKey } {
  if (rule.kind === "presence-minimum") {
    // Minimum rules accumulate toward a target; they don't "expire" daily.
    return pct >= 100
      ? { severity: "safe", statusKey: "met" }
      : { severity: "safe", statusKey: "on-track" };
  }
  if (remaining <= 0) return { severity: "danger", statusKey: "over" };
  if (pct >= 90 || (present && daysUntilExit !== null && daysUntilExit <= 14)) {
    return { severity: "danger", statusKey: "at-risk" };
  }
  if (pct >= 70 || (present && daysUntilExit !== null && daysUntilExit <= 30)) {
    return { severity: "warn", statusKey: "close" };
  }
  return { severity: "safe", statusKey: "on-track" };
}

export function computeRule(
  rule: Rule,
  allStays: Stay[],
  today: string,
): RuleComputation {
  const stays = allStays.filter(
    (s) => s.status === "confirmed" && stayMatchesRule(s, rule),
  );
  const usedDays = usedDaysForRule(rule, stays, today);
  const remainingDays = Math.max(0, rule.limitDays - usedDays);
  const pct = Math.min(
    100,
    Math.round((usedDays / Math.max(1, rule.limitDays)) * 100),
  );
  const present = presentUnderRule(rule, stays, today);

  let mustExitBy: string | null = null;
  let daysUntilExit: number | null = null;
  if (present && rule.kind !== "presence-minimum") {
    mustExitBy = computeMustExitBy(rule, stays, today);
    if (mustExitBy) {
      daysUntilExit = dayNumber(mustExitBy) - dayNumber(today);
    }
  }

  const reEnterOn =
    !present && rule.kind !== "presence-minimum" && remainingDays === 0
      ? computeReEnterOn(rule, stays, today)
      : null;

  let { severity, statusKey } = severityFor(
    rule,
    pct,
    rule.limitDays - usedDays,
    present,
    daysUntilExit,
  );

  // Calendar-year minimums (e.g. "≥183 days at home for fiscal residency")
  // get feasibility math: can the target still be reached by Dec 31 if the
  // user were present every remaining day?
  if (isCalendarYearMinimum(rule) && statusKey !== "met") {
    const stillNeeded = rule.limitDays - usedDays;
    const daysLeftInYear =
      dayNumber(`${today.slice(0, 4)}-12-31`) - dayNumber(today);
    if (stillNeeded > daysLeftInYear) {
      severity = "danger";
      statusKey = "at-risk";
    } else if (stillNeeded > daysLeftInYear - 14) {
      severity = "warn";
      statusKey = "close";
    }
  }

  return {
    rule,
    usedDays,
    limitDays: rule.limitDays,
    remainingDays,
    pct,
    severity,
    statusKey,
    present,
    mustExitBy,
    daysUntilExit,
    cappedByVisaId: null,
    reEnterOn,
  };
}

/**
 * A visa's hard expiry can force an exit before the day-count math does.
 * Caps a present max-rule's mustExitBy at the earliest applicable visa
 * expiry and recomputes severity for the tightened window.
 */
export function applyVisaCap(
  rc: RuleComputation,
  visas: Visa[],
  today: string,
): RuleComputation {
  if (!rc.present || rc.rule.kind === "presence-minimum") return rc;
  const t = dayNumber(today);
  const binding = visas
    .filter(
      (v) =>
        visaMatchesRule(v, rc.rule) &&
        dayNumber(v.expiresOn) >= t &&
        (v.validFrom === null || dayNumber(v.validFrom) <= t),
    )
    .sort((a, b) => dayNumber(a.expiresOn) - dayNumber(b.expiresOn))[0];
  if (!binding) return rc;
  const expiry = dayNumber(binding.expiresOn);
  const currentExit = rc.mustExitBy ? dayNumber(rc.mustExitBy) : Infinity;
  if (expiry >= currentExit) return rc;

  const mustExitBy = binding.expiresOn;
  const daysUntilExit = expiry - t;
  const { severity, statusKey } = severityFor(
    rc.rule,
    rc.pct,
    rc.limitDays - rc.usedDays,
    true,
    daysUntilExit,
  );
  return {
    ...rc,
    mustExitBy,
    daysUntilExit,
    cappedByVisaId: binding.id,
    severity,
    statusKey,
  };
}

export function computeVisa(
  visa: Visa,
  stays: Stay[],
  today: string,
): VisaComputation {
  const t = dayNumber(today);
  const daysUntilExpiry = dayNumber(visa.expiresOn) - t;
  const active = visa.validFrom === null || dayNumber(visa.validFrom) <= t;
  const openStays = stays.filter(
    (s) =>
      s.status === "confirmed" &&
      dayNumber(s.entryDate) <= t &&
      (s.exitDate === null || dayNumber(s.exitDate) >= t) &&
      visaAppliesToCountry(visa, s.countryCode),
  );
  const present = openStays.length > 0;
  const severity: Severity =
    daysUntilExpiry < 0 || (present && active && daysUntilExpiry <= 14)
      ? "danger"
      : daysUntilExpiry <= 30
        ? "warn"
        : "safe";
  return { visa, daysUntilExpiry, active, severity, present };
}

const SEVERITY_RANK: Record<Severity, number> = { safe: 0, warn: 1, danger: 2 };

export function worstSeverity(items: Severity[]): Severity {
  return items.reduce<Severity>(
    (worst, s) => (SEVERITY_RANK[s] > SEVERITY_RANK[worst] ? s : worst),
    "safe",
  );
}

export function findCurrentLocation(
  stays: Stay[],
  today: string,
): CurrentLocation | null {
  const t = dayNumber(today);
  const open = stays
    .filter(
      (s) =>
        s.status === "confirmed" &&
        dayNumber(s.entryDate) <= t &&
        (s.exitDate === null || dayNumber(s.exitDate) >= t),
    )
    .sort((a, b) => dayNumber(b.entryDate) - dayNumber(a.entryDate))[0];
  if (!open) return null;
  return {
    countryCode: open.countryCode,
    city: open.city,
    since: open.entryDate,
    dayNumber: t - dayNumber(open.entryDate) + 1,
  };
}

function computeCountries(
  ruleComputations: RuleComputation[],
  stays: Stay[],
  currentLocation: CurrentLocation | null,
  trackedCountries: string[],
): CountryComputation[] {
  const codes = new Set<string>(trackedCountries.map((c) => c.toUpperCase()));
  for (const s of stays) codes.add(s.countryCode.toUpperCase());
  for (const rc of ruleComputations) {
    if (rc.rule.countryCode) codes.add(rc.rule.countryCode.toUpperCase());
  }

  return [...codes].map((code) => {
    const applicable = ruleComputations.filter((rc) =>
      ruleAppliesToCountry(rc.rule, code),
    );
    // Headline rule ranked by ACTIONABILITY: scariest severity first, then
    // live counters before already-met minimums (a finished rule has no
    // decision value and its saturated pct must not outrank an active one),
    // then highest usage.
    const ranked = [...applicable].sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        Number(a.statusKey === "met") - Number(b.statusKey === "met") ||
        b.pct - a.pct,
    );
    const primary = ranked[0];
    // Map color considers every rule: calendar-year minimums can go warn or
    // at-risk when the target slips out of reach, and that must show.
    const severity = worstSeverity(applicable.map((rc) => rc.severity));
    return {
      countryCode: code,
      severity,
      statusKey: primary?.statusKey ?? "on-track",
      here: currentLocation?.countryCode.toUpperCase() === code,
      usedDays: primary?.usedDays ?? 0,
      limitDays: primary?.limitDays ?? 0,
      ruleIds: ranked.map((rc) => rc.rule.id),
      primaryRuleId: primary?.rule.id ?? null,
    };
  });
}

function computeAlerts(
  ruleComputations: RuleComputation[],
  visaComputations: VisaComputation[],
  pendingStays: Stay[],
): ComplianceAlert[] {
  const alerts: ComplianceAlert[] = [];
  for (const rc of ruleComputations) {
    if (rc.severity === "safe") continue;
    alerts.push({
      id: `rule-${rc.rule.id}`,
      kind: rc.severity === "danger" ? "rule-danger" : "rule-warn",
      severity: rc.severity,
      ruleId: rc.rule.id,
      countryCode: rc.rule.countryCode ?? undefined,
      data: {
        ruleName: rc.rule.name,
        usedDays: rc.usedDays,
        limitDays: rc.limitDays,
        remainingDays: rc.remainingDays,
        ...(rc.rule.kind === "presence-minimum" ? { minimum: 1 } : {}),
        ...(rc.mustExitBy ? { mustExitBy: rc.mustExitBy } : {}),
        ...(rc.daysUntilExit !== null
          ? { daysUntilExit: rc.daysUntilExit }
          : {}),
        ...(rc.reEnterOn ? { reEnterOn: rc.reEnterOn } : {}),
      },
    });
  }
  for (const vc of visaComputations) {
    if (vc.severity === "safe") continue;
    alerts.push({
      id: `visa-${vc.visa.id}`,
      kind: "visa-expiry",
      severity: vc.severity,
      visaId: vc.visa.id,
      countryCode: vc.visa.countryCode ?? undefined,
      data: {
        label: vc.visa.label,
        expiresOn: vc.visa.expiresOn,
        daysUntilExpiry: vc.daysUntilExpiry,
      },
    });
  }
  for (const stay of pendingStays) {
    alerts.push({
      id: `pending-${stay.id}`,
      kind: "pending-stay",
      severity: "info",
      stayId: stay.id,
      countryCode: stay.countryCode,
      data: {
        countryCode: stay.countryCode,
        city: stay.city ?? "",
        entryDate: stay.entryDate,
      },
    });
  }
  const rank = { danger: 0, warn: 1, info: 2 } as const;
  return alerts.sort(
    (a, b) =>
      rank[a.severity as keyof typeof rank] -
      rank[b.severity as keyof typeof rank],
  );
}

export function computeSnapshot(
  stays: Stay[],
  rules: Rule[],
  profile: NomadProfile,
  today: string = todayISO(),
  visas: Visa[] = [],
): ComplianceSnapshot {
  const confirmed = stays.filter((s) => s.status === "confirmed");
  const pendingStays = stays.filter((s) => s.status === "pending");
  const ruleComputations = rules.map((r) =>
    applyVisaCap(computeRule(r, stays, today), visas, today),
  );
  const visaComputations = visas.map((v) => computeVisa(v, stays, today));
  const currentLocation = findCurrentLocation(stays, today);
  const countries = computeCountries(
    ruleComputations,
    stays,
    currentLocation,
    profile.trackedCountries,
  );
  const trips = [...confirmed].sort(
    (a, b) => dayNumber(b.entryDate) - dayNumber(a.entryDate),
  );
  return {
    today,
    profile,
    currentLocation,
    rules: ruleComputations,
    visas: visaComputations,
    countries,
    alerts: computeAlerts(ruleComputations, visaComputations, pendingStays),
    trips,
    pendingStays,
  };
}
