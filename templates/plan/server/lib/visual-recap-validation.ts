import type {
  PlanBlock,
  PlanContent,
  PlanLegacyWireframeBlock,
  PlanWireframeBlock,
  PlanWireframeNode,
} from "../../shared/plan-content.js";

type WireframeData = PlanWireframeBlock["data"];
type LegacyWireframeData = PlanLegacyWireframeBlock["data"];

type EmptyWireframeIssue = {
  location: string;
  reason: string;
};

const MEANINGFUL_TEXT_FIELDS = [
  "text",
  "value",
  "label",
  "placeholder",
  "title",
  "note",
  "due",
] as const;

const ENTITY_RE = /&(?:[a-z][a-z0-9]+|#[0-9]+|#x[0-9a-f]+);/gi;
const HTML_TEXT_ATTR_RE =
  /\b(?:aria-label|alt|placeholder|title|value)=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/gi;

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, " ")
    .replace(ENTITY_RE, "x")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTextLength(value: unknown): number {
  return normalizeText(value).length;
}

function htmlMeaningfulTextLength(html: string): number {
  let length = 0;
  for (const match of html.matchAll(HTML_TEXT_ATTR_RE)) {
    length += meaningfulTextLength(match[1] ?? match[2] ?? match[3] ?? "");
  }

  const visibleText = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  length += meaningfulTextLength(visibleText);

  return length;
}

function hasSkeletonGeometry(html: string): boolean {
  return (
    /<(?:div|span|section|main|article|ul|li)\b/i.test(html) &&
    /\b(?:height|width|background|border|padding|wf-card|wf-box|wf-pill|wf-chip)\b/i.test(
      html,
    )
  );
}

function nodeMeaningfulTextLength(node: PlanWireframeNode): number {
  let length = 0;
  for (const field of MEANINGFUL_TEXT_FIELDS) {
    length += meaningfulTextLength(node[field]);
  }
  if (Array.isArray(node.items)) {
    for (const item of node.items) {
      length += meaningfulTextLength(item.label);
    }
  }
  if (Array.isArray(node.rows)) {
    for (const row of node.rows) {
      length += meaningfulTextLength(row.k);
      length += meaningfulTextLength(row.v);
    }
  }
  for (const child of node.children ?? []) {
    length += nodeMeaningfulTextLength(child);
  }
  return length;
}

function hasMeaningfulKitScreen(nodes: PlanWireframeNode[] | undefined) {
  return (
    (nodes ?? []).reduce(
      (total, node) => total + nodeMeaningfulTextLength(node),
      0,
    ) >= 2
  );
}

function hasMeaningfulHtmlWireframe(data: WireframeData) {
  const html = data.html?.trim();
  if (!html) return false;
  if (htmlMeaningfulTextLength(html) >= 2) return true;
  return data.skeleton === true && hasSkeletonGeometry(html);
}

function emptyWireframeReason(data: WireframeData): string | null {
  const html = data.html?.trim();
  if (html) {
    return hasMeaningfulHtmlWireframe(data)
      ? null
      : "HTML mockup has no visible text, accessible labels, or skeleton geometry";
  }
  if (!data.screen || data.screen.length === 0) {
    return "Screen has no HTML and no kit nodes";
  }
  return hasMeaningfulKitScreen(data.screen)
    ? null
    : "kit tree has no visible text, labels, rows, or items";
}

function emptyLegacyWireframeReason(data: LegacyWireframeData): string | null {
  if (data.regions.some((region) => normalizeText(region.label).length >= 2)) {
    return null;
  }
  return data.regions.length === 0
    ? "legacy wireframe has no regions"
    : "legacy wireframe regions have no labels";
}

function collectWireframeIssue(
  issues: EmptyWireframeIssue[],
  data: WireframeData,
  location: string,
) {
  const reason = emptyWireframeReason(data);
  if (reason) issues.push({ location, reason });
}

function collectCanvasWireframeIssue(
  issues: EmptyWireframeIssue[],
  data: WireframeData,
  location: string,
) {
  if (!data.html?.trim() && (data.screen?.length ?? 0) > 0) {
    issues.push({
      location,
      reason:
        "canvas artboard uses legacy kit-tree Screen children; use Screen html/data.html so the canvas renders through the same HTML wireframe path as the document body",
    });
  }
  collectWireframeIssue(issues, data, location);
}

function collectLegacyWireframeIssue(
  issues: EmptyWireframeIssue[],
  data: LegacyWireframeData,
  location: string,
) {
  const reason = emptyLegacyWireframeReason(data);
  if (reason) issues.push({ location, reason });
}

function blockLocation(block: PlanBlock, path: string) {
  return `${path} block "${block.id}"`;
}

function collectBlockIssues(
  blocks: PlanBlock[],
  path: string,
  issues: EmptyWireframeIssue[],
) {
  for (const block of blocks) {
    const location = blockLocation(block, path);
    if (block.type === "wireframe") {
      collectWireframeIssue(issues, block.data, location);
      continue;
    }
    if (block.type === "legacy-wireframe") {
      collectLegacyWireframeIssue(issues, block.data, location);
      continue;
    }
    if (block.type === "tabs") {
      for (const tab of block.data.tabs) {
        collectBlockIssues(
          tab.blocks,
          `${location} > tab "${tab.label}"`,
          issues,
        );
      }
      continue;
    }
    if (block.type === "columns") {
      for (const column of block.data.columns) {
        collectBlockIssues(
          column.blocks,
          `${location} > column "${column.label ?? column.id}"`,
          issues,
        );
      }
      continue;
    }
    if (block.type === "question-form" || block.type === "visual-questions") {
      for (const question of block.data.questions) {
        for (const option of question.options ?? []) {
          if (option.wireframe) {
            collectWireframeIssue(
              issues,
              option.wireframe,
              `${location} > question "${question.title}" option "${option.label}"`,
            );
          }
        }
      }
    }
  }
}

export function assertRecapWireframesHaveContent(content: PlanContent) {
  const issues: EmptyWireframeIssue[] = [];
  collectBlockIssues(content.blocks, "plan body", issues);

  for (const frame of content.canvas?.frames ?? []) {
    const location = `canvas artboard "${frame.id}"`;
    if (frame.wireframe) {
      collectCanvasWireframeIssue(issues, frame.wireframe, location);
    }
    if (frame.legacyWireframe) {
      collectLegacyWireframeIssue(issues, frame.legacyWireframe, location);
    }
  }

  if (issues.length === 0) return;

  const details = issues
    .slice(0, 8)
    .map((issue) => `${issue.location}: ${issue.reason}`)
    .join("; ");
  const overflow =
    issues.length > 8
      ? `; plus ${issues.length - 8} more empty wireframes`
      : "";
  throw new Error(
    `Visual recap contains empty wireframes or legacy canvas kit trees. Recap wireframes must include visible product content and canvas artboards must use HTML screens before publishing. ` +
      `Add realistic HTML text/controls; legacy kit-tree screens are only an old-plan compatibility path and must not be used for new canvas artboards. Items: ${details}${overflow}.`,
  );
}
