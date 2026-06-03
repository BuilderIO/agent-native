import { buildDeepLink } from "@agent-native/core/server";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { asc, eq, inArray } from "drizzle-orm";
import { Buffer } from "node:buffer";
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

type ImplementationFile = {
  id: string;
  path: string;
  absolutePath?: string;
  line?: number;
  language: string;
  summary: string;
  symbols: string[];
  previewCode?: string;
};

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
  if (
    /\b(file|files|symbol|symbols|component|function|implementation|touch|update|modify)\b/.test(
      text,
    ) &&
    findFileReferences(`${title}\n${body}`).length > 0
  ) {
    return "implementation" as const;
  }
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
  const storedHtml = normalizeStoredHtml(bundle.plan.html);
  if (storedHtml.trim()) return storedHtml;
  const title = escapeHtml(bundle.plan.title);
  const brief = escapeHtml(bundle.plan.brief);
  const sectionHtml = bundle.sections
    .map((section) => renderSectionHtml(section, bundle.plan.repoPath))
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
  <main>
    <section class="hero">
      <p class="kicker">Working plan</p>
      <h1>${title}</h1>
      <p class="lede">${brief}</p>
      <ul class="meta">
        <li>${escapeHtml(bundle.plan.source)}</li>
        <li>${escapeHtml(bundle.plan.status.replace(/_/g, " "))}</li>
        ${bundle.plan.repoPath ? `<li>${escapeHtml(bundle.plan.repoPath)}</li>` : ""}
      </ul>
    </section>
    ${sectionHtml}
  </main>
</body>
</html>`;
}

function normalizeStoredHtml(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  if (value == null) return "";
  return String(value);
}

function renderSectionHtml(section: PlanSection, repoPath?: string | null) {
  const body = markdownishToHtml(section.body);
  const custom = section.html?.trim();
  const visual =
    custom ||
    (section.type === "implementation"
      ? renderImplementationMapHtml(section.body, repoPath)
      : section.type === "wireframe"
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

const FILE_REFERENCE_PATTERN =
  /(?:^|[\s([`])((?:\.{1,2}\/)?(?:[\w@.-]+\/)+[\w@(). -]+\.(?:tsx?|jsx?|css|scss|mdx?|json|jsonc|sql|py|go|rs|java|kt|swift|rb|php|ya?ml|toml|html|vue|svelte|astro|graphql|gql|prisma|sh|bash|zsh))(?:[:#](\d+))?/gim;

function findFileReferences(value: string) {
  const refs: Array<{ path: string; line?: number; index: number }> = [];
  let match: RegExpExecArray | null;
  FILE_REFERENCE_PATTERN.lastIndex = 0;
  while ((match = FILE_REFERENCE_PATTERN.exec(value))) {
    const rawPath = match[1]?.trim().replace(/[),.;\]]+$/, "");
    if (!rawPath) continue;
    refs.push({
      path: rawPath,
      line: match[2] ? Number(match[2]) : undefined,
      index: match.index,
    });
  }
  return refs;
}

function parseImplementationFiles(
  body: string,
  repoPath?: string | null,
): ImplementationFile[] {
  const files = new Map<string, ImplementationFile>();
  const lines = body.split(/\r?\n/);

  for (const line of lines) {
    for (const ref of findFileReferences(line)) {
      const existing = files.get(ref.path);
      const summary = cleanImplementationSummary(line, ref.path);
      const symbols = extractSymbols(line, ref.path);
      if (existing) {
        if (!existing.line && ref.line) existing.line = ref.line;
        if (summary && !existing.summary) existing.summary = summary;
        for (const symbol of symbols) {
          if (!existing.symbols.includes(symbol)) existing.symbols.push(symbol);
        }
        continue;
      }
      files.set(ref.path, {
        id: stableDomId(`impl-${ref.path}`),
        path: ref.path,
        absolutePath: resolveImplementationPath(repoPath, ref.path),
        line: ref.line,
        language: inferLanguage(ref.path),
        summary,
        symbols,
      });
    }
  }

  const fences = Array.from(body.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)).map(
    (match) => ({
      info: match[1]?.trim() ?? "",
      code: match[2]?.trimEnd() ?? "",
      index: match.index ?? 0,
    }),
  );

  for (const fence of fences) {
    const nearbyRefs = findFileReferences(
      body.slice(Math.max(0, fence.index - 280), fence.index),
    );
    const hintedRef =
      findFileReferences(fence.info)[0] || nearbyRefs[nearbyRefs.length - 1];
    const item = hintedRef
      ? files.get(hintedRef.path)
      : Array.from(files.values()).find((candidate) => !candidate.previewCode);
    if (!item) continue;
    item.previewCode = fence.code;
    item.language = inferLanguage(item.path, fence.info) || item.language;
  }

  return Array.from(files.values()).slice(0, 12);
}

function cleanImplementationSummary(line: string, path: string) {
  return line
    .replace(/^[-*]\s+/, "")
    .replace(path, "")
    .replace(/\s+[—-]\s+/, " ")
    .replace(/\b(symbols?|components?|functions?)\s*:\s*[^.;]+[.;]?/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function extractSymbols(line: string, path: string) {
  const symbols = new Set<string>();
  const explicit = line.match(
    /\b(?:symbols?|components?|functions?)\s*:\s*([^.;]+)/i,
  );
  if (explicit?.[1]) {
    for (const part of explicit[1].split(/[,/]/)) {
      const symbol = part.trim().replace(/^`|`$/g, "");
      if (symbol && symbol !== path) symbols.add(symbol);
    }
  }
  for (const match of line.matchAll(/`([^`]+)`/g)) {
    const value = match[1]?.trim();
    if (value && value !== path && !value.includes("/")) symbols.add(value);
  }
  return Array.from(symbols).slice(0, 5);
}

function resolveImplementationPath(
  repoPath: string | null | undefined,
  filePath: string,
) {
  if (filePath.startsWith("/")) return filePath;
  if (!repoPath) return undefined;
  return `${repoPath.replace(/\/+$/, "")}/${filePath.replace(/^\.?\//, "")}`;
}

function inferLanguage(filePath: string, info = "") {
  const infoLang = info
    .split(/\s+/)[0]
    ?.replace(/[^\w#+-]/g, "")
    .toLowerCase();
  if (infoLang && !infoLang.includes("/")) return infoLang;
  const extension = filePath.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "ts",
    tsx: "tsx",
    js: "js",
    jsx: "jsx",
    css: "css",
    scss: "scss",
    md: "md",
    mdx: "mdx",
    json: "json",
    jsonc: "json",
    yaml: "yaml",
    yml: "yaml",
    html: "html",
    py: "py",
    rs: "rs",
    go: "go",
    sql: "sql",
    sh: "sh",
    bash: "sh",
    zsh: "sh",
  };
  return (extension && map[extension]) || "text";
}

function stableDomId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "");
}

function editorHref(
  scheme: "vscode" | "cursor",
  absolutePath?: string,
  line?: number,
) {
  if (!absolutePath) return "";
  const suffix = line ? `:${line}:1` : "";
  return `${scheme}://file${encodeURI(absolutePath)}${suffix}`;
}

function renderImplementationMapHtml(body: string, repoPath?: string | null) {
  const files = parseImplementationFiles(body, repoPath);
  if (files.length === 0) return "";
  return `<div class="implementation-map" data-plan-implementation-map>
    <div class="implementation-map-header">
      <span>${files.length} file${files.length === 1 ? "" : "s"}</span>
      <span>review file-level intent before implementation</span>
    </div>
    <div class="implementation-files">
      ${files.map((file) => renderImplementationFileHtml(file)).join("")}
    </div>
  </div>`;
}

function renderImplementationFileHtml(file: ImplementationFile) {
  const templateId = `${file.id}-preview`;
  const previewCode =
    file.previewCode ||
    `// No embedded preview yet.\n// Ask the agent to add the exact snippet it plans to modify for ${file.path}.`;
  const vscodeHref = editorHref("vscode", file.absolutePath, file.line);
  const cursorHref = editorHref("cursor", file.absolutePath, file.line);
  return `<article class="implementation-file" data-file-path="${escapeHtml(file.path)}">
    <div>
      <p class="file-path">${escapeHtml(file.path)}${file.line ? `<span>:${file.line}</span>` : ""}</p>
      ${file.summary ? `<p class="file-summary">${escapeHtml(file.summary)}</p>` : ""}
      ${
        file.symbols.length
          ? `<div class="symbol-list">${file.symbols
              .map((symbol) => `<code>${escapeHtml(symbol)}</code>`)
              .join("")}</div>`
          : ""
      }
    </div>
    <div class="file-actions">
      <button type="button" data-agent-native-code-preview="${escapeHtml(templateId)}">Preview</button>
      ${
        vscodeHref
          ? `<button type="button" data-agent-native-open-editor="${escapeHtml(vscodeHref)}">VS Code</button>`
          : ""
      }
      ${
        cursorHref
          ? `<button type="button" data-agent-native-open-editor="${escapeHtml(cursorHref)}">Cursor</button>`
          : ""
      }
    </div>
    <template id="${escapeHtml(templateId)}">
      <div class="code-preview">
        <div class="code-preview-title"><strong>${escapeHtml(file.path)}</strong><span>${escapeHtml(file.language)}</span></div>
        <pre><code>${highlightCodeHtml(previewCode, file.language)}</code></pre>
      </div>
    </template>
  </article>`;
}

function highlightCodeHtml(code: string, language: string) {
  const escaped = escapeHtml(code);
  const highlighted = escaped
    .replace(
      /(&quot;[^&]*(?:&quot;)|&#39;[^&]*(?:&#39;)|`[^`]*`)/g,
      '<span class="syntax-string">$1</span>',
    )
    .replace(
      /\b(import|export|from|const|let|var|function|return|type|interface|class|extends|async|await|if|else|for|while|new|throw|try|catch|switch|case|default)\b/g,
      '<span class="syntax-keyword">$1</span>',
    )
    .replace(
      /\b(true|false|null|undefined)\b/g,
      '<span class="syntax-literal">$1</span>',
    );
  if (/(sh|bash|zsh|py|yaml|yml)/.test(language)) {
    return highlighted.replace(
      /(^|\n)(\s*#.*)/g,
      '$1<span class="syntax-comment">$2</span>',
    );
  }
  return highlighted.replace(
    /(^|\n)(\s*\/\/.*)/g,
    '$1<span class="syntax-comment">$2</span>',
  );
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
    <div class="window-bar"><i></i><i></i><i></i><strong>Plan review</strong></div>
    <div class="screen-body">
      <aside>
        <span class="nav-dot"></span>
        <span class="nav-line wide"></span>
        <span class="nav-line"></span>
        <span class="nav-line short"></span>
      </aside>
      <main>
        <div class="toolbar"><span></span><span></span><button>Comment</button></div>
        <div class="document-line title"></div>
        <div class="document-line"></div>
        <div class="wide-preview">
          <div></div><div></div><div></div>
        </div>
        <div class="detail-row"><i></i><i></i><i></i></div>
      </main>
    </div>
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
:root { color-scheme: dark; --bg: #0a0a0b; --paper: #111113; --paper-2: #171719; --line: #28282c; --text: #f2f2f3; --muted: #a4a4aa; --soft: #d7d7da; --accent: #00B5FF; --accent-soft: rgba(0,181,255,.12); --shadow: 0 24px 70px rgba(0,0,0,.28); }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.55; }
main { width: min(1120px, calc(100vw - 48px)); margin: 0 auto; padding: 96px 0 96px; }
.hero { max-width: 760px; padding-bottom: 30px; border-bottom: 1px solid var(--line); }
.kicker, .section-type { margin: 0 0 12px; color: var(--accent); font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
h1 { margin: 0; font-size: clamp(36px, 5vw, 58px); line-height: 1.02; letter-spacing: -.04em; }
.lede { margin: 20px 0 0; color: var(--soft); font-size: clamp(18px, 2vw, 23px); line-height: 1.45; }
.meta { display: grid; gap: 7px; margin: 26px 0 0; padding-left: 20px; color: var(--muted); font-size: 13px; }
.meta li::marker { color: var(--accent); }
.plan-section { margin-top: 70px; padding-top: 46px; border-top: 1px solid var(--line); scroll-margin-top: 72px; }
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
.wireframe-shell { overflow: hidden; border: 1px solid var(--line); border-radius: 18px; background: var(--paper-2); box-shadow: var(--shadow); }
.window-bar { height: 42px; display: flex; align-items: center; gap: 8px; padding: 0 14px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 12px; }
.window-bar i { width: 8px; height: 8px; border-radius: 999px; background: #4a4a50; }
.window-bar strong { margin-left: auto; font-weight: 600; color: var(--soft); }
.screen-body { min-height: 430px; display: grid; grid-template-columns: 190px 1fr; }
.wireframe-shell aside { display: grid; align-content: start; gap: 13px; padding: 18px; border-right: 1px solid var(--line); background: #0d0d0f; }
.nav-dot { width: 34px; height: 34px; border-radius: 11px; background: var(--accent-soft); border: 1px solid rgba(0,181,255,.28); }
.nav-line, .document-line, .toolbar span { display: block; border-radius: 999px; background: #3b3b40; }
.nav-line { height: 9px; width: 72%; }
.nav-line.wide { width: 86%; }
.nav-line.short { width: 52%; }
.wireframe-shell main { width: auto; margin: 0; padding: 18px; }
.toolbar { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 24px; }
.toolbar span { width: 34px; height: 30px; }
.toolbar button { border: 0; border-radius: 8px; background: #ececef; color: #111113; padding: 0 18px; font: 700 12px/30px inherit; }
.document-line { height: 13px; width: 46%; margin-bottom: 12px; }
.document-line.title { height: 24px; width: 66%; background: #5b5b62; }
.wide-preview { min-height: 190px; display: grid; grid-template-columns: 1.1fr .85fr .85fr; gap: 12px; margin: 26px 0 14px; }
.wide-preview div { border-radius: 14px; background: var(--accent-soft); border: 1px solid rgba(0,181,255,.26); }
.detail-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.detail-row i { height: 116px; border-radius: 14px; background: #202024; border: 1px solid var(--line); }
.implementation-map { margin: 24px 0; border-top: 1px solid var(--line); }
.implementation-map-header { display: flex; justify-content: space-between; gap: 16px; padding: 14px 0; color: var(--muted); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
.implementation-files { display: grid; gap: 0; border-top: 1px solid var(--line); }
.implementation-file { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 18px; padding: 18px 0; border-bottom: 1px solid var(--line); }
.file-path { margin: 0; color: var(--text); font: 650 15px/1.4 "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
.file-path span { color: var(--muted); }
.file-summary { max-width: 760px; margin: 8px 0 0; color: var(--soft); font-size: 15px; }
.symbol-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.symbol-list code { border: 1px solid var(--line); border-radius: 7px; background: var(--paper-2); padding: 2px 6px; color: var(--soft); font-size: 12px; }
.file-actions { display: flex; align-items: flex-start; gap: 6px; }
.file-actions button { min-height: 32px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--soft); padding: 0 10px; font: 650 12px/30px inherit; cursor: pointer; }
.file-actions button:hover { border-color: rgba(0,181,255,.44); color: var(--text); background: rgba(0,181,255,.08); }
.code-preview-title { display: flex; align-items: center; justify-content: space-between; gap: 14px; border-bottom: 1px solid var(--line); padding: 10px 12px; color: var(--muted); font-size: 12px; }
.code-preview-title strong { color: var(--text); font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; font-size: 12px; }
.code-preview pre { margin: 0; max-height: 360px; overflow: auto; padding: 14px 16px; background: #0c0c0e; color: #e9e9ea; font: 12px/1.65 "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
.syntax-keyword { color: #7cc7ff; }
.syntax-string { color: #a6e3a1; }
.syntax-literal { color: #f7c876; }
.syntax-comment { color: #7a7a83; }
@media (max-width: 760px) { main { width: min(100vw - 24px, 980px); padding-top: 72px; } .flow-diagram, .screen-body, .wide-preview, .detail-row, .implementation-file { grid-template-columns: 1fr; } .implementation-map-header, .file-actions { flex-wrap: wrap; } .flow-diagram div::after { display: none; } .wireframe-shell aside { border-right: 0; border-bottom: 1px solid var(--line); } }
`;
