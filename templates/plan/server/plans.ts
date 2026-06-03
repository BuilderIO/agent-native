import { buildDeepLink } from "@agent-native/core/server";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db/index.js";
import {
  PLAN_AUTHORS,
  PLAN_COMMENT_KINDS,
  PLAN_COMMENT_STATUSES,
  PLAN_SECTION_TYPES,
  PLAN_SOURCES,
  PLAN_STATUSES,
  type PlanBundle,
  type PlanComment,
  type PlanEvent,
  type PlanSection,
  type PlanSummary,
} from "../shared/types.js";

export const planStatusSchema = z.enum(PLAN_STATUSES);
export const planSourceSchema = z.enum(PLAN_SOURCES);
export const planSectionTypeSchema = z.enum(PLAN_SECTION_TYPES);
export const planCommentKindSchema = z.enum(PLAN_COMMENT_KINDS);
export const planCommentStatusSchema = z.enum(PLAN_COMMENT_STATUSES);
export const planAuthorSchema = z.enum(PLAN_AUTHORS);

export const sectionInputSchema = z.object({
  id: z.string().optional(),
  type: planSectionTypeSchema.optional().default("custom"),
  title: z.string().min(1),
  body: z.string().optional().default(""),
  html: z.string().optional(),
  order: z.number().int().optional(),
  createdBy: planAuthorSchema.optional().default("agent"),
});

export const commentInputSchema = z.object({
  id: z.string().optional(),
  sectionId: z.string().optional(),
  kind: planCommentKindSchema.optional().default("comment"),
  status: planCommentStatusSchema.optional().default("open"),
  anchor: z.string().optional(),
  message: z.string().min(1),
  createdBy: planAuthorSchema.optional().default("human"),
});

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function planPath(id: string): string {
  return `/plans/${encodeURIComponent(id)}`;
}

export function planDeepLink(id: string): string {
  return buildDeepLink({
    app: "plan",
    view: "plan",
    to: planPath(id),
    params: { planId: id },
  });
}

function parseJsonRecord(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function toSection(
  row: typeof schema.planSections.$inferSelect,
): PlanSection {
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

export function toComment(
  row: typeof schema.planComments.$inferSelect,
): PlanComment {
  return {
    id: row.id,
    planId: row.planId,
    sectionId: row.sectionId,
    kind: row.kind,
    status: row.status,
    anchor: row.anchor,
    message: row.message,
    createdBy: row.createdBy,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toEvent(row: typeof schema.planEvents.$inferSelect): PlanEvent {
  return {
    id: row.id,
    planId: row.planId,
    type: row.type,
    message: row.message,
    payload: parseJsonRecord(row.payload),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export async function writeEvent(input: {
  planId: string;
  type: string;
  message: string;
  payload?: Record<string, unknown>;
  createdBy?: "agent" | "human" | "import";
}) {
  await getDb()
    .insert(schema.planEvents)
    .values({
      id: newId("evt"),
      planId: input.planId,
      type: input.type,
      message: input.message,
      payload: input.payload ? JSON.stringify(input.payload) : null,
      createdBy: input.createdBy ?? "agent",
      createdAt: nowIso(),
    });
}

export async function assertPlanEditor(planId: string) {
  return assertAccess("plan", planId, "editor");
}

export async function loadPlanBundle(planId: string): Promise<PlanBundle> {
  const access = await resolveAccess("plan", planId);
  if (!access) throw new Error(`Plan ${planId} not found`);
  const plan = access.resource as typeof schema.plans.$inferSelect;
  const db = getDb();
  const [sectionRows, commentRows, eventRows] = await Promise.all([
    db
      .select()
      .from(schema.planSections)
      .where(eq(schema.planSections.planId, planId))
      .orderBy(
        asc(schema.planSections.order),
        asc(schema.planSections.createdAt),
      ),
    db
      .select()
      .from(schema.planComments)
      .where(eq(schema.planComments.planId, planId))
      .orderBy(asc(schema.planComments.createdAt)),
    db
      .select()
      .from(schema.planEvents)
      .where(eq(schema.planEvents.planId, planId))
      .orderBy(asc(schema.planEvents.createdAt)),
  ]);

  const sections = sectionRows.map(toSection);
  const comments = commentRows.map(toComment);
  const events = eventRows.map(toEvent);
  return {
    plan: {
      id: plan.id,
      title: plan.title,
      brief: plan.brief,
      status: plan.status,
      source: plan.source,
      repoPath: plan.repoPath,
      currentFocus: plan.currentFocus,
      html: plan.html,
      markdown: plan.markdown,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      approvedAt: plan.approvedAt,
    },
    sections,
    comments,
    events,
    summary: summarizePlan(sections, comments),
  };
}

export function summarizePlan(
  sections: PlanSection[],
  comments: PlanComment[],
) {
  const sectionCounts: Record<string, number> = {};
  for (const section of sections) {
    sectionCounts[section.type] = (sectionCounts[section.type] ?? 0) + 1;
  }
  return {
    sectionCounts,
    commentCount: comments.length,
    openCommentCount: comments.filter((comment) => comment.status === "open")
      .length,
  };
}

export async function summarizePlans(
  plans: Array<typeof schema.plans.$inferSelect>,
): Promise<PlanSummary[]> {
  if (plans.length === 0) return [];
  const ids = plans.map((plan) => plan.id);
  const db = getDb();
  const [sectionRows, commentRows] = await Promise.all([
    db
      .select()
      .from(schema.planSections)
      .where(inArray(schema.planSections.planId, ids)),
    db
      .select()
      .from(schema.planComments)
      .where(inArray(schema.planComments.planId, ids)),
  ]);
  return plans.map((plan) => {
    const sections = sectionRows
      .filter((section) => section.planId === plan.id)
      .map(toSection);
    const comments = commentRows
      .filter((comment) => comment.planId === plan.id)
      .map(toComment);
    return {
      id: plan.id,
      title: plan.title,
      brief: plan.brief,
      status: plan.status,
      source: plan.source,
      repoPath: plan.repoPath,
      currentFocus: plan.currentFocus,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      approvedAt: plan.approvedAt,
      ...summarizePlan(sections, comments),
    };
  });
}

export function deriveSectionsFromText(planText: string) {
  const chunks = planText
    .split(/\n(?=#{1,3}\s+)/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const sourceChunks = chunks.length > 1 ? chunks : [planText.trim()];
  const sections: Array<z.infer<typeof sectionInputSchema>> = sourceChunks
    .slice(0, 8)
    .map((chunk, index) => {
      const [firstLine = `Plan section ${index + 1}`, ...rest] =
        chunk.split(/\r?\n/);
      const title = firstLine.replace(/^#{1,3}\s+/, "").trim();
      const body = rest.join("\n").trim() || chunk;
      return {
        type: inferSectionType(title, body),
        title: title.slice(0, 120) || `Plan section ${index + 1}`,
        body,
        order: index,
        createdBy: "import" as const,
      };
    });
  if (!sections.some((section) => section.type === "diagram")) {
    sections.splice(1, 0, {
      type: "diagram" as const,
      title: "How the plan fits together",
      body: "Generated companion diagram for the imported plan.",
      html: renderCompanionDiagramHtml(planText),
      order: 1,
      createdBy: "agent" as const,
    });
  }
  return sections.map((section, index) => ({ ...section, order: index }));
}

function inferSectionType(title: string, body: string) {
  const text = `${title} ${body}`.toLowerCase();
  if (/\b(wireframe|mockup|screen|ui|layout|prototype)\b/.test(text)) {
    return "wireframe" as const;
  }
  if (/\b(flow|architecture|diagram|state|data)\b/.test(text)) {
    return "diagram" as const;
  }
  if (/\b(step|task|phase|implement|build)\b/.test(text)) {
    return "steps" as const;
  }
  if (/\b(decision|option|tradeoff|choose)\b/.test(text)) {
    return "decisions" as const;
  }
  if (/\b(question|open|unclear|assume|risk)\b/.test(text)) {
    return "questions" as const;
  }
  return "summary" as const;
}

export function buildPlanHtml(bundle: PlanBundle): string {
  if (bundle.plan.html?.trim()) return bundle.plan.html;
  const title = escapeHtml(bundle.plan.title);
  const brief = escapeHtml(bundle.plan.brief);
  const nav = bundle.sections
    .map(
      (section) =>
        `<a href="#${escapeHtml(section.id)}">${escapeHtml(section.title)}</a>`,
    )
    .join("");
  const sectionHtml = bundle.sections
    .map((section) => renderSectionHtml(section))
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${DOCUMENT_CSS}</style>
</head>
<body>
  <header class="topbar">
    <strong>Agent-Native Plans</strong>
    <nav>${nav}</nav>
  </header>
  <main>
    <section class="hero">
      <p class="kicker">HTML plan mode</p>
      <h1>${title}</h1>
      <p class="lede">${brief}</p>
      <div class="meta">
        <span>${escapeHtml(bundle.plan.source)}</span>
        <span>${escapeHtml(bundle.plan.status.replace(/_/g, " "))}</span>
        ${bundle.plan.repoPath ? `<span>${escapeHtml(bundle.plan.repoPath)}</span>` : ""}
      </div>
    </section>
    <section class="glance">
      <article>
        <span>Visuals</span>
        <strong>${bundle.sections.filter((section) => ["diagram", "wireframe", "prototype"].includes(section.type)).length}</strong>
        <p>Diagrams, mockups, or prototype sections.</p>
      </article>
      <article>
        <span>Review</span>
        <strong>${bundle.summary.openCommentCount}</strong>
        <p>Open comments and annotations.</p>
      </article>
      <article>
        <span>Plan</span>
        <strong>${bundle.sections.length}</strong>
        <p>Readable sections in this companion.</p>
      </article>
    </section>
    ${sectionHtml}
  </main>
</body>
</html>`;
}

function renderSectionHtml(section: PlanSection) {
  const body = markdownishToHtml(section.body);
  const custom = section.html?.trim();
  const visual =
    custom ||
    (section.type === "wireframe"
      ? renderWireframeHtml(section.title)
      : section.type === "diagram"
        ? renderFlowHtml(section.title)
        : "");
  return `<section id="${escapeHtml(section.id)}" class="plan-section ${escapeHtml(section.type)}">
  <p class="section-type">${escapeHtml(section.type.replace(/_/g, " "))}</p>
  <h2>${escapeHtml(section.title)}</h2>
  ${visual ? `<div class="visual">${visual}</div>` : ""}
  <div class="copy">${body}</div>
</section>`;
}

function markdownishToHtml(value: string) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";
  const listLines = lines.filter((line) => /^[-*]\s+/.test(line));
  if (listLines.length >= Math.max(2, Math.ceil(lines.length * 0.5))) {
    return `<ul>${lines
      .map((line) => `<li>${escapeHtml(line.replace(/^[-*]\s+/, ""))}</li>`)
      .join("")}</ul>`;
  }
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}

function renderWireframeHtml(title: string) {
  return `<div class="wireframe-shell" aria-label="${escapeHtml(title)} wireframe">
    <aside><span></span><span></span><span></span></aside>
    <main>
      <div class="bar wide"></div>
      <div class="bar"></div>
      <div class="cards"><i></i><i></i><i></i></div>
      <div class="panel-row"><i></i><i></i></div>
    </main>
  </div>`;
}

function renderFlowHtml(title: string) {
  return `<div class="flow-diagram" aria-label="${escapeHtml(title)} diagram">
    <div><strong>Intent</strong><span>User asks for a plan</span></div>
    <div><strong>Visualize</strong><span>Agent creates HTML companion</span></div>
    <div><strong>React</strong><span>User annotates visuals</span></div>
    <div><strong>Build</strong><span>Agent follows the revised plan</span></div>
  </div>`;
}

function renderCompanionDiagramHtml(planText: string) {
  const words = planText
    .split(/\s+/)
    .filter((word) => /^[A-Za-z][A-Za-z-]{3,}$/.test(word))
    .slice(0, 4);
  const labels =
    words.length >= 4 ? words : ["Plan", "Visuals", "Review", "Build"];
  return `<div class="flow-diagram">
    ${labels
      .map(
        (label, index) =>
          `<div><strong>${escapeHtml(label)}</strong><span>Step ${index + 1}</span></div>`,
      )
      .join("")}
  </div>`;
}

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const DOCUMENT_CSS = `
:root { color-scheme: dark; --bg: #0a0a0b; --paper: #111113; --paper-2: #171719; --line: #28282c; --text: #f2f2f3; --muted: #a4a4aa; --soft: #d7d7da; --accent: #64d2c8; --accent-soft: rgba(100,210,200,.12); }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.55; }
.topbar { position: sticky; top: 0; z-index: 5; height: 52px; display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 0 max(24px, calc((100vw - 980px) / 2)); border-bottom: 1px solid var(--line); background: rgba(10,10,11,.84); backdrop-filter: blur(18px); }
.topbar strong { font-size: 13px; letter-spacing: .01em; }
.topbar nav { display: flex; gap: 18px; overflow-x: auto; white-space: nowrap; }
.topbar a { color: var(--muted); text-decoration: none; font-size: 13px; }
.topbar a:hover { color: var(--text); }
main { width: min(980px, calc(100vw - 32px)); margin: 0 auto; padding: 72px 0 96px; }
.hero { padding-bottom: 36px; border-bottom: 1px solid var(--line); }
.kicker, .section-type { margin: 0 0 12px; color: var(--accent); font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
h1 { max-width: 860px; margin: 0; font-size: clamp(42px, 8vw, 82px); line-height: .94; letter-spacing: -.055em; }
.lede { max-width: 760px; margin: 24px 0 0; color: var(--soft); font-size: clamp(20px, 3vw, 28px); line-height: 1.35; }
.meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 28px; }
.meta span { border: 1px solid var(--line); border-radius: 999px; padding: 6px 10px; color: var(--muted); font-size: 12px; }
.glance { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 28px 0 52px; }
.glance article, .plan-section { border: 1px solid var(--line); border-radius: 18px; background: var(--paper); }
.glance article { padding: 18px; }
.glance span { display: block; margin-bottom: 10px; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .12em; }
.glance strong { font-size: 34px; line-height: 1; }
.glance p { margin: 10px 0 0; color: var(--muted); font-size: 14px; }
.plan-section { margin-top: 18px; padding: clamp(22px, 4vw, 34px); scroll-margin-top: 72px; }
.plan-section h2 { margin: 0; font-size: clamp(26px, 4vw, 42px); letter-spacing: -.035em; }
.copy { max-width: 760px; margin-top: 18px; color: var(--soft); font-size: 17px; }
.copy p { margin: 0 0 14px; }
.copy ul { margin: 0; padding-left: 20px; }
.copy li { margin: 9px 0; }
.visual { margin: 24px 0; }
.flow-diagram { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.flow-diagram div { position: relative; min-height: 124px; border: 1px solid var(--line); border-radius: 14px; background: var(--paper-2); padding: 16px; }
.flow-diagram div:not(:last-child)::after { content: ""; position: absolute; top: 50%; right: -10px; width: 10px; height: 1px; background: var(--accent); }
.flow-diagram strong { display: block; margin-bottom: 8px; }
.flow-diagram span { color: var(--muted); font-size: 14px; }
.wireframe-shell { min-height: 360px; display: grid; grid-template-columns: 190px 1fr; overflow: hidden; border: 1px solid var(--line); border-radius: 18px; background: var(--paper-2); }
.wireframe-shell aside { display: grid; align-content: start; gap: 12px; padding: 18px; border-right: 1px solid var(--line); background: #0d0d0f; }
.wireframe-shell span, .bar, .cards i, .panel-row i { display: block; border-radius: 999px; background: #3b3b40; }
.wireframe-shell span { height: 10px; }
.wireframe-shell span:nth-child(1) { width: 80%; }
.wireframe-shell span:nth-child(2) { width: 62%; }
.wireframe-shell span:nth-child(3) { width: 70%; }
.wireframe-shell main { width: auto; margin: 0; padding: 22px; }
.bar { height: 12px; width: 48%; margin-bottom: 12px; }
.bar.wide { width: 72%; }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 28px 0 12px; }
.cards i { height: 112px; border-radius: 14px; background: var(--accent-soft); border: 1px solid rgba(100,210,200,.26); }
.panel-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.panel-row i { height: 118px; border-radius: 14px; background: #202024; }
@media (max-width: 760px) { .topbar { justify-content: flex-start; padding: 0 16px; } .topbar strong { display: none; } main { width: min(100vw - 24px, 980px); padding-top: 44px; } .glance, .flow-diagram, .wireframe-shell, .cards, .panel-row { grid-template-columns: 1fr; } .flow-diagram div::after { display: none; } .wireframe-shell aside { border-right: 0; border-bottom: 1px solid var(--line); } }
`;
