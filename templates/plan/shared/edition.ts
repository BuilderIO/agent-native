import type { PlanBlock } from "./plan-content.js";

/**
 * Edition — the stored "engineering newspaper" artifact. One `plans` row per
 * edition (`kind: "edition"`), whose blocks are the stories plus one coverage
 * note. Stories cite the PR recaps they were written from, so a reader can open
 * the underlying recap from any headline.
 */

/**
 * A recap a story was written from. `filesChanged`/`additions`/`deletions` are
 * `null` when the stat could not be resolved — renderers must show that as
 * unavailable, never as `0`, or a 50-PR day reads as a day where nothing moved.
 */
export interface EditionStoryRecapRef {
  recapId?: string;
  repo: string;
  prNumber: number;
  prUrl: string;
  authorLogin?: string;
  filesChanged?: number | null;
  additions?: number | null;
  deletions?: number | null;
  /**
   * Block ids to lift out of this recap and show inside the story — the
   * diagram, diff, file-tree, or wireframe that makes the change legible.
   * Stored as ids, not copies, so an edition never renders a stale diagram.
   */
  blockIds?: string[];
}

/**
 * A sub-theme inside a story, carrying its own pull requests and aggregate
 * diff. Cohorts are what a story shows instead of one row per pull request:
 * a reader gets 2-4 named groups rather than eleven citations. `mechanical`
 * marks release/lockfile/codegen/translation work, which renders dimmed and
 * sorted last instead of competing with real changes.
 */
export interface EditionStoryCohort {
  name: string;
  sentence: string;
  prNumbers: number[];
  repos: string[];
  additions?: number | null;
  deletions?: number | null;
  mechanical?: boolean;
}

export interface EditionStoryData {
  storyId: string;
  headline: string;
  dek: string;
  tags: string[];
  /** Featured story, versus a one-line "also in this edition" entry. */
  lead: boolean;
  recaps: EditionStoryRecapRef[];
  cohorts: EditionStoryCohort[];
  whatShipped?: string;
  why?: string;
  howItWorks?: string;
}

/**
 * A block lifted out of a recap for a story, paired with the recap it came
 * from. The pairing is explicit because a block does not carry its own origin,
 * and two recaps in one story can legitimately use the same block id — so
 * inferring the owner from the id would attribute one of them wrongly.
 */
export interface EditionStoryBlock {
  recapId: string;
  block: PlanBlock;
}

/** A story as the reader receives it: stored fields plus its resolved blocks. */
export interface EditionReaderStory extends EditionStoryData {
  blocks: EditionStoryBlock[];
}

export interface EditionMissingPr {
  repo: string;
  prNumber: number;
  title: string;
  url: string;
}

/**
 * What the edition could and could not see. Recap coverage runs well under
 * 100% (tiny diffs, forks, and failed recap runs all skip silently), so an
 * edition states the gap instead of implying the recaps were the whole day.
 */
export interface EditionCoverageData {
  mergedPrCount: number;
  recapCount: number;
  /** Merged PRs with no recap row at all. */
  missingPrs: EditionMissingPr[];
  /**
   * Merged PRs that DO have a recap, but one that cannot be proven merged —
   * CI writes merged-at only on the merge-close run, so a skipped or failed
   * one leaves the recap frozen as `open`. These have readable content and
   * must not be reported as missing; the gap is the stamp, not the recap.
   */
  stalePrs: EditionMissingPr[];
  reposCovered: string[];
  /**
   * Commit count for the window. `null` when the provider was not asked —
   * the stat block must render that as unavailable, never as zero.
   */
  commitCount?: number | null;
}

/** `2026-09-21`, or `2026-09-08_2026-09-21` for a multi-day catch-up window. */
export function editionDateKey(
  windowStartIso: string,
  windowEndIso: string,
  timeZone: string,
): string {
  const start = dayKeyInZone(windowStartIso, timeZone);
  // windowEnd is exclusive, so the last covered day is the one holding the
  // instant just before it. Reading the boundary itself names a single 24h
  // window as a two-day range.
  const lastCoveredIso = new Date(
    new Date(windowEndIso).getTime() - 1,
  ).toISOString();
  const end = dayKeyInZone(lastCoveredIso, timeZone);
  return start === end ? end : `${start}_${end}`;
}

/**
 * `en-CA` is the one widely-available locale whose short date is already
 * `YYYY-MM-DD`, which keeps day keys sortable without hand-formatting parts.
 */
export function dayKeyInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
