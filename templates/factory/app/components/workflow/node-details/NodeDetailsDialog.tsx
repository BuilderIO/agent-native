import { useActionQuery } from "@agent-native/core/client/hooks";
import {
  IconCopy,
  IconExternalLink,
  IconMessage,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useRef, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useEditorSnapshot,
  type StepOverlay,
} from "@/components/workflow-canvas";
import {
  NODE_KIND_ICONS,
  nodeProvider,
  providerName,
} from "@/components/workflow-canvas/node-kinds";
import { nodeTitle } from "@/components/workflow-canvas/node-summary";
import { useWorkflowCanvasStrings } from "@/components/workflow-canvas/strings";
import type {
  Rejection,
  WorkflowEditor,
  WorkflowNode,
} from "@/lib/workflow-editor";
import { requestPathOf } from "@/lib/workflow-editor/api-request";

import type { NodeData } from "../../../../server/workflow-host/read-models.js";
import { docsUrlOf } from "../api-provider-catalog";
import { canTestRequestOnItsOwn } from "../api-request-test";
import { classifyReadError } from "../items/read-failure";
import { useApiRequestTest } from "../use-api-request-test";
import { useProviderApiCatalog } from "../use-provider-api-catalog";
import { useWorkflowStrings } from "../workflow-strings";
import { ApiRequestOutputPane } from "./ApiRequestOutputPane";
import { MapDragProvider } from "./MapDrag";
import { leaveField, NodeDetailsName } from "./NodeDetailsName";
import {
  NodeDetailsInputPane,
  NodeDetailsOutputPane,
} from "./NodeDetailsPanes";
import { NodeDetailsParameters } from "./NodeDetailsParameters";

/** Fields that take typed text, which Escape leaves before it closes the modal. */
const TEXT_FIELD =
  "textarea, input:not([type=button]):not([type=checkbox]):not([type=color]):not([type=file]):not([type=hidden]):not([type=radio]):not([type=range]):not([type=reset]):not([type=submit])";

/** The fields a person edits in the Parameters column. */
const PARAMETER_FIELD =
  "input:not([type=hidden]):not(:disabled), textarea:not(:disabled), [role=combobox]:not(:disabled)";

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
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

/** A link to the provider's API docs, for a step that reads one of its endpoints. Nothing shows until the catalog has a page for it. */
function ApiDocsLink({ node }: { node: WorkflowNode }) {
  const ws = useWorkflowStrings();
  const catalog = useProviderApiCatalog();
  const provider = nodeProvider(node);
  const url =
    provider === null
      ? undefined
      : docsUrlOf(catalog.data?.providers, provider);
  if (provider === null || url === undefined) return null;
  return (
    <Button asChild variant="ghost" size="sm">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={ws.apiRequest.docsFor(providerName(provider))}
      >
        {ws.apiRequest.docs}
        <IconExternalLink />
      </a>
    </Button>
  );
}

interface NodeDetailsDialogProps {
  editor: WorkflowEditor;
  factoryId: string;
  workflowId: string;
  /** The step to show. Without one the modal is closed. */
  node: WorkflowNode | undefined;
  onClose: () => void;
  /** Opens with the name field focused, as F2 and Space do on the canvas. Enter there commits the name and closes the modal. */
  focusName: boolean;
  /** The step is opened for the first time after it was added: its issue marks wait. */
  quiet: boolean;
  /** A field was left, or a test started: the issue marks show. */
  onEngage: () => void;
  runId: string | null;
  /** The run is queued and has no steps to read yet. */
  runPending: boolean;
  /** What the open run did at each step, by node id. */
  steps: Readonly<Record<string, StepOverlay>> | undefined;
  /** The steps of the workflow the server has, which is not always the one on the canvas. */
  serverNodeIds: ReadonlySet<string>;
  dirty: boolean;
  /** A save or a run is starting. */
  starting: boolean;
  /** Resolves to whether the run started. */
  onTestStep: (nodeId: string, sampleItemIds: string[]) => Promise<boolean>;
  /** Saves the page's edits, which a test of one API request sends from the saved workflow. Resolves to whether they are saved. */
  onSave: () => Promise<boolean>;
  /** Items waiting at this step, when it is a Wait. */
  parkedCount: number;
  /** Saves the page and runs a dry run of the whole workflow, as the toolbar's Test does. */
  onTestWorkflow: () => void;
  /** Hands the step to the agent sidebar; the modal closes first, or its overlay would cover the sidebar. */
  onAskAgent: () => void;
  /** A read-only modal shows no drag grips and takes no drops. */
  readOnly?: boolean;
}

/**
 * One step's details over the canvas: its name, its parameters and history, and
 * its input and output. Closing it leaves the step selected.
 */
export function NodeDetailsDialog({
  editor,
  factoryId,
  workflowId,
  node,
  onClose,
  focusName,
  quiet,
  onEngage,
  runId,
  runPending,
  steps,
  serverNodeIds,
  dirty,
  starting,
  onTestStep,
  onSave,
  parkedCount,
  onTestWorkflow,
  onAskAgent,
  readOnly = false,
}: NodeDetailsDialogProps) {
  const ws = useWorkflowStrings();
  const s = useWorkflowCanvasStrings();
  const { graph } = useEditorSnapshot(editor);
  const nameRef = useRef<HTMLInputElement>(null);
  const parametersRef = useRef<HTMLDivElement>(null);

  // The step's items come from the saved workflow, so a step not saved yet has none to read and has never run.
  const onServer = node !== undefined && serverNodeIds.has(node.id);
  const dataQuery = useActionQuery<NodeData>(
    "get-workflow-node-data",
    {
      factoryId,
      workflowId,
      nodeId: node?.id ?? "",
      ...(runId ? { runId } : {}),
    },
    // While the run is queued it has no steps yet, so the read waits for the run to start.
    { enabled: onServer && !runPending },
  );
  const data = onServer ? (dataQuery.data ?? null) : null;
  const dataLoading = onServer && (runPending || dataQuery.isPending);
  const dataFailure = dataQuery.isError
    ? classifyReadError(dataQuery.error)
    : null;
  const refetchData = () => void dataQuery.refetch();
  // An API request that reads nothing about an item is sent from here and answers on this screen; the answer lives in this state and goes with the window.
  const apiTest = useApiRequestTest({
    factoryId,
    workflowId,
    nodeId: node?.id,
    save: onSave,
    unknownMessage: ws.errors.unknown,
  });

  if (!node) return null;
  const KindIcon = NODE_KIND_ICONS[node.kind];
  const title = nodeTitle(node, editor.catalog, s);
  // A trigger has no upstream items, so it has no input pane.
  const hasInput = node.kind !== "trigger";
  const isApiRequest = requestPathOf(node, editor.catalog) !== undefined;
  const testsInWindow = canTestRequestOnItsOwn(node, editor.catalog);

  const output = {
    factoryId,
    workflowId,
    node,
    catalog: editor.catalog,
    data,
    loading: dataLoading,
    failure: dataFailure,
    onRetry: refetchData,
    onServer,
    dirty,
    starting: starting || apiTest.running,
    parkedCount,
    onTest: (nodeId: string, sampleItemIds: string[]) => {
      onEngage();
      if (testsInWindow) apiTest.run();
      else void onTestStep(nodeId, sampleItemIds);
    },
  };

  const refuse = (outcome: { ok: boolean; rejection?: Rejection }) => {
    if (!outcome.ok && outcome.rejection) {
      toast.error(s.rejection[outcome.rejection.code]);
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          hideClose
          motion="instant"
          overlayClassName="bg-scrim/50"
          aria-describedby={undefined}
          className="inset-6 flex max-h-none w-auto max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl p-0 max-md:inset-0 max-md:rounded-none"
          onOpenAutoFocus={(event) => {
            // Radix would take the first control in the header; a person starts in the step's first field instead.
            event.preventDefault();
            if (focusName) {
              nameRef.current?.focus();
              nameRef.current?.select();
              return;
            }
            // A form can name the field a person fills first (an API request's path) when it is not the first control.
            const field =
              parametersRef.current?.querySelector<HTMLElement>(
                "[data-autofocus-field] :is(input, textarea)",
              ) ??
              parametersRef.current?.querySelector<HTMLElement>(
                PARAMETER_FIELD,
              );
            (field ?? (event.target as HTMLElement)).focus();
          }}
          onEscapeKeyDown={(event) => {
            const active = document.activeElement;
            if (!active?.matches(TEXT_FIELD)) return;
            // Escape leaves a text field first and keeps the modal open. The name field reverts its own edit.
            event.preventDefault();
            if (active !== nameRef.current) leaveField(active as HTMLElement);
          }}
        >
          <header className="flex h-10 shrink-0 items-center gap-1 border-b border-border ps-3 pe-2">
            <span
              role="img"
              aria-label={s.kind[node.kind]}
              title={s.kind[node.kind]}
              className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted"
            >
              <KindIcon className="size-3.5" aria-hidden />
            </span>
            <DialogTitle className="sr-only">
              {ws.nodeDetails.dialogName}
            </DialogTitle>
            <NodeDetailsName
              key={node.id}
              editor={editor}
              node={node}
              title={title}
              inputRef={nameRef}
              onCommitAndClose={focusName ? onClose : undefined}
            />
            {requestPathOf(node, editor.catalog) !== undefined ? (
              <ApiDocsLink node={node} />
            ) : null}
            <IconAction
              label={s.toolbar.duplicate}
              onClick={() => refuse(editor.duplicateNodes([node.id]))}
            >
              <IconCopy />
            </IconAction>
            <IconAction
              label={s.toolbar.delete}
              onClick={() =>
                refuse(editor.deleteElements({ nodeIds: [node.id] }))
              }
            >
              <IconTrash />
            </IconAction>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onClose();
                onAskAgent();
              }}
            >
              <IconMessage />
              {ws.toolbar.askAgent}
            </Button>
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={ws.nodeDetails.close}
              >
                <IconX />
              </Button>
            </DialogClose>
          </header>
          <MapDragProvider readOnly={readOnly} onMapped={onEngage}>
            <div className="flex min-h-0 flex-1 overflow-x-auto">
              {hasInput && (
                <NodeDetailsInputPane
                  key={`input-${node.id}`}
                  node={node}
                  graph={graph}
                  catalog={editor.catalog}
                  data={data}
                  loading={dataLoading}
                  failure={dataFailure}
                  onRetry={refetchData}
                  starting={starting}
                  onTestWorkflow={onTestWorkflow}
                />
              )}
              <NodeDetailsParameters
                key={node.id}
                sectionRef={parametersRef}
                editor={editor}
                factoryId={factoryId}
                workflowId={workflowId}
                node={node}
                title={title}
                quiet={quiet}
                onEngage={onEngage}
                runId={runId}
                runPending={runPending}
                steps={steps}
                serverNodeIds={serverNodeIds}
                dirty={dirty}
                starting={starting}
                onTestStep={onTestStep}
                {...(testsInWindow
                  ? {
                      onTestRequest: apiTest.run,
                      testingRequest: apiTest.running,
                    }
                  : {})}
                onAskAgent={onClose}
              />
              {isApiRequest ? (
                <ApiRequestOutputPane
                  key={`output-${node.id}`}
                  {...output}
                  liveTest={apiTest.state}
                />
              ) : (
                <NodeDetailsOutputPane key={`output-${node.id}`} {...output} />
              )}
            </div>
          </MapDragProvider>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
