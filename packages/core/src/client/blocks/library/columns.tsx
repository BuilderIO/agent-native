import { IconColumns } from "@tabler/icons-react";
import { cn } from "../../utils.js";
import { defineBlock } from "../types.js";
import type {
  BlockContainerRegion,
  BlockEditProps,
  BlockReadProps,
  NestedBlock,
} from "../types.js";
import {
  columnsSchema,
  columnsMdx,
  type ColumnsData,
  type ColumnsColumn,
} from "./columns.config.js";

/**
 * Standard `columns` block: a multi-column side-by-side container whose columns
 * each hold a list of child blocks. Labels may still exist in stored data for
 * source round-tripping, but the document UI intentionally renders bare regions.
 *
 * Like `tabs`, child rendering flows through `ctx.renderBlock` — the app's own
 * block dispatcher — so registered children render via their spec and
 * unconverted children fall through the app's legacy switch. This is the
 * coexistence seam: the core columns block never has to know app-specific child
 * block types. The plan CSS classes (`plan-block`, `text-plan-*`) resolve
 * against the plan app's stylesheet at render time.
 */

/** Mint a reasonably-unique column id without pulling a dep into core. */
function newColId(): string {
  return `col-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Tailwind grid-column classes keyed by the column count. The grid collapses to
 * a single column on small screens and fans out to the column count at `md`+, so
 * narrow viewports stack the panels instead of crushing them.
 */
const COLS_CLASS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 md:grid-cols-2",
  3: "grid-cols-1 md:grid-cols-3",
  4: "grid-cols-1 md:grid-cols-4",
};

/** Resolve the responsive grid class for a column count (clamped to 1–4). */
function gridColsClass(count: number): string {
  return COLS_CLASS[Math.min(4, Math.max(1, count))] ?? COLS_CLASS[1];
}

const API_REFERENCE_BLOCK_TYPES = new Set(["api-endpoint", "openapi-spec"]);
const BEFORE_LABELS = new Set(["before", "old", "previous", "current"]);
const AFTER_LABELS = new Set(["after", "new", "next", "target"]);

function normalizedLabel(column: ColumnsColumn): string {
  return column.label?.trim().toLowerCase() ?? "";
}

function isComparisonGroup(columns: ColumnsColumn[]): boolean {
  const labels = columns.map(normalizedLabel);
  return (
    labels.some((label) => BEFORE_LABELS.has(label)) &&
    labels.some((label) => AFTER_LABELS.has(label))
  );
}

function isApiReferenceGroup(columns: ColumnsColumn[]): boolean {
  return (
    columns.length > 1 &&
    !isComparisonGroup(columns) &&
    columns.every(
      (column) =>
        column.blocks.length > 0 &&
        column.blocks.every((block) =>
          API_REFERENCE_BLOCK_TYPES.has(block.type),
        ),
    )
  );
}

function columnsLayoutClass(columns: ColumnsColumn[]): string {
  return isApiReferenceGroup(columns)
    ? COLS_CLASS[1]
    : gridColsClass(columns.length);
}

function isBlankRichTextBlock(block: NestedBlock): boolean {
  if (block.type !== "rich-text") return false;
  const data = block.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const markdown = (data as { markdown?: unknown }).markdown;
  return typeof markdown === "string" && markdown.trim().length === 0;
}

function isEffectivelyEmptyRegion(blocks: NestedBlock[]): boolean {
  return (
    blocks.length === 0 ||
    (blocks.length === 1 && isBlankRichTextBlock(blocks[0]!))
  );
}

function areSameBlocks(a: NestedBlock[], b: NestedBlock[]): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Read renderer: a responsive grid of columns, each child rendered read-only. */
export function ColumnsBlockReader({
  data,
  blockId,
  title,
  ctx,
}: BlockReadProps<ColumnsData>) {
  return (
    <section className="plan-block" data-block-id={blockId}>
      {title && <div className="plan-block-label">{title}</div>}
      <div className={cn("grid gap-6", columnsLayoutClass(data.columns))}>
        {data.columns.map((column) => (
          <div key={column.id} className="min-w-0">
            <div>
              {column.blocks.map((child) => (
                <div key={child.id}>
                  {ctx.renderBlock?.({ block: child, editing: false })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Editor: the same responsive grid, with child blocks rendered editable in
 * place through the app dispatcher. A child change updates that child within
 * its column and commits the whole
 * columns block — mirroring the legacy `tabs` onChange bubbling so the plan's
 * recursive `updateBlocks`/`findBlock` (`PlanContentRenderer`) keeps working.
 *
 * Renders BARE (no `plan-block` section / title): in edit mode the app's block
 * dispatcher already wraps registered editors in a titled `plan-block` section,
 * so wrapping again here would double-nest. The read renderer owns its own
 * section because read mode renders the spec directly.
 */
export function ColumnsBlockEditor({
  data,
  onChange,
  editable,
  blockId,
  ctx,
}: BlockEditProps<ColumnsData>) {
  const commit = (columns: ColumnsColumn[]) => onChange({ columns });

  const updateChild = (columnId: string, child: NestedBlock) =>
    commit(
      data.columns.map((column) =>
        column.id === columnId
          ? {
              ...column,
              blocks: column.blocks.map((existing) =>
                existing.id === child.id ? child : existing,
              ),
            }
          : column,
      ),
    );

  return (
    <div data-columns-edit-block={blockId} className="grid gap-3">
      <div className={cn("grid gap-6", columnsLayoutClass(data.columns))}>
        {data.columns.map((column) => (
          <div key={column.id} className="min-w-0">
            <div>
              {ctx.renderBlocksEditor
                ? ctx.renderBlocksEditor({
                    blocks: column.blocks,
                    onChange: (nextBlocks) => {
                      if (areSameBlocks(nextBlocks, column.blocks)) return;
                      onChange(
                        {
                          columns: data.columns.map((existing) =>
                            existing.id === column.id
                              ? {
                                  ...existing,
                                  blocks: nextBlocks,
                                }
                              : existing,
                          ),
                        },
                        {
                          containerRegion: {
                            regionId: column.id,
                            blocks: nextBlocks,
                          },
                        },
                      );
                    },
                    editable,
                    containerBlockId: blockId,
                    regionId: column.id,
                    regionLabel: column.label,
                  })
                : column.blocks.map((child) => (
                    <div key={child.id}>
                      {ctx.renderBlock?.({
                        block: child,
                        editing: true,
                        onChange: (next) => updateChild(column.id, next),
                      })}
                    </div>
                  ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The standard columns block spec (with React `Read`/`Edit`). Apps register this
 * in their browser registry. The schema + MDX config come from
 * `./columns.config.ts`, the exact same object server / agent code registers, so
 * rendering and source round-trip never drift.
 */
export const columnsBlock = defineBlock<ColumnsData>({
  type: "columns",
  schema: columnsSchema,
  mdx: columnsMdx,
  Read: ColumnsBlockReader,
  Edit: ColumnsBlockEditor,
  placement: ["block"],
  editSurface: "container",
  container: {
    regions: (data): BlockContainerRegion[] => data.columns,
    updateRegion: (data, regionId, blocks) => {
      const shouldRemoveRegion =
        data.columns.length > 1 && isEffectivelyEmptyRegion(blocks);

      return {
        columns: data.columns
          .map((column) =>
            column.id === regionId ? { ...column, blocks } : column,
          )
          .filter((column) => column.id !== regionId || !shouldRemoveRegion),
      };
    },
    addRegion: (data, afterRegionId) => {
      if (data.columns.length >= 4) return data;
      const nextColumn: ColumnsColumn = {
        id: newColId(),
        blocks: [],
      };
      if (!afterRegionId) return { columns: [...data.columns, nextColumn] };
      const afterIndex = data.columns.findIndex(
        (column) => column.id === afterRegionId,
      );
      if (afterIndex < 0) return { columns: [...data.columns, nextColumn] };
      return {
        columns: [
          ...data.columns.slice(0, afterIndex + 1),
          nextColumn,
          ...data.columns.slice(afterIndex + 1),
        ],
      };
    },
    removeRegion: (data, regionId) => {
      if (data.columns.length <= 1) return data;
      return {
        columns: data.columns.filter((column) => column.id !== regionId),
      };
    },
  },
  label: "Columns",
  icon: IconColumns,
  description:
    "A multi-column side-by-side layout container; each column holds its own list of blocks. Ideal for before/after or current/target comparisons.",
  empty: () => ({
    columns: [
      { id: newColId(), blocks: [] },
      { id: newColId(), blocks: [] },
    ],
  }),
});
