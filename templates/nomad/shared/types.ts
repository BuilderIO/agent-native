/**
 * Shared domain types for the Nomad residency-compliance app.
 *
 * Dates are calendar dates in `YYYY-MM-DD` form (no time component) — presence
 * rules everywhere count *days on the ground*, so a plain calendar date is the
 * correct unit. Both the entry and exit day count as presence days (the
 * standard Schengen / tax-residency counting convention).
 */

export type StaySource = "manual" | "inbox" | "import";
export type StayStatus = "confirmed" | "pending";

export interface Stay {
  id: string;
  countryCode: string;
  city: string | null;
  /** First day on the ground (inclusive), YYYY-MM-DD. */
  entryDate: string;
  /** Last day on the ground (inclusive), YYYY-MM-DD. Null = still there / open-ended. */
  exitDate: string | null;
  source: StaySource;
  /** `pending` stays were auto-detected (e.g. from an inbox scan) and await user confirmation. */
  status: StayStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RuleKind = "rolling-window" | "calendar-year" | "presence-minimum";

export interface Rule {
  id: string;
  name: string;
  kind: RuleKind;
  /** ISO country code the rule applies to. Null when the rule targets a zone. */
  countryCode: string | null;
  /** Multi-country zone ("schengen") — days in any member state count together. */
  zone: string | null;
  /** Day cap (max rules) or required minimum (presence-minimum). */
  limitDays: number;
  /**
   * Window length in days for rolling rules (180 for Schengen, 1825 for
   * Canadian PR). Null for calendar-year rules.
   */
  windowDays: number | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export type StatusKey = "on-track" | "close" | "at-risk" | "over" | "met";
export type Severity = "safe" | "warn" | "danger";

export interface RuleComputation {
  rule: Rule;
  usedDays: number;
  limitDays: number;
  remainingDays: number;
  /** 0-100, clamped. */
  pct: number;
  severity: Severity;
  statusKey: StatusKey;
  /** True when the user is currently inside the rule's country/zone. */
  present: boolean;
  /**
   * If present under a max rule: last day the user can legally stay
   * (YYYY-MM-DD), accounting for days aging out of rolling windows AND any
   * applicable visa's expiry (whichever binds first).
   */
  mustExitBy: string | null;
  /** Days from today through mustExitBy (inclusive of remaining stay days). */
  daysUntilExit: number | null;
  /** Set when a visa's expiry, not the day count, is what forces the exit. */
  cappedByVisaId: string | null;
  /** For exhausted max rules: earliest date a 1-day visit becomes legal again. */
  reEnterOn: string | null;
}

export interface CountryComputation {
  countryCode: string;
  severity: Severity;
  statusKey: StatusKey;
  /** True when the user's current open stay is in this country. */
  here: boolean;
  usedDays: number;
  limitDays: number;
  /** Rule ids that apply to this country (directly or via zone). */
  ruleIds: string[];
  /** The rule shown as the headline number for this country. */
  primaryRuleId: string | null;
}

export type AlertKind =
  | "rule-danger"
  | "rule-warn"
  | "pending-stay"
  | "visa-expiry";

export interface ComplianceAlert {
  id: string;
  kind: AlertKind;
  severity: Severity | "info";
  ruleId?: string;
  stayId?: string;
  visaId?: string;
  countryCode?: string;
  /** Pre-computed numbers the UI interpolates into localized copy. */
  data: Record<string, string | number>;
}

/**
 * A visa, permit, or entry authorization with a hard validity window —
 * distinct from day-count rules. Scoped to one country OR a zone
 * ("schengen"): a Schengen C visa grants the whole area until it expires.
 */
export interface Visa {
  id: string;
  label: string;
  countryCode: string | null;
  zone: string | null;
  /** First valid day (inclusive), YYYY-MM-DD. Null = valid since issuance. */
  validFrom: string | null;
  /** Last valid day (inclusive), YYYY-MM-DD. */
  expiresOn: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VisaComputation {
  visa: Visa;
  /** Days from today through expiresOn (negative = already expired). */
  daysUntilExpiry: number;
  /** False when today is before validFrom (issued but not yet usable). */
  active: boolean;
  severity: Severity;
  /** True when the user is currently inside the visa's country/zone. */
  present: boolean;
}

export type ImmigrationStatus = "pr" | "citizen" | "visa";

export interface NomadProfile {
  fiscalHomeCountry: string | null;
  /** Passport country — drives which visa regimes apply to the user. */
  citizenshipCountry: string | null;
  immigrationStatus: ImmigrationStatus | null;
  /** Onboarding "what brings you here" picks — personalizes agent guidance. */
  goals: string[];
  trackedCountries: string[];
  mailScanEnabled: boolean;
  scanFrequency: "weekly";
  lastScanAt: string | null;
  onboardingCompleted: boolean;
}

export interface CurrentLocation {
  countryCode: string;
  city: string | null;
  since: string;
  /** 1-based day count of the current stay (entry day = day 1). */
  dayNumber: number;
}

export interface ComplianceSnapshot {
  today: string;
  profile: NomadProfile;
  currentLocation: CurrentLocation | null;
  rules: RuleComputation[];
  visas: VisaComputation[];
  countries: CountryComputation[];
  alerts: ComplianceAlert[];
  trips: Stay[];
  pendingStays: Stay[];
}
