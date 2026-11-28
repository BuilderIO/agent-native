import type { ContextPreview } from "@agent-native/core/shared/context-xray";
import type { ContentContextPathEntry } from "@shared/api";
import { countWords } from "@shared/properties";
import { documentContentPreviewBody } from "@shared/screen-document-preview";

export interface AgentContextPage {
  title: string;
  content: string;
  contextPath?: readonly ContentContextPathEntry[] | undefined;
  spaceDatabaseId?: string | null | undefined;
}

export type AgentContextRowKey =
  | "page"
  | "pages-above"
  | "workspace"
  | "instructions"
  | "memory";

export interface AgentContextRow {
  key: AgentContextRowKey;
  name: string;
  meta: string;
  detail: string;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface AgentContextLabels {
  t: Translate;
  workspaceName?: string | null | undefined;
}

const NAME_SEPARATOR = " · ";
const EMPTY_MEMORY_INDEX = "# Memory Index";
const CODE_FENCE = "```";
const SHARED_INSTRUCTION_OWNERS = ["workspace", "organization"];

type PreviewSection = Pick<
  ContextPreview["sections"][number],
  "provenance" | "tokenCount" | "sourceRef" | "preview"
>;

function sent(section: PreviewSection) {
  return section.tokenCount > 0;
}

function sectionScope(section: PreviewSection) {
  return section.sourceRef?.scope ?? "";
}

function isWorkspaceInstruction(section: PreviewSection) {
  const scope = sectionScope(section);
  const agentsFile =
    SHARED_INSTRUCTION_OWNERS.includes(scope) &&
    section.sourceRef?.path === "AGENTS.md";
  const instructionFiles = SHARED_INSTRUCTION_OWNERS.some(
    (owner) => scope === `${owner}-instruction`,
  );
  return sent(section) && (agentsFile || instructionFiles);
}

function isPersonalInstruction(section: PreviewSection) {
  return (
    sent(section) &&
    section.provenance === "personal" &&
    sectionScope(section).startsWith("personal")
  );
}

function isMemory(section: PreviewSection) {
  return (
    sent(section) &&
    section.provenance === "memory" &&
    section.preview.trim() !== EMPTY_MEMORY_INDEX
  );
}

function shownWordCount(shownBody: string, total: number) {
  const openFence = shownBody.split(CODE_FENCE).length % 2 === 0;
  const counted = openFence ? `${shownBody}\n${CODE_FENCE}` : shownBody;
  return Math.min(countWords(counted), total);
}

function pageRow(page: AgentContextPage, t: Translate): AgentContextRow {
  const name = page.title.trim() || t("agentContext.untitled");
  const body = page.content.trim();
  const shownBody = documentContentPreviewBody(page.content);
  if (shownBody.length >= body.length) {
    return {
      key: "page",
      name,
      meta: t("agentContext.pageAll"),
      detail: t("agentContext.pageAllDetail"),
    };
  }
  const total = countWords(body);
  return {
    key: "page",
    name,
    meta: t("agentContext.pagePart"),
    detail: t("agentContext.pagePartDetail", {
      shown: shownWordCount(shownBody, total),
      total,
    }),
  };
}

function pagesAbove(page: AgentContextPage): ContentContextPathEntry[] {
  const path = page.contextPath ?? [];
  const space = path.find((entry) => entry.id === page.spaceDatabaseId);
  const above = path.filter((entry) => entry !== space).reverse();
  if (space?.description.trim()) above.push(space);
  return above;
}

function pagesAboveRow(
  above: readonly ContentContextPathEntry[],
  t: Translate,
): AgentContextRow {
  const count = above.length;
  return {
    key: "pages-above",
    name: above
      .map((entry) => entry.title.trim() || t("agentContext.untitled"))
      .join(NAME_SEPARATOR),
    meta: t("agentContext.pagesAbove", { count }),
    detail: t("agentContext.pagesAboveDetail", { count }),
  };
}

export function buildAgentContextRows(
  page: AgentContextPage,
  preview: Pick<ContextPreview, "sections"> | null | undefined,
  { t, workspaceName }: AgentContextLabels,
): [AgentContextRow, ...AgentContextRow[]] {
  const rows: [AgentContextRow, ...AgentContextRow[]] = [pageRow(page, t)];
  const above = pagesAbove(page);
  if (above.length) rows.push(pagesAboveRow(above, t));
  const sections = preview?.sections ?? [];
  if (sections.some(isWorkspaceInstruction)) {
    rows.push({
      key: "workspace",
      name: workspaceName?.trim() || t("agentContext.workspace"),
      meta: t("agentContext.workspaceMeta"),
      detail: t("agentContext.workspaceDetail"),
    });
  }
  if (sections.some(isPersonalInstruction)) {
    rows.push({
      key: "instructions",
      name: t("agentContext.instructions"),
      meta: t("agentContext.instructionsMeta"),
      detail: t("agentContext.instructionsDetail"),
    });
  }
  if (sections.some(isMemory)) {
    rows.push({
      key: "memory",
      name: t("agentContext.memory"),
      meta: t("agentContext.memoryMeta"),
      detail: t("agentContext.memoryDetail"),
    });
  }
  return rows;
}
