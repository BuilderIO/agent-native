/**
 * Whether a screen has been *rendered* clean, as opposed to parsed clean.
 *
 * Static checks cap out at syntax: `x-show="opne"` parses, compiles, and shows
 * nothing. Only a browser settles that, so "verified" is stored as a fact keyed
 * to the exact content that passed — never as a claim a caller can assert.
 */

export type RenderVerificationStatus = "pass" | "fail" | "unavailable";

export type RenderFindingKind =
  | "page-error"
  | "console-error"
  | "alpine-expression"
  | "runtime-inert"
  | "blocked-request";

export interface RenderFinding {
  kind: RenderFindingKind;
  message: string;
  /** Which rendered width produced it, when the run covered several. */
  viewport?: string;
}

/** The persisted columns, as read off a `design_files` row. */
export interface RenderVerificationRow {
  verifiedRenderHash?: string | null;
  verifiedRenderStatus?: string | null;
  verifiedRenderAt?: string | null;
  verifiedRenderFindings?: string | null;
}

export type RenderVerificationState =
  | { state: "verified"; at: string }
  | { state: "failed"; at: string; findings: RenderFinding[] }
  | { state: "unavailable"; at: string; reason: string }
  | { state: "stale" }
  | { state: "never" };

function parseFindings(raw: string | null | undefined): RenderFinding[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is RenderFinding =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as RenderFinding).message === "string",
    );
  } catch {
    // A findings blob we cannot read is not an absence of findings, but the
    // state is already `failed` by the time this is called, so the caller is
    // told the truth either way.
    return [];
  }
}

/**
 * A stamp for different content proves nothing about this content, so the hash
 * is compared before the status is trusted. `unavailable` (no browser on this
 * host) must never collapse into `verified` — that is the whole point of the
 * separate state.
 */
export function resolveRenderVerification(args: {
  contentHash: string;
  row: RenderVerificationRow;
}): RenderVerificationState {
  const { contentHash, row } = args;
  if (!row.verifiedRenderHash || !row.verifiedRenderStatus) {
    return { state: "never" };
  }
  if (row.verifiedRenderHash !== contentHash) return { state: "stale" };

  const at = row.verifiedRenderAt ?? "";
  if (row.verifiedRenderStatus === "pass") return { state: "verified", at };
  if (row.verifiedRenderStatus === "unavailable") {
    return {
      state: "unavailable",
      at,
      reason:
        parseFindings(row.verifiedRenderFindings)[0]?.message ??
        "no browser was available to render this screen",
    };
  }
  if (row.verifiedRenderStatus === "fail") {
    return {
      state: "failed",
      at,
      findings: parseFindings(row.verifiedRenderFindings),
    };
  }
  // An unrecognized status is not a pass.
  return { state: "stale" };
}

/** Only a current, passing render may be reported as ready to a human. */
export function isRenderVerified(state: RenderVerificationState): boolean {
  return state.state === "verified";
}

export function describeRenderVerification(
  state: RenderVerificationState,
): string {
  switch (state.state) {
    case "verified":
      return `rendered clean in a real browser at ${state.at}`;
    case "failed":
      return (
        `the last render of this exact content failed with ` +
        `${state.findings.length} finding(s): ` +
        state.findings
          .slice(0, 3)
          .map((finding) => `${finding.kind}: ${finding.message}`)
          .join("; ")
      );
    case "unavailable":
      return `never rendered — ${state.reason}. This is not a pass; treat the screen as unverified.`;
    case "stale":
      return "the content changed since the last render; re-verify before calling it ready";
    case "never":
      return "this screen has never been rendered in a browser";
  }
}
