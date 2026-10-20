import { IconCopy, IconTrash, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  Rejection,
  WorkflowEditor,
  WorkflowNode,
} from "@/lib/workflow-editor";

import { IssueMark } from "../IssueMark";
import { NODE_KIND_ICONS } from "../node-kinds";
import { useWorkflowCanvasStrings } from "../strings";
import { useEditorSnapshot } from "../use-workflow-editor";
import { buildFormContext, type FormContext } from "./context";
import { TextInput } from "./fields";
import { AiForm } from "./forms/AiForm";
import { CombineForm } from "./forms/CombineForm";
import { EndForm } from "./forms/EndForm";
import { FilterForm } from "./forms/FilterForm";
import { ActionForm, AgentForm, LookupForm } from "./forms/OperationNodeForm";
import { SourceForm } from "./forms/SourceForm";
import { SplitForm } from "./forms/SplitForm";
import { SwitchForm } from "./forms/SwitchForm";
import { TriggerForm } from "./forms/TriggerForm";
import { WaitForm } from "./forms/WaitForm";
import { useSettingsDraft } from "./use-settings-draft";

function SettingsForm({
  editor,
  node,
  context,
}: {
  editor: WorkflowEditor;
  node: WorkflowNode;
  context: FormContext;
}) {
  const { settings, issues, update } = useSettingsDraft(editor, node);
  // The draft holds this node's own kind of settings, so each branch below can
  // hand it to the form for that kind; the union cannot say so on its own.
  const props = {
    settings: settings as never,
    onChange: update as never,
    context,
  };
  let form;
  switch (node.kind) {
    case "trigger":
      form = <TriggerForm {...props} />;
      break;
    case "source":
      form = <SourceForm {...props} />;
      break;
    case "lookup":
      form = <LookupForm {...props} />;
      break;
    case "action":
      form = <ActionForm {...props} />;
      break;
    case "filter":
      form = <FilterForm {...props} />;
      break;
    case "switch":
      form = <SwitchForm {...props} />;
      break;
    case "combine":
      form = <CombineForm {...props} />;
      break;
    case "split":
      form = <SplitForm {...props} />;
      break;
    case "ai":
      form = <AiForm {...props} />;
      break;
    case "agent":
      form = <AgentForm {...props} />;
      break;
    case "wait":
      form = <WaitForm {...props} />;
      break;
    case "end":
      form = <EndForm {...props} />;
      break;
  }
  return (
    <>
      {form}
      {issues.length > 0 && (
        <ul
          role="alert"
          className="flex flex-col gap-1 text-xs text-destructive"
        >
          {issues.map((issue, index) => (
            <li key={`${index}:${issue.message}`}>
              {issue.path.length > 0 && (
                <span className="font-mono">{issue.path.join(".")}: </span>
              )}
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function HeaderButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function InspectorContent({
  editor,
  node,
  readOnly,
  footer,
  onClose,
}: {
  editor: WorkflowEditor;
  node: WorkflowNode;
  readOnly: boolean;
  footer?: ReactNode;
  onClose: () => void;
}) {
  const s = useWorkflowCanvasStrings();

  const { graph } = useEditorSnapshot(editor);
  const issues = editor.validate().byNode[node.id] ?? [];
  const context = useMemo(
    () => buildFormContext(graph, node, editor.catalog),
    [graph, node, editor.catalog],
  );
  const KindIcon = NODE_KIND_ICONS[node.kind];

  const [name, setName] = useState(node.name);
  const [renameError, setRenameError] = useState<Rejection | null>(null);
  const [stale, setStale] = useState<{
    oldName: string;
    where: string[];
  } | null>(null);
  useEffect(() => {
    setName(node.name);
    setRenameError(null);
  }, [node.name]);

  const commitName = () => {
    if (name === node.name) return;
    const result = editor.renameNode(node.id, name);
    if (!result.ok) return setRenameError(result.rejection);
    setRenameError(null);
    setStale(
      result.references.length > 0
        ? {
            oldName: node.name,
            where: result.references.map((reference) => {
              const holder = graph.nodes.find((n) => n.id === reference.nodeId);
              return s.inspector.staleWhere(
                holder?.name ?? reference.nodeId,
                reference.where,
              );
            }),
          }
        : null,
    );
  };

  const refuse = (outcome: { ok: boolean; rejection?: Rejection }) => {
    if (!outcome.ok && outcome.rejection) {
      toast.error(s.rejection[outcome.rejection.code]);
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <header className="flex items-start gap-2 border-b border-border px-4 py-3">
        <span
          role="img"
          aria-label={s.kind[node.kind]}
          title={s.kind[node.kind]}
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted"
        >
          <KindIcon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <TextInput
            value={name}
            aria-label={s.inspector.nameLabel}
            invalid={renameError !== null}
            onChange={(next) => {
              setName(next);
              setRenameError(null);
            }}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitName();
              if (event.key === "Escape") {
                event.stopPropagation();
                setName(node.name);
                setRenameError(null);
              }
            }}
          />
          {renameError && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {s.rejection[renameError.code]}
            </p>
          )}
          {stale && (
            <p className="mt-1 text-xs text-muted-foreground">
              {s.inspector.renamedStale(stale.where.length, stale.oldName)}{" "}
              {stale.where.slice(0, 3).join("; ")}
            </p>
          )}
        </div>
        {!readOnly && (
          <>
            <HeaderButton
              label={s.toolbar.duplicate}
              onClick={() => refuse(editor.duplicateNodes([node.id]))}
            >
              <IconCopy />
            </HeaderButton>
            <HeaderButton
              label={s.toolbar.delete}
              onClick={() =>
                refuse(editor.deleteElements({ nodeIds: [node.id] }))
              }
            >
              <IconTrash />
            </HeaderButton>
          </>
        )}
        <HeaderButton label={s.inspector.closeLabel} onClick={onClose}>
          <IconX />
        </HeaderButton>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <fieldset
          disabled={readOnly}
          className="flex min-w-0 flex-col gap-4 p-4"
        >
          <SettingsForm editor={editor} node={node} context={context} />
          {issues.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <IssueMark issues={issues} />
              <span>{s.inspector.problemsHeading}</span>
            </div>
          )}
        </fieldset>
      </ScrollArea>
      {footer ? (
        <div className="shrink-0 border-t border-border p-3">{footer}</div>
      ) : null}
    </TooltipProvider>
  );
}

export interface NodeInspectorProps {
  editor: WorkflowEditor;
  readOnly?: boolean;
  /** `docked` fills the height of its parent beside the canvas; `sheet` slides over it on narrow screens. */
  presentation?: "docked" | "sheet";
  /** Pinned under the settings, which scroll above it. */
  footer?: ReactNode;
  className?: string;
}

/**
 * Settings for the one selected step, with a form built for its kind from the
 * contract and its operation's declared fields. Renders nothing unless exactly
 * one step is selected, so the canvas takes the room back.
 */
export function NodeInspector({
  editor,
  readOnly = false,
  presentation = "docked",
  footer,
  className,
}: NodeInspectorProps) {
  const s = useWorkflowCanvasStrings();

  const { graph, selection } = useEditorSnapshot(editor);
  const node =
    selection.nodeIds.length === 1
      ? graph.nodes.find((candidate) => candidate.id === selection.nodeIds[0])
      : undefined;
  if (!node) return null;
  const close = () => editor.clearSelection();
  const content = (
    <InspectorContent
      key={node.id}
      editor={editor}
      node={node}
      readOnly={readOnly}
      footer={footer}
      onClose={close}
    />
  );
  if (presentation === "sheet") {
    return (
      <Sheet open onOpenChange={(open) => !open && close()}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-sm [&>button]:hidden"
          // Opening must not drop the cursor into the name box and select it.
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <SheetTitle className="sr-only">{s.inspector.panelName}</SheetTitle>
          <SheetDescription className="sr-only">{node.name}</SheetDescription>
          {content}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <aside
      aria-label={s.inspector.panelName}
      className={cn(
        "flex h-full w-96 shrink-0 flex-col border-s border-border bg-background",
        className,
      )}
    >
      {content}
    </aside>
  );
}
