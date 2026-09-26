
import type { PlanBlock, PlanContent } from "./plan-content.js";
import type { PlanSection } from "./types.js";


export interface BlockRef {
  id: string;
  label: string;
}

export interface PlanVersionDiff {
  addedBlocks: BlockRef[];
  removedBlocks: BlockRef[];
  changedBlocks: BlockRef[];
  sectionChanges?: {
    added: string[];
    removed: string[];
  };
}

export type PlanVersionDiffResult =
  | { kind: "diff"; diff: PlanVersionDiff }
  | { kind: "html-only" }
  | { kind: "initial" };


function flattenBlocks(blocks: PlanBlock[]): PlanBlock[] {
  const result: PlanBlock[] = [];
  const visit = (block: PlanBlock) => {
    result.push(block);
    if (block.type === "tabs") {
      for (const tab of block.data.tabs) {
        for (const child of tab.blocks) visit(child);
      }
    }
    if (block.type === "columns") {
      for (const column of block.data.columns) {
        for (const child of column.blocks) visit(child);
      }
    }
  };
  for (const block of blocks) visit(block);
  return result;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const keys = Object.keys(value as object).sort();
  const pairs = keys.map(
    (k) =>
      `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`,
  );
  return `{${pairs.join(",")}}`;
}

const BLOCK_TYPE_LABELS: Record<string, string> = {
  "rich-text": "Text",
  callout: "Callout",
  checklist: "Checklist",
  table: "Table",
  code: "Code",
  "code-tabs": "Code tabs",
  "implementation-map": "Implementation map",
  wireframe: "Wireframe",
  "legacy-wireframe": "Wireframe",
  diagram: "Diagram",
  image: "Image",
  tabs: "Tabs",
  columns: "Columns",
  "custom-html": "Custom HTML",
  "question-form": "Questions",
  "visual-questions": "Questions",
  mermaid: "Diagram",
  "api-endpoint": "API endpoint",
  "openapi-spec": "OpenAPI spec",
  "data-model": "Data model",
  diff: "Diff",
  "file-tree": "File tree",
  "json-explorer": "JSON",
  "annotated-code": "Code",
};

function blockTypeLabel(type: string): string {
  return BLOCK_TYPE_LABELS[type] ?? type;
}

function blockLabel(block: PlanBlock): string {
  if (block.title) return block.title;

  switch (block.type) {
    case "rich-text": {
      const md = block.data.markdown.trim();
      const headingMatch = /^#{1,6}\s+(.+)/.exec(md);
      if (headingMatch) return headingMatch[1].trim();
      const firstLine = md.split("\n")[0]?.trim();
      if (firstLine) return firstLine.slice(0, 60);
      break;
    }
    case "callout":
      if (block.data.body) return block.data.body.slice(0, 60);
      break;
    case "code":
      if (block.data.filename) return block.data.filename;
      if (block.data.caption) return block.data.caption;
      break;
    case "annotated-code":
      if (block.data.filename) return block.data.filename;
      break;
    case "image":
      if (block.data.alt) return block.data.alt;
      if (block.data.caption) return block.data.caption ?? "";
      break;
    case "table":
      if (block.data.columns.length) return block.data.columns[0];
      break;
    case "api-endpoint":
      return `${block.data.method} ${block.data.path}`;
    case "mermaid":
      if (block.data.caption) return block.data.caption;
      break;
    case "wireframe":
      if (block.data.caption) return block.data.caption;
      return `${block.data.surface} wireframe`;
    case "diagram":
      if (block.data.caption) return block.data.caption;
      break;
    case "data-model":
      if (block.data.entities.length)
        return block.data.entities
          .map((e) => e.name)
          .slice(0, 3)
          .join(", ");
      break;
    case "file-tree":
      if (block.data.title) return block.data.title;
      break;
    default:
      break;
  }

  return blockTypeLabel(block.type);
}


export function diffPlanVersions(
  newer: {
    content?: PlanContent | null;
    sections?: Array<Pick<PlanSection, "id" | "title">> | null;
    html?: string | null;
  },
  older: {
    content?: PlanContent | null;
    sections?: Array<Pick<PlanSection, "id" | "title">> | null;
    html?: string | null;
  } | null,
): PlanVersionDiffResult {
  if (!older) return { kind: "initial" };

  const newerContent = newer.content;
  const olderContent = older.content;

  if (newerContent || olderContent) {
    const newerBlocks = flattenBlocks(newerContent?.blocks ?? []);
    const olderBlocks = flattenBlocks(olderContent?.blocks ?? []);

    const newerById = new Map<string, PlanBlock>();
    for (const b of newerBlocks) newerById.set(b.id, b);

    const olderById = new Map<string, PlanBlock>();
    for (const b of olderBlocks) olderById.set(b.id, b);

    const addedBlocks: BlockRef[] = [];
    const removedBlocks: BlockRef[] = [];
    const changedBlocks: BlockRef[] = [];

    for (const [id, block] of newerById) {
      if (!olderById.has(id)) {
        addedBlocks.push({ id, label: blockLabel(block) });
      }
    }

    for (const [id, block] of olderById) {
      if (!newerById.has(id)) {
        removedBlocks.push({ id, label: blockLabel(block) });
      }
    }

    for (const [id, newerBlock] of newerById) {
      const olderBlock = olderById.get(id);
      if (!olderBlock) continue;
      if (stableJson(newerBlock) !== stableJson(olderBlock)) {
        changedBlocks.push({ id, label: blockLabel(newerBlock) });
      }
    }

    return {
      kind: "diff",
      diff: { addedBlocks, removedBlocks, changedBlocks },
    };
  }

  const newerSections = newer.sections ?? [];
  const olderSections = older.sections ?? [];

  if (newerSections.length > 0 || olderSections.length > 0) {
    const newerIds = new Set(newerSections.map((s) => s.id));
    const olderIds = new Set(olderSections.map((s) => s.id));
    const added = newerSections
      .filter((s) => !olderIds.has(s.id))
      .map((s) => s.title);
    const removed = olderSections
      .filter((s) => !newerIds.has(s.id))
      .map((s) => s.title);
    return {
      kind: "diff",
      diff: {
        addedBlocks: [],
        removedBlocks: [],
        changedBlocks: [],
        sectionChanges: { added, removed },
      },
    };
  }

  return { kind: "html-only" };
}


const MAX_LABELS = 2;

function labelsWithOverflow(items: BlockRef[], prefix: string): string | null {
  if (items.length === 0) return null;
  const shown = items
    .slice(0, MAX_LABELS)
    .map((b) => b.label)
    .join(", ");
  const overflow = items.length - MAX_LABELS;
  const suffix = overflow > 0 ? ` +${overflow} more` : "";
  return `${prefix}(${shown}${suffix})`;
}

export function formatVersionDiffSummary(
  result: PlanVersionDiffResult,
): string | null {
  if (result.kind === "html-only") return null;
  if (result.kind === "initial") return "Initial version";

  const { diff } = result;

  if (diff.sectionChanges) {
    const { added, removed } = diff.sectionChanges;
    const parts: string[] = [];
    if (added.length)
      parts.push(
        `+${added.length} section${added.length > 1 ? "s" : ""} (${added.slice(0, MAX_LABELS).join(", ")}${added.length > MAX_LABELS ? ` +${added.length - MAX_LABELS} more` : ""})`,
      );
    if (removed.length)
      parts.push(
        `−${removed.length} section${removed.length > 1 ? "s" : ""} (${removed.slice(0, MAX_LABELS).join(", ")}${removed.length > MAX_LABELS ? ` +${removed.length - MAX_LABELS} more` : ""})`,
      );
    if (parts.length === 0) return "No section changes";
    return parts.join(" · ");
  }

  const { addedBlocks, removedBlocks, changedBlocks } = diff;

  if (
    addedBlocks.length === 0 &&
    removedBlocks.length === 0 &&
    changedBlocks.length === 0
  ) {
    return "No content changes";
  }

  const parts: string[] = [];

  if (addedBlocks.length) {
    const detail = labelsWithOverflow(addedBlocks, "");
    parts.push(
      `+${addedBlocks.length} block${addedBlocks.length > 1 ? "s" : ""}${detail ? ` ${detail}` : ""}`,
    );
  }

  if (changedBlocks.length) {
    const detail = labelsWithOverflow(changedBlocks, "");
    parts.push(`${changedBlocks.length} changed${detail ? ` ${detail}` : ""}`);
  }

  if (removedBlocks.length) {
    const detail = labelsWithOverflow(removedBlocks, "");
    parts.push(`−${removedBlocks.length}${detail ? ` ${detail}` : ""}`);
  }

  return parts.join(" · ");
}
