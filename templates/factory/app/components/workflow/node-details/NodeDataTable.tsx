import { Badge } from "@/components/ui/badge";
import { itemPath } from "@/lib/workflow-editor/drop-paths";

import type { NodeDataItem } from "../../../../server/workflow-host/read-models.js";
import { shortId } from "../items/format";
import { useWorkflowStrings } from "../workflow-strings";
import { MapGrip } from "./MapDrag";
import { valueKind, type TableColumn } from "./node-data-model";
import { JsonEntry } from "./NodeDataJson";

/** One row per item, one column per field. A stub item has no fields, so its row shows only its short id. */
export function TableView({
  rows,
  columns,
  dragSource = false,
}: {
  rows: readonly NodeDataItem[];
  columns: { shown: readonly TableColumn[]; hidden: number };
  /** Each column header gets a grip to drag the column onto a path or template field. */
  dragSource?: boolean;
}) {
  const ws = useWorkflowStrings();
  return (
    <div className="flex flex-col gap-2">
      {columns.hidden > 0 ? (
        <p className="text-xs text-muted-foreground">
          {ws.nodeData.hiddenColumns}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/50">
            <tr>
              {columns.shown.map((column) => {
                const path = dragSource ? itemPath(column.segments) : null;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className="group whitespace-nowrap border-b border-border px-3 py-2 text-start text-xs font-medium text-muted-foreground"
                  >
                    <span className="inline-flex items-center gap-1">
                      {column.label}
                      {path ? <MapGrip path={path} kind={column.kind} /> : null}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((item) =>
              item.synthetic ? (
                <tr
                  key={item.itemId}
                  className="border-b border-border last:border-b-0"
                >
                  <td
                    colSpan={columns.shown.length}
                    className="px-3 py-2 font-mono text-xs text-muted-foreground"
                  >
                    {shortId(item.itemId)}
                  </td>
                </tr>
              ) : (
                <tr
                  key={item.itemId}
                  className="border-b border-border align-top last:border-b-0"
                >
                  {columns.shown.map((column, index) => (
                    <td key={column.key} className="max-w-64 px-3 py-2">
                      {index === 0 && item.truncated ? (
                        <Badge variant="outline" className="mb-1">
                          {ws.nodeData.truncated}
                        </Badge>
                      ) : null}
                      <Cell value={column.read(item)} />
                    </td>
                  ))}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ value }: { value: unknown }) {
  const kind = valueKind(value);
  if (kind === "empty") return <span className="text-muted-foreground">—</span>;
  if (kind === "list" || kind === "object")
    return <NestedValue value={value} />;
  return (
    <span className="block truncate" title={String(value)}>
      {String(value)}
    </span>
  );
}

/** A nested value shows its brackets and size; opening it shows the tree inside. */
function NestedValue({ value }: { value: unknown }) {
  const isList = Array.isArray(value);
  const size = isList ? value.length : Object.keys(value as object).length;
  const [open, close] = isList ? ["[", "]"] : ["{", "}"];
  return (
    <details className="group">
      <summary className="cursor-pointer list-none font-mono text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
        {open}
        {size}
        {close}
      </summary>
      <div className="mt-1 max-w-md overflow-x-auto whitespace-nowrap font-mono text-xs">
        <JsonEntry
          label={null}
          value={value}
          segments={[]}
          comma={false}
          copyable={false}
        />
      </div>
    </details>
  );
}
