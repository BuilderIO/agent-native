import { ActionContractError, defineAction } from "@agent-native/core";
import { isUniqueViolation } from "@agent-native/core/db";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { accessFilter, currentAccess } from "@agent-native/core/sharing";
import { and, eq, isNull, max, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertEditionsLabEnabled } from "../server/lib/editions-lab.js";
import {
  requirePlanOwnerEmailForWrite,
  resolvePlanAccessContext,
  resolvePlanOrgIdForWrite,
} from "../server/lib/local-identity.js";
import { runWithPlanOrgContext } from "../server/lib/plan-org-context.js";
import { newId, nowIso, planDeepLink, planPath } from "../server/plans.js";
import { editionDateKey } from "../shared/edition.js";

const LABEL = "Creating an edition";

/** `null` is a stat that could not be resolved; `0` is a real zero. */
const statSchema = z.number().int().nullable().optional();

/**
 * Stored link targets are rendered straight into reader anchors, and React
 * does not refuse a `javascript:` href — only the scheme check does.
 */
function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
    // coercion-ok: a value that is not a URL at all is not an http(s) one.
  } catch {
    return false;
  }
}

const linkUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine(isHttpUrl, "must be an http(s) URL");

const recapRefSchema = z.object({
  recapId: z.string().trim().min(1).optional(),
  repo: z.string().trim().min(1),
  prNumber: z.coerce.number().int().positive(),
  prUrl: linkUrlSchema,
  authorLogin: z.string().trim().optional(),
  filesChanged: statSchema,
  additions: statSchema,
  deletions: statSchema,
  blockIds: z.array(z.string().trim().min(1)).max(12).optional(),
});

const cohortSchema = z.object({
  name: z.string().trim().min(1).max(80),
  sentence: z.string().trim().min(1).max(400),
  prNumbers: z.array(z.coerce.number().int().positive()).min(1).max(60),
  repos: z.array(z.string().trim().min(1)).max(20).default([]),
  additions: statSchema,
  deletions: statSchema,
  mechanical: z.boolean().optional(),
});

const storySchema = z.object({
  storyId: z.string().trim().min(1).max(120),
  headline: z.string().trim().min(1).max(200),
  dek: z.string().trim().max(600).default(""),
  tags: z.array(z.string().trim().min(1).max(60)).max(8).default([]),
  lead: z.boolean().default(false),
  recaps: z.array(recapRefSchema).min(1).max(60),
  // 2-4 named sub-themes replace one row per pull request. Optional: a story
  // small enough to need no grouping simply has none.
  cohorts: z.array(cohortSchema).max(8).default([]),
  whatShipped: z.string().trim().max(8_000).optional(),
  why: z.string().trim().max(8_000).optional(),
  howItWorks: z.string().trim().max(8_000).optional(),
});

const coveragePrSchema = z.object({
  repo: z.string().trim().min(1),
  prNumber: z.coerce.number().int().positive(),
  title: z.string().trim().min(1),
  url: linkUrlSchema,
});

const coverageSchema = z.object({
  mergedPrCount: z.coerce.number().int().min(0),
  recapCount: z.coerce.number().int().min(0),
  missingPrs: z.array(coveragePrSchema).max(500).default([]),
  stalePrs: z.array(coveragePrSchema).max(500).default([]),
  reposCovered: z.array(z.string().trim().min(1)).max(100).default([]),
  commitCount: statSchema,
});

export default defineAction({
  description:
    "Publish one edition of the engineering newspaper for a time window, replacing the existing edition for the same window if it was already written. Call this EXACTLY ONCE per edition with every story in the same call — do not create an empty edition and append stories, because a retried background run would leave a half-written paper. Call list-edition-candidates first.",
  schema: z.object({
    title: z.string().trim().min(1).max(200),
    brief: z.string().trim().min(1).max(1_000),
    windowStart: z.string().datetime(),
    windowEnd: z.string().datetime(),
    series: z
      .string()
      .trim()
      .regex(
        /^[a-z0-9][a-z0-9-]{0,39}$/,
        "series must be a lowercase slug, e.g. daily or internal-weekly",
      )
      .optional()
      .default("daily")
      .describe(
        "Which recurring edition this issue belongs to. Editions in different series never replace each other, so a per-repo or per-team edition can cover the same day as the org-wide one.",
      ),
    timezone: z
      .string()
      .trim()
      .min(1)
      .describe(
        "IANA zone the window's day key is read in, e.g. Europe/Amsterdam.",
      ),
    stories: z.array(storySchema).min(1).max(60),
    coverage: coverageSchema.optional(),
    notes: z
      .string()
      .trim()
      .max(2_000)
      .optional()
      .describe(
        "The day's through-line: what connects the stories and what to read sceptically. Rendered in the rail, once per edition.",
      ),
    visibility: z.enum(["private", "org"]).optional().default("org"),
  }),
  run: async (args) =>
    runWithPlanOrgContext(args.visibility, LABEL, async () => {
      await assertEditionsLabEnabled();
      if (args.windowEnd <= args.windowStart) {
        throw new ActionContractError(
          `windowEnd (${args.windowEnd}) must be after windowStart (${args.windowStart}).`,
          { errorCode: "invalid-window", statusCode: 400 },
        );
      }
      const db = getDb();
      const requesterEmail = getRequestUserEmail();
      const ownerEmail = requirePlanOwnerEmailForWrite(requesterEmail, LABEL);
      const orgId = resolvePlanOrgIdForWrite(requesterEmail, getRequestOrgId());
      const series = args.series;
      // `coalesce(...)` on both sides: rows written before series existed have
      // NULL, and the unique index treats those as `daily`. A plain equality
      // check would miss them, then the index would reject the insert.
      const seriesMatches = sql`coalesce(${schema.plans.editionSeries}, 'daily') = ${series}`;
      const dateKey = editionDateKey(
        args.windowStart,
        args.windowEnd,
        args.timezone,
      );
      const now = nowIso();

      const findExistingEdition = async (): Promise<
        { id: string; issueNumber: number | null } | undefined
      > => {
        const [row] = await db
          .select({
            id: schema.plans.id,
            issueNumber: schema.plans.editionIssueNumber,
          })
          .from(schema.plans)
          .where(
            and(
              accessFilter(
                schema.plans,
                schema.planShares,
                resolvePlanAccessContext(currentAccess()),
              ),
              eq(schema.plans.kind, "edition"),
              eq(schema.plans.editionDateKey, dateKey),
              seriesMatches,
              eq(schema.plans.ownerEmail, ownerEmail),
              orgId
                ? eq(schema.plans.orgId, orgId)
                : isNull(schema.plans.orgId),
            ),
          )
          .limit(1);
        return row ? { id: row.id, issueNumber: row.issueNumber } : undefined;
      };

      /**
       * Issue numbers run per owner/org so an edition is citable as "No. 214".
       * A replaced edition keeps the number it was first published with.
       */
      const nextIssueNumber = async (): Promise<number> => {
        const [row] = await db
          .select({ highest: max(schema.plans.editionIssueNumber) })
          .from(schema.plans)
          .where(
            and(
              eq(schema.plans.kind, "edition"),
              seriesMatches,
              eq(schema.plans.ownerEmail, ownerEmail),
              orgId
                ? eq(schema.plans.orgId, orgId)
                : isNull(schema.plans.orgId),
            ),
          );
        return (row?.highest ?? 0) + 1;
      };

      const row = {
        title: args.title,
        brief: args.brief,
        kind: "edition" as const,
        status: "complete" as const,
        source: "imported" as const,
        currentFocus: "edition",
        markdown: renderEditionMarkdown(args.title, args.brief, args.stories),
        editionDateKey: dateKey,
        editionWindowStart: args.windowStart,
        editionWindowEnd: args.windowEnd,
        editionTimezone: args.timezone,
        editionSeries: series,
        editionNotes: args.notes ?? null,
        editionCoverageJson: args.coverage
          ? JSON.stringify(args.coverage)
          : null,
        updatedAt: now,
      };

      const publish = async (
        existing: { id: string; issueNumber: number | null } | undefined,
      ) => {
        const existingId = existing?.id;
        const editionId = existingId ?? newId("edition");
        const issueNumber = existing?.issueNumber ?? (await nextIssueNumber());
        const storyRows = args.stories.map((story, index) => ({
          id: newId("edstory"),
          editionId,
          storyId: story.storyId,
          order: index,
          isLead: story.lead,
          headline: story.headline,
          dek: story.dek,
          tagsJson: JSON.stringify(story.tags),
          recapsJson: JSON.stringify(story.recaps),
          cohortsJson: JSON.stringify(story.cohorts),
          whatShipped: story.whatShipped ?? null,
          why: story.why ?? null,
          howItWorks: story.howItWorks ?? null,
          createdAt: now,
        }));

        await db.transaction(async (tx) => {
          if (existingId) {
            await tx
              .update(schema.plans)
              // The issue number is written on replace too: an edition
              // published before issue numbers existed has NULL here, and a
              // reader that shows "No. —" is worse than one that backfills.
              // Visibility likewise: leaving it alone silently keeps the first
              // publish's audience for every later one.
              .set({
                ...row,
                editionIssueNumber: issueNumber,
                visibility: args.visibility,
              })
              .where(eq(schema.plans.id, editionId));
            await tx
              .delete(schema.planEditionStories)
              .where(eq(schema.planEditionStories.editionId, editionId));
          } else {
            await tx.insert(schema.plans).values({
              ...row,
              editionIssueNumber: issueNumber,
              id: editionId,
              createdAt: now,
              ownerEmail,
              ...(orgId ? { orgId } : {}),
              visibility: args.visibility,
            });
          }
          await tx.insert(schema.planEditionStories).values(storyRows);
        });

        // Re-read rather than trusting the write: a background continuation
        // that replays this action must be able to prove the stories landed.
        const persisted = await db
          .select({ id: schema.planEditionStories.id })
          .from(schema.planEditionStories)
          .where(eq(schema.planEditionStories.editionId, editionId));
        if (persisted.length !== storyRows.length) {
          throw new ActionContractError(
            `Edition ${editionId} persisted ${persisted.length} of ${storyRows.length} stories; treat this edition as incomplete.`,
            {
              errorCode: "edition-stories-incomplete",
              details: {
                editionId,
                persisted: persisted.length,
                expected: storyRows.length,
              },
            },
          );
        }

        return {
          editionId,
          issueNumber,
          series,
          dateKey,
          replaced: Boolean(existingId),
          storyCount: storyRows.length,
          leadCount: storyRows.filter((story) => story.isLead).length,
          missingPrCount: args.coverage?.missingPrs.length ?? null,
          url: planPath(editionId, "edition"),
        };
      };

      const existing = await findExistingEdition();
      try {
        return await publish(existing);
      } catch (error) {
        // Two schedulers publishing the same window both read "no edition yet";
        // the partial unique index lets exactly one insert win. The loser must
        // adopt the winner's row, or a retried run reports failure for an
        // edition that exists and is complete.
        if (existing) throw error;
        const raced = await findExistingEdition();
        if (raced) return await publish(raced);
        // Or a publish for a DIFFERENT window took the issue number this one
        // allocated. Nothing to adopt — re-read the high-water mark, which now
        // includes the winner, and take the next one.
        if (isUniqueViolation(error)) return await publish(undefined);
        throw error;
      }
    }),
  link: ({ result }) => {
    const editionId = (result as { editionId?: string } | null)?.editionId;
    if (!editionId) return null;
    return {
      url: planDeepLink(editionId, "edition"),
      label: "Open Edition",
      view: "plan",
    };
  },
});

function renderEditionMarkdown(
  title: string,
  brief: string,
  stories: z.infer<typeof storySchema>[],
): string {
  const parts = [`# ${title}`, "", brief, ""];
  for (const story of stories) {
    parts.push(`## ${story.headline}`, "");
    if (story.dek) parts.push(story.dek, "");
    const refs = story.recaps
      .map((recap) => `${recap.repo}#${recap.prNumber}`)
      .join(", ");
    parts.push(`Sources: ${refs}`, "");
    for (const [heading, body] of [
      ["What shipped", story.whatShipped],
      ["Why", story.why],
      ["How it works", story.howItWorks],
    ] as const) {
      if (body) parts.push(`### ${heading}`, "", body, "");
    }
  }
  return parts.join("\n");
}
