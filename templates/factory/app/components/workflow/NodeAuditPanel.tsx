import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useLocale } from "@agent-native/core/client/i18n";
import { IconMessage, IconX } from "@tabler/icons-react";
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { WorkflowGraph } from "@/lib/workflow-editor";

import { NODE_KIND_ICONS } from "../workflow-canvas/node-kinds";
import { useWorkflowCanvasStrings } from "../workflow-canvas/strings";
import { auditAgentContext } from "./audit/audit-model";
import { AuditErrors, AuditReceipts } from "./audit/AuditErrorsAndReceipts";
import { AuditInputs, AuditOutputs } from "./audit/AuditSamples";
import { AuditSteps } from "./audit/AuditSteps";
import { AuditSummary } from "./audit/AuditSummary";
import { useItemsStrings } from "./items-strings";
import { formatDateTime, formatDuration } from "./items/format";
import { ItemJourneySheet } from "./items/ItemJourneySheet";
import { portLabeler } from "./items/port-label";
import { classifyReadError } from "./items/read-failure";
import { ReadErrorState } from "./items/read-support";
import type { ItemTarget, NodeAudit } from "./items/read-types";

interface NodeAuditPanelProps {
  factoryId: string;
  workflowId: string;
  nodeId: string;
  /** Read one run's step, on the graph version that run used. */
  runId?: string;
  onClose?: () => void;
}

const AUDIT_STEPS = 20;

function Section({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{heading}</h3>
      {children}
    </section>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  const s = useItemsStrings();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={s.audit.close}
      onClick={onClose}
    >
      <IconX />
    </Button>
  );
}

function AuditSkeleton() {
  return (
    <div className="space-y-5 px-4 py-4" aria-busy>
      <div className="space-y-2">
        <div className="flex justify-between">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-3 w-3/5" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}

/**
 * What one node has done: how its recent runs ended, what went in and out of
 * the newest, its errors and receipts. Content for the right-hand panel the
 * canvas page docks; the page owns the frame and the tab.
 */
export function NodeAuditPanel({
  factoryId,
  workflowId,
  nodeId,
  runId,
  onClose,
}: NodeAuditPanelProps) {
  const workflowCanvasStrings = useWorkflowCanvasStrings();
  const s = useItemsStrings();
  const { locale } = useLocale();

  const [open, setOpen] = useState<ItemTarget | null>(null);
  const query = useActionQuery<NodeAudit>("get-workflow-node-audit", {
    factoryId,
    workflowId,
    nodeId,
    limit: AUDIT_STEPS,
    ...(runId ? { runId } : {}),
  });
  // Names for the nodes that fed this one. The page has this graph already, so
  // this is the same cached read; ids stand in if it is not there.
  const graph = useActionQuery<{ graph: WorkflowGraph }>(
    "get-factory-workflow",
    {
      factoryId,
      workflowId,
    },
  );
  const names = useMemo(
    () =>
      new Map(
        (graph.data?.graph.nodes ?? []).map((node) => [node.id, node.name]),
      ),
    [graph.data],
  );
  const nameOf = (id: string) => names.get(id) ?? id;
  const labelPort = useMemo(
    () => portLabeler(graph.data?.graph, s, workflowCanvasStrings),
    [graph.data, s, workflowCanvasStrings],
  );

  const audit = query.data;
  if (!audit) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
          <p className="min-w-0 truncate font-mono text-sm">{nodeId}</p>
          {onClose ? <CloseButton onClose={onClose} /> : null}
        </header>
        {query.isError ? (
          <div className="p-4">
            <ReadErrorState
              failure={classifyReadError(query.error)}
              action="get-workflow-node-audit"
              onRetry={() => void query.refetch()}
            />
          </div>
        ) : (
          <AuditSkeleton />
        )}
      </div>
    );
  }

  const KindIcon = NODE_KIND_ICONS[audit.node.kind];
  const latest = audit.latest;
  const openItem = (itemId: string, title?: string | null) =>
    setOpen({ workflowId, itemId, title });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 space-y-2 border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <KindIcon
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <h2 className="min-w-0 truncate text-base font-semibold">
              {audit.node.name}
            </h2>
            <span className="shrink-0 text-xs text-muted-foreground">
              {workflowCanvasStrings.kind[audit.node.kind]}
            </span>
          </div>
          {onClose ? <CloseButton onClose={onClose} /> : null}
        </div>
        {audit.runId && latest ? (
          <p className="text-xs text-muted-foreground">
            {s.audit.scopedToRun(formatDateTime(latest.startedAt, locale))}
            {" · "}
            {s.audit.atVersion(audit.graphVersion)}
          </p>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            sendToAgentChat({
              message: s.audit.askMessage,
              context: auditAgentContext(factoryId, audit),
              submit: true,
              openSidebar: true,
            })
          }
        >
          <IconMessage />
          {s.audit.askAgent}
        </Button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {query.isError ? (
          <ReadErrorState
            failure={classifyReadError(query.error)}
            action="get-workflow-node-audit"
            onRetry={() => void query.refetch()}
          />
        ) : null}
        <Section heading={s.audit.summaryHeading}>
          <AuditSummary
            summary={audit.summary}
            hasMoreSteps={audit.hasMoreSteps}
          />
          {audit.steps.length > 0 ? (
            <AuditSteps
              steps={audit.steps}
              portLabel={(port) => labelPort(audit.node.id, port)}
            />
          ) : null}
        </Section>
        {latest ? (
          <Section heading={s.audit.latestHeading}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{s.audit.stepStatus[latest.status]}</span>
              <span aria-hidden>{"·"}</span>
              <time dateTime={latest.startedAt}>
                {formatDateTime(latest.startedAt, locale)}
              </time>
              {latest.durationMs !== null ? (
                <>
                  <span aria-hidden>{"·"}</span>
                  <span className="tabular-nums">
                    {formatDuration(latest.durationMs, s)}
                  </span>
                </>
              ) : null}
            </div>
            {latest.error ? (
              <p className="break-words rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <span className="font-mono font-medium">
                  {latest.error.code}
                </span>
                {": "}
                {latest.error.message}
              </p>
            ) : null}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {s.audit.inHeading}
              </p>
              <AuditInputs
                inputs={latest.in}
                nodeName={nameOf}
                portLabel={labelPort}
                onOpenItem={(item) => openItem(item.itemId, item.title)}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {s.audit.outHeading}
              </p>
              <AuditOutputs
                outputs={latest.out}
                portLabel={(port) => labelPort(audit.node.id, port)}
                onOpenItem={(item) => openItem(item.itemId, item.title)}
              />
            </div>
          </Section>
        ) : null}
        <Section heading={s.audit.errorsHeading}>
          <AuditErrors
            errors={audit.errors}
            onOpenItem={(id) => openItem(id)}
          />
        </Section>
        <Section heading={s.audit.receiptsHeading}>
          <AuditReceipts audit={audit} onOpenItem={(id) => openItem(id)} />
        </Section>
      </div>
      <ItemJourneySheet
        factoryId={factoryId}
        target={open}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      />
    </div>
  );
}
