import {
  IconColumnInsertRight,
  IconPlus,
  IconRowInsertBottom,
  IconTable,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { defineBlock } from "../types.js";
import type { BlockEditProps, BlockReadProps } from "../types.js";
import { tableMdx, tableSchema, type TableData } from "./table.config.js";

/**
 * Standard `table` block — a simple grid of header columns and string rows.
 * STANDARD library block: lives in core (`@agent-native/core/blocks`) so any
 * app can register it. The plan app's registries (server + client) import
 * {@link tableBlock} (browser) and the React-free {@link tableMdx}/
 * {@link tableSchema} config (server) so its render + MDX round-trip move out
 * of the plan `PlanBlockView` switch / `serializeBlock` into the registry,
 * while the legacy branch stays as a backward-compatible fallback for
 * unregistered renderers.
 */

/**
 * Read-only renderer. Mirrors the legacy plan `PlanBlockView` table branch
 * markup byte-for-byte (same `plan-block overflow-x-auto` section + title +
 * `plan-line`/`plan-muted` table) so converting the block to the registry does
 * not change the rendered output. The `plan-*` class names are styled by the
 * consuming app's CSS — core only emits the markup, exactly like the existing
 * `CalloutBlock` read renderer.
 */
function TableBlockRead({ data, blockId, title }: BlockReadProps<TableData>) {
  return (
    <section className="plan-block overflow-x-auto" data-block-id={blockId}>
      {title && <div className="plan-block-label">{title}</div>}
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="border-b border-plan-line text-sm text-plan-muted">
            {data.columns.map((column) => (
              <th key={column} className="py-3 pr-4 font-semibold">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, index) => (
            <tr key={index} className="border-b border-plan-line">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="py-4 pr-4 text-plan-muted">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const editInputClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const iconButtonClass =
  "inline-flex size-7 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50";

const addButtonClass =
  "inline-flex items-center gap-1.5 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Editable grid. The schema's `columns: string[]` / `rows: string[][]` are
 * positional/structured, which the schema auto-editor intentionally cannot
 * render, so this block supplies its own `Edit`: an editable header row plus a
 * body grid, with add/remove controls for both columns and rows. Every change
 * commits a full new `{ columns, rows }` value (re-validated upstream by the
 * registry), keeping rows rectangular with the column count.
 */
function TableBlockEdit({
  data,
  onChange,
  editable,
}: BlockEditProps<TableData>) {
  const columns = data.columns ?? [];
  const rows = data.rows ?? [];
  const columnCount = columns.length;

  const commit = (next: TableData) => onChange(next);

  const setColumn = (index: number, value: string) => {
    commit({
      columns: columns.map((c, i) => (i === index ? value : c)),
      rows,
    });
  };

  const setCell = (rowIndex: number, cellIndex: number, value: string) => {
    commit({
      columns,
      rows: rows.map((row, i) =>
        i === rowIndex
          ? row.map((cell, j) => (j === cellIndex ? value : cell))
          : row,
      ),
    });
  };

  const addColumn = () => {
    commit({
      columns: [...columns, `Column ${columnCount + 1}`],
      // Keep rows rectangular: append an empty cell to every row.
      rows: rows.map((row) => [...row, ""]),
    });
  };

  const removeColumn = (index: number) => {
    commit({
      columns: columns.filter((_, i) => i !== index),
      rows: rows.map((row) => row.filter((_, i) => i !== index)),
    });
  };

  const addRow = () => {
    commit({
      columns,
      // New row matches the current column count.
      rows: [
        ...rows,
        Array.from({ length: Math.max(columnCount, 1) }, () => ""),
      ],
    });
  };

  const removeRow = (index: number) => {
    commit({ columns, rows: rows.filter((_, i) => i !== index) });
  };

  return (
    <div className="an-table-block-editor flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-left">
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th key={index} className="p-1 align-top">
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      data-plan-interactive
                      aria-label={`Column ${index + 1} header`}
                      className={editInputClass}
                      value={column}
                      disabled={!editable}
                      onChange={(event) => setColumn(index, event.target.value)}
                    />
                    <button
                      type="button"
                      data-plan-interactive
                      aria-label={`Remove column ${index + 1}`}
                      className={iconButtonClass}
                      disabled={!editable}
                      onClick={() => removeColumn(index)}
                    >
                      <IconX size={14} />
                    </button>
                  </div>
                </th>
              ))}
              <th className="p-1 align-top">
                <button
                  type="button"
                  data-plan-interactive
                  aria-label="Add column"
                  className={iconButtonClass}
                  disabled={!editable}
                  onClick={addColumn}
                >
                  <IconColumnInsertRight size={16} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {Array.from({ length: columnCount }).map((_, cellIndex) => (
                  <td key={cellIndex} className="p-1 align-top">
                    <input
                      type="text"
                      data-plan-interactive
                      aria-label={`Row ${rowIndex + 1}, column ${cellIndex + 1}`}
                      className={editInputClass}
                      value={row[cellIndex] ?? ""}
                      disabled={!editable}
                      onChange={(event) =>
                        setCell(rowIndex, cellIndex, event.target.value)
                      }
                    />
                  </td>
                ))}
                <td className="p-1 align-top">
                  <button
                    type="button"
                    data-plan-interactive
                    aria-label={`Remove row ${rowIndex + 1}`}
                    className={iconButtonClass}
                    disabled={!editable}
                    onClick={() => removeRow(rowIndex)}
                  >
                    <IconTrash size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-plan-interactive
          className={addButtonClass}
          disabled={!editable}
          onClick={addRow}
        >
          <IconRowInsertBottom size={16} />
          Add row
        </button>
        <button
          type="button"
          data-plan-interactive
          className={addButtonClass}
          disabled={!editable}
          onClick={addColumn}
        >
          <IconPlus size={16} />
          Add column
        </button>
      </div>
    </div>
  );
}

/**
 * The full standard `table` `BlockSpec`. Pairs the React-free
 * {@link tableSchema}/{@link tableMdx} config (also used by the server registry)
 * with the React `Read`/`Edit`. `empty()` seeds a 2×2 grid for slash insertion.
 */
export const tableBlock = defineBlock<TableData>({
  type: "table",
  schema: tableSchema,
  mdx: tableMdx,
  Read: TableBlockRead,
  Edit: TableBlockEdit,
  placement: ["block"],
  // A simple grid maps to an NFM table, so it round-trips to Notion.
  notionCompatible: true,
  label: "Table",
  icon: ({ size, className }) => (
    <IconTable size={size} className={className} />
  ),
  description:
    "A simple grid with header columns and string rows for comparisons, parameters, or structured lists.",
  empty: () => ({
    columns: ["Column 1", "Column 2"],
    rows: [
      ["", ""],
      ["", ""],
    ],
  }),
});
