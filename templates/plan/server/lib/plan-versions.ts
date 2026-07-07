import { and, asc, desc, eq } from "drizzle-orm";

import type {
  Plan,
  PlanAuthor,
  PlanSection,
  PlanVersionSnapshot,
  PlanVersionSummary,
} from "../../shared/types.js";
import { getDb, schema } from "../db/index.js";
import { parsePlanContent } from "../plan-content.js";

const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * When `force: true` is set and the latest version for this plan carries the
 * exact same label and was created within this window, we coalesce rather than
 * append a new identical-label row.  The earliest snapshot of a burst already
 * captures the pre-burst state, which is the meaningful restore point.
 * A different label, or a gap longer than this window, always starts a new row.
 */
const BURST_COALESCE_WINDOW_MS = 90 * 1000; // 90 seconds

function canCoalesceBurstLabel(label: string | undefined): label is string {
  return label !== undefined && !label.startsWith("Before ");
}

type PlanRow = typeof schema.plans.$inferSelect;
type SectionRow = typeof schema.planSections.$inferSelect;
type VersionRow = typeof schema.planVersions.$inferSelect;

function newVersionId(): string {
  return `pver_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function sectionFromRow(row: SectionRow): PlanSection {
  return {
    id: row.id,
    planId: row.planId,
    type: row.type,
    title: row.title,
    body: row.body,
    html: row.html,
    order: row.order,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function snapshotFromRows(
  plan: PlanRow,
  sections: SectionRow[],
): PlanVersionSnapshot {
  return {
    plan: {
      title: plan.title,
      brief: plan.brief,
      status: plan.status,
      source: plan.source,
      repoPath: plan.repoPath,
      currentFocus: plan.currentFocus,
      html: plan.html,
      markdown: plan.markdown,
      content: parsePlanContent(plan.content),
      approvedAt: plan.approvedAt,
    },
    sections: sections.map(sectionFromRow),
  };
}

export function parsePlanVersionSnapshot(value: string): PlanVersionSnapshot {
  const parsed = JSON.parse(value) as PlanVersionSnapshot;
  return {
    plan: {
      title: parsed.plan.title,
      brief: parsed.plan.brief,
      status: parsed.plan.status,
      source: parsed.plan.source,
      repoPath: parsed.plan.repoPath ?? null,
      currentFocus: parsed.plan.currentFocus ?? null,
      html: parsed.plan.html ?? null,
      markdown: parsed.plan.markdown ?? null,
      content: parsed.plan.content
        ? parsePlanContent(parsed.plan.content)
        : null,
      approvedAt: parsed.plan.approvedAt ?? null,
    },
    sections: Array.isArray(parsed.sections) ? parsed.sections : [],
  };
}

function compactText(value: string, limit = 180) {
  const compacted = value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_`>\-[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return compacted.length > limit
    ? `${compacted.slice(0, limit - 3)}...`
    : compacted;
}

function snapshotPreview(snapshot: PlanVersionSnapshot): string {
  const firstRichText = snapshot.plan.content?.blocks.find(
    (block) => block.type === "rich-text" && block.data.markdown.trim(),
  );
  if (firstRichText?.type === "rich-text") {
    return compactText(firstRichText.data.markdown);
  }
  const firstSection = snapshot.sections.find((section) => section.body.trim());
  return compactText(
    firstSection?.body || snapshot.plan.brief || snapshot.plan.title,
  );
}

function blockCount(snapshot: PlanVersionSnapshot) {
  const countBlocks = (
    blocks: NonNullable<Plan["content"]>["blocks"],
  ): number =>
    blocks.reduce(
      (count, block) =>
        count +
        1 +
        (block.type === "tabs"
          ? block.data.tabs.reduce(
              (tabCount, tab) => tabCount + countBlocks(tab.blocks),
              0,
            )
          : 0),
      0,
    );
  return snapshot.plan.content ? countBlocks(snapshot.plan.content.blocks) : 0;
}

export function summarizePlanVersion(row: VersionRow): PlanVersionSummary {
  const snapshot = parsePlanVersionSnapshot(row.snapshotJson);
  return {
    id: row.id,
    planId: row.planId,
    title: row.title,
    label: row.changeLabel,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    status: snapshot.plan.status,
    source: snapshot.plan.source,
    blockCount: blockCount(snapshot),
    sectionCount: snapshot.sections.length,
    hasCanvas: Boolean(snapshot.plan.content?.canvas),
    hasPrototype: Boolean(snapshot.plan.content?.prototype),
    preview: snapshotPreview(snapshot),
  };
}

/** Derived summary fields computed from a snapshot, stored alongside the row at
 * write time so list reads don't need to parse snapshot_json. */
function summaryColumnsFromSnapshot(snapshot: PlanVersionSnapshot) {
  return {
    status: snapshot.plan.status,
    source: snapshot.plan.source,
    blockCount: blockCount(snapshot),
    sectionCount: snapshot.sections.length,
    hasCanvas: Boolean(snapshot.plan.content?.canvas),
    hasPrototype: Boolean(snapshot.plan.content?.prototype),
    previewText: snapshotPreview(snapshot),
  };
}

/** Row shape needed by `summarizePlanVersionRow`: the small always-selected
 * columns, the denormalized summary columns, and `snapshotJson` only as a
 * fallback for legacy rows (see below). Callers project just this shape
 * instead of the full `VersionRow` in the common case. */
type SummaryRow = Pick<
  VersionRow,
  | "id"
  | "planId"
  | "title"
  | "changeLabel"
  | "createdBy"
  | "createdAt"
  | "status"
  | "source"
  | "blockCount"
  | "sectionCount"
  | "hasCanvas"
  | "hasPrototype"
  | "previewText"
> & { snapshotJson?: string | null };

/**
 * Like `summarizePlanVersion`, but reads the denormalized summary columns
 * instead of parsing `snapshotJson` when they're populated. Only rows written
 * before this column set existed have `blockCount === null`; for those,
 * `snapshotJson` must be provided so this can fall back to the legacy
 * parse-on-read path.
 */
export function summarizePlanVersionRow(row: SummaryRow): PlanVersionSummary {
  const base = {
    id: row.id,
    planId: row.planId,
    title: row.title,
    label: row.changeLabel,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
  if (row.blockCount == null) {
    if (row.snapshotJson == null) {
      throw new Error(
        `Plan version ${row.id} has no summary columns and no snapshotJson to fall back to`,
      );
    }
    const snapshot = parsePlanVersionSnapshot(row.snapshotJson);
    const summary = summaryColumnsFromSnapshot(snapshot);
    return { ...base, ...summary, preview: summary.previewText };
  }
  return {
    ...base,
    status: row.status ?? "draft",
    source: row.source ?? "manual",
    blockCount: row.blockCount,
    sectionCount: row.sectionCount ?? 0,
    hasCanvas: Boolean(row.hasCanvas),
    hasPrototype: Boolean(row.hasPrototype),
    preview: row.previewText ?? "",
  };
}

export async function createPlanVersionSnapshot(
  planId: string,
  options: {
    force?: boolean;
    label?: string;
    createdBy?: PlanAuthor;
  } = {},
): Promise<{ created: boolean; id?: string; reason?: string }> {
  const db = getDb();
  const [plan] = await db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.id, planId))
    .limit(1);
  if (!plan) throw new Error(`Plan ${planId} not found`);
  if (!plan.ownerEmail) {
    throw new Error("Cannot snapshot plan version without an owner email");
  }

  const sections = await db
    .select()
    .from(schema.planSections)
    .where(eq(schema.planSections.planId, planId))
    .orderBy(
      asc(schema.planSections.order),
      asc(schema.planSections.createdAt),
    );
  const snapshot = snapshotFromRows(plan, sections);
  const snapshotJson = JSON.stringify(snapshot);
  const summaryColumns = summaryColumnsFromSnapshot(snapshot);

  const [latestVersion] = await db
    .select({
      snapshotJson: schema.planVersions.snapshotJson,
      changeLabel: schema.planVersions.changeLabel,
      createdAt: schema.planVersions.createdAt,
    })
    .from(schema.planVersions)
    .where(
      and(
        eq(schema.planVersions.planId, planId),
        eq(schema.planVersions.ownerEmail, plan.ownerEmail),
      ),
    )
    .orderBy(desc(schema.planVersions.createdAt))
    .limit(1);

  // Identical-content dedupe: skip regardless of label.
  if (latestVersion?.snapshotJson === snapshotJson) {
    return { created: false, reason: "duplicate" };
  }

  // Burst coalescing: when force is set (inline-edit path) and the latest
  // snapshot for this plan already carries the same label and was written
  // within BURST_COALESCE_WINDOW_MS, skip. The earliest snapshot of the burst
  // already preserves the pre-burst state; appending more identical-label rows
  // floods version history without adding restore value.
  // Explicit safety snapshots ("Before restore", "Before source import", etc.)
  // are never coalesced: they are created before destructive/import/restore
  // operations and are the actual restore point.
  if (
    options.force &&
    canCoalesceBurstLabel(options.label) &&
    latestVersion?.createdAt
  ) {
    const latestAt = new Date(latestVersion.createdAt).getTime();
    if (
      Number.isFinite(latestAt) &&
      Date.now() - latestAt < BURST_COALESCE_WINDOW_MS &&
      latestVersion.changeLabel === options.label
    ) {
      return { created: false, reason: "coalesced" };
    }
  }

  if (!options.force && latestVersion?.createdAt) {
    const latestAt = new Date(latestVersion.createdAt).getTime();
    if (
      Number.isFinite(latestAt) &&
      Date.now() - latestAt < SNAPSHOT_INTERVAL_MS
    ) {
      return { created: false, reason: "interval" };
    }
  }

  const id = newVersionId();
  await db.insert(schema.planVersions).values({
    id,
    ownerEmail: plan.ownerEmail,
    planId,
    title: plan.title,
    snapshotJson,
    changeLabel: options.label,
    createdBy: options.createdBy ?? "agent",
    createdAt: new Date().toISOString(),
    status: summaryColumns.status,
    source: summaryColumns.source,
    blockCount: summaryColumns.blockCount,
    sectionCount: summaryColumns.sectionCount,
    hasCanvas: summaryColumns.hasCanvas,
    hasPrototype: summaryColumns.hasPrototype,
    previewText: summaryColumns.previewText,
  });

  return { created: true, id };
}
