/**
 * Whether a frozen copy of another app's resource (a chart, a screen, a
 * slide) can sit in a page, given who can open each. Pages and their sources
 * share three levels: invited people, everyone at the organization, and
 * anyone with the link.
 */

export type EmbedVisibility = "private" | "org" | "public";

const VISIBILITY_RANK: Record<EmbedVisibility, number> = {
  private: 0,
  org: 1,
  public: 2,
};

/** True when `a` lets more people in than `b`. */
export function isWiderVisibility(
  a: EmbedVisibility,
  b: EmbedVisibility,
): boolean {
  return VISIBILITY_RANK[a] > VISIBILITY_RANK[b];
}

export type EmbedAudienceVerdict = "ok" | "warn" | "block";

export type EmbedAudienceReason =
  /** The page is open to anyone with the link and the source isn't. */
  | "public-page"
  /** The page reaches more people than the source does. */
  | "wider"
  /** The source app wouldn't say who can open the source. */
  | "unknown-source";

export interface EmbedAudienceCheck {
  verdict: EmbedAudienceVerdict;
  reason: EmbedAudienceReason | null;
}

/**
 * Checks one embedded copy against the page's audience.
 *
 * - `insert`: adding the copy to a page. A page anyone with the link can open
 *   only takes copies of sources that open as widely, because pasting is
 *   quick and easy to do without noticing the page is public. A page shared
 *   more widely than the source otherwise warns, and the author can go ahead.
 * - `widen`: about to share the page (or a page holding the copy) with
 *   `page`. Publishing is a deliberate step, so it warns rather than blocks.
 *
 * `strict` copies (rows about named customers, such as tables) never go
 * wider than their source: every warning becomes a block. A source whose
 * sharing is unknown counts as narrower than any shared page.
 */
export function checkEmbedAudience(args: {
  action: "insert" | "widen";
  page: EmbedVisibility;
  source: EmbedVisibility | null;
  strict?: boolean;
}): EmbedAudienceCheck {
  const { action, page, source, strict = false } = args;
  if (page === "private") return { verdict: "ok", reason: null };
  if (source !== null && !isWiderVisibility(page, source)) {
    return { verdict: "ok", reason: null };
  }
  const reason: EmbedAudienceReason =
    source === null ? "unknown-source" : "wider";
  if (action === "insert" && page === "public") {
    return { verdict: "block", reason: "public-page" };
  }
  return { verdict: strict ? "block" : "warn", reason };
}
