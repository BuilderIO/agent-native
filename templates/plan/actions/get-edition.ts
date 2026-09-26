import { ActionContractError, defineAction } from "@agent-native/core";
import {
  accessFilter,
  assertAccess,
  currentAccess,
} from "@agent-native/core/sharing";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertEditionsLabEnabled } from "../server/lib/editions-lab.js";
import { resolvePlanAccessContext } from "../server/lib/local-identity.js";
import { parsePlanContent } from "../server/plan-content.js";
import { planDeepLink, planPath } from "../server/plans.js";
import type {
  EditionCoverageData,
  EditionStoryBlock,
  EditionStoryCohort,
  EditionStoryData,
  EditionStoryRecapRef,
} from "../shared/edition.js";
import type { PlanBlock } from "../shared/plan-content.js";

/**
 * These columns are written by create-edition, so malformed JSON is a bug in
 * this app rather than untrusted input. Throwing keeps a corrupt story out of
 * the paper instead of rendering it as an empty one.
 */
function parseJsonColumn<T>(
  raw: string | null,
  column: string,
  fallback: T,
): T {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(
      `Edition column ${column} holds invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Index every block in a recap by id, including the ones nested inside `tabs`
 * and `columns` — a recap's most useful diff usually lives inside a tab, so a
 * top-level-only lookup would find almost nothing worth showing.
 */
function indexBlocksById(
  blocks: PlanBlock[] | undefined,
  into: Map<string, PlanBlock>,
): void {
  for (const block of blocks ?? []) {
    into.set(block.id, block);
    const data = (block as { data?: Record<string, unknown> }).data;
    for (const tab of (data?.tabs as { blocks?: PlanBlock[] }[]) ?? [])
      indexBlocksById(tab.blocks, into);
    for (const column of (data?.columns as { blocks?: PlanBlock[] }[]) ?? [])
      indexBlocksById(column.blocks, into);
  }
}

/**
 * Resolve the `blockIds` a story cites into the recaps' live blocks, in one
 * access-filtered batch. Blocks are referenced rather than copied, so an
 * edition can never show a diagram the recap has since corrected — and a
 * reference that no longer resolves is counted, not quietly dropped.
 */
async function resolveStoryBlocks(stories: EditionStoryData[]): Promise<{
  blocksByStory: Map<string, EditionStoryBlock[]>;
  unresolved: number;
  /**
   * Cited recaps that exist and are live but are NOT this viewer's to read. An
   * edition is shared more widely than the recaps it cites, and a reference
   * carries the recap's repo, PR, author and diff stats, so the reference is
   * itself a disclosure. A recap that is gone or soft-deleted is not in here:
   * nothing is disclosed by citing it, and dropping it would lose a pull
   * request the story really did cover.
   */
  hiddenRecapIds: Set<string>;
}> {
  const cited = new Set<string>();
  const wanted = new Map<string, Set<string>>();
  for (const story of stories)
    for (const recap of story.recaps) {
      if (!recap.recapId) continue;
      cited.add(recap.recapId);
      if (!recap.blockIds?.length) continue;
      const set = wanted.get(recap.recapId) ?? new Set<string>();
      for (const id of recap.blockIds) set.add(id);
      wanted.set(recap.recapId, set);
    }
  if (cited.size === 0)
    return {
      blocksByStory: new Map(),
      unresolved: 0,
      hiddenRecapIds: new Set(),
    };

  const rows = await getDb()
    .select({ id: schema.plans.id, content: schema.plans.content })
    .from(schema.plans)
    .where(
      and(
        accessFilter(
          schema.plans,
          schema.planShares,
          resolvePlanAccessContext(currentAccess()),
        ),
        isNull(schema.plans.deletedAt),
        eq(schema.plans.kind, "recap"),
        inArray(schema.plans.id, [...cited]),
      ),
    );

  const live = await getDb()
    .select({ id: schema.plans.id })
    .from(schema.plans)
    .where(
      and(
        isNull(schema.plans.deletedAt),
        eq(schema.plans.kind, "recap"),
        inArray(schema.plans.id, [...cited]),
      ),
    );

  const readable = new Set(rows.map((row) => row.id));
  const hiddenRecapIds = new Set(
    live.map((row) => row.id).filter((id) => !readable.has(id)),
  );
  const byRecap = new Map<string, Map<string, PlanBlock>>();
  for (const row of rows) {
    if (!wanted.has(row.id)) continue;
    const index = new Map<string, PlanBlock>();
    indexBlocksById(parsePlanContent(row.content)?.blocks, index);
    byRecap.set(row.id, index);
  }

  const blocksByStory = new Map<string, EditionStoryBlock[]>();
  let unresolved = 0;
  for (const story of stories) {
    const picked: EditionStoryBlock[] = [];
    for (const recap of story.recaps)
      for (const id of recap.recapId ? (recap.blockIds ?? []) : []) {
        const recapId = recap.recapId as string;
        const block = byRecap.get(recapId)?.get(id);
        if (block) picked.push({ recapId, block });
        else unresolved += 1;
      }
    if (picked.length > 0) blocksByStory.set(story.storyId, picked);
  }
  return { blocksByStory, unresolved, hiddenRecapIds };
}

export default defineAction({
  description:
    "Read one edition of the engineering newspaper: its window, its stories in reading order, and the coverage note saying which merged PRs had no recap.",
  schema: z.object({ id: z.string().trim().min(1) }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Get Edition",
    description:
      "Read one edition of the engineering newspaper: its stories and its coverage note.",
  },
  link: ({ args }) => ({
    url: planDeepLink(String((args as { id: string }).id), "edition"),
    label: "Open Edition",
    view: "plan",
  }),
  run: async (args) => {
    await assertEditionsLabEnabled();
    const { resource } = await assertAccess(
      "plan",
      args.id,
      "viewer",
      resolvePlanAccessContext(currentAccess()),
    );
    const edition = resource as {
      id: string;
      kind: string;
      title: string;
      brief: string;
      editionDateKey: string | null;
      editionWindowStart: string | null;
      editionWindowEnd: string | null;
      editionTimezone: string | null;
      editionCoverageJson: string | null;
      editionIssueNumber: number | null;
      editionSeries: string | null;
      editionNotes: string | null;
      updatedAt: string;
    };
    if (edition.kind !== "edition") {
      throw new ActionContractError(
        `${args.id} is a ${edition.kind}, not an edition. Use get-visual-plan for plans and recaps.`,
        { errorCode: "wrong-plan-kind", statusCode: 400 },
      );
    }

    const rows = await getDb()
      .select({
        storyId: schema.planEditionStories.storyId,
        isLead: schema.planEditionStories.isLead,
        headline: schema.planEditionStories.headline,
        dek: schema.planEditionStories.dek,
        tagsJson: schema.planEditionStories.tagsJson,
        recapsJson: schema.planEditionStories.recapsJson,
        cohortsJson: schema.planEditionStories.cohortsJson,
        whatShipped: schema.planEditionStories.whatShipped,
        why: schema.planEditionStories.why,
        howItWorks: schema.planEditionStories.howItWorks,
      })
      .from(schema.planEditionStories)
      .where(eq(schema.planEditionStories.editionId, args.id))
      .orderBy(asc(schema.planEditionStories.order));

    const stories: EditionStoryData[] = rows.map((row) => ({
      storyId: row.storyId,
      headline: row.headline,
      dek: row.dek,
      tags: parseJsonColumn<string[]>(row.tagsJson, "tags_json", []),
      lead: row.isLead,
      recaps: parseJsonColumn<EditionStoryRecapRef[]>(
        row.recapsJson,
        "recaps_json",
        [],
      ),
      cohorts: parseJsonColumn<EditionStoryCohort[]>(
        row.cohortsJson,
        "cohorts_json",
        [],
      ),
      ...(row.whatShipped ? { whatShipped: row.whatShipped } : {}),
      ...(row.why ? { why: row.why } : {}),
      ...(row.howItWorks ? { howItWorks: row.howItWorks } : {}),
    }));

    const { blocksByStory, unresolved, hiddenRecapIds } =
      await resolveStoryBlocks(stories);

    return {
      unresolvedBlockRefs: unresolved,
      edition: {
        id: edition.id,
        title: edition.title,
        brief: edition.brief,
        issueNumber: edition.editionIssueNumber,
        series: edition.editionSeries ?? "daily",
        notes: edition.editionNotes,
        dateKey: edition.editionDateKey,
        windowStart: edition.editionWindowStart,
        windowEnd: edition.editionWindowEnd,
        timezone: edition.editionTimezone,
        updatedAt: edition.updatedAt,
        url: planPath(edition.id, "edition"),
      },
      stories: stories.map((story) => ({
        ...story,
        // Dropped, not redacted: an entry with no diff and no link reads as a
        // recap that failed rather than one that was never theirs to see.
        recaps: story.recaps.filter(
          (recap) => !recap.recapId || !hiddenRecapIds.has(recap.recapId),
        ),
        blocks: blocksByStory.get(story.storyId) ?? [],
      })),
      coverage: parseJsonColumn<EditionCoverageData | null>(
        edition.editionCoverageJson,
        "edition_coverage_json",
        null,
      ),
    };
  },
});
