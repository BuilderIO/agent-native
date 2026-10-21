import { IconCopy } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { itemPath } from "@/lib/workflow-editor/drop-paths";

import type { NodeDataItem } from "../../../../server/workflow-host/read-models.js";
import { useWorkflowStrings } from "../workflow-strings";
import { MapGrip } from "./MapDrag";
import {
  fieldsOf,
  valueKind,
  type Segment,
  type ValueKind,
} from "./node-data-model";

/** Each item as the JSON its workflow steps read: the fixed fields, then the extras. */
export function JsonView({
  items,
  dragKindAt,
}: {
  items: readonly NodeDataItem[];
  /** Each key gets a grip to drag it onto a path or template field. Given a key's path, this is the kind the drag carries. */
  dragKindAt?: (segments: readonly Segment[]) => ValueKind;
}) {
  const ws = useWorkflowStrings();
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) =>
        item.synthetic ? (
          <JsonBlock key={item.itemId}>
            <JsonEntry
              label={null}
              value={{ itemId: item.itemId }}
              segments={[]}
              comma={false}
              copyable={false}
            />
          </JsonBlock>
        ) : (
          <JsonBlock
            key={item.itemId}
            badge={item.truncated ? ws.nodeData.truncated : null}
          >
            <JsonEntry
              label={null}
              value={fieldsOf(item)}
              segments={[]}
              comma={false}
              copyable
              dragKindAt={dragKindAt}
            />
          </JsonBlock>
        ),
      )}
    </div>
  );
}

function JsonBlock({
  badge,
  children,
}: {
  badge?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      {badge ? (
        <Badge variant="outline" className="mb-2">
          {badge}
        </Badge>
      ) : null}
      <div className="font-mono text-xs leading-5">{children}</div>
    </div>
  );
}

/**
 * One value in the tree, with its key or index before it. A container prints
 * its brackets and the entries inside them; `copyable` puts a copy-path button
 * on each key line, and `label` null means the value is the whole item.
 */
export function JsonEntry({
  label,
  value,
  segments,
  comma,
  copyable,
  dragKindAt,
  keyed = false,
}: {
  label: ReactNode | null;
  value: unknown;
  /** The path from the item root to this value. */
  segments: readonly Segment[];
  comma: boolean;
  copyable: boolean;
  /** Object keys get a grip to drag them, when the view is a drag source. Given a key's path, this is the kind the drag carries. */
  dragKindAt?: (segments: readonly Segment[]) => ValueKind;
  /** This entry is an object key, not a list index. */
  keyed?: boolean;
}) {
  const kind = valueKind(value);
  const path = copyable && label !== null ? itemPath(segments) : null;
  const dragPath =
    dragKindAt && keyed && label !== null ? itemPath(segments) : null;
  const grip =
    dragPath !== null && dragKindAt ? (
      <MapGrip path={dragPath} kind={dragKindAt(segments)} />
    ) : null;
  const prefix =
    label === null ? null : (
      <>
        {label}
        {": "}
      </>
    );
  const trailing = comma ? "," : "";

  if (kind === "list" || kind === "object") {
    const isList = kind === "list";
    const entries = isList
      ? (value as unknown[]).map((child, index) => ({
          segment: index as Segment,
          label: <span className="text-muted-foreground">{index}</span>,
          value: child,
        }))
      : Object.entries(value as Record<string, unknown>).map(
          ([key, child]) => ({
            segment: key as Segment,
            label: (
              <span className="text-kind-data">{JSON.stringify(key)}</span>
            ),
            value: child,
          }),
        );
    const [open, close] = isList ? ["[", "]"] : ["{", "}"];
    if (entries.length === 0) {
      return (
        <Line path={path} grip={grip}>
          {prefix}
          {open}
          {close}
          {trailing}
        </Line>
      );
    }
    return (
      <div>
        <Line path={path} grip={grip}>
          {prefix}
          {open}
        </Line>
        <div className="ps-4">
          {entries.map((entry, index) => (
            <JsonEntry
              key={String(entry.segment)}
              label={entry.label}
              value={entry.value}
              segments={[...segments, entry.segment]}
              comma={index < entries.length - 1}
              copyable={copyable}
              dragKindAt={dragKindAt}
              keyed={!isList}
            />
          ))}
        </div>
        <Line path={null}>
          {close}
          {trailing}
        </Line>
      </div>
    );
  }

  return (
    <Line path={path} grip={grip}>
      {prefix}
      <Primitive value={value} />
      {trailing}
    </Line>
  );
}

function Line({
  path,
  grip,
  children,
}: {
  path: string | null;
  /** The grip that drags this line's key, when the view is a drag source. */
  grip?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="group flex items-start gap-1">
      <span className="min-w-0 flex-1 break-words">{children}</span>
      {grip}
      {path === null ? null : <CopyPathButton path={path} />}
    </div>
  );
}

function Primitive({ value }: { value: unknown }) {
  switch (valueKind(value)) {
    case "text":
      return <span className="text-foreground">{JSON.stringify(value)}</span>;
    case "number":
    case "boolean":
      return <span className="text-kind-flow">{String(value)}</span>;
    case "empty":
      return <span className="text-muted-foreground">null</span>;
    case "list":
    case "object":
      return null;
  }
}

function CopyPathButton({ path }: { path: string }) {
  const ws = useWorkflowStrings();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(path);
      toast.success(ws.nodeData.pathCopied);
    } catch {
      toast.error(ws.nodeData.pathCopyFailed);
    }
  };
  // The button stays hidden until its line is hovered or the button is focused.
  return (
    <span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 motion-reduce:transition-none">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={ws.nodeData.copyPath}
        title={`${ws.nodeData.copyPath}: ${path}`}
        onClick={() => void copy()}
      >
        <IconCopy />
      </Button>
    </span>
  );
}
