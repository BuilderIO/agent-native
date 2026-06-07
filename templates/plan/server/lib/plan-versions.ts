import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import { parsePlanContent } from "../plan-content.js";
import type {
  Plan,
  PlanAuthor,
  PlanSection,
  PlanVersionSnapshot,
  PlanVersionSummary,
} from "../../shared/types.js";

const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

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
  const snapshotJson = JSON.stringify(snapshotFromRows(plan, sections));

  const [latestVersion] = await db
    .select({
      snapshotJson: schema.planVersions.snapshotJson,
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

  if (latestVersion?.snapshotJson === snapshotJson) {
    return { created: false, reason: "duplicate" };
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
  });

  return { created: true, id };
}
