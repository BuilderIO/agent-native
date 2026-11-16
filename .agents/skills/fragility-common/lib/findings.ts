import { commonConfig, ScriptError } from "./cli.ts";
// The tracker-neutral model of a refactor finding, the rules every tracker
// shares (overlap, comment cooldown, sighting merge, run markers), and the
// Tracker interface a tracker skill implements.
import type { Check } from "./doctor.ts";
import type { PlanMeta } from "./plan-format.ts";

export interface Sighting {
  runId: string;
  date: string;
  score: number | null;
  verdict: string | null;
  windowCommits: number | null;
  lookbackFixes: number | null;
  source?: string | null;
}

/** The structured state a tracker keeps on each ticket, next to its text. */
export interface FindingProperty {
  fingerprint: string;
  systems: string[];
  paths: string[];
  firstSeen: string;
  lastSeen: string;
  sightingCount: number;
  sightings: Sighting[];
  lastCommented?: string;
  recurrenceOf?: string;
}

export interface Finding {
  key: string;
  url: string;
  summary: string;
  status: string;
  open: boolean;
  /** Closed without a fix: never re-filed, and sighted at a slower cadence. */
  declined: boolean;
  resolution: string | null;
  created: string;
  updated: string;
  fingerprint: string | null;
  systems: string[];
  paths: string[];
  sightings: Sighting[];
  sightingCount: number;
  /** First sighting date; the sightings list keeps only the latest 60. */
  firstSeen: string | null;
  /** Names of the plan versions already on the ticket. */
  plans: string[];
  /** Last date the skill commented, or null when it never has. */
  lastCommented: string | null;
  /** The resolved ticket this one recurs, when it was opened as a recurrence. */
  recurrenceOf: string | null;
}

/** A run of text; trackers render it as Jira ADF or GitHub markdown. */
export type Inline = { text: string; href?: string; code?: boolean };
export type Paragraph = Inline[];

export const text = (value: string, href?: string): Inline =>
  href ? { text: value, href } : { text: value };
export const code = (value: string): Inline => ({ text: value, code: true });

export interface CreateInput {
  meta: PlanMeta;
  /** One-paragraph facts list shown under the summary. */
  facts: Paragraph[];
  previous: Finding | null;
  planFile: string;
  planName: string;
}

export interface Tracker {
  /** "Jira" or "GitHub", for messages. */
  readonly name: string;
  readonly label: string;
  readonly sightingCooldownDays: number;
  readonly maxNewTicketsPerRun: number;
  findings(): Promise<Finding[]>;
  ticketUrl(key: string): string;
  /** Normalizes a --key value (ENG-12, #12, an issue URL); throws on a bad one. */
  parseKey(raw: string): string;
  create(input: CreateInput): Promise<string>;
  currentProperty(key: string): Promise<FindingProperty | null>;
  setProperty(key: string, value: FindingProperty): Promise<void>;
  /** Puts a plan version on the ticket under `planName`. */
  attachPlan(key: string, file: string, planName: string): Promise<void>;
  /** Links `key` to `recurrenceOf` unless already linked, so a re-run repairs a skipped link. */
  ensureRecurrenceLink(key: string, recurrenceOf: string): Promise<void>;
  hasRunComment(key: string, runId: string): Promise<boolean>;
  comment(key: string, paragraphs: Paragraph[]): Promise<void>;
}

/** What each tracker skill's scripts/tracker.ts exports. */
export interface TrackerModule {
  createTracker(): Tracker;
  doctorChecks(): Check[];
  /** These two need no credentials, so summaries and verdicts work offline. */
  ticketUrl(key: string): string;
  parseKey(raw: string): string;
}

export type TrackerName = "jira" | "github";

export function trackerName(): TrackerName {
  const { tracker } = commonConfig();
  if (tracker !== "jira" && tracker !== "github") {
    throw new ScriptError(
      `fragility-common/config.json tracker must be "jira" or "github", not ${JSON.stringify(tracker)}`,
    );
  }
  return tracker;
}

export async function loadTracker(): Promise<TrackerModule> {
  return (await import(
    `../../${trackerName()}-refactor-findings/scripts/tracker.ts`
  )) as TrackerModule;
}

// The branch-run link put on tickets: FRAGILITY_RUN_URL, or the Builder
// project branch derived from a Fusion preview origin.
export function runLink(): { url: string | null; source: string } {
  const explicit = process.env.FRAGILITY_RUN_URL;
  if (explicit) return { url: explicit, source: "FRAGILITY_RUN_URL" };
  const origin = process.env.FUSION_ENV_ORIGIN;
  const match =
    origin &&
    /^https:\/\/([0-9a-f]{20,32})-([a-z0-9-]+)\.builderio\.xyz/.exec(origin);
  return match
    ? {
        url: `https://builder.io/app/projects/${match[1]}/${match[2]}`,
        source: "FUSION_ENV_ORIGIN",
      }
    : { url: null, source: "none" };
}

export const runLinkCheck: Check = {
  name: "run-link",
  run: () => {
    const link = runLink();
    if (!link.url)
      throw new Error(
        "no FRAGILITY_RUN_URL and FUSION_ENV_ORIGIN is not a Fusion preview URL",
      );
    return `${link.url} (from ${link.source})`;
  },
  onFail: "warn",
};

export function runMarker(runId: string): string {
  return `fragility run ${runId}`;
}

// Delimited so run "bug-eng-45" never matches a comment for "bug-eng-456" or
// "bug-eng-45.2"; a sentence-ending period still ends the id.
export function runMarkerPattern(runId: string): RegExp {
  return new RegExp(
    `fragility run ${escapeRegExp(runId)}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`,
  );
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function planNamePattern(planBase: string): RegExp {
  return new RegExp(`^${escapeRegExp(planBase)}-[A-Za-z0-9._-]+\\.md$`);
}

/** Why a ticket overlaps a system and its files; empty when it doesn't. The one matching rule for match and upsert. */
export function overlap(
  system: string,
  files: string[],
  finding: Finding,
): string[] {
  const why: string[] = [];
  if (finding.fingerprint?.startsWith(`fsys:${system.toLowerCase()}:`))
    why.push("fingerprint anchor");
  for (const s of finding.systems) {
    if (s === system) why.push("same system");
    else if (s.startsWith(`${system}/`) || system.startsWith(`${s}/`))
      why.push(`nested system ${s}`);
  }
  const shared = files.filter((f) => finding.paths.includes(f));
  if (shared.length)
    why.push(
      `${shared.length} shared file(s): ${shared.slice(0, 3).join(", ")}`,
    );
  return [...new Set(why)];
}

/**
 * Whether a sighting should comment. The cooldown runs from the last comment,
 * not the last sighting, because every run records a sighting and a system
 * that stays hot would otherwise never comment again. Declined tickets wait
 * four cooldowns. Tickets created before lastCommented was tracked count
 * their first sighting (the create) as the last comment.
 */
export function commentDue(finding: Finding, cooldownDays: number): boolean {
  const days = (finding.declined ? 4 : 1) * cooldownDays;
  const last =
    finding.lastCommented ?? finding.firstSeen ?? finding.sightings[0]?.date;
  return !last || Date.now() - Date.parse(last) >= days * 86_400_000;
}

export function mergeSighting(
  existing: FindingProperty | null,
  base: Pick<FindingProperty, "fingerprint" | "systems" | "paths">,
  sighting: Sighting,
  extra: { commentedOn?: string; recurrenceOf?: string } = {},
): FindingProperty {
  const previous = existing?.sightings ?? [];
  const repeat = previous.some((s) => s.runId === sighting.runId);
  const sightings = [
    ...previous.filter((s) => s.runId !== sighting.runId),
    sighting,
  ].slice(-60);
  return {
    fingerprint: existing?.fingerprint ?? base.fingerprint,
    systems: [...new Set([...(existing?.systems ?? []), ...base.systems])],
    paths: [...new Set([...(existing?.paths ?? []), ...base.paths])].slice(
      0,
      80,
    ),
    firstSeen: existing?.firstSeen ?? sighting.date,
    lastSeen: sighting.date,
    sightingCount:
      (existing?.sightingCount ?? previous.length) + (repeat ? 0 : 1),
    sightings,
    lastCommented: extra.commentedOn ?? existing?.lastCommented,
    recurrenceOf: extra.recurrenceOf ?? existing?.recurrenceOf,
  };
}
