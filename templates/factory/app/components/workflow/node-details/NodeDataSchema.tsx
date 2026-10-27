import {
  IconBraces,
  IconChevronDown,
  IconChevronRight,
  IconCircleDashed,
  IconHash,
  IconLetterT,
  IconList,
  IconToggleRight,
  type Icon,
} from "@tabler/icons-react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { itemPath } from "@/lib/workflow-editor/drop-paths";

import { useWorkflowStrings } from "../workflow-strings";
import { MapGrip } from "./MapDrag";
import {
  dragKindOf,
  EXTRAS_FIELD_ID,
  schemaLines,
  type SchemaField,
  type SchemaLine,
  type ValueKind,
} from "./node-data-model";
import { EmptyData } from "./NodeDataStates";

const KIND_ICONS: Record<ValueKind, Icon> = {
  text: IconLetterT,
  number: IconHash,
  boolean: IconToggleRight,
  list: IconList,
  object: IconBraces,
  empty: IconCircleDashed,
};

/** Each level of nesting indents its row by this much. */
const INDENT_REM = 1.25;

/** The indent of a row, handed to its `ps-(--indent)` class as a custom property. */
function indentOf(depth: number): CSSProperties {
  return { "--indent": `${depth * INDENT_REM}rem` } as CSSProperties;
}

/**
 * The fields of a set of items, as a tree. The fixed fields come first and
 * `extras` opens by default. While a search is set, only the branches it
 * matches show, and they all open.
 */
export function SchemaView({
  fields,
  query,
  notice,
  onClear,
  dragSource = false,
}: {
  fields: readonly SchemaField[];
  query: string;
  notice?: ReactNode;
  /** Clears the search when it matches nothing. Leave it out for a schema with no search. */
  onClear?: () => void;
  /** Each field gets a grip to drag it onto a path or template field. */
  dragSource?: boolean;
}) {
  const ws = useWorkflowStrings();
  const [opened, setOpened] = useState<ReadonlySet<string>>(
    () => new Set([EXTRAS_FIELD_ID]),
  );
  const lines = useMemo(
    () => schemaLines(fields, opened, query),
    [fields, opened, query],
  );
  const toggle = (id: string) =>
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col">
      {notice}
      {lines.length === 0 ? (
        <EmptyData
          title={ws.nodeData.noMatchingFields}
          action={
            onClear ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClear}
              >
                {ws.nodeData.clearSearch}
              </Button>
            ) : undefined
          }
        />
      ) : (
        lines.map((line, index) =>
          line.kind === "more" ? (
            <div
              key={`more-${index}`}
              className="flex min-h-9.5 items-center ps-(--indent) text-sm text-muted-foreground"
              style={indentOf(line.depth)}
            >
              {ws.nodeData.moreFields(line.count)}
            </div>
          ) : (
            <FieldRow
              key={line.field.id}
              line={line}
              searching={query !== ""}
              onToggle={toggle}
              dragSource={dragSource}
            />
          ),
        )
      )}
    </div>
  );
}

function FieldRow({
  line,
  searching,
  onToggle,
  dragSource,
}: {
  line: Extract<SchemaLine, { kind: "field" }>;
  searching: boolean;
  onToggle: (id: string) => void;
  dragSource: boolean;
}) {
  const { field, depth, open, expandable } = line;
  const Glyph = KIND_ICONS[field.kind];
  const path = dragSource ? itemPath(field.segments) : null;
  return (
    <div
      className="group flex min-h-9.5 items-center gap-2 border-b border-border/60 py-1 ps-(--indent) last:border-b-0"
      style={indentOf(depth)}
    >
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          aria-label={field.label}
          disabled={searching}
          onClick={() => onToggle(field.id)}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          {open ? (
            <IconChevronDown className="size-3.5" aria-hidden />
          ) : (
            <IconChevronRight className="size-3.5" aria-hidden />
          )}
        </button>
      ) : (
        <span className="size-5 shrink-0" aria-hidden />
      )}
      <span
        className={cn(
          "inline-flex h-6 max-w-1/2 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium",
          field.preview
            ? "border border-dashed border-border text-muted-foreground"
            : "bg-muted text-foreground",
        )}
      >
        <Glyph className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{field.label}</span>
      </span>
      {field.sample !== null ? (
        <span
          className="min-w-0 flex-1 truncate text-sm text-muted-foreground"
          title={field.sample}
        >
          {field.sample}
        </span>
      ) : null}
      {path ? <MapGrip path={path} kind={dragKindOf(field)} /> : null}
    </div>
  );
}
