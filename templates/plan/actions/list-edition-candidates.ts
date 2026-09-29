import { ActionContractError, defineAction } from "@agent-native/core";
import { accessFilter, currentAccess } from "@agent-native/core/sharing";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertEditionsLabEnabled } from "../server/lib/editions-lab.js";
import { resolvePlanAccessContext } from "../server/lib/local-identity.js";
import { planPath } from "../server/plans.js";
import type { EditionCoverageData } from "../shared/edition.js";

/**
 * A recap row is only usable as a candidate when it can be attributed to a
 * merged PR. `sourcePrMergedAt` is written ONLY on the merge-close CI run, and
 * fork recaps never get one at all, so the window has to fall back to
 * `updatedAt` the same way search-pr-recaps does.
 */
const MERGED_AT = sql`coalesce(${schema.plans.sourcePrMergedAt}, ${schema.plans.updatedAt})`;

const ledgerEntrySchema = z.object({
  repo: z.string().trim().min(1),
  prNumber: z.coerce.number().int().positive(),
  title: z.string().trim().min(1),
  url: z.string().trim().min(1),
  authorLogin: z.string().trim().optional(),
});

function briefSnippet(value: string | null | undefined, max = 400): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length <= max
    ? normalized
    : `${normalized.slice(0, max - 3)}...`;
}

export default defineAction({
  description:
    "Select the merged PR recaps that an edition (engineering newspaper) should be written from, for one time window. Returns compact candidates — never full recap bodies — plus a coverage report when a GitHub merged-PR ledger is supplied. Call this before create-edition. `mergedPrLedger` is optional and only feeds the coverage note; omit it unless you already have GitHub access in this session, because Plan exposes no provider-api action to fetch one with.",
  schema: z.object({
    windowStart: z
      .string()
      .datetime()
      .describe("ISO start of the window, inclusive."),
    windowEnd: z
      .string()
      .datetime()
      .describe("ISO end of the window, exclusive."),
    repos: z
      .array(z.string().trim().min(1))
      .optional()
      .describe("Restrict to these `owner/name` repos. Omit for all visible."),
    limit: z.coerce.number().int().positive().max(200).optional().default(80),
    mergedPrLedger: z
      .array(ledgerEntrySchema)
      .max(500)
      .optional()
      .describe(
        "Merged PRs in the same window from the git provider, used to compute coverage. Omit and coverage is reported as unknown rather than guessed.",
      ),
  }),
  // POST, not GET: a window's merged-PR ledger can carry hundreds of entries,
  // which does not fit a query string. `readOnly` still tells callers it never
  // mutates.
  readOnly: true,
  run: async (args) => {
    await assertEditionsLabEnabled();
    if (args.windowEnd <= args.windowStart) {
      throw new ActionContractError(
        `windowEnd (${args.windowEnd}) must be after windowStart (${args.windowStart}).`,
        { errorCode: "invalid-window", statusCode: 400 },
      );
    }
    const db = getDb();
    const accessWhere = accessFilter(
      schema.plans,
      schema.planShares,
      resolvePlanAccessContext(currentAccess()),
    );
    const recapScope = [
      accessWhere,
      isNull(schema.plans.deletedAt),
      eq(schema.plans.kind, "recap"),
    ];

    const rows = await db
      .select({
        id: schema.plans.id,
        title: schema.plans.title,
        brief: schema.plans.brief,
        repo: schema.plans.sourceRepo,
        prNumber: schema.plans.sourcePrNumber,
        prState: schema.plans.sourcePrState,
        mergedAt: schema.plans.sourcePrMergedAt,
        updatedAt: schema.plans.updatedAt,
        sourceUrl: schema.plans.sourceUrl,
        authorLogin: schema.plans.sourceAuthorLogin,
        currentFocus: schema.plans.currentFocus,
      })
      .from(schema.plans)
      .where(
        and(
          ...recapScope,
          or(
            eq(schema.plans.sourceType, "pull-request"),
            sql`${schema.plans.sourceUrl} like ${"%github.com/%/pull/%"}`,
          ),
          or(
            eq(schema.plans.sourcePrState, "merged"),
            isNotNull(schema.plans.sourcePrMergedAt),
          ),
          sql`${MERGED_AT} >= ${args.windowStart}`,
          sql`${MERGED_AT} < ${args.windowEnd}`,
          // In SQL, not over `rows`: filtering after `.limit()` lets recaps
          // from unrelated repos spend the limit and reports a repo that did
          // ship as a quiet window.
          ...(args.repos?.length
            ? [inArray(schema.plans.sourceRepo, args.repos)]
            : []),
        ),
      )
      .orderBy(desc(MERGED_AT))
      .limit(args.limit);

    const candidates = rows.map((row) => ({
      recapId: row.id,
      title: row.title,
      brief: briefSnippet(row.brief),
      repo: row.repo ?? "",
      prNumber: row.prNumber,
      prUrl: row.sourceUrl ?? "",
      authorLogin: row.authorLogin ?? undefined,
      mergedAt: row.mergedAt ?? row.updatedAt,
      mergedAtIsExact: row.mergedAt !== null,
      recapUrl: planPath(row.id, "recap"),
    }));

    // An empty candidate list has two completely different causes, and an
    // edition written from the wrong one is a confident lie. "No recaps are
    // readable at all" is a misconfiguration (usually the caller's active org
    // is not the org that owns the CI-published recaps, because accessFilter
    // matches the ACTIVE org while a single-row read matches org membership) —
    // so it throws. A genuinely quiet window returns normally.
    if (candidates.length === 0) {
      const [anyRecap] = await db
        .select({ id: schema.plans.id })
        .from(schema.plans)
        .where(and(...recapScope))
        .limit(1);
      if (!anyRecap) {
        // ActionContractError, not a bare Error: the framework keeps a bare
        // throw as an opaque 500, which would hand the caller back exactly the
        // ambiguity this check exists to remove.
        throw new ActionContractError(
          "No PR recaps are readable in this access scope, so a quiet window cannot be distinguished from an unreadable one. Check that the caller's active organization owns the CI-published recaps before writing an edition.",
          {
            errorCode: "recaps-unreadable",
            details: {
              windowStart: args.windowStart,
              windowEnd: args.windowEnd,
            },
          },
        );
      }
    }

    let coverage: EditionCoverageData | null = null;
    if (args.mergedPrLedger) {
      const uncovered = uncoveredLedgerEntries(args.mergedPrLedger, candidates);
      // Queried here rather than inside the helper so the access scope is
      // visible at the query site: an uncovered PR is not automatically
      // un-recapped, and the (repo, PR) pair CI always sets is indexed by
      // `plans_source_pr_idx`.
      const staleKeys = new Set<string>();
      if (uncovered.length > 0) {
        const staleRows = await db
          .select({
            repo: schema.plans.sourceRepo,
            prNumber: schema.plans.sourcePrNumber,
          })
          .from(schema.plans)
          .where(
            and(
              accessWhere,
              isNull(schema.plans.deletedAt),
              eq(schema.plans.kind, "recap"),
              inArray(
                schema.plans.sourceRepo,
                Array.from(new Set(uncovered.map((entry) => entry.repo))),
              ),
              inArray(
                schema.plans.sourcePrNumber,
                Array.from(new Set(uncovered.map((entry) => entry.prNumber))),
              ),
            ),
          );
        for (const row of staleRows)
          if (row.repo && row.prNumber !== null)
            staleKeys.add(coverageKey(row.repo, row.prNumber));
      }
      coverage = buildCoverage(args.mergedPrLedger, uncovered, staleKeys);
    }

    return {
      status:
        candidates.length > 0 ? ("ok" as const) : ("empty-window" as const),
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
      candidateCount: candidates.length,
      candidates,
      coverage,
      coverageKnown: coverage !== null,
      guidance:
        coverage === null
          ? "Coverage is unknown because no mergedPrLedger was supplied. Pass one so the edition can name the PRs that shipped without a recap."
          : `${coverage.recapCount} of ${coverage.mergedPrCount} merged PRs have an in-window recap. ${coverage.missingPrs.length} have no recap and ${coverage.stalePrs.length} have a recap that was never re-published at merge; list both in the edition's coverage note rather than implying the recaps were the whole window.`,
    };
  },
});

function coverageKey(repo: string, prNumber: number): string {
  return `${repo}#${prNumber}`;
}

/** Ledger entries with no in-window, merge-proven recap among the candidates. */
function uncoveredLedgerEntries(
  ledger: z.infer<typeof ledgerEntrySchema>[],
  candidates: { repo: string; prNumber: number | null }[],
): z.infer<typeof ledgerEntrySchema>[] {
  const covered = new Set(
    candidates
      .filter((candidate) => candidate.prNumber !== null)
      .map((candidate) =>
        coverageKey(candidate.repo, candidate.prNumber as number),
      ),
  );
  return ledger.filter(
    (entry) => !covered.has(coverageKey(entry.repo, entry.prNumber)),
  );
}

/**
 * Split the ledger three ways. "Has a recap that was never re-published at
 * merge" is a different gap from "has no recap at all": the first is readable
 * content with a missing stamp, and reporting it as missing sends a reader to
 * read a diff by hand while a recap sits right there.
 */
function buildCoverage(
  ledger: z.infer<typeof ledgerEntrySchema>[],
  uncovered: z.infer<typeof ledgerEntrySchema>[],
  staleKeys: Set<string>,
): EditionCoverageData {
  const toEntry = (entry: z.infer<typeof ledgerEntrySchema>) => ({
    repo: entry.repo,
    prNumber: entry.prNumber,
    title: entry.title,
    url: entry.url,
  });
  const stalePrs = uncovered
    .filter((entry) => staleKeys.has(coverageKey(entry.repo, entry.prNumber)))
    .map(toEntry);
  const missingPrs = uncovered
    .filter((entry) => !staleKeys.has(coverageKey(entry.repo, entry.prNumber)))
    .map(toEntry);

  return {
    mergedPrCount: ledger.length,
    recapCount: ledger.length - uncovered.length,
    missingPrs,
    stalePrs,
    reposCovered: [...new Set(ledger.map((entry) => entry.repo))].sort(),
  };
}
