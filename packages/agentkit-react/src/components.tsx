import {
  inferAgentActivityKind,
  type AgentActivity,
  type AgentApprovalRequest,
  type AgentConnectionRequest,
  type AgentError,
  type AgentEvent,
  type AgentInteraction,
  type AgentMessage,
  type AgentMessagePart,
  type AgentObjectReference,
  type AgentParticipant,
  type AgentRunOptions,
  type AgentTask,
  type AgentToolCall,
  type AgentWidget,
  type RunId,
} from "@agent-native/agentkit-protocol";
import {
  ActionButton,
  AgentSuggestionBar,
  IconButton,
  MessageQueueDrawer,
  PromptComposer,
  Surface,
  TextField,
  agentSuggestionPrompt,
  type PromptComposerFile,
  type PromptComposerProps,
  type TiptapComposerHandle,
  splitMarkdownBlocks,
  writeClipboardText,
} from "@agent-native/toolkit/agentkit";
import {
  IconActivity,
  IconAlertCircle,
  IconArrowFork,
  IconBook2,
  IconBrain,
  IconChevronRight,
  IconCircleCheck,
  IconCode,
  IconCopy,
  IconFile,
  IconGitBranch,
  IconMessage,
  IconPlugConnected,
  IconPlayerPause,
  IconPlayerPlay,
  IconSearch,
  IconTerminal2,
  IconChecklist,
  IconThumbDown,
  IconThumbUp,
  IconTool,
  IconX,
} from "@tabler/icons-react";
import {
  Component,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ErrorInfo,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  useAgentCapabilities,
  useAgentConnection,
  useAgentKit,
  useAgentKitControl,
  useAgentKitMutation,
  useAgentThread,
  type AgentConnectionErrorRenderProps,
  type AgentKitQueueRenderProps,
  type AgentKitRenderProps,
  type AgentKitRenderSurface,
  type AgentKitSuggestionsRenderProps,
  type AgentRunFailureRenderProps,
} from "./context.js";
import { AgentStreamingText } from "./streaming-text.js";

export interface AgentKitErrorBoundaryProps {
  children: ReactNode;
  resetKey?: string | number;
  fallback: ReactNode | ((error: Error) => ReactNode);
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface AgentKitErrorBoundaryState {
  error?: Error;
  resetKey?: string | number;
}

/** Isolates custom renderers so one extension cannot take down the chat. */
export class AgentKitErrorBoundary extends Component<
  AgentKitErrorBoundaryProps,
  AgentKitErrorBoundaryState
> {
  public state: AgentKitErrorBoundaryState = {
    resetKey: this.props.resetKey,
  };

  public static getDerivedStateFromError(
    error: Error,
  ): Partial<AgentKitErrorBoundaryState> {
    return { error };
  }

  public static getDerivedStateFromProps(
    props: AgentKitErrorBoundaryProps,
    state: AgentKitErrorBoundaryState,
  ): Partial<AgentKitErrorBoundaryState> | null {
    return props.resetKey !== state.resetKey
      ? { error: undefined, resetKey: props.resetKey }
      : null;
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    try {
      this.props.onError?.(error, info);
    } catch (observerError) {
      if (typeof globalThis.reportError === "function") {
        globalThis.reportError(observerError);
      } else {
        console.error("AgentKit render observer failed.", observerError);
      }
    }
  }

  public render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return typeof this.props.fallback === "function"
      ? this.props.fallback(this.state.error)
      : this.props.fallback;
  }
}

function AgentKitSurfaceBoundary({
  surface,
  resetKey,
  children,
}: {
  surface: AgentKitRenderSurface;
  resetKey?: string | number;
  children: ReactNode;
}) {
  const { labels, onRenderError, threadId } = useAgentKit();
  return (
    <AgentKitErrorBoundary
      resetKey={resetKey}
      fallback={
        <div
          className="agentkit-error"
          data-render-surface={surface}
          role="alert"
        >
          <IconAlertCircle aria-hidden="true" className="agentkit-icon" />
          <span>{labels.renderError}</span>
        </div>
      }
      onError={(error, info) =>
        onRenderError?.({
          error,
          surface,
          threadId,
          componentStack: info.componentStack ?? undefined,
        })
      }
    >
      {children}
    </AgentKitErrorBoundary>
  );
}

function AgentKitRegionSlot({
  slot: Slot,
  threadId,
  children,
}: {
  slot?: ComponentType<{
    children: ReactNode;
    threadId: string;
  }>;
  threadId: string;
  children: ReactNode;
}) {
  return Slot ? <Slot threadId={threadId}>{children}</Slot> : children;
}

const allowedAgentProtocols = new Set(["http:", "https:", "mailto:", "blob:"]);
const allowedAgentImageProtocols = new Set(["http:", "https:", "blob:"]);

/** Rejects executable and embedded-data URLs before they reach a default anchor. */
export function safeAgentHref(href?: string): string | undefined {
  if (!href) return undefined;
  try {
    const parsed = new URL(href, "https://agentkit.invalid");
    return allowedAgentProtocols.has(parsed.protocol) ? href : undefined;
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
}

const AgentMarkdownBlock = memo(function AgentMarkdownBlock({
  text,
}: {
  text: string;
}) {
  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children, href }) => {
          const safeHref = safeAgentHref(href);
          return safeHref ? (
            <a href={safeHref}>{children}</a>
          ) : (
            <span>{children}</span>
          );
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
});

function AgentMarkdown({ text }: { text: string }) {
  const { completedBlocks, tail } = useMemo(
    () => splitMarkdownBlocks(text),
    [text],
  );
  const blocks = useMemo(
    () => (tail ? [...completedBlocks, tail] : completedBlocks),
    [completedBlocks, tail],
  );

  return (
    <div className="agentkit-markdown" data-format="markdown">
      {blocks.map((block, index) => (
        <AgentMarkdownBlock key={index} text={block} />
      ))}
    </div>
  );
}

/** Keeps participant avatars on image-capable, non-executable URL schemes. */
export function safeAgentImageSrc(src?: string): string | undefined {
  if (!src) return undefined;
  try {
    const parsed = new URL(src, "https://agentkit.invalid");
    return allowedAgentImageProtocols.has(parsed.protocol) ? src : undefined;
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
}

function createInvocationId(widgetId: string, actionId: string): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${widgetId}:${actionId}:${crypto.randomUUID()}`;
  }
  return `${widgetId}:${actionId}:${Date.now().toString(36)}`;
}

function activityIcon(kind: string): ReactNode {
  const props = { "aria-hidden": true, className: "agentkit-icon" } as const;
  switch (kind) {
    case "status":
      return <IconActivity {...props} />;
    case "reasoning":
    case "model":
      return <IconBrain {...props} />;
    case "search":
      return <IconSearch {...props} />;
    case "read":
      return <IconBook2 {...props} />;
    case "write":
    case "edit":
      return <IconCode {...props} />;
    case "command":
      return <IconTerminal2 {...props} />;
    case "check":
      return <IconCircleCheck {...props} />;
    case "mcp":
    case "connection":
      return <IconPlugConnected {...props} />;
    case "navigation":
      return <IconGitBranch {...props} />;
    case "delegation":
      return <IconArrowFork {...props} />;
    case "approval":
      return <IconChecklist {...props} />;
    default:
      return <IconTool {...props} />;
  }
}

function interactionIcon(kind: string): ReactNode {
  const props = { "aria-hidden": true, className: "agentkit-icon" } as const;
  switch (kind) {
    case "started":
    case "resumed":
      return <IconPlayerPlay {...props} />;
    case "messaged":
      return <IconMessage {...props} />;
    case "delegated":
      return <IconArrowFork {...props} />;
    case "paused":
      return <IconPlayerPause {...props} />;
    case "completed":
      return <IconCircleCheck {...props} />;
    case "failed":
      return <IconAlertCircle {...props} />;
    case "closed":
      return <IconX {...props} />;
    default:
      return <IconActivity {...props} />;
  }
}

export function AgentObjectReferenceView({
  value: object,
}: AgentKitRenderProps<AgentObjectReference>) {
  const { onOpenObject } = useAgentKit();
  const content = (
    <>
      <span className="agentkit-object-label">{object.label}</span>
      {typeof object.metadata?.added === "number" ? (
        <span className="agentkit-diff-added">+{object.metadata.added}</span>
      ) : null}
      {typeof object.metadata?.removed === "number" ? (
        <span className="agentkit-diff-removed">
          −{object.metadata.removed}
        </span>
      ) : null}
    </>
  );
  return onOpenObject ? (
    <button
      type="button"
      className="agentkit-object"
      onClick={() => onOpenObject(object)}
    >
      {content}
    </button>
  ) : (
    <span className="agentkit-object">{content}</span>
  );
}

export function AgentParticipantView({
  value: agent,
}: AgentKitRenderProps<AgentParticipant>) {
  return (
    <AgentIdentityChip
      id={agent.id}
      name={agent.name}
      kind={agent.kind}
      status={agent.status}
    />
  );
}

function AgentIdentityChip({
  id,
  name,
  kind,
  status,
}: {
  id: string;
  name: string;
  kind?: string;
  status?: AgentParticipant["status"];
}) {
  return (
    <span
      className="agentkit-agent"
      data-agent-id={id}
      data-agent-kind={kind}
      data-status={status}
    >
      <span className="agentkit-agent-name">{name}</span>
    </span>
  );
}

function defaultInteractionLabel(
  interaction: AgentInteraction,
  labels: ReturnType<typeof useAgentKit>["labels"],
): string {
  if (interaction.label) return interaction.label;
  switch (interaction.kind) {
    case "started":
      return labels.agentStarted;
    case "resumed":
      return labels.agentResumed;
    case "messaged":
      return labels.agentMessaged;
    case "delegated":
      return labels.agentDelegated;
    case "paused":
      return labels.agentPaused;
    case "completed":
      return labels.agentCompleted;
    case "failed":
      return labels.agentFailed;
    case "closed":
      return labels.agentClosed;
    default:
      return interaction.kind;
  }
}

export function AgentInteractionItem({
  value: interaction,
  threadId,
}: AgentKitRenderProps<AgentInteraction>) {
  const { slots, registry, labels } = useAgentKit();
  const thread = useAgentThread(threadId);
  const agent = thread.agents[interaction.agentId];
  const target = interaction.targetAgentId
    ? thread.agents[interaction.targetAgentId]
    : undefined;
  const AgentRenderer = agent
    ? (registry.agents?.[agent.kind ?? ""] ??
      slots.agent ??
      AgentParticipantView)
    : undefined;
  const TargetRenderer = target
    ? (registry.agents?.[target.kind ?? ""] ??
      slots.agent ??
      AgentParticipantView)
    : undefined;
  const ObjectRenderer = slots.object ?? AgentObjectReferenceView;
  const object = interaction.object ?? interaction.source;
  return (
    <div
      className="agentkit-agent-interaction"
      data-kind={interaction.kind}
      data-scope={interaction.scope}
    >
      {interactionIcon(interaction.kind)}
      {agent && AgentRenderer ? (
        <AgentRenderer value={agent} threadId={threadId} />
      ) : (
        <AgentIdentityChip
          id={interaction.agentId}
          name={interaction.agentId}
        />
      )}
      <span className="agentkit-agent-interaction-label">
        {defaultInteractionLabel(interaction, labels)}
      </span>
      {target && TargetRenderer ? (
        <TargetRenderer value={target} threadId={threadId} />
      ) : interaction.targetAgentId ? (
        <AgentIdentityChip
          id={interaction.targetAgentId}
          name={interaction.targetAgentId}
        />
      ) : null}
      {object ? (
        <ObjectRenderer value={object} threadId={threadId} />
      ) : interaction.detail ? (
        <span className="agentkit-agent-interaction-detail">
          {interaction.detail}
        </span>
      ) : null}
    </div>
  );
}

export function AgentActivityItem({
  value: activity,
  threadId,
}: AgentKitRenderProps<AgentActivity>) {
  const { slots, registry, labels } = useAgentKit();
  const thread = useAgentThread();
  const [open, setOpen] = useState(false);
  const expandable = Boolean(activity.summary?.length);
  const agent = activity.agentId ? thread.agents[activity.agentId] : undefined;
  const AgentRenderer = agent
    ? (registry.agents?.[agent.kind ?? ""] ??
      slots.agent ??
      AgentParticipantView)
    : undefined;
  const ObjectRenderer = slots.object ?? AgentObjectReferenceView;
  return (
    <div
      className="agentkit-activity-item"
      data-activity-kind={activity.kind}
      data-status={activity.status}
    >
      <div className="agentkit-activity-row">
        {activityIcon(activity.kind)}
        {agent && AgentRenderer ? (
          <AgentRenderer value={agent} threadId={threadId} />
        ) : activity.agentId ? (
          <AgentIdentityChip id={activity.agentId} name={activity.agentId} />
        ) : null}
        <span className="agentkit-activity-label">{activity.label}</span>
        {activity.object ? (
          <ObjectRenderer value={activity.object} threadId={threadId} />
        ) : null}
        {!activity.object && activity.source ? (
          <ObjectRenderer value={activity.source} threadId={threadId} />
        ) : !activity.object && activity.detail ? (
          <span className="agentkit-activity-detail">{activity.detail}</span>
        ) : null}
        {expandable ? (
          <button
            type="button"
            className="agentkit-activity-disclosure"
            aria-expanded={open}
            aria-label={open ? labels.collapseActivity : labels.expandActivity}
            onClick={() => setOpen((current) => !current)}
          >
            <IconChevronRight
              aria-hidden="true"
              className="agentkit-icon agentkit-disclosure-icon"
              data-open={open ? "true" : "false"}
            />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="agentkit-activity-summary">
          {activity.summary?.map((part, index) => (
            <AgentMessagePartView
              key={`${activity.id}-summary-${index}`}
              value={part}
              threadId={threadId}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function objectReferenceIdentity(
  object: AgentObjectReference | undefined,
): string {
  return object
    ? [object.kind, object.id, object.uri ?? ""].join("\u0000")
    : "";
}

function activityClusterIdentity(activity: AgentActivity): string {
  return [
    activity.kind,
    activity.label.trim(),
    activity.status,
    activity.agentId ?? "",
    objectReferenceIdentity(activity.object),
    objectReferenceIdentity(activity.source),
  ].join("\u0001");
}

function RepeatedActivityCluster({
  activities,
  threadId,
}: {
  activities: AgentActivity[];
  threadId: string;
}) {
  const { slots, registry } = useAgentKit();
  const thread = useAgentThread();
  const [open, setOpen] = useState(false);
  const activity = activities[0];
  if (!activity) return null;
  const agent = activity.agentId ? thread.agents[activity.agentId] : undefined;
  const AgentRenderer = agent
    ? (registry.agents?.[agent.kind ?? ""] ??
      slots.agent ??
      AgentParticipantView)
    : undefined;
  const ObjectRenderer = slots.object ?? AgentObjectReferenceView;
  return (
    <details
      className="agentkit-activity-cluster"
      data-activity-kind={activity.kind}
      open={open}
    >
      <summary
        className="agentkit-activity-row"
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
      >
        {activityIcon(activity.kind)}
        {agent && AgentRenderer ? (
          <AgentRenderer value={agent} threadId={threadId} />
        ) : activity.agentId ? (
          <AgentIdentityChip id={activity.agentId} name={activity.agentId} />
        ) : null}
        <span className="agentkit-activity-label">{activity.label}</span>
        {activity.object ? (
          <ObjectRenderer value={activity.object} threadId={threadId} />
        ) : null}
        {!activity.object && activity.source ? (
          <ObjectRenderer value={activity.source} threadId={threadId} />
        ) : null}
        <span className="agentkit-activity-cluster-count">
          ×{activities.length}
        </span>
        <IconChevronRight
          aria-hidden="true"
          className="agentkit-icon agentkit-disclosure-icon"
          data-open={open ? "true" : "false"}
        />
      </summary>
      <div className="agentkit-activity-cluster-items">
        {activities.map((item) => (
          <AgentActivityItem key={item.id} value={item} threadId={threadId} />
        ))}
      </div>
    </details>
  );
}

function toolToActivity(tool: AgentToolCall): AgentActivity {
  return {
    id: tool.id,
    kind: inferAgentActivityKind(tool.name),
    label: tool.name,
    status:
      tool.status === "completed"
        ? "completed"
        : tool.status === "running"
          ? "running"
          : tool.status,
    detail:
      typeof tool.output === "string"
        ? tool.output
        : typeof tool.input === "string"
          ? tool.input
          : undefined,
  };
}

interface AgentEventRange {
  runId?: RunId;
  afterSequence?: number;
  throughSequence?: number;
}

function sequenceInRange(
  sequence: number,
  { afterSequence, throughSequence }: AgentEventRange,
): boolean {
  return (
    (afterSequence === undefined || sequence > afterSequence) &&
    (throughSequence === undefined || sequence <= throughSequence)
  );
}

export function formatAgentKitDuration(
  ms: number,
  units: { hour?: string; minute?: string; second?: string } = {},
): string {
  const hour = units.hour ?? "h";
  const minute = units.minute ?? "m";
  const second = units.second ?? "s";
  const totalSeconds = Math.max(0, Math.round(ms / 1_000));
  if (totalSeconds < 60) return `${Math.max(1, totalSeconds)}${second}`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds === 0
      ? `${minutes}${minute}`
      : `${minutes}${minute} ${seconds}${second}`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0
    ? `${hours}${hour}`
    : `${hours}${hour} ${remainingMinutes}${minute}`;
}

function workEventIdentity(event: AgentEvent): string | undefined {
  if (
    event.type === "activity.started" ||
    event.type === "activity.updated" ||
    event.type === "activity.completed"
  ) {
    return `activity:${event.activity.id}`;
  }
  if (event.type === "tool.started" || event.type === "tool.updated") {
    return `tool:${event.toolCall.id}`;
  }
  if (event.type === "tool.delta") return `tool:${event.toolCallId}`;
  if (event.type === "agent.interaction") {
    return `interaction:${event.interaction.id}`;
  }
  if (
    event.type === "task.created" ||
    event.type === "task.updated" ||
    event.type === "task.completed"
  ) {
    return `task:${event.task.id}`;
  }
  return undefined;
}

function firstWorkEvents(events: AgentEvent[]): AgentEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const identity = workEventIdentity(event);
    if (!identity) return false;
    const scopedIdentity = `${event.runId}:${identity}`;
    if (seen.has(scopedIdentity)) return false;
    seen.add(scopedIdentity);
    return true;
  });
}

function messageEventHasVisibleAssistantOutput(
  event: AgentEvent,
  assistantMessageIds: ReadonlySet<string>,
): boolean {
  if (event.type === "message.delta") {
    return (
      event.text.trim().length > 0 && assistantMessageIds.has(event.messageId)
    );
  }
  if (event.type !== "message.created" && event.type !== "message.completed") {
    return false;
  }
  return (
    event.message.role === "assistant" &&
    event.message.parts.some((part) => {
      if (part.type === "reasoning") return false;
      if (part.type === "text") return part.text.trim().length > 0;
      return true;
    })
  );
}

export function AgentActivityGroup({
  runId,
  afterSequence,
  throughSequence,
  excludeAgentActivities = false,
}: {
  runId?: RunId;
  afterSequence?: number;
  throughSequence?: number;
  excludeAgentActivities?: boolean;
}) {
  const { threadId, slots, registry, labels } = useAgentKit();
  const thread = useAgentThread();
  const runEvents = runId
    ? thread.events.filter((event) => event.runId === runId)
    : thread.events;
  const activityMap = new Map<string, AgentActivity>();
  const toolMap = new Map<string, AgentToolCall>();
  const firstSequence = new Map<string, number>();
  const itemOrder: string[] = [];
  const seenItems = new Set<string>();
  const remember = (id: string, sequence: number) => {
    if (seenItems.has(id)) return;
    seenItems.add(id);
    itemOrder.push(id);
    firstSequence.set(id, sequence);
  };
  for (const event of runEvents) {
    if (
      event.type === "activity.started" ||
      event.type === "activity.updated" ||
      event.type === "activity.completed"
    ) {
      if (excludeAgentActivities && event.activity.agentId) continue;
      activityMap.set(event.activity.id, event.activity);
      remember(event.activity.id, event.sequence);
    }
    if (event.type === "tool.started" || event.type === "tool.updated") {
      toolMap.set(event.toolCall.id, event.toolCall);
      remember(event.toolCall.id, event.sequence);
    }
    if (event.type === "tool.delta") {
      const tool = thread.tools[event.toolCallId];
      if (tool) toolMap.set(tool.id, tool);
      remember(event.toolCallId, event.sequence);
    }
  }
  const items = itemOrder.flatMap((id) => {
    const sequence = firstSequence.get(id);
    if (
      sequence === undefined ||
      !sequenceInRange(sequence, { afterSequence, throughSequence })
    ) {
      return [];
    }
    const activity = activityMap.get(id);
    if (activity) return [activity];
    const tool = toolMap.get(id);
    return tool ? [toolToActivity(tool)] : [];
  });
  const running = items.some((item) => item.status === "running");
  const run = runId ? thread.runs[runId] : undefined;
  const segmentStartedEvent = firstWorkEvents(runEvents).find((event) =>
    sequenceInRange(event.sequence, { afterSequence, throughSequence }),
  );
  const startedAt =
    afterSequence === undefined && run?.startedAt
      ? Date.parse(run.startedAt)
      : segmentStartedEvent
        ? Date.parse(segmentStartedEvent.occurredAt)
        : Number.NaN;
  const responseStartedEvent =
    throughSequence === undefined
      ? undefined
      : runEvents.find((event) => event.sequence === throughSequence);
  const completedAt = responseStartedEvent
    ? Date.parse(responseStartedEvent.occurredAt)
    : run?.completedAt
      ? Date.parse(run.completedAt)
      : Number.NaN;
  const durationMs =
    Number.isFinite(startedAt) && Number.isFinite(completedAt)
      ? Math.max(0, completedAt - startedAt)
      : undefined;
  const activelyWorking =
    throughSequence === undefined &&
    run !== undefined &&
    run.status === "running";
  const visiblyRunning = throughSequence === undefined && running;
  const [elapsedAt, setElapsedAt] = useState<number>();
  useEffect(() => {
    if (!activelyWorking || !Number.isFinite(startedAt)) return;
    const update = () => setElapsedAt(Date.now());
    update();
    const interval = globalThis.setInterval(update, 1_000);
    return () => globalThis.clearInterval(interval);
  }, [activelyWorking, startedAt]);
  const activeDurationMs =
    activelyWorking && elapsedAt !== undefined && Number.isFinite(startedAt)
      ? Math.max(0, elapsedAt - startedAt)
      : undefined;
  const completedRunSummary =
    throughSequence !== undefined ||
    (afterSequence === undefined &&
      !running &&
      run !== undefined &&
      ["completed", "failed", "cancelled"].includes(run.status));
  const [open, setOpen] = useState(visiblyRunning);
  const previousRunningRef = useRef(visiblyRunning);
  useEffect(() => {
    if (previousRunningRef.current === visiblyRunning) return;
    previousRunningRef.current = visiblyRunning;
    setOpen(visiblyRunning);
  }, [visiblyRunning]);
  if (items.length === 0) return null;
  const displayGroups: AgentActivity[][] = [];
  for (const activity of items) {
    const sourceTool = toolMap.get(activity.id);
    const hasCustomToolRenderer = Boolean(
      sourceTool &&
      !activityMap.has(activity.id) &&
      (registry.tools?.[sourceTool.name] ?? slots.tool),
    );
    const hasCustomActivityRenderer = Boolean(
      registry.activities?.[activity.kind] ?? slots.activity,
    );
    const previous = displayGroups.at(-1);
    if (
      !hasCustomToolRenderer &&
      !hasCustomActivityRenderer &&
      previous &&
      activityClusterIdentity(previous[0] as AgentActivity) ===
        activityClusterIdentity(activity)
    ) {
      previous.push(activity);
    } else {
      displayGroups.push([activity]);
    }
  }
  const labelsSummary = Array.from(
    new Set(items.map((item) => item.label.trim()).filter(Boolean)),
  );
  const remaining = Math.max(0, labelsSummary.length - 2);
  const summary = `${labelsSummary.slice(0, 2).join(", ")}${remaining ? ` +${remaining}` : ""}`;
  const formatDuration = (ms: number) =>
    formatAgentKitDuration(ms, {
      hour: labels.durationHourShort,
      minute: labels.durationMinuteShort,
      second: labels.durationSecondShort,
    });
  const summaryLabel = activelyWorking
    ? activeDurationMs !== undefined && activeDurationMs >= 1_000
      ? labels.workingFor.replace(
          "{{duration}}",
          formatDuration(activeDurationMs),
        )
      : labels.working
    : completedRunSummary
      ? durationMs !== undefined && durationMs >= 1_000
        ? labels.workedFor.replace("{{duration}}", formatDuration(durationMs))
        : labels.worked
      : summary || labels.activities;
  return (
    <details
      className="agentkit-activities"
      data-running={visiblyRunning ? "true" : undefined}
      open={open}
    >
      <summary
        className="agentkit-activities-summary"
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
      >
        <IconActivity aria-hidden="true" className="agentkit-icon" />
        <span className="agentkit-activities-label">{summaryLabel}</span>
        {!completedRunSummary ? (
          <span className="agentkit-activities-count">{items.length}</span>
        ) : null}
        <IconChevronRight
          aria-hidden="true"
          className="agentkit-icon agentkit-summary-chevron"
        />
      </summary>
      <div className="agentkit-activities-list">
        {displayGroups.map((activities) => {
          const activity = activities[0] as AgentActivity;
          if (activities.length > 1) {
            return (
              <RepeatedActivityCluster
                key={`cluster:${activity.id}`}
                activities={activities}
                threadId={threadId}
              />
            );
          }
          const sourceTool = toolMap.get(activity.id);
          const ToolRenderer = sourceTool
            ? (registry.tools?.[sourceTool.name] ?? slots.tool)
            : undefined;
          if (sourceTool && ToolRenderer && !activityMap.has(activity.id)) {
            return (
              <ToolRenderer
                key={sourceTool.id}
                value={sourceTool}
                threadId={threadId}
              />
            );
          }
          const Renderer =
            registry.activities?.[activity.kind] ??
            slots.activity ??
            AgentActivityItem;
          return (
            <Renderer key={activity.id} value={activity} threadId={threadId} />
          );
        })}
      </div>
    </details>
  );
}

export function AgentCollaborationFeed({
  runId,
  afterSequence,
  throughSequence,
}: AgentEventRange) {
  const { threadId, slots, registry, labels } = useAgentKit();
  const thread = useAgentThread();
  const entries = new Map<
    string,
    | { type: "interaction"; value: AgentInteraction }
    | { type: "activity"; value: AgentActivity }
  >();
  const firstSequence = new Map<string, number>();
  const order: string[] = [];
  const remember = (
    key: string,
    sequence: number,
    entry:
      | { type: "interaction"; value: AgentInteraction }
      | { type: "activity"; value: AgentActivity },
  ) => {
    if (!entries.has(key)) {
      order.push(key);
      firstSequence.set(key, sequence);
    }
    entries.set(key, entry);
  };
  for (const event of thread.events) {
    if (runId && event.runId !== runId) continue;
    if (event.type === "agent.interaction") {
      remember(`interaction:${event.interaction.id}`, event.sequence, {
        type: "interaction",
        value: event.interaction,
      });
    }
    if (
      (event.type === "activity.started" ||
        event.type === "activity.updated" ||
        event.type === "activity.completed") &&
      event.activity.agentId
    ) {
      remember(`activity:${event.activity.id}`, event.sequence, {
        type: "activity",
        value: event.activity,
      });
    }
  }
  const selectedOrder = order.filter((key) => {
    const sequence = firstSequence.get(key);
    return (
      sequence !== undefined &&
      sequenceInRange(sequence, { afterSequence, throughSequence })
    );
  });
  if (selectedOrder.length === 0) return null;
  return (
    <section
      className="agentkit-agent-feed"
      aria-label={labels.agents}
      data-agent-collaboration-feed="true"
    >
      {selectedOrder.map((key) => {
        const entry = entries.get(key);
        if (!entry) return null;
        if (entry.type === "interaction") {
          const Renderer =
            registry.agentInteractions?.[entry.value.kind] ??
            slots.agentInteraction ??
            AgentInteractionItem;
          return <Renderer key={key} value={entry.value} threadId={threadId} />;
        }
        const Renderer =
          registry.activities?.[entry.value.kind] ??
          slots.activity ??
          AgentActivityItem;
        return <Renderer key={key} value={entry.value} threadId={threadId} />;
      })}
    </section>
  );
}

export function AgentTaskItem({
  value: task,
  threadId,
}: AgentKitRenderProps<AgentTask>) {
  const { slots, registry } = useAgentKit();
  const thread = useAgentThread();
  const ObjectRenderer = slots.object ?? AgentObjectReferenceView;
  const agent = task.assignedAgentId
    ? thread.agents[task.assignedAgentId]
    : undefined;
  const AgentRenderer = agent
    ? (registry.agents?.[agent.kind ?? ""] ??
      slots.agent ??
      AgentParticipantView)
    : undefined;
  const progress = task.progress
    ? `${task.progress.completed}/${task.progress.total}`
    : undefined;
  return (
    <div className="agentkit-task-row" data-status={task.status}>
      <IconChecklist aria-hidden="true" className="agentkit-icon" />
      {agent && AgentRenderer ? (
        <AgentRenderer value={agent} threadId={threadId} />
      ) : task.assignedAgentId ? (
        <AgentIdentityChip
          id={task.assignedAgentId}
          name={task.assignedAgentId}
        />
      ) : null}
      <span className="agentkit-task-title">{task.title}</span>
      {task.object ? (
        <ObjectRenderer value={task.object} threadId={threadId} />
      ) : null}
      {!task.object && task.source ? (
        <ObjectRenderer value={task.source} threadId={threadId} />
      ) : !task.object && task.detail ? (
        <span className="agentkit-task-detail">{task.detail}</span>
      ) : null}
      {progress ? (
        <span className="agentkit-task-progress">{progress}</span>
      ) : null}
    </div>
  );
}

export function AgentTaskGroup({
  runId,
  afterSequence,
  throughSequence,
}: AgentEventRange) {
  const { threadId, slots, registry, labels } = useAgentKit();
  const thread = useAgentThread();
  const ids: string[] = [];
  const tasks = new Map<string, AgentTask>();
  const firstSequence = new Map<string, number>();
  for (const event of thread.events) {
    if (runId && event.runId !== runId) continue;
    if (
      event.type !== "task.created" &&
      event.type !== "task.updated" &&
      event.type !== "task.completed"
    ) {
      continue;
    }
    if (!tasks.has(event.task.id)) {
      ids.push(event.task.id);
      firstSequence.set(event.task.id, event.sequence);
    }
    tasks.set(event.task.id, event.task);
  }
  const selectedIds = ids.filter((id) => {
    const sequence = firstSequence.get(id);
    return (
      sequence !== undefined &&
      sequenceInRange(sequence, { afterSequence, throughSequence })
    );
  });
  if (selectedIds.length === 0) return null;
  return (
    <details className="agentkit-tasks">
      <summary className="agentkit-tasks-summary">
        <IconChecklist aria-hidden="true" className="agentkit-icon" />
        <span>{labels.tasks}</span>
        <span className="agentkit-tasks-count">{selectedIds.length}</span>
        <IconChevronRight
          aria-hidden="true"
          className="agentkit-icon agentkit-summary-chevron"
        />
      </summary>
      <div className="agentkit-tasks-list">
        {selectedIds.map((id) => {
          const task = tasks.get(id);
          if (!task) return null;
          const Renderer =
            registry.tasks?.[task.kind ?? task.status] ??
            slots.task ??
            AgentTaskItem;
          return <Renderer key={id} value={task} threadId={threadId} />;
        })}
      </div>
    </details>
  );
}

export function AgentApprovalPrompt({
  request,
  runId,
}: {
  request: AgentApprovalRequest;
  runId: string;
}) {
  const { labels, requestComposerFocus, threadId } = useAgentKit();
  const control = useAgentKitControl();
  const [selected, setSelected] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [otherSelected, setOtherSelected] = useState(false);
  const [other, setOther] = useState("");
  const resolution = useAgentKitMutation(
    (response: Parameters<typeof control.resolveApproval>[2]) =>
      control.resolveApproval(runId, request.id, response),
  );
  const options = request.options ?? [];
  const choice = request.kind === "choice" || options.length > 0;
  const allowOther = choice && request.allowOther !== false;
  const simpleApproval = !choice && options.length === 0 && !request.input;
  const toggle = (id: string) => {
    if (!request.allowMultiple) setOtherSelected(false);
    setSelected((current) =>
      request.allowMultiple
        ? current.includes(id)
          ? current.filter((item) => item !== id)
          : [...current, id]
        : [id],
    );
  };
  const toggleOther = () => {
    setOtherSelected((current) => !current);
    if (!request.allowMultiple) setSelected([]);
  };
  const resolve = (response: Parameters<typeof control.resolveApproval>[2]) =>
    void resolution
      .execute(response)
      .catch(() => undefined)
      .finally(() => requestComposerFocus(threadId));
  return (
    <Surface
      as="section"
      className="agentkit-approval"
      elevation="low"
      padding="none"
      aria-labelledby={`${request.id}-title`}
    >
      <div className="agentkit-approval-copy">
        <h3 id={`${request.id}-title`}>{request.title}</h3>
        {request.description ? <p>{request.description}</p> : null}
      </div>
      {options.length || allowOther ? (
        <div className="agentkit-approval-options">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected.includes(option.id)}
              data-kind={option.kind}
              disabled={resolution.pending}
              onClick={() => toggle(option.id)}
            >
              <span>{option.label}</span>
              {option.description ? <small>{option.description}</small> : null}
            </button>
          ))}
          {allowOther ? (
            <button
              type="button"
              aria-pressed={otherSelected}
              data-kind="other"
              disabled={resolution.pending}
              onClick={toggleOther}
            >
              <span>{labels.approvalOther}</span>
            </button>
          ) : null}
        </div>
      ) : null}
      {allowOther && otherSelected ? (
        <TextField
          autoFocus
          className="agentkit-approval-input"
          label={labels.approvalOther}
          disabled={resolution.pending}
          placeholder={labels.approvalOtherPlaceholder}
          value={other}
          onChange={setOther}
        />
      ) : null}
      {request.input ? (
        <TextField
          className="agentkit-approval-input"
          label={request.input.label}
          type={request.input.type === "url" ? "url" : "text"}
          inputMode={request.input.type === "number" ? "decimal" : undefined}
          required={request.input.required}
          disabled={resolution.pending}
          placeholder={request.input.placeholder}
          value={input}
          onChange={setInput}
        />
      ) : null}
      <div className="agentkit-approval-footer">
        {simpleApproval ? (
          <>
            <ActionButton
              emphasis="outline"
              size="compact"
              disabled={resolution.pending}
              onPress={() => resolve({ decision: "deny", optionIds: ["deny"] })}
            >
              {labels.approvalDeny}
            </ActionButton>
            <ActionButton
              className="agentkit-primary-button"
              intent="primary"
              size="compact"
              disabled={resolution.pending}
              pending={resolution.pending}
              onPress={() =>
                resolve({ decision: "approve", optionIds: ["approve"] })
              }
            >
              {labels.approvalApprove}
            </ActionButton>
          </>
        ) : (
          <ActionButton
            className="agentkit-primary-button"
            intent="primary"
            size="compact"
            disabled={
              (selected.length === 0 && !otherSelected && !request.input) ||
              (otherSelected && other.trim().length === 0) ||
              (request.input?.required && input.trim().length === 0) ||
              resolution.pending
            }
            pending={resolution.pending}
            onPress={() =>
              resolve({
                decision: "approve",
                optionIds: selected.length ? selected : undefined,
                other: otherSelected ? other.trim() : undefined,
                input: request.input
                  ? { [request.input.id]: input }
                  : undefined,
              })
            }
          >
            {labels.approvalSubmit}
          </ActionButton>
        )}
      </div>
      {resolution.error ? (
        <p className="agentkit-command-error" role="alert">
          {resolution.error.message}
        </p>
      ) : null}
    </Surface>
  );
}

export function AgentConnectionRequestCard({
  request,
  runId,
}: {
  request: AgentConnectionRequest;
  runId: string;
}) {
  const { labels, onConnectionRequest, requestComposerFocus, threadId } =
    useAgentKit();
  const control = useAgentKitControl();
  const resolution = useAgentKitMutation(
    async (decision: "connect" | "decline") => {
      const response =
        decision === "decline"
          ? { status: "declined" as const }
          : await onConnectionRequest?.(request);
      if (!response) {
        throw new Error(labels.connectionFailed);
      }
      await control.resolveConnectionRequest(runId, request.id, response);
      return response;
    },
  );
  const resolve = (decision: "connect" | "decline") =>
    void resolution
      .execute(decision)
      .catch(() => undefined)
      .finally(() => requestComposerFocus(threadId));
  const terminal =
    request.status === "connected" ||
    request.status === "declined" ||
    request.status === "failed";
  const title =
    request.status === "connected"
      ? labels.connectionConnected
      : request.status === "failed"
        ? labels.connectionFailed
        : request.reason === "admin_required"
          ? labels.connectionAdminRequired
          : `${labels.connectionConnect} ${request.provider}`;
  return (
    <Surface
      as="section"
      className="agentkit-connection-request"
      elevation="low"
      padding="none"
      data-status={request.status}
      aria-labelledby={`${request.id}-title`}
    >
      <div className="agentkit-connection-request-copy">
        <IconPlugConnected aria-hidden="true" className="agentkit-icon" />
        <div>
          <h3 id={`${request.id}-title`}>{title}</h3>
          {request.detail ? <p>{request.detail}</p> : null}
        </div>
      </div>
      {!terminal && request.reason !== "admin_required" ? (
        <div className="agentkit-connection-request-actions">
          <ActionButton
            emphasis="outline"
            size="compact"
            disabled={resolution.pending}
            onPress={() => resolve("decline")}
          >
            {labels.connectionNotNow}
          </ActionButton>
          <ActionButton
            className="agentkit-primary-button"
            intent="primary"
            size="compact"
            disabled={resolution.pending || !onConnectionRequest}
            pending={resolution.pending}
            onPress={() => resolve("connect")}
          >
            {resolution.pending
              ? labels.connectionConnecting
              : labels.connectionConnect}
          </ActionButton>
        </div>
      ) : request.status === "failed" && onConnectionRequest ? (
        <div className="agentkit-connection-request-actions">
          <ActionButton
            emphasis="outline"
            size="compact"
            disabled={resolution.pending}
            pending={resolution.pending}
            onPress={() => resolve("connect")}
          >
            {labels.connectionRetry}
          </ActionButton>
        </div>
      ) : null}
      {resolution.error ? (
        <div className="agentkit-command-error" role="alert">
          <IconAlertCircle aria-hidden="true" className="agentkit-icon" />
          <span>{resolution.error.message}</span>
        </div>
      ) : null}
    </Surface>
  );
}

function AgentWidgetActionButton({
  widget,
  action,
  threadId,
}: {
  widget: AgentWidget;
  action: NonNullable<AgentWidget["actions"]>[number];
  threadId: string;
}) {
  const control = useAgentKitControl(threadId);
  const invocation = useAgentKitMutation(
    () =>
      control.invokeAction({
        id: createInvocationId(widget.id, action.id),
        action: action.action ?? "",
        threadId,
        widgetId: widget.id,
        itemId: action.id,
        payload: action.payload,
      }),
    threadId,
  );
  return (
    <div className="agentkit-widget-action">
      <ActionButton
        className="agentkit-widget-action-button"
        intent={
          action.kind === "primary"
            ? "primary"
            : action.kind === "danger"
              ? "danger"
              : "neutral"
        }
        emphasis={action.kind === "primary" ? "solid" : "outline"}
        size="compact"
        disabled={action.disabled || !action.action || invocation.pending}
        pending={invocation.pending}
        onPress={() => void invocation.execute().catch(() => undefined)}
      >
        {action.label}
      </ActionButton>
      {invocation.error ? (
        <span className="agentkit-command-error" role="alert">
          {invocation.error.message}
        </span>
      ) : null}
    </div>
  );
}

export function AgentWidgetView({
  value: widget,
  threadId,
}: AgentKitRenderProps<AgentWidget>) {
  if (
    !widget.title &&
    typeof widget.data !== "string" &&
    !widget.actions?.length
  ) {
    return null;
  }
  const titleId = `${widget.id}-title`;
  return (
    <section
      className="agentkit-widget-shell"
      data-widget-kind={widget.kind}
      aria-labelledby={widget.title ? titleId : undefined}
    >
      <Surface className="agentkit-widget" elevation="low" padding="none">
        {widget.title ? <h3 id={titleId}>{widget.title}</h3> : null}
        {typeof widget.data === "string" ? <p>{widget.data}</p> : null}
        {widget.actions?.length ? (
          <div className="agentkit-widget-actions">
            {widget.actions.map((action) => (
              <AgentWidgetActionButton
                key={action.id}
                widget={widget}
                action={action}
                threadId={threadId}
              />
            ))}
          </div>
        ) : null}
      </Surface>
    </section>
  );
}

export interface AgentMessagePartViewProps extends AgentKitRenderProps<AgentMessagePart> {
  active?: boolean;
  resetKey?: string;
}

export function AgentMessagePartView({
  value: part,
  threadId,
  active = false,
  resetKey = `${threadId}:${part.type}`,
}: AgentMessagePartViewProps) {
  const { labels, slots, registry } = useAgentKit();
  const RegisteredRenderer = registry.messageParts?.[part.type];
  if (RegisteredRenderer) {
    return (
      <RegisteredRenderer
        value={part}
        threadId={threadId}
        active={active}
        resetKey={resetKey}
      />
    );
  }
  switch (part.type) {
    case "text": {
      const Renderer = slots.text;
      return Renderer ? (
        <Renderer
          value={part}
          threadId={threadId}
          active={active}
          resetKey={resetKey}
        />
      ) : part.format === "markdown" ? (
        <AgentStreamingText
          text={part.text}
          active={active}
          resetKey={resetKey}
        >
          {(visibleText) => <AgentMarkdown text={visibleText} />}
        </AgentStreamingText>
      ) : (
        <p data-format="plain">
          <AgentStreamingText
            text={part.text}
            active={active}
            resetKey={resetKey}
          />
        </p>
      );
    }
    case "reasoning": {
      const Renderer = slots.reasoning;
      return Renderer ? (
        <Renderer value={part} threadId={threadId} />
      ) : part.visibility === "hidden" ? null : (
        <details
          className="agentkit-reasoning"
          data-active={active ? "true" : undefined}
        >
          <summary className="agentkit-reasoning-summary">
            {activityIcon("reasoning")}
            <span className="agentkit-reasoning-label">
              {part.label ?? labels.reasoning}
            </span>
            <IconChevronRight
              aria-hidden="true"
              className="agentkit-icon agentkit-reasoning-chevron"
            />
          </summary>
          <div className="agentkit-reasoning-content">
            <p>
              <AgentStreamingText
                text={part.text}
                active={active}
                resetKey={resetKey}
              />
            </p>
          </div>
        </details>
      );
    }
    case "citation": {
      const Renderer = slots.citation;
      if (Renderer) return <Renderer value={part} threadId={threadId} />;
      const href = safeAgentHref(part.url);
      return href ? <a href={href}>{part.title}</a> : <span>{part.title}</span>;
    }
    case "annotation": {
      const Renderer = slots.annotation;
      if (Renderer) return <Renderer value={part} threadId={threadId} />;
      const href = safeAgentHref(part.annotation.url);
      return href ? (
        <a href={href}>{part.annotation.label}</a>
      ) : (
        <span>{part.annotation.label}</span>
      );
    }
    case "file": {
      const Renderer = slots.file;
      if (Renderer) return <Renderer value={part} threadId={threadId} />;
      const href = safeAgentHref(part.url);
      return href ? (
        <a className="agentkit-file" href={href} download={part.name}>
          <IconFile aria-hidden="true" className="agentkit-icon" />
          <span>{part.name}</span>
        </a>
      ) : (
        <span className="agentkit-file">
          <IconFile aria-hidden="true" className="agentkit-icon" />
          <span>{part.name}</span>
        </span>
      );
    }
    case "widget": {
      const Renderer =
        registry.widgets?.[part.widget.kind] ?? slots.widget ?? AgentWidgetView;
      return <Renderer value={part.widget} threadId={threadId} />;
    }
    case "data": {
      const Renderer = slots.data;
      return Renderer ? <Renderer value={part} threadId={threadId} /> : null;
    }
    default:
      return null;
  }
}

export function AgentMessageActions({
  value: message,
  threadId,
}: AgentKitRenderProps<AgentMessage>) {
  const { labels, onThreadForked } = useAgentKit();
  const capabilities = useAgentCapabilities();
  const control = useAgentKitControl(threadId);
  const text = message.parts
    .filter(
      (part): part is Extract<AgentMessagePart, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"positive" | "negative" | null>(
    null,
  );
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [message.id],
  );
  const copyAction = useAgentKitMutation(async () => {
    if (!(await writeClipboardText(text))) {
      throw new Error(labels.copyUnavailable);
    }
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1_400);
  }, `${threadId}:${message.id}:copy`);
  const feedbackAction = useAgentKitMutation(
    (value: "positive" | "negative" | "dismissed") =>
      control.submitFeedback(message.id, value),
    `${threadId}:${message.id}:feedback`,
  );
  const forkAction = useAgentKitMutation(async () => {
    const thread = await control.fork(message.id);
    onThreadForked?.(thread);
  }, `${threadId}:${message.id}:fork`);
  const updateFeedback = async (value: "positive" | "negative") => {
    const previous = feedback;
    if (previous === value) return;
    setFeedback(value);
    try {
      await feedbackAction.execute(value);
    } catch {
      setFeedback(previous);
    }
  };
  const actionError =
    copyAction.error ?? feedbackAction.error ?? forkAction.error;
  return (
    <div className="agentkit-message-actions">
      <IconButton
        label={copied ? labels.copied : labels.copy}
        icon={
          copied ? (
            <IconCircleCheck aria-hidden="true" />
          ) : (
            <IconCopy aria-hidden="true" />
          )
        }
        size="compact"
        pending={copyAction.pending}
        onPress={() => void copyAction.execute().catch(() => undefined)}
      />
      {message.role === "assistant" && capabilities.feedback ? (
        <>
          <IconButton
            label={labels.positiveFeedback}
            icon={<IconThumbUp aria-hidden="true" />}
            size="compact"
            aria-pressed={feedback === "positive"}
            pending={feedbackAction.pending && feedback === "positive"}
            disabled={feedbackAction.pending}
            onPress={() => void updateFeedback("positive")}
          />
          <IconButton
            label={labels.negativeFeedback}
            icon={<IconThumbDown aria-hidden="true" />}
            size="compact"
            aria-pressed={feedback === "negative"}
            pending={feedbackAction.pending && feedback === "negative"}
            disabled={feedbackAction.pending}
            onPress={() => void updateFeedback("negative")}
          />
        </>
      ) : null}
      {message.role === "assistant" &&
      capabilities.threadForking &&
      onThreadForked ? (
        <>
          <IconButton
            label={labels.fork}
            icon={<IconGitBranch aria-hidden="true" />}
            size="compact"
            pending={forkAction.pending}
            onPress={() => void forkAction.execute().catch(() => undefined)}
          />
        </>
      ) : null}
      {message.createdAt ? (
        <time dateTime={message.createdAt}>
          {new Date(message.createdAt).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </time>
      ) : null}
      {actionError ? (
        <span className="agentkit-command-error" role="alert">
          {actionError.message}
        </span>
      ) : null}
    </div>
  );
}

export function AgentMessageView({
  value: message,
  threadId,
}: AgentKitRenderProps<AgentMessage>) {
  const { labels, slots } = useAgentKit();
  const thread = useAgentThread(threadId);
  const Supplement = slots.messageSupplement;
  const Actions = slots.messageActions ?? AgentMessageActions;
  const embeddedWidgetIds = new Set(
    message.parts.flatMap((part) =>
      part.type === "widget" ? [part.widget.id] : [],
    ),
  );
  const embeddedAnnotationIds = new Set(
    message.parts.flatMap((part) =>
      part.type === "annotation" ? [part.annotation.id] : [],
    ),
  );
  const attachedWidgets = Object.values(thread.widgets).filter(
    (widget) =>
      thread.widgetMessageIds[widget.id] === message.id &&
      !embeddedWidgetIds.has(widget.id),
  );
  const attachedAnnotations = Object.values(thread.annotations).filter(
    (annotation) =>
      thread.annotationMessageIds[annotation.id] === message.id &&
      !embeddedAnnotationIds.has(annotation.id),
  );
  return (
    <article
      className="agentkit-message"
      data-role={message.role}
      data-message-id={message.id}
      aria-label={message.role === "user" ? labels.you : labels.assistant}
      aria-busy={message.status === "streaming"}
    >
      <div className="agentkit-message-content">
        {message.parts.map((part, index) => (
          <AgentMessagePartView
            key={`${message.id}-${index}`}
            value={part}
            threadId={threadId}
            active={message.status === "streaming"}
            resetKey={`${threadId}:${message.id}:${index}`}
          />
        ))}
        {attachedWidgets.map((widget) => (
          <AgentMessagePartView
            key={widget.id}
            value={{ type: "widget", widget }}
            threadId={threadId}
          />
        ))}
        {attachedAnnotations.length ? (
          <div className="agentkit-annotations">
            {attachedAnnotations.map((annotation) => (
              <AgentMessagePartView
                key={annotation.id}
                value={{ type: "annotation", annotation }}
                threadId={threadId}
              />
            ))}
          </div>
        ) : null}
        {Supplement ? <Supplement value={message} threadId={threadId} /> : null}
      </div>
      <Actions value={message} threadId={threadId} />
    </article>
  );
}

export function AgentRunFailure({
  error,
  runId,
  threadId,
}: AgentRunFailureRenderProps) {
  const { labels } = useAgentKit();
  return (
    <div
      className="agentkit-run-failure"
      data-error-code={error.code}
      data-run-id={runId}
      data-thread-id={threadId}
      role="alert"
    >
      <IconAlertCircle aria-hidden="true" className="agentkit-icon" />
      <div className="agentkit-run-failure-copy">
        <strong>{labels.runFailed}</strong>
        <span>{error.message}</span>
      </div>
    </div>
  );
}

export function AgentConnectionErrorView({
  error,
  threadId,
  recover,
  recovering,
  recoveryError,
}: AgentConnectionErrorRenderProps) {
  const { labels } = useAgentKit();
  return (
    <div
      className="agentkit-error"
      data-error-code={error.code}
      data-thread-id={threadId}
      role="alert"
    >
      <strong>{labels.error}</strong>
      <span>{error.message}</span>
      {error.retryable ? (
        <div className="agentkit-error-actions">
          <ActionButton
            emphasis="outline"
            size="compact"
            pending={recovering}
            onPress={() => void recover().catch(() => undefined)}
          >
            {labels.reconnect}
          </ActionButton>
        </div>
      ) : null}
      {recoveryError ? (
        <span className="agentkit-command-error">{recoveryError.message}</span>
      ) : null}
    </div>
  );
}

export interface AgentKitComposerProps extends Pick<
  PromptComposerProps,
  | "slashCommands"
  | "slashSkills"
  | "includeDefaultSlashCommands"
  | "includeDefaultSlashSkills"
  | "onSlashCommand"
  | "plusMenuMode"
  | "voiceEnabled"
  | "autoFocus"
> {
  threadId?: string;
  className?: string;
  queueWhileRunning?: boolean;
  showModelSelector?: boolean;
  /** Controlled execution mode for agent-native act/plan workflows. */
  mode?: "act" | "plan";
  /** Initial execution mode when the composer is uncontrolled. */
  defaultMode?: "act" | "plan";
  /** Called when the execution mode changes. */
  onModeChange?: (mode: "act" | "plan") => void;
}

export function AgentKitComposer({
  threadId: requestedThreadId,
  className,
  queueWhileRunning = true,
  showModelSelector = true,
  slashCommands,
  slashSkills,
  includeDefaultSlashCommands,
  includeDefaultSlashSkills,
  onSlashCommand,
  plusMenuMode,
  voiceEnabled = false,
  autoFocus = true,
  mode,
  defaultMode = "act",
  onModeChange,
}: AgentKitComposerProps) {
  const {
    threadId: contextThreadId,
    labels,
    registerComposerFocus,
    slots,
  } = useAgentKit();
  const threadId = requestedThreadId ?? contextThreadId;
  const capabilities = useAgentCapabilities();
  const control = useAgentKitControl(threadId);
  const thread = useAgentThread(threadId);
  const command = useAgentKitMutation(
    (execute: () => Promise<unknown>) => execute(),
    threadId,
  );
  const composerRef = useRef<TiptapComposerHandle>(null);
  const [uncontrolledMode, setUncontrolledMode] = useState(defaultMode);
  const executionMode = mode ?? uncontrolledMode;
  const active = thread.activeRunIds.length > 0;
  const focusComposer = useCallback(() => {
    if (!autoFocus) return;
    composerRef.current?.focus();
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(() => composerRef.current?.focus());
    }
  }, [autoFocus]);
  useEffect(
    () => registerComposerFocus(threadId, focusComposer),
    [focusComposer, registerComposerFocus, threadId],
  );
  const submitText = (text: string) =>
    active && queueWhileRunning && capabilities.messageQueue
      ? control.queue(text)
      : control.send(text);
  const steerQueued: AgentKitQueueRenderProps["onSteer"] = !active
    ? (item) =>
        void command
          .execute(() => control.steerQueued(item.id))
          .catch(() => undefined)
          .finally(focusComposer)
    : undefined;
  const removeQueued: AgentKitQueueRenderProps["onRemove"] = (item) =>
    void command
      .execute(() => control.removeQueued(item.id))
      .catch(() => undefined)
      .finally(focusComposer);
  const selectSuggestion: AgentKitSuggestionsRenderProps["onSelect"] = (
    suggestion,
  ) =>
    void command
      .execute(() => submitText(agentSuggestionPrompt(suggestion)))
      .catch(() => undefined)
      .finally(focusComposer);
  const Queue = slots.queue;
  const Suggestions = slots.suggestions;
  return (
    <div className={`agentkit-composer-stack ${className ?? ""}`}>
      {capabilities.messageQueue ? (
        Queue ? (
          <Queue
            items={thread.queuedMessages}
            threadId={threadId}
            active={active}
            pending={command.pending}
            onSteer={steerQueued}
            onRemove={removeQueued}
          />
        ) : (
          <MessageQueueDrawer
            variant="recessed"
            items={thread.queuedMessages}
            disabled={command.pending}
            onSteer={
              steerQueued
                ? (item) => {
                    const message = thread.queuedMessages.find(
                      (candidate) => candidate.id === item.id,
                    );
                    if (message) steerQueued(message);
                  }
                : undefined
            }
            onRemove={(item) => {
              const message = thread.queuedMessages.find(
                (candidate) => candidate.id === item.id,
              );
              if (message) removeQueued(message);
            }}
            labels={{
              region: labels.queue,
              steer: labels.queueSteer,
              steerHint: labels.queueSteerHint,
              remove: labels.queueRemove,
              moreActions: labels.queueMore,
            }}
          />
        )
      ) : null}
      {capabilities.suggestions && thread.suggestions.length ? (
        Suggestions ? (
          <Suggestions
            suggestions={thread.suggestions}
            threadId={threadId}
            pending={command.pending}
            onSelect={selectSuggestion}
          />
        ) : (
          <AgentSuggestionBar
            suggestions={thread.suggestions.map((suggestion) => ({
              ...suggestion,
              disabled: command.pending,
            }))}
            ariaLabel={labels.suggestions}
            onSelect={selectSuggestion}
            className="agentkit-suggestions"
          />
        )
      ) : null}
      <PromptComposer
        rootClassName="agentkit-composer"
        layoutVariant="default"
        draftScope={`agentkit:${threadId}`}
        ariaLabel={labels.composerLabel}
        placeholder={labels.composerPlaceholder}
        autoFocus={autoFocus}
        composerRef={composerRef}
        submitting={command.pending}
        willQueue={active && queueWhileRunning && capabilities.messageQueue}
        showModelSelector={
          showModelSelector && capabilities.modelSelection !== false
        }
        attachmentsEnabled={Boolean(capabilities.uploads)}
        slashCommands={slashCommands}
        slashSkills={slashSkills}
        includeDefaultSlashCommands={includeDefaultSlashCommands ?? false}
        includeDefaultSlashSkills={includeDefaultSlashSkills ?? false}
        onSlashCommand={onSlashCommand}
        plusMenuMode={
          plusMenuMode ?? (capabilities.uploads ? "upload-only" : "hidden")
        }
        voiceEnabled={voiceEnabled}
        execMode={executionMode === "plan" ? "plan" : "build"}
        onExecModeChange={(nextMode) => {
          const next = nextMode === "plan" ? "plan" : "act";
          if (mode === undefined) setUncontrolledMode(next);
          onModeChange?.(next);
        }}
        onSubmit={(text, files, references, options) => {
          const submission = command.execute(async () => {
            const attachments =
              files.length && capabilities.uploads
                ? await control.uploadFiles(
                    files.map((file: PromptComposerFile) => ({
                      name: file.name,
                      mediaType: file.type || "application/octet-stream",
                      size: file.size,
                      body: file,
                    })),
                  )
                : [];
            const effort = options.effort;
            const runOptions: AgentRunOptions = {
              model: options.model,
              mode: executionMode,
              reasoningEffort:
                effort && !["auto", "max"].includes(effort)
                  ? (effort as AgentRunOptions["reasoningEffort"])
                  : undefined,
            };
            const metadata = references.length ? { references } : undefined;
            if (active && queueWhileRunning && capabilities.messageQueue) {
              await control.queueMessage({ text, attachments, metadata });
            } else {
              await control.sendMessage({
                text,
                attachments,
                options: runOptions,
                metadata,
              });
            }
          });
          focusComposer();
          void submission.catch(() => undefined).finally(focusComposer);
        }}
      />
      {command.error ? (
        <div className="agentkit-composer-error" role="alert">
          <IconAlertCircle aria-hidden="true" className="agentkit-icon" />
          <span>{command.error.message}</span>
        </div>
      ) : null}
    </div>
  );
}

export interface AgentKitChatProps {
  title?: ReactNode;
  toolbar?: ReactNode;
  composer?: boolean;
  /** Configures the reference composer without replacing its slot. */
  composerProps?: Omit<AgentKitComposerProps, "threadId">;
  /** New conversations center the composer; embedded panels can anchor it. */
  emptyComposerPlacement?: "center" | "bottom";
  /** Follow new output until the user deliberately scrolls away. */
  autoScroll?: boolean;
  className?: string;
}

const AGENTKIT_TRANSCRIPT_BOTTOM_THRESHOLD = 24;
const AGENTKIT_TRANSCRIPT_SCROLLBAR_IDLE_MS = 900;
const AGENTKIT_TRANSCRIPT_SCROLL_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " ",
]);

export function isAgentKitTranscriptNearBottom(
  element: Pick<HTMLElement, "clientHeight" | "scrollHeight" | "scrollTop">,
  threshold = AGENTKIT_TRANSCRIPT_BOTTOM_THRESHOLD,
) {
  return (
    element.scrollHeight - element.clientHeight - element.scrollTop <= threshold
  );
}

export function AgentKitChat({
  title,
  toolbar,
  composer = true,
  composerProps,
  emptyComposerPlacement = "center",
  autoScroll = true,
  className,
}: AgentKitChatProps) {
  const { threadId, slots, labels } = useAgentKit();
  const connection = useAgentConnection();
  const control = useAgentKitControl(threadId);
  const recovery = useAgentKitMutation(() => control.load(), threadId);
  const thread = useAgentThread(threadId);
  const hasConversation = thread.messages.length > 0;
  const Message = slots.message ?? AgentMessageView;
  const EmptyState = slots.emptyState;
  const Composer = slots.composer ?? AgentKitComposer;
  const approvalEntries = Object.entries(thread.approvals);
  const connectionRequestEntries = Object.entries(
    thread.connectionRequests ?? {},
  );
  const ErrorState =
    slots.connectionError ?? slots.error ?? AgentConnectionErrorView;
  const RunFailure = slots.runFailure ?? AgentRunFailure;
  const Approval = slots.approval;
  const ConnectionRequest = slots.connectionRequest;
  const Header = slots.header;
  const Toolbar = slots.toolbar;
  const Transcript = slots.transcript;
  const Footer = slots.footer;
  const transcriptRef = useRef<HTMLDivElement>(null);
  const transcriptContentRef = useRef<HTMLDivElement>(null);
  const followsTranscriptRef = useRef(true);
  const transcriptThreadIdRef = useRef(threadId);
  const previousLastMessageIdRef = useRef<string | undefined>(undefined);
  const transcriptFollowFrameRef = useRef<number | undefined>(undefined);
  const transcriptScrollbarInteractionRef = useRef(false);
  const transcriptScrollbarTimeoutRef = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const [transcriptScrollbarVisible, setTranscriptScrollbarVisible] =
    useState(false);
  const lastMessage = thread.messages.at(-1);
  const lastEventId = thread.events.at(-1)?.id;
  const connectionError =
    connection.status === "error" ? connection.error : undefined;

  const clearTranscriptScrollbarTimeout = useCallback(() => {
    if (transcriptScrollbarTimeoutRef.current === undefined) return;
    clearTimeout(transcriptScrollbarTimeoutRef.current);
    transcriptScrollbarTimeoutRef.current = undefined;
  }, []);

  const hideTranscriptScrollbar = useCallback(() => {
    clearTranscriptScrollbarTimeout();
    transcriptScrollbarInteractionRef.current = false;
    setTranscriptScrollbarVisible(false);
  }, [clearTranscriptScrollbarTimeout]);

  const scheduleTranscriptScrollbarHide = useCallback(() => {
    clearTranscriptScrollbarTimeout();
    transcriptScrollbarTimeoutRef.current = setTimeout(() => {
      transcriptScrollbarTimeoutRef.current = undefined;
      transcriptScrollbarInteractionRef.current = false;
      setTranscriptScrollbarVisible(false);
    }, AGENTKIT_TRANSCRIPT_SCROLLBAR_IDLE_MS);
  }, [clearTranscriptScrollbarTimeout]);

  const revealTranscriptScrollbar = useCallback(() => {
    const transcript = transcriptRef.current;
    if (!transcript || transcript.scrollHeight <= transcript.clientHeight)
      return;
    transcriptScrollbarInteractionRef.current = true;
    setTranscriptScrollbarVisible(true);
    scheduleTranscriptScrollbarHide();
  }, [scheduleTranscriptScrollbarHide]);

  const scrollTranscriptToBottom = useCallback(() => {
    const transcript = transcriptRef.current;
    if (!autoScroll || !transcript || !followsTranscriptRef.current) return;
    const nextScrollTop = Math.max(
      0,
      transcript.scrollHeight - transcript.clientHeight,
    );
    if (Math.abs(transcript.scrollTop - nextScrollTop) <= 1) return;
    transcript.scrollTop = nextScrollTop;
  }, [autoScroll]);

  const cancelScheduledTranscriptFollow = useCallback(() => {
    if (transcriptFollowFrameRef.current === undefined) return;
    if (typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(transcriptFollowFrameRef.current);
    }
    transcriptFollowFrameRef.current = undefined;
  }, []);

  const scheduleTranscriptFollow = useCallback(() => {
    if (!autoScroll || transcriptFollowFrameRef.current !== undefined) return;
    if (typeof globalThis.requestAnimationFrame !== "function") {
      scrollTranscriptToBottom();
      return;
    }
    transcriptFollowFrameRef.current = globalThis.requestAnimationFrame(() => {
      transcriptFollowFrameRef.current = undefined;
      scrollTranscriptToBottom();
    });
  }, [autoScroll, scrollTranscriptToBottom]);

  useEffect(
    () => () => {
      clearTranscriptScrollbarTimeout();
      cancelScheduledTranscriptFollow();
    },
    [cancelScheduledTranscriptFollow, clearTranscriptScrollbarTimeout],
  );

  useLayoutEffect(() => {
    if (transcriptThreadIdRef.current !== threadId) {
      transcriptThreadIdRef.current = threadId;
      previousLastMessageIdRef.current = undefined;
      followsTranscriptRef.current = true;
      hideTranscriptScrollbar();
    }
    const previousLastMessageId = previousLastMessageIdRef.current;
    previousLastMessageIdRef.current = lastMessage?.id;
    if (!autoScroll) return;
    if (
      lastMessage?.role === "user" &&
      lastMessage.id !== previousLastMessageId
    ) {
      followsTranscriptRef.current = true;
      hideTranscriptScrollbar();
    }
    scrollTranscriptToBottom();
  }, [
    autoScroll,
    hideTranscriptScrollbar,
    lastEventId,
    lastMessage?.id,
    lastMessage?.role,
    scrollTranscriptToBottom,
    threadId,
  ]);

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;
    const content = transcriptContentRef.current;
    if (
      !autoScroll ||
      !transcript ||
      !content ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }
    const observer = new ResizeObserver(scheduleTranscriptFollow);
    observer.observe(transcript);
    observer.observe(content);
    return () => {
      observer.disconnect();
      cancelScheduledTranscriptFollow();
    };
  }, [
    autoScroll,
    cancelScheduledTranscriptFollow,
    scheduleTranscriptFollow,
    threadId,
  ]);

  const handleTranscriptScroll = useCallback(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    if (autoScroll && transcriptScrollbarInteractionRef.current) {
      followsTranscriptRef.current = isAgentKitTranscriptNearBottom(transcript);
    }
    if (transcriptScrollbarInteractionRef.current) {
      scheduleTranscriptScrollbarHide();
    }
  }, [autoScroll, scheduleTranscriptScrollbarHide]);

  const handleTranscriptPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const edgeDistance = Math.min(
        Math.abs(event.clientX - bounds.left),
        Math.abs(bounds.right - event.clientX),
      );
      if (edgeDistance <= 12) revealTranscriptScrollbar();
    },
    [revealTranscriptScrollbar],
  );

  const handleTranscriptKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (AGENTKIT_TRANSCRIPT_SCROLL_KEYS.has(event.key)) {
        revealTranscriptScrollbar();
      }
    },
    [revealTranscriptScrollbar],
  );
  const messageRunIds = useMemo(() => {
    const result = new Map<string, string>();
    for (const event of thread.events) {
      if (
        event.type === "message.created" ||
        event.type === "message.completed"
      ) {
        result.set(event.message.id, event.runId);
      }
      if (event.type === "message.delta" || event.type === "reasoning.delta") {
        result.set(event.messageId, event.runId);
      }
    }
    return result;
  }, [thread.events]);
  const messageBoundarySequences = useMemo(() => {
    const result = new Map<string, number>();
    const assistantMessageIds = new Set(
      thread.messages
        .filter((message) => message.role === "assistant")
        .map((message) => message.id),
    );
    for (const event of thread.events) {
      if (!messageEventHasVisibleAssistantOutput(event, assistantMessageIds)) {
        continue;
      }
      const messageId =
        event.type === "message.created" || event.type === "message.completed"
          ? event.message.id
          : event.type === "message.delta"
            ? event.messageId
            : undefined;
      if (!messageId) continue;
      result.set(
        messageId,
        Math.min(result.get(messageId) ?? Infinity, event.sequence),
      );
    }
    return result;
  }, [thread.events, thread.messages]);
  const lastAssistantMessagesByRun = useMemo(() => {
    const result = new Map<RunId, { id: string; sequence: number }>();
    for (const message of thread.messages) {
      const runId = messageRunIds.get(message.id);
      const sequence = messageBoundarySequences.get(message.id);
      if (runId && message.role === "assistant" && sequence !== undefined) {
        result.set(runId, { id: message.id, sequence });
      }
    }
    return result;
  }, [messageBoundarySequences, messageRunIds, thread.messages]);
  const failedRuns = useMemo(() => {
    const result = new Map<RunId, AgentError>();
    for (const run of Object.values(thread.runs)) {
      if (run.status === "failed" && run.error) {
        result.set(run.id, run.error);
      }
    }
    return result;
  }, [thread.runs]);
  const runWorkStarts = useMemo(
    () => firstWorkEvents(thread.events),
    [thread.events],
  );
  const hasRunWork = (
    runId: RunId,
    afterSequence?: number,
    throughSequence?: number,
  ) =>
    runWorkStarts.some(
      (event) =>
        event.runId === runId &&
        sequenceInRange(event.sequence, { afterSequence, throughSequence }),
    );
  const pendingRunIds = Array.from(
    new Set(
      runWorkStarts
        .filter((event) => {
          const boundary = lastAssistantMessagesByRun.get(event.runId);
          return boundary === undefined || event.sequence > boundary.sequence;
        })
        .map((event) => event.runId),
    ),
  );
  const pendingRuns = new Set(pendingRunIds);
  const renderRunFailure = (runId: RunId) => {
    const error = failedRuns.get(runId);
    return error ? (
      <RunFailure error={error} runId={runId} threadId={threadId} />
    ) : null;
  };
  const renderRunWork = ({
    runId,
    anchor,
    afterSequence,
    throughSequence,
  }: {
    runId: RunId;
    anchor: string;
    afterSequence?: number;
    throughSequence?: number;
  }) => (
    <AgentKitSurfaceBoundary
      key={`run-work:${runId}:${anchor}`}
      surface="activity"
      resetKey={`${runId}:${anchor}:${thread.events.length}`}
    >
      <AgentCollaborationFeed
        runId={runId}
        afterSequence={afterSequence}
        throughSequence={throughSequence}
      />
      <AgentTaskGroup
        runId={runId}
        afterSequence={afterSequence}
        throughSequence={throughSequence}
      />
      <AgentActivityGroup
        runId={runId}
        afterSequence={afterSequence}
        throughSequence={throughSequence}
        excludeAgentActivities
      />
    </AgentKitSurfaceBoundary>
  );
  const transcriptItems: ReactNode[] = [];
  const previousAssistantByRun = new Map<
    RunId,
    { id: string; sequence: number }
  >();
  for (const message of thread.messages) {
    const runId = messageRunIds.get(message.id);
    const sequence = messageBoundarySequences.get(message.id);
    const isAssistantBoundary =
      message.role === "assistant" &&
      runId !== undefined &&
      sequence !== undefined;
    const previousAssistant =
      isAssistantBoundary && runId
        ? previousAssistantByRun.get(runId)
        : undefined;
    if (
      isAssistantBoundary &&
      runId &&
      hasRunWork(runId, previousAssistant?.sequence, sequence)
    ) {
      transcriptItems.push(
        renderRunWork({
          runId,
          anchor: previousAssistant?.id ?? "start",
          afterSequence: previousAssistant?.sequence,
          throughSequence: sequence,
        }),
      );
    }
    transcriptItems.push(
      <AgentKitSurfaceBoundary
        key={`message:${message.id}`}
        surface="message"
        resetKey={`${message.id}:${thread.events.length}`}
      >
        <Message value={message} threadId={threadId} />
      </AgentKitSurfaceBoundary>,
    );
    if (isAssistantBoundary && runId) {
      previousAssistantByRun.set(runId, { id: message.id, sequence });
    }
    const concludesRun =
      isAssistantBoundary &&
      runId !== undefined &&
      lastAssistantMessagesByRun.get(runId)?.id === message.id;
    if (concludesRun && !pendingRuns.has(runId) && failedRuns.has(runId)) {
      transcriptItems.push(
        <AgentKitSurfaceBoundary
          key={`run-failure:${runId}`}
          surface="activity"
          resetKey={`${runId}:${thread.events.length}`}
        >
          {renderRunFailure(runId)}
        </AgentKitSurfaceBoundary>,
      );
    }
  }
  for (const runId of pendingRunIds) {
    const boundary = lastAssistantMessagesByRun.get(runId);
    transcriptItems.push(
      renderRunWork({
        runId,
        anchor: boundary?.id ?? "start",
        afterSequence: boundary?.sequence,
      }),
    );
    if (failedRuns.has(runId)) {
      transcriptItems.push(
        <AgentKitSurfaceBoundary
          key={`run-failure:${runId}`}
          surface="activity"
          resetKey={`${runId}:${thread.events.length}`}
        >
          {renderRunFailure(runId)}
        </AgentKitSurfaceBoundary>,
      );
    }
  }
  for (const [runId] of failedRuns) {
    if (lastAssistantMessagesByRun.has(runId) || pendingRuns.has(runId)) {
      continue;
    }
    transcriptItems.push(
      <AgentKitSurfaceBoundary
        key={`run-failure:${runId}`}
        surface="activity"
        resetKey={`${runId}:${thread.events.length}`}
      >
        {renderRunFailure(runId)}
      </AgentKitSurfaceBoundary>,
    );
  }
  return (
    <section
      aria-label={typeof title === "string" ? title : labels.conversation}
      className={`agentkit-chat ${className ?? ""}`}
      data-empty={!hasConversation}
      data-empty-composer-placement={emptyComposerPlacement}
    >
      {hasConversation && (title || toolbar) ? (
        <AgentKitSurfaceBoundary surface="header" resetKey={threadId}>
          <AgentKitRegionSlot slot={Header} threadId={threadId}>
            <header className="agentkit-chat-header">
              <div className="agentkit-chat-title">{title}</div>
              <AgentKitRegionSlot slot={Toolbar} threadId={threadId}>
                <div className="agentkit-chat-toolbar">{toolbar}</div>
              </AgentKitRegionSlot>
            </header>
          </AgentKitRegionSlot>
        </AgentKitSurfaceBoundary>
      ) : null}
      <div
        ref={transcriptRef}
        className="agentkit-transcript"
        aria-live="off"
        data-scrollbar-visible={transcriptScrollbarVisible}
        onKeyDown={handleTranscriptKeyDown}
        onPointerDown={handleTranscriptPointerDown}
        onScroll={handleTranscriptScroll}
        onTouchMove={revealTranscriptScrollbar}
        onWheel={revealTranscriptScrollbar}
      >
        <div ref={transcriptContentRef} className="agentkit-transcript-content">
          <AgentKitRegionSlot slot={Transcript} threadId={threadId}>
            {!hasConversation && EmptyState ? (
              <EmptyState threadId={threadId} />
            ) : null}
            {transcriptItems}
            {approvalEntries.map(([approvalId, request]) => (
              <AgentKitSurfaceBoundary
                key={approvalId}
                surface="approval"
                resetKey={`${approvalId}:${thread.events.length}`}
              >
                {Approval ? (
                  <Approval
                    value={request}
                    threadId={threadId}
                    runId={thread.approvalRunIds[approvalId] ?? ""}
                  />
                ) : (
                  <AgentApprovalPrompt
                    request={request}
                    runId={thread.approvalRunIds[approvalId] ?? ""}
                  />
                )}
              </AgentKitSurfaceBoundary>
            ))}
            {connectionRequestEntries.map(([requestId, request]) => (
              <AgentKitSurfaceBoundary
                key={requestId}
                surface="connection-request"
                resetKey={`${requestId}:${request.status}`}
              >
                {ConnectionRequest ? (
                  <ConnectionRequest
                    value={request}
                    threadId={threadId}
                    runId={thread.connectionRequestRunIds[requestId] ?? ""}
                  />
                ) : (
                  <AgentConnectionRequestCard
                    request={request}
                    runId={thread.connectionRequestRunIds[requestId] ?? ""}
                  />
                )}
              </AgentKitSurfaceBoundary>
            ))}
            {connectionError ? (
              <AgentKitSurfaceBoundary
                surface="connection-error"
                resetKey={`${threadId}:${connectionError.code}`}
              >
                <ErrorState
                  error={connectionError}
                  threadId={threadId}
                  recover={recovery.execute}
                  recovering={recovery.pending}
                  recoveryError={recovery.error}
                />
              </AgentKitSurfaceBoundary>
            ) : null}
          </AgentKitRegionSlot>
        </div>
      </div>
      {composer ? (
        <footer className="agentkit-chat-footer">
          <AgentKitSurfaceBoundary surface="composer" resetKey={threadId}>
            <AgentKitRegionSlot slot={Footer} threadId={threadId}>
              {slots.composer ? (
                <Composer threadId={threadId} />
              ) : (
                <AgentKitComposer {...composerProps} threadId={threadId} />
              )}
            </AgentKitRegionSlot>
          </AgentKitSurfaceBoundary>
        </footer>
      ) : null}
    </section>
  );
}
