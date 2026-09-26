import {
  IconColumnInsertRight,
  IconPlus,
  IconRowInsertBottom,
  IconTable,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { defineBlock } from "../types.js";
import type {
  BlockEditProps,
  BlockReadProps,
  BlockRenderContext,
} from "../types.js";
import {
  tableMdx,
  tableSchema,
  type TableData,
  type TableDensity,
} from "./table.config.js";

const densityClasses: Record<TableDensity, { header: string; cell: string }> = {
  compact: {
    header: "py-1.5",
    cell: "py-2",
  },
  normal: {
    header: "py-3",
    cell: "py-4",
  },
  relaxed: {
    header: "py-5",
    cell: "py-6",
  },
};

function resolveDensity(data: TableData): TableDensity {
  return data.density ?? "normal";
}

function TableBlockRead({
  data,
  blockId,
  title,
  ctx,
}: BlockReadProps<TableData>) {
  const density = resolveDensity(data);
  const spacing = densityClasses[density];

  return (
    <section className="plan-block overflow-x-auto" data-block-id={blockId}>
      {title && <div className="plan-block-label">{title}</div>}
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="border-b border-plan-line text-sm text-plan-muted">
            {data.columns.map((column) => (
              <th
                key={column}
                className={`${spacing.header} pr-4 font-semibold`}
              >
                {renderTableMarkdown(ctx, column, tableHeaderMarkdownClass)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, index) => (
            <tr key={index} className="border-b border-plan-line">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`${spacing.cell} pr-4 text-plan-muted`}
                >
                  {renderTableMarkdown(ctx, cell, tableCellMarkdownClass)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const tableCellMarkdownClass =
  "an-table-cell-markdown mt-0 max-w-none text-plan-muted";

const tableHeaderMarkdownClass = `${tableCellMarkdownClass} an-table-cell-markdown--header font-semibold`;

const plainTextFieldBaseClass =
  "min-h-6 w-full whitespace-pre-wrap break-words rounded-sm border border-transparent bg-transparent px-0 leading-6 text-plan-muted outline-none focus:border-transparent focus:bg-transparent focus:px-0 focus:outline-none focus:ring-0 focus-visible:border-transparent focus-visible:bg-transparent focus-visible:px-0 focus-visible:outline-none focus-visible:ring-0 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50";

const iconButtonBaseClass =
  "inline-flex size-7 items-center justify-center rounded-md border border-input bg-background/80 text-muted-foreground opacity-0 shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-50";

const tableHoverIconButtonClass = `${iconButtonBaseClass} group-hover/table:opacity-100`;

const columnHoverIconButtonClass = `${iconButtonBaseClass} group-hover/column:opacity-100`;

const rowHoverIconButtonClass = `${iconButtonBaseClass} group-hover/row:opacity-100`;

const addButtonClass =
  "inline-flex items-center gap-1.5 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm text-muted-foreground opacity-0 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 group-hover/table:opacity-100 disabled:cursor-not-allowed disabled:opacity-50";

function renderTableMarkdown(
  ctx: BlockRenderContext,
  value: string,
  className: string,
) {
  return ctx.renderMarkdown?.(value, { className }) ?? value;
}

function TableMarkdownField({
  ctx,
  value,
  onChange,
  editable,
  ariaLabel,
  className,
}: {
  ctx: BlockRenderContext;
  value: string;
  onChange: (value: string) => void;
  editable: boolean;
  ariaLabel: string;
  className: string;
}) {
  const editor = ctx.renderMarkdownEditor?.({
    value,
    onChange,
    editable,
    className,
    ariaLabel,
  });

  if (editor) return editor;

  return (
    <PlainTextTableField
      value={value}
      onChange={onChange}
      editable={editable}
      ariaLabel={ariaLabel}
      className={`${plainTextFieldBaseClass} ${className}`}
    />
  );
}

function PlainTextTableField({
  value,
  onChange,
  editable,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  editable: boolean;
  ariaLabel: string;
  className: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || document.activeElement === node) return;
    if (node.textContent !== value) node.textContent = value;
  }, [value]);

  const handleInput = (event: FormEvent<HTMLDivElement>) => {
    onChange(event.currentTarget.textContent ?? "");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.currentTarget.blur();
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    onChange(event.currentTarget.textContent ?? "");
  };

  return (
    <div
      ref={ref}
      data-plan-interactive
      data-disabled={!editable ? "true" : undefined}
      role="textbox"
      aria-label={ariaLabel}
      contentEditable={editable}
      suppressContentEditableWarning
      className={className}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
    />
  );
}

function TableBlockEdit({
  data,
  onChange,
  editable,
  ctx,
}: BlockEditProps<TableData>) {
  const columns = data.columns ?? [];
  const rows = data.rows ?? [];
  const columnCount = columns.length;
  const density = resolveDensity(data);
  const spacing = densityClasses[density];

  const commit = (next: TableData) => onChange({ ...data, ...next });

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
      rows: rows.map((row) => [...row, ""]),
    });
  };

  const removeColumn = (index: number) => {
    if (columns.length <= 1) return;
    commit({
      columns: columns.filter((_, i) => i !== index),
      rows: rows.map((row) => row.filter((_, i) => i !== index)),
    });
  };

  const addRow = () => {
    commit({
      columns,
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
    <div className="an-table-block-editor group/table flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-left">
          <thead>
            <tr className="border-b border-plan-line">
              {columns.map((column, index) => (
                <th
                  key={index}
                  className={`group/column ${spacing.header} pr-4 align-top`}
                >
                  <div className="flex items-center gap-2">
                    <TableMarkdownField
                      ctx={ctx}
                      value={column}
                      onChange={(value) => setColumn(index, value)}
                      editable={editable}
                      ariaLabel={`Column ${index + 1} header`}
                      className={tableHeaderMarkdownClass}
                    />
                    <button
                      type="button"
                      data-plan-interactive
                      aria-label={`Remove column ${index + 1}`}
                      className={columnHoverIconButtonClass}
                      disabled={!editable || columns.length <= 1}
                      onClick={() => removeColumn(index)}
                    >
                      <IconX size={14} />
                    </button>
                  </div>
                </th>
              ))}
              <th className="py-1 align-top">
                <button
                  type="button"
                  data-plan-interactive
                  aria-label="Add column in grid"
                  className={tableHoverIconButtonClass}
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
              <tr
                key={rowIndex}
                className="group/row border-b border-plan-line"
              >
                {Array.from({ length: columnCount }).map((_, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={`${spacing.cell} pr-4 align-top`}
                  >
                    <TableMarkdownField
                      ctx={ctx}
                      value={row[cellIndex] ?? ""}
                      onChange={(value) => setCell(rowIndex, cellIndex, value)}
                      editable={editable}
                      ariaLabel={`Row ${rowIndex + 1}, column ${cellIndex + 1}`}
                      className={tableCellMarkdownClass}
                    />
                  </td>
                ))}
                <td className="py-2 align-top">
                  <button
                    type="button"
                    data-plan-interactive
                    aria-label={`Remove row ${rowIndex + 1}`}
                    className={rowHoverIconButtonClass}
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

export const tableBlock = defineBlock<TableData>({
  type: "table",
  schema: tableSchema,
  mdx: tableMdx,
  Read: TableBlockRead,
  Edit: TableBlockEdit,
  placement: ["block"],
  editSurface: "inline",
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
