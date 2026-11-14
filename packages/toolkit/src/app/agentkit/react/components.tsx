import {
  IconId,
  IconThumbUpFilled,
  IconThumbUp,
  IconThumbDownFilled,
  IconThumbDown,
  IconActivity,
  IconAlertTriangle,
  IconArrowDown,
  IconArrowFork,
  IconBook2,
  IconBrain,
  IconChevronLeft,
  IconChevronRight,
  IconCircle,
  IconCircleCheck,
  IconClock,
  IconCode,
  IconCopy,
  IconDots,
  IconFile,
  IconFolder,
  IconFileText,
  IconCheckbox,
  IconMail,
  IconUser,
  IconPresentation,
  IconStack2,
  IconMessageChatbot,
  IconGitBranch,
  IconLoader2,
  IconMessage,
  IconMessageQuestion,
  IconPlugConnected,
  IconPlayerPause,
  IconPlayerPlay,
  IconPencil,
  IconRefresh,
  IconSearch,
  IconTerminal2,
  IconChecklist,
  IconBolt,
  IconPointFilled,
  IconTool,
  IconWorld,
  IconWorldDownload,
  IconX,
} from "@tabler/icons-react";
import {
  createContext,
  createElement,
  Component,
  Fragment,
  isValidElement,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type ComponentType,
  type CSSProperties,
  type ErrorInfo,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type DragEvent as ReactDragEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, {
  type Components as MarkdownComponents,
  type ExtraProps as MarkdownExtraProps,
  type Options as MarkdownOptions,
} from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  ActionButton,
  AgentSuggestionBar,
  IconButton,
  MessageQueueDrawer,
  PromptComposer,
  Surface,
  TextField,
  agentSuggestionPrompt,
  createChatAttachmentAdapter,
  formatAttachmentError,
  type PromptComposerFile,
  type PromptComposerProps,
  type TiptapComposerHandle,
  markdownBlockOffsets,
  rehypeStreamingReveal,
  settleStreamingMarkdown,
  splitMarkdownBlocks,
  STREAMING_REVEAL_BLOCK_CLASS,
  writeClipboardText,
} from "../../../agentkit.js";
import {
  ComposerNotice,
  ComposerNoticeScope,
} from "../../../composer/composer-notice.js";
import { useComposerRuntimeAdapters } from "../../../composer/runtime-adapters.js";
import { Dialog, Tooltip } from "../../../design-system/index.js";
import { useTableColumnGlide } from "../../../table-column-glide.js";
import { Skeleton } from "../../../ui/skeleton.js";
import {
  ApprovalCard,
  approvalOptionDecision,
  approvalRequestKind,
  type ApprovalCardAction,
  type ApprovalDecision,
} from "./approval-card.js";
import {
  createAgentKitComposerSubmission,
  snapshotComposerValue,
  type AgentKitComposerSubmission,
} from "./composer-submission.js";
import { CoreFileStorageSetupContext } from "./core-file-storage.js";
import {
  AgentKitDeferClosedContentContext,
  useUntilFoundContent,
} from "./disclosure-content.js";
export type { AgentKitComposerSubmission } from "./composer-submission.js";

import { splitAgentKitMessageContext } from "@agent-native/agentkit";
import type { AgentThreadState } from "@agent-native/agentkit/client";
import {
  AgentKitCapabilityError,
  AgentKitUploadError,
  hasActiveAgentRuns,
  isCurrentAgentSuggestion,
  selectAgentSuggestions,
} from "@agent-native/agentkit/client";
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
  type AgentThread,
  type AgentToolCall,
  type AgentWidget,
  type CitationPart,
  type RunId,
} from "@agent-native/agentkit/protocol";

import { prettyLanguageName } from "../../code-highlighter.js";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFooter,
  CodeBlockHeader,
  CodeBlockTitle,
} from "./code-block.js";
import {
  defaultAgentKitLabels,
  useAgentCapability,
  useAgentConnection,
  useAgentKit,
  useAgentKitBeginPendingSubmission,
  useAgentKitControl,
  useAgentKitMutation,
  useAgentKitPendingSubmissions,
  useAgentKitSelector,
  useAgentKitSubmissionStarting,
  useAgentThread,
  useAgentThreadLoadStatus,
  type AgentConnectionErrorRenderProps,
  type AgentKitLabels,
  type AgentKitQueueRenderProps,
  type AgentKitRegistry,
  type AgentKitRenderProps,
  type AgentKitRenderSurface,
  type AgentKitRunUsage,
  type AgentKitSlots,
  type AgentKitSuggestionsRenderProps,
  type AgentRunFailureRenderProps,
} from "./context.js";
import { formatAgentKitDuration } from "./duration.js";
import { FileChange, type FileChangeData } from "./file-change.js";
import { scheduleIdleMount } from "./idle-mount.js";
import { orderMessageContent } from "./message-content-order.js";
import {
  AGENTKIT_CLIENT_REQUEST_ID_METADATA_KEY,
  agentKitTurnInProgress,
  pendingSubmissionFiles,
} from "./pending-submissions.js";
import { parseStackTrace, StackTrace } from "./stack-trace.js";
import { Terminal } from "./terminal.js";

export { formatAgentKitDuration };
import { useRovingFocus } from "./roving-focus.js";
import { useAgentKitStopButton } from "./stop-button.js";
import {
  AgentStreamingText,
  usePrefersReducedMotion,
  useStreamingRevealOrigin,
} from "./streaming-text.js";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
  type TraceStatus,
} from "./trace.js";
import { TranscriptGlide } from "./transcript-glide.js";
import {
  workedForRowChevronStyle,
  workedForRowSummaryStyle,
  type AgentChatTranscriptLayout,
} from "./transcript-layout.js";
import { registerChatThreadView } from "./viewed-threads.js";
import { useRealtimeVoiceTranscripts } from "./voice-transcripts.js";
import {
  agentWorkCallObject,
  agentWorkSteps,
  agentWorkTimeline,
  type AgentWorkCall,
  type AgentWorkGroup,
  type AgentWorkItem,
  type AgentWorkObject,
  type AgentWorkStep,
  type AgentWorkTimelineEntry,
  type AgentWorkVerb,
} from "./work-steps.js";

// AgentKit React installs without @agent-native/core, so it repeats core's
// replay markers. Its specs assert core's attribute names.
const SESSION_REPLAY_MASK_PROPS = { "data-an-mask": "" } as const;
const SESSION_REPLAY_BLOCK_PROPS = { "data-an-block": "" } as const;

export interface AgentKitErrorBoundaryProps {
  children: ReactNode;
  resetKey?: string | number;
  fallback: ReactNode | ((error: Error) => ReactNode);
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface AgentKitErrorBoundaryState {
  error?: Error;
  resetKey?: string | number | undefined;
}

/** Isolates custom renderers so one extension cannot take down the chat. */
export class AgentKitErrorBoundary extends Component<
  AgentKitErrorBoundaryProps,
  AgentKitErrorBoundaryState
> {
  public override state: AgentKitErrorBoundaryState = {
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

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
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

  public override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return typeof this.props.fallback === "function"
      ? this.props.fallback(this.state.error)
      : this.props.fallback;
  }
}

/**
 * The transcript rebuilds every row element on each thread change. Rows whose
 * element tree is unchanged skip the boundary and everything under it, so a
 * streamed delta re-renders only the row it changed.
 */
function sameRenderedNode(previous: ReactNode, next: ReactNode): boolean {
  if (Object.is(previous, next)) return true;
  if (Array.isArray(previous) || Array.isArray(next)) {
    return (
      Array.isArray(previous) &&
      Array.isArray(next) &&
      previous.length === next.length &&
      previous.every((child, index) => sameRenderedNode(child, next[index]))
    );
  }
  if (!isValidElement(previous) || !isValidElement(next)) return false;
  if (previous.type !== next.type || previous.key !== next.key) return false;
  const previousProps = previous.props as Record<string, unknown>;
  const nextProps = next.props as Record<string, unknown>;
  const keys = Object.keys(previousProps);
  return (
    keys.length === Object.keys(nextProps).length &&
    keys.every((key) =>
      key === "children"
        ? sameRenderedNode(
            previousProps[key] as ReactNode,
            nextProps[key] as ReactNode,
          )
        : Object.is(previousProps[key], nextProps[key]),
    )
  );
}

interface AgentKitSurfaceBoundaryProps {
  surface: AgentKitRenderSurface;
  resetKey?: string | number;
  children: ReactNode;
}

const AgentKitSurfaceBoundary = memo(function AgentKitSurfaceBoundary({
  surface,
  resetKey,
  children,
}: AgentKitSurfaceBoundaryProps) {
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
          <IconAlertTriangle aria-hidden="true" className="agentkit-icon" />
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
}, sameSurfaceBoundaryProps);

// Only transcript rows skip: they read the store through their own
// subscriptions, while the composer and header follow their parent's props.
const AGENTKIT_ROW_SURFACES = new Set<AgentKitRenderSurface>([
  "message",
  "activity",
]);

function sameSurfaceBoundaryProps(
  previous: AgentKitSurfaceBoundaryProps,
  next: AgentKitSurfaceBoundaryProps,
): boolean {
  return (
    AGENTKIT_ROW_SURFACES.has(next.surface) &&
    previous.surface === next.surface &&
    previous.resetKey === next.resetKey &&
    sameRenderedNode(previous.children, next.children)
  );
}

type DefinedProps<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<
    T[K],
    undefined
  >;
};

/** Leaves out props whose value is undefined, so optional props stay unset. */
function definedProps<T extends Record<string, unknown>>(
  props: T,
): DefinedProps<T> {
  return Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as DefinedProps<T>;
}

function AgentKitRegionSlot({
  slot: Slot,
  threadId,
  children,
}: {
  slot?:
    | ComponentType<{
        children: ReactNode;
        threadId: string;
      }>
    | undefined;
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

/**
 * Opens links that leave `currentOrigin` in a new tab. Without an origin every
 * absolute link opens in a new tab, which is what the server renders.
 */
export function agentLinkTargetProps(
  href: string,
  currentOrigin?: string,
): {
  target?: "_blank";
  rel?: string;
} {
  if (!/^https?:\/\//i.test(href)) return {};
  return currentOrigin !== undefined && new URL(href).origin === currentOrigin
    ? {}
    : { target: "_blank", rel: "noopener noreferrer" };
}

const subscribeToStaticOrigin = () => () => undefined;

// The server snapshot also serves hydration, so the first client render keeps
// the server's markup and same-origin links lose `target` only afterwards.
function useHydratedOrigin(): string | undefined {
  return useSyncExternalStore(
    subscribeToStaticOrigin,
    () => window.location.origin,
    () => undefined,
  );
}

function AgentLink({
  href,
  children,
}: {
  href?: string | undefined;
  children: ReactNode;
}) {
  const origin = useHydratedOrigin();
  const safeHref = safeAgentHref(href);
  return safeHref ? (
    <a href={safeHref} {...agentLinkTargetProps(safeHref, origin)}>
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );
}

function fencedCode(children: ReactNode): {
  text: string;
  language: string | undefined;
} {
  const code = Array.isArray(children) ? children[0] : children;
  if (!isValidElement<{ className?: unknown; children?: ReactNode }>(code)) {
    return { text: nodeText(children), language: undefined };
  }
  const className = code.props.className;
  return {
    text: nodeText(code.props.children),
    language:
      typeof className === "string"
        ? /(?:^|\s)language-([\w+#.-]+)/.exec(className)?.[1]
        : undefined,
  };
}

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return `${node}`;
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeText(node.props.children);
  }
  return "";
}

function AgentMarkdownCodeBlock({
  children,
  node: _node,
  className,
  ...props
}: ComponentPropsWithoutRef<"pre"> & MarkdownExtraProps) {
  // The header belongs to the block, so it fades in with the code.
  const classNames = className?.split(" ") ?? [];
  const revealsAsBlock = classNames.includes(STREAMING_REVEAL_BLOCK_CLASS);
  const preClassName =
    classNames
      .filter((name) => name && name !== STREAMING_REVEAL_BLOCK_CLASS)
      .join(" ") || undefined;
  const { labels } = useAgentKit();
  const { text, language } = fencedCode(children);
  const languageName = prettyLanguageName(language);
  return (
    <CodeBlock
      className={revealsAsBlock ? STREAMING_REVEAL_BLOCK_CLASS : undefined}
    >
      <CodeBlockHeader>
        <CodeBlockTitle aria-hidden="true">{languageName}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={text} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent
        {...props}
        className={preClassName}
        language={language}
        // A group, not a region: a landmark per code block buries the real ones.
        role="group"
        aria-label={
          languageName
            ? labels.codeBlockLanguage.replace(
                "{{language}}",
                () => languageName,
              )
            : labels.codeBlock
        }
      >
        {text}
      </CodeBlockContent>
    </CodeBlock>
  );
}

function AgentMarkdownTable({
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"table"> & MarkdownExtraProps) {
  const { labels } = useAgentKit();
  const table = useRef<HTMLTableElement>(null);
  useTableColumnGlide(table);
  return (
    <div
      className="agentkit-markdown-table"
      tabIndex={0}
      role="group"
      aria-label={labels.table}
    >
      <table ref={table} {...props} />
    </div>
  );
}

function AgentMarkdownImage({
  node: _node,
  src,
  alt,
  ...props
}: ComponentPropsWithoutRef<"img"> & MarkdownExtraProps) {
  const [loaded, setLoaded] = useState(false);
  const safeSrc = safeAgentImageSrc(typeof src === "string" ? src : undefined);
  if (!safeSrc) return alt ? <span>{alt}</span> : null;
  return (
    <span
      className="agentkit-markdown-image"
      data-loaded={loaded ? "true" : "false"}
    >
      <img
        {...props}
        ref={(image) => {
          if (image?.complete && image.naturalWidth > 0) setLoaded(true);
        }}
        src={safeSrc}
        alt={alt ?? ""}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
      />
    </span>
  );
}

function AgentMarkdownInput({
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"input"> & MarkdownExtraProps) {
  const { labels } = useAgentKit();
  if (props.type !== "checkbox") return <input {...props} />;
  return (
    <input
      {...props}
      disabled
      aria-label={
        props.checked ? labels.taskListChecked : labels.taskListUnchecked
      }
    />
  );
}

function withAutoDirection<
  Tag extends
    | "p"
    | "ul"
    | "ol"
    | "h1"
    | "h2"
    | "h3"
    | "h4"
    | "h5"
    | "h6"
    | "blockquote",
>(Tag: Tag) {
  return function AutoDirection({
    node: _node,
    ...props
  }: ComponentPropsWithoutRef<Tag> & MarkdownExtraProps) {
    return createElement(Tag, { dir: "auto", ...props });
  };
}

const agentMarkdownComponents: MarkdownComponents = {
  a: ({ children, href }) => <AgentLink href={href}>{children}</AgentLink>,
  pre: AgentMarkdownCodeBlock,
  table: AgentMarkdownTable,
  img: AgentMarkdownImage,
  input: AgentMarkdownInput,
  p: withAutoDirection("p"),
  // Items inherit the list's direction: a dir on an li hangs its marker past
  // the list's padding, and dir="auto" on the list skips children with a dir.
  ul: withAutoDirection("ul"),
  ol: withAutoDirection("ol"),
  h1: withAutoDirection("h1"),
  h2: withAutoDirection("h2"),
  h3: withAutoDirection("h3"),
  h4: withAutoDirection("h4"),
  h5: withAutoDirection("h5"),
  h6: withAutoDirection("h6"),
  blockquote: withAutoDirection("blockquote"),
};

const agentMarkdownRemarkPlugins = [remarkGfm];

const AgentMarkdownBlock = memo(function AgentMarkdownBlock({
  text,
  streaming,
  offset,
  animateFrom,
}: {
  text: string;
  streaming: boolean;
  offset: number;
  animateFrom: number | null;
}) {
  const settled = settleStreamingMarkdown(text, streaming);
  const reveals = animateFrom !== null && offset + settled.length > animateFrom;
  const rehypePlugins = useMemo(
    () =>
      reveals
        ? [
            [
              rehypeStreamingReveal,
              { baseOffset: offset, animateFrom },
            ] as const,
          ]
        : undefined,
    [animateFrom, offset, reveals],
  );
  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={agentMarkdownRemarkPlugins}
      rehypePlugins={rehypePlugins as MarkdownOptions["rehypePlugins"]}
      components={agentMarkdownComponents}
    >
      {settled}
    </ReactMarkdown>
  );
});

/**
 * Renders Markdown as independently memoized blocks, so only the growing tail
 * re-parses while a message streams. The tail holds back syntax that has not
 * closed yet, and text revealed after mount fades in word by word.
 */
function AgentMarkdown({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  const animateFrom = useStreamingRevealOrigin(text.length, streaming);
  const { completedBlocks, tail } = useMemo(
    () => splitMarkdownBlocks(text),
    [text],
  );
  const blocks = useMemo(() => {
    const texts = tail ? [...completedBlocks, tail] : completedBlocks;
    const offsets = markdownBlockOffsets(text, texts);
    return texts.map((block, index) => {
      const offset = offsets.at(index);
      if (offset === undefined) {
        throw new Error("Missing offset for a Markdown block");
      }
      return { text: block, offset };
    });
  }, [completedBlocks, tail, text]);

  return (
    <div className="agentkit-markdown" data-format="markdown">
      {blocks.map((block, index) => (
        <AgentMarkdownBlock
          key={index}
          text={block.text}
          streaming={streaming && index === blocks.length - 1}
          offset={block.offset}
          animateFrom={animateFrom}
        />
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

export interface AgentKitDisclosureSummaryProps {
  open: boolean;
  onToggle: () => void;
  label?: ReactNode;
  /** Fills the fixed leading column; null keeps the column empty. */
  icon?: ReactNode;
  expandable?: boolean;
  /** A row with nothing to expand renders as text, not a disabled button. */
  as?: "button" | "static";
  /** Id of the mounted content the trigger reveals. */
  controls?: string | undefined;
  /** Trailing content beside the trigger, such as objects and details. */
  meta?: ReactNode;
  className?: string | undefined;
  rowClassName?: string | undefined;
  style?: CSSProperties | undefined;
  chevronStyle?: CSSProperties | undefined;
  /** Omit for finished work. */
  status?: TraceStatus | undefined;
  /** Replaces the default icon, label and chevron. */
  children?: ReactNode;
}

const DISCLOSURE_ROW_INTERACTIVE =
  "button, a, input, textarea, select, [role='button'], [contenteditable='true']";

/** The label keeps its own styling; `TraceTitle` is for host rows. */
export function AgentKitDisclosureSummary({
  open,
  onToggle,
  label,
  icon,
  expandable = true,
  as = "button",
  controls,
  meta,
  className,
  rowClassName,
  style,
  chevronStyle,
  status,
  children,
}: AgentKitDisclosureSummaryProps) {
  const content = children ?? (
    <>
      <TraceLine status={status}>
        {icon !== undefined ? <TraceIcon>{icon}</TraceIcon> : null}
        <span data-slot="trace-title" className="agentkit-disclosure-label">
          {label}
        </span>
      </TraceLine>
      {expandable && as === "button" ? (
        <IconChevronRight
          aria-hidden="true"
          className="agentkit-icon agentkit-disclosure-chevron"
          data-open={open ? "true" : "false"}
          style={chevronStyle}
        />
      ) : null}
    </>
  );
  const trigger =
    as === "static" ? (
      <span
        className={["agentkit-disclosure-summary", className]
          .filter(Boolean)
          .join(" ")}
        data-expandable="false"
        style={style}
      >
        {content}
      </span>
    ) : (
      <button
        type="button"
        data-slot={expandable ? "trace-collapsible-trigger" : undefined}
        className={["agentkit-disclosure-summary", className]
          .filter(Boolean)
          .join(" ")}
        data-expandable={expandable ? "true" : "false"}
        aria-expanded={expandable ? open : undefined}
        aria-controls={expandable ? controls : undefined}
        aria-disabled={expandable ? undefined : true}
        tabIndex={expandable ? undefined : -1}
        style={style}
        onClick={() => {
          if (expandable) onToggle();
        }}
      >
        {content}
      </button>
    );
  if (meta === undefined && !rowClassName) return trigger;
  const rowToggles = expandable && as === "button";
  return (
    <div
      className={["agentkit-disclosure-row", rowClassName]
        .filter(Boolean)
        .join(" ")}
      data-expandable={rowToggles ? "true" : "false"}
      onClick={
        rowToggles
          ? (event) => {
              // The trigger and controls in the meta handle their own clicks;
              // a drag that selected text is not a toggle.
              const target = event.target;
              if (
                target instanceof Element &&
                target.closest(DISCLOSURE_ROW_INTERACTIVE)
              )
                return;
              if (globalThis.getSelection()?.toString()) return;
              onToggle();
            }
          : undefined
      }
    >
      {trigger}
      {meta}
    </div>
  );
}

/** Mounted while closed, like <details>, so find-in-page can reveal it. */
export function AgentKitDisclosureContent({
  id,
  open,
  onReveal,
  children,
}: {
  id?: string | undefined;
  open: boolean;
  onReveal?: (() => void) | undefined;
  children: ReactNode;
}) {
  const { ref, mounted } = useUntilFoundContent(open, onReveal);
  return (
    <div
      ref={ref}
      id={id}
      data-slot="trace-collapsible-content"
      data-state={open ? "open" : "closed"}
      className="agentkit-disclosure-content"
      hidden={!open}
    >
      {mounted ? children : null}
    </div>
  );
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
      return <IconAlertTriangle {...props} />;
    case "closed":
      return <IconX {...props} />;
    default:
      return <IconActivity {...props} />;
  }
}

const EMPTY_EVENTS: AgentEvent[] = [];

interface AgentThreadEventIndex {
  byRun: Map<RunId, AgentEvent[]>;
  messageRunIds: Map<string, RunId>;
  finishedRunIds: Set<RunId>;
}

const threadEventIndexes = new WeakMap<
  readonly AgentEvent[],
  AgentThreadEventIndex
>();
const latestThreadEventIndexes = new Map<string, AgentThreadEventIndex>();

/**
 * One pass over a thread's events, shared by every renderer that reads them.
 * A run whose events did not change keeps its array, so renderers scoped to a
 * finished run can skip work while another run streams.
 */
function agentThreadEventIndex(
  events: readonly AgentEvent[],
): AgentThreadEventIndex {
  const cached = threadEventIndexes.get(events);
  if (cached) return cached;
  const threadKey = events[0]?.threadId ?? "";
  const previous = latestThreadEventIndexes.get(threadKey);
  const byRun = new Map<RunId, AgentEvent[]>();
  const messageRunIds = new Map<string, RunId>();
  const finishedRunIds = new Set<RunId>();
  for (const event of events) {
    const runEvents = byRun.get(event.runId);
    if (runEvents) runEvents.push(event);
    else byRun.set(event.runId, [event]);
    if (
      event.type === "message.created" ||
      event.type === "message.completed" ||
      event.type === "message.replaced"
    ) {
      messageRunIds.set(event.message.id, event.runId);
    } else if (
      event.type === "message.delta" ||
      event.type === "reasoning.delta"
    ) {
      messageRunIds.set(event.messageId, event.runId);
    }
    if (
      event.type === "run.completed" ||
      event.type === "run.failed" ||
      event.type === "run.cancelled" ||
      (event.type === "run.status" &&
        (event.status === "completed" ||
          event.status === "failed" ||
          event.status === "cancelled"))
    ) {
      finishedRunIds.add(event.runId);
    }
  }
  if (previous) {
    for (const [runId, runEvents] of byRun) {
      const previousRunEvents = previous.byRun.get(runId);
      if (
        previousRunEvents &&
        previousRunEvents.length === runEvents.length &&
        previousRunEvents.every((event, index) => event === runEvents[index])
      ) {
        byRun.set(runId, previousRunEvents);
      }
    }
  }
  const index = { byRun, messageRunIds, finishedRunIds };
  threadEventIndexes.set(events, index);
  latestThreadEventIndexes.delete(threadKey);
  latestThreadEventIndexes.set(threadKey, index);
  if (latestThreadEventIndexes.size > 32) {
    const oldest = latestThreadEventIndexes.keys().next().value;
    if (oldest !== undefined) latestThreadEventIndexes.delete(oldest);
  }
  return index;
}

function agentRunEvents(
  thread: AgentThreadState,
  runId: RunId | undefined,
): AgentEvent[] {
  if (runId === undefined) return thread.events;
  return agentThreadEventIndex(thread.events).byRun.get(runId) ?? EMPTY_EVENTS;
}

const messagesByIdCache = new WeakMap<
  readonly AgentMessage[],
  Map<string, { message: AgentMessage; index: number }>
>();

function agentMessagesById(
  messages: readonly AgentMessage[],
): Map<string, { message: AgentMessage; index: number }> {
  const cached = messagesByIdCache.get(messages);
  if (cached) return cached;
  const result = new Map(
    messages.map((message, index) => [message.id, { message, index }]),
  );
  messagesByIdCache.set(messages, result);
  return result;
}

const activeRunsCache = new WeakMap<AgentThreadState, boolean>();

function threadHasActiveRuns(thread: AgentThreadState): boolean {
  const cached = activeRunsCache.get(thread);
  if (cached !== undefined) return cached;
  const active = hasActiveAgentRuns(thread);
  activeRunsCache.set(thread, active);
  return active;
}

/**
 * Subscribes to the thread but re-renders only when `isSame` sees a change in
 * the parts this renderer reads. On no change it keeps the earlier thread
 * object, so the renderer must read nothing that `isSame` does not compare.
 */
function useAgentThreadSlice(
  isSame: (previous: AgentThreadState, next: AgentThreadState) => boolean,
  requestedThreadId?: string,
): AgentThreadState {
  const { controller, threadId: contextThreadId } = useAgentKit();
  const threadId = requestedThreadId ?? contextThreadId;
  const isSameRef = useRef(isSame);
  isSameRef.current = isSame;
  return useAgentKitSelector(
    (snapshot) => snapshot.threads[threadId] ?? controller.getThread(threadId),
    (previous, next) =>
      previous === next ||
      (previous.id === next.id && isSameRef.current(previous, next)),
  );
}

function sameAgents(previous: AgentThreadState, next: AgentThreadState) {
  return previous.agents === next.agents;
}

function sameAgentsAndTasks(
  previous: AgentThreadState,
  next: AgentThreadState,
) {
  return previous.agents === next.agents && previous.tasks === next.tasks;
}

export function AgentObjectReferenceView({
  value: object,
}: AgentKitRenderProps<AgentObjectReference>) {
  const { onOpenObject, labels } = useAgentKit();
  const thread = useAgentThreadSlice(sameAgentsAndTasks);
  const content = (
    <>
      <span className="agentkit-object-label">
        {resolveObjectLabel(object, thread, labels.assistant)}
      </span>
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
      onClick={(event) => {
        // A reference inside a disclosure summary must not also toggle it.
        event.stopPropagation();
        onOpenObject(object);
      }}
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
  const { labels } = useAgentKit();
  const thread = useAgentThreadSlice(sameAgents);
  return (
    <AgentIdentityChip
      id={agent.id}
      name={resolveAgentName(
        thread,
        agent.id,
        [agent.origin],
        labels.assistant,
        agent.name,
      )}
      fallbackName={labels.assistant}
      kind={agent.kind}
      status={agent.status}
    />
  );
}

const UUID_PATTERN =
  /(^|[^0-9a-f])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=$|[^0-9a-f])/gi;
const ACTIVITY_TOOL_VALUE_LIMIT = 2_000;
const ACTIVITY_TOOL_NODE_LIMIT = 160;
const ACTIVITY_TOOL_DEPTH_LIMIT = 8;

function isUuid(value: string): boolean {
  if (value.length > 64) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

function hideUuids(value: string): string {
  return value.replace(UUID_PATTERN, "$1");
}

function readableText(value: string | undefined): string {
  if (!value) return "";
  return hideUuids(value)
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/[,.;:!?]\s*$/g, "")
    .trim();
}

const AGENT_KIND_ACRONYMS = new Set([
  "api",
  "mcp",
  "url",
  "pr",
  "id",
  "cli",
  "json",
  "http",
]);

function humanizeAgentKind(kind: string): string {
  const readableKind = readableText(
    kind.replace(/^agent-native\//i, "").replace(/^mcp__/i, ""),
  );
  if (!readableKind) return "";
  const words = readableKind
    .replace(/[._-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) =>
      AGENT_KIND_ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.toLowerCase(),
    );
  const [first = "", ...rest] = words;
  return [
    AGENT_KIND_ACRONYMS.has(first.toLowerCase())
      ? first
      : first.charAt(0).toUpperCase() + first.slice(1),
    ...rest,
  ].join(" ");
}

function humanizeAgentLabel(value: string): string {
  const label = readableText(value);
  if (!label) return "";
  if (label.toLowerCase() === "agent-native") return "Agent-Native";
  return /\s/.test(label) ? label : humanizeAgentKind(label);
}

function resolveAgentName(
  thread: AgentThreadState,
  agentId: string | undefined,
  references: readonly (AgentObjectReference | undefined)[],
  fallback: string,
  preferredName?: string,
): string {
  const participant = agentId ? thread.agents[agentId] : undefined;
  const names = [
    preferredName,
    participant?.name,
    participant?.origin?.label,
    ...references
      .filter(
        (reference) => reference?.kind === "agent" && reference.id === agentId,
      )
      .map((reference) => reference?.label),
    participant?.description,
  ];
  for (const name of names) {
    const label = name ? humanizeAgentLabel(name) : "";
    if (label) return label;
  }
  return fallback;
}

function resolveObjectLabel(
  object: AgentObjectReference,
  thread: AgentThreadState,
  fallback: string,
): string {
  if (object.kind === "agent") {
    return resolveAgentName(thread, object.id, [object], fallback);
  }
  if (object.kind === "task") {
    const title = humanizeAgentLabel(thread.tasks[object.id]?.title ?? "");
    if (title) return title;
  }
  return (
    humanizeAgentLabel(object.label) ||
    humanizeAgentKind(object.kind) ||
    fallback
  );
}

// A delegated participant's id is its call id; the app it runs is its origin,
// and that is what a source reference names.
function sourceObjectUnlessRepresented(
  source: AgentObjectReference | undefined,
  thread: AgentThreadState,
  displayedAgentIds: readonly (string | undefined)[],
): AgentObjectReference | undefined {
  if (
    source?.kind === "agent" &&
    displayedAgentIds.some(
      (id) =>
        id !== undefined &&
        (id === source.id || thread.agents[id]?.origin?.id === source.id),
    )
  ) {
    return undefined;
  }
  return source;
}

type ActivityToolValueBudget = {
  nodes: number;
  remainingCharacters: number;
  ancestors: WeakSet<object>;
  truncated: boolean;
};

type ActivityValueLabels = Pick<
  AgentKitLabels,
  | "activityValueIdentifierHidden"
  | "activityValueOmitted"
  | "activityValueCircular"
>;

function resolveActivityValueLabels(
  labels: Partial<AgentKitLabels> = {},
): Required<ActivityValueLabels> {
  return {
    activityValueIdentifierHidden:
      labels.activityValueIdentifierHidden ??
      defaultAgentKitLabels.activityValueIdentifierHidden!,
    activityValueOmitted:
      labels.activityValueOmitted ??
      defaultAgentKitLabels.activityValueOmitted!,
    activityValueCircular:
      labels.activityValueCircular ??
      defaultAgentKitLabels.activityValueCircular!,
  };
}

function activityToolValue(
  value: unknown,
  budget: ActivityToolValueBudget,
  labels: Required<ActivityValueLabels>,
  depth = 0,
): unknown {
  if (budget.nodes >= ACTIVITY_TOOL_NODE_LIMIT) {
    budget.truncated = true;
    return undefined;
  }
  budget.nodes++;
  if (depth > ACTIVITY_TOOL_DEPTH_LIMIT) {
    budget.truncated = true;
    return labels.activityValueOmitted;
  }
  if (typeof value === "string") {
    if (isUuid(value)) return labels.activityValueIdentifierHidden;
    const sourceLimit = budget.remainingCharacters + 36;
    let text = hideUuids(value.slice(0, sourceLimit));
    if (value.length > sourceLimit) {
      text = text.slice(0, Math.max(0, text.length - 36));
      budget.truncated = true;
    }
    const safeText = text.slice(0, budget.remainingCharacters);
    budget.remainingCharacters -= safeText.length;
    if (text.length > safeText.length) budget.truncated = true;
    if (text.length > 0 && safeText.length === 0) {
      return labels.activityValueOmitted;
    }
    return safeText;
  }
  if (value && typeof value === "object") {
    if (budget.ancestors.has(value)) {
      budget.truncated = true;
      return labels.activityValueCircular;
    }
    budget.ancestors.add(value);
    if (Array.isArray(value)) {
      const items: unknown[] = [];
      let visited = 0;
      for (let index = 0; index < value.length; index++) {
        if (budget.nodes >= ACTIVITY_TOOL_NODE_LIMIT) break;
        budget.nodes++;
        visited++;
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (!descriptor || !("value" in descriptor)) continue;
        const safeValue = activityToolValue(
          descriptor.value,
          budget,
          labels,
          depth + 1,
        );
        if (safeValue !== undefined) items.push(safeValue);
      }
      if (visited < value.length) {
        budget.truncated = true;
        items.push(labels.activityValueOmitted);
      }
      budget.ancestors.delete(value);
      return items.length ? items : undefined;
    }

    const result: Record<string, unknown> = Object.create(null);
    let included = 0;
    for (const key in value) {
      if (budget.nodes >= ACTIVITY_TOOL_NODE_LIMIT) {
        budget.truncated = true;
        break;
      }
      budget.nodes++;
      if (!Object.hasOwn(value, key) || isUuid(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) continue;
      const keyLimit = budget.remainingCharacters + 36;
      let safeKey = hideUuids(key.slice(0, keyLimit));
      if (key.length > keyLimit) {
        safeKey = safeKey.slice(0, Math.max(0, safeKey.length - 36));
        budget.truncated = true;
      }
      const boundedKey = safeKey.slice(0, budget.remainingCharacters);
      if (safeKey.length > boundedKey.length) budget.truncated = true;
      safeKey = boundedKey;
      if (!safeKey.trim()) continue;
      budget.remainingCharacters -= safeKey.length;
      const safeValue = activityToolValue(
        descriptor.value,
        budget,
        labels,
        depth + 1,
      );
      if (safeValue === undefined) continue;
      result[safeKey] = safeValue;
      included++;
    }
    budget.ancestors.delete(value);
    return included ? result : undefined;
  }
  return value;
}

function createActivityToolValueBudget(): ActivityToolValueBudget {
  return {
    nodes: 0,
    remainingCharacters: ACTIVITY_TOOL_VALUE_LIMIT - 64,
    ancestors: new WeakSet(),
    truncated: false,
  };
}

function formatActivityText(
  value: string,
  labels: Partial<AgentKitLabels> = {},
): string {
  const budget = createActivityToolValueBudget();
  const safeValue = activityToolValue(
    value,
    budget,
    resolveActivityValueLabels(labels),
  );
  if (typeof safeValue !== "string") return "";
  return budget.truncated ? `${safeValue}…` : safeValue;
}

function formatActivityToolValue(
  value: unknown,
  labels: Partial<AgentKitLabels> = {},
): string | undefined {
  const budget = createActivityToolValueBudget();
  const valueLabels = resolveActivityValueLabels(labels);
  const safeValue = activityToolValue(value, budget, valueLabels);
  if (safeValue === undefined) {
    return budget.truncated ? valueLabels.activityValueOmitted : undefined;
  }
  const formatted = formatToolDiagnostic(safeValue);
  if (!formatted?.trim()) {
    return budget.truncated ? valueLabels.activityValueOmitted : undefined;
  }
  if (!budget.truncated && formatted.length <= ACTIVITY_TOOL_VALUE_LIMIT) {
    return formatted;
  }
  const omissionMarker = `\n${valueLabels.activityValueOmitted}`;
  const contentLimit = Math.max(
    0,
    ACTIVITY_TOOL_VALUE_LIMIT - omissionMarker.length - 1,
  );
  return `${formatted.slice(0, contentLimit).trimEnd()}…${omissionMarker}`;
}

interface ActivityToolInput {
  text: string;
  language?: string | undefined;
  /** The call's other arguments, when `text` is its source. */
  options?: Array<[string, string]>;
}

/** Fields whose string is the program a tool runs, with its grammar. */
const ACTIVITY_TOOL_SOURCE_FIELDS: Record<string, string | undefined> = {
  command: "bash",
  script: undefined,
  code: undefined,
};

function formatActivityToolInput(
  value: unknown,
  labels: Partial<AgentKitLabels> = {},
): ActivityToolInput | undefined {
  const source = activityToolSource(value);
  if (!source) {
    const text = formatActivityToolValue(value, labels);
    return text ? { text } : undefined;
  }
  const text = formatActivityToolValue(source.text, labels);
  if (!text) return undefined;
  const options = Object.entries(source.rest).flatMap(
    ([key, option]): Array<[string, string]> => {
      const formatted = formatActivityToolValue(option, labels);
      return formatted ? [[key, formatted.replace(/\s+/g, " ")]] : [];
    },
  );
  return {
    text,
    language: source.language,
    ...(options.length ? { options } : {}),
  };
}

function activityToolSource(value: unknown):
  | {
      text: string;
      language: string | undefined;
      rest: Record<string, unknown>;
    }
  | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const field = Object.keys(ACTIVITY_TOOL_SOURCE_FIELDS).find((key) => {
    const text = input[key];
    // `code` also names short values such as a country or a promo code.
    return (
      typeof text === "string" &&
      (key === "command" ? text.trim() !== "" : /\n|.{40}/.test(text))
    );
  });
  if (!field) return undefined;
  const languageField = ["language", "lang"].find(
    (key) => typeof input[key] === "string",
  );
  const rest = Object.fromEntries(
    Object.entries(input).filter(
      ([key, option]) =>
        key !== field && key !== languageField && option !== undefined,
    ),
  );
  return {
    text: input[field] as string,
    language: languageField
      ? (input[languageField] as string)
      : ACTIVITY_TOOL_SOURCE_FIELDS[field],
    rest,
  };
}

function activityLabel(activity: AgentActivity, workingLabel: string): string {
  const label = readableText(activity.label);
  if (label.toLowerCase() === "processing") return workingLabel;
  return (
    humanizeAgentLabel(label) ||
    humanizeAgentKind(activity.kind) ||
    workingLabel
  );
}

function AgentIdentityChip({
  id,
  name,
  fallbackName = "Agent",
  kind,
  status,
}: {
  id: string;
  name: string;
  fallbackName?: string;
  kind?: string;
  status?: AgentParticipant["status"];
}) {
  const { labels } = useAgentKit();
  // The chip's tint and shimmer carry the state, so it is said in words too.
  const statusLabel =
    status === "working"
      ? labels.taskStatusRunning
      : status === "failed"
        ? labels.taskStatusFailed
        : status === "waiting"
          ? labels.taskStatusAwaitingInput
          : undefined;
  return (
    <span
      className="agentkit-agent"
      data-agent-id={id}
      data-agent-kind={kind}
      data-status={status}
    >
      {status === "failed" ? (
        <IconAlertTriangle aria-hidden="true" className="agentkit-icon" />
      ) : null}
      <span className="agentkit-agent-name">
        {readableText(name) || fallbackName}
      </span>
      {statusLabel ? (
        <span className="agentkit-visually-hidden">{statusLabel}</span>
      ) : null}
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
      return humanizeAgentKind(interaction.kind) || labels.working;
  }
}

export function AgentInteractionItem({
  value: interaction,
  threadId,
}: AgentKitRenderProps<AgentInteraction>) {
  const { slots, registry, labels, formatAgentInteractionDetail } =
    useAgentKit();
  const thread = useAgentThreadSlice(sameAgents, threadId);
  const showAgent =
    useContext(AgentSubagentStepContext) !== interaction.agentId;
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
  const agentName = resolveAgentName(
    thread,
    interaction.agentId,
    [interaction.source],
    labels.assistant,
  );
  const targetName = resolveAgentName(
    thread,
    interaction.targetAgentId,
    [interaction.object],
    labels.assistant,
  );
  const object =
    interaction.object ??
    sourceObjectUnlessRepresented(interaction.source, thread, [
      interaction.agentId,
      interaction.targetAgentId,
    ]);
  const label = readableText(interaction.label);
  const visibleLabel =
    humanizeAgentLabel(label) ||
    defaultInteractionLabel({ ...interaction, label: undefined }, labels);
  const detail = readableText(
    formatAgentInteractionDetail?.(interaction) ?? interaction.detail,
  );
  return (
    <div
      className="agentkit-agent-interaction"
      data-kind={interaction.kind}
      data-scope={interaction.scope}
    >
      <TraceLine
        className="agentkit-agent-interaction-head"
        status={interaction.kind === "failed" ? "error" : undefined}
      >
        <TraceIcon>{interactionIcon(interaction.kind)}</TraceIcon>
        {!showAgent ? null : AgentRenderer ? (
          <AgentRenderer value={agent} threadId={threadId} />
        ) : (
          <AgentIdentityChip
            id={interaction.agentId}
            name={agentName}
            fallbackName={labels.assistant}
          />
        )}
        <span
          data-slot="trace-title"
          className="agentkit-agent-interaction-label"
        >
          {visibleLabel}
        </span>
        {target && TargetRenderer ? (
          <TargetRenderer value={target} threadId={threadId} />
        ) : interaction.targetAgentId ? (
          <AgentIdentityChip
            id={interaction.targetAgentId}
            name={targetName}
            fallbackName={labels.assistant}
          />
        ) : null}
        {object ? <ObjectRenderer value={object} threadId={threadId} /> : null}
      </TraceLine>
      {detail && (!object || interaction.kind === "failed") ? (
        <span
          {...(interaction.kind === "failed"
            ? SESSION_REPLAY_MASK_PROPS
            : { title: detail })}
          className="agentkit-agent-interaction-detail"
        >
          {detail}
        </span>
      ) : null}
    </div>
  );
}

const ACTIVITY_ERROR_PREVIEW_LIMIT = 160;

function activityErrorPreview(
  activity: AgentActivity,
  tool: AgentToolCall | undefined,
  labels: Partial<AgentKitLabels>,
): string {
  if (activity.status !== "failed") return "";
  const summaryText = activity.summary
    ?.find(
      (part): part is Extract<AgentMessagePart, { type: "text" }> =>
        part.type === "text" && part.text.trim().length > 0,
    )
    ?.text.trim();
  // Structured diagnostics read badly on one line; they stay in the details.
  const message =
    tool?.error?.message.trim() ||
    (tool ? undefined : activity.detail?.trim()) ||
    (summaryText && !/^[[{]/.test(summaryText) ? summaryText : undefined);
  if (!message) return "";
  const text = readableText(formatActivityText(message, labels));
  return text.length > ACTIVITY_ERROR_PREVIEW_LIMIT
    ? `${text.slice(0, ACTIVITY_ERROR_PREVIEW_LIMIT).trimEnd()}…`
    : text;
}

export function AgentActivityItem({
  value: activity,
  threadId,
}: AgentKitRenderProps<AgentActivity>) {
  const { slots, registry, labels } = useAgentKit();
  const thread = useAgentThreadSlice(
    (previous, next) =>
      previous.agents === next.agents &&
      previous.tools[activity.id] === next.tools[activity.id],
  );
  const [open, setOpen] = useState(false);
  const showAgent = useContext(AgentSubagentStepContext) !== activity.agentId;
  const agent = activity.agentId ? thread.agents[activity.agentId] : undefined;
  const agentName = resolveAgentName(
    thread,
    activity.agentId,
    [activity.source, activity.object],
    labels.assistant,
  );
  const tool = thread.tools[activity.id] as AgentToolCall | undefined;
  const toolInput = useMemo(
    () => (tool ? formatActivityToolInput(tool.input, labels) : undefined),
    [labels, tool],
  );
  const toolResult = useMemo(
    () => (tool ? formatActivityToolValue(tool.output, labels) : undefined),
    [labels, tool],
  );
  const stackTrace = useMemo(() => {
    if (!tool) return undefined;
    const sources = [
      toolResult,
      formatActivityToolValue(tool.error?.details, labels),
      formatActivityToolValue(tool.error?.message, labels),
    ];
    for (const source of sources) {
      const parsed = source ? parseStackTrace(source) : undefined;
      if (parsed) return { parsed, fromResult: source === toolResult };
    }
    return undefined;
  }, [labels, tool, toolResult]);
  const toolInputLabel = labels.toolInput;
  const toolResultLabel = labels.toolResult;
  const expandable = Boolean(
    activity.summary?.length || toolInput || toolResult,
  );
  const AgentRenderer = agent
    ? (registry.agents?.[agent.kind ?? ""] ??
      slots.agent ??
      AgentParticipantView)
    : undefined;
  const ObjectRenderer = slots.object ?? AgentObjectReferenceView;
  const object =
    activity.object ??
    sourceObjectUnlessRepresented(activity.source, thread, [activity.agentId]);
  const failed = activity.status === "failed";
  const statusWords =
    activity.status === "running"
      ? labels.taskStatusRunning
      : failed
        ? labels.taskStatusFailed
        : activity.status === "cancelled"
          ? labels.runStopped
          : undefined;
  const errorPreview = activityErrorPreview(activity, tool, labels);
  // A tool call names what it acted on, so rows in a group tell apart.
  const toolObject =
    tool && !object
      ? agentWorkCallObject({ id: activity.id, activity, tool })
      : undefined;
  const detail =
    tool || failed
      ? readableText(toolObject?.text)
      : readableText(activity.detail);
  const line = (
    <TraceLine status={traceStatus(activity.status)}>
      <TraceIcon>
        {failed ? (
          <IconAlertTriangle aria-hidden="true" className="agentkit-icon" />
        ) : (
          <ActivitySourceIcon activity={activity} threadId={threadId} />
        )}
      </TraceIcon>
      <span className="agentkit-disclosure-label">
        {!showAgent ? null : agent && AgentRenderer ? (
          <AgentRenderer value={agent} threadId={threadId} />
        ) : activity.agentId ? (
          <AgentIdentityChip
            id={activity.agentId}
            name={agentName}
            fallbackName={labels.assistant}
          />
        ) : null}
        <TraceTitle className="agentkit-activity-label">
          {activityLabel(activity, labels.working)}
        </TraceTitle>
        {/* State shows only as color, motion and icon, so say it in words too. */}
        {statusWords ? (
          <span className="agentkit-visually-hidden">{statusWords}</span>
        ) : null}
      </span>
    </TraceLine>
  );
  const meta = (
    <>
      {object ? <ObjectRenderer value={object} threadId={threadId} /> : null}
      {detail ? (
        <TraceDescription
          {...(toolObject ? SESSION_REPLAY_MASK_PROPS : {})}
          title={toolObject ? undefined : detail}
          className="agentkit-activity-detail"
          data-kind={toolObject?.kind}
        >
          {detail}
        </TraceDescription>
      ) : null}
    </>
  );
  const errorLine = errorPreview ? (
    // Replays mask text but record attributes, so failure text gets no title.
    <span {...SESSION_REPLAY_MASK_PROPS} className="agentkit-activity-error">
      {errorPreview}
    </span>
  ) : null;
  const rootProps = {
    className: "agentkit-activity-item",
    "data-activity-kind": activity.kind,
    "data-status": activity.status,
    "data-open": expandable && open ? "true" : "false",
  };
  const fileChange = tool ? fileChangeTool(tool) : undefined;
  if (fileChange) {
    return (
      <div {...rootProps}>
        <FileChange
          change={fileChange}
          running={activity.status === "running"}
        />
        {errorLine}
      </div>
    );
  }
  const terminal = tool ? terminalTool(tool) : undefined;
  if (terminal) {
    return (
      <div {...rootProps}>
        <Terminal
          command={terminal.command}
          output={typeof tool?.output === "string" ? tool.output : toolResult}
          running={activity.status === "running"}
          exitCode={terminal.exitCode}
          durationMs={terminal.durationMs}
          timedOut={terminal.timedOut}
          failed={failed}
        />
      </div>
    );
  }
  if (!expandable) {
    return (
      <div {...rootProps}>
        <div className="agentkit-disclosure-row agentkit-activity-row">
          <span className="agentkit-disclosure-summary" data-expandable="false">
            {line}
          </span>
          {meta}
        </div>
        {errorLine}
      </div>
    );
  }
  return (
    <TraceCollapsible {...rootProps} open={open} onOpenChange={setOpen}>
      <div
        className="agentkit-disclosure-row agentkit-activity-row"
        data-expandable="true"
        onClick={(event) => {
          // Meta controls handle their own clicks; a text-selecting drag is no toggle.
          const target = event.target;
          if (
            target instanceof Element &&
            target.closest(DISCLOSURE_ROW_INTERACTIVE)
          )
            return;
          if (globalThis.getSelection()?.toString()) return;
          setOpen((current) => !current);
        }}
      >
        <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
        {meta}
      </div>
      {errorLine}
      <TraceCollapsibleContent
        // A fresh node on each toggle: the recorder can drop a block marker
        // changed on a node it has recorded, and the closed body stays mounted.
        key={open ? "open" : "closed"}
        keepMounted
        {...(activity.status === "failed" || !open
          ? SESSION_REPLAY_BLOCK_PROPS
          : {})}
        className="agentkit-activity-summary"
      >
        {activity.summary?.map((part, index) => {
          const safePart =
            part.type === "text"
              ? {
                  ...part,
                  text: part.text.trim()
                    ? formatActivityText(part.text, labels)
                    : "",
                }
              : part;
          return safePart.type === "text" && !safePart.text ? null : (
            <AgentMessagePartView
              key={`${activity.id}-summary-${index}`}
              value={safePart}
              threadId={threadId}
            />
          );
        })}
        {toolInput ? (
          <ActivityToolValue
            label={toolInputLabel}
            value={toolInput.text}
            language={toolInput.language}
            options={toolInput.options}
          />
        ) : null}
        {stackTrace ? (
          <StackTrace trace={stackTrace.parsed} defaultOpen />
        ) : null}
        {toolResult && !(stackTrace?.fromResult && stackTrace.parsed.whole) ? (
          <ActivityToolValue label={toolResultLabel} value={toolResult} />
        ) : null}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function terminalTool(tool: AgentToolCall):
  | {
      command: string;
      exitCode: number | null | undefined;
      durationMs: number | undefined;
      timedOut: boolean | undefined;
    }
  | undefined {
  const metadata = tool.metadata;
  if (metadata?.toolKind !== "bash" || typeof metadata.command !== "string") {
    return undefined;
  }
  return {
    command: metadata.command,
    exitCode:
      typeof metadata.exitCode === "number" || metadata.exitCode === null
        ? metadata.exitCode
        : undefined,
    durationMs:
      typeof metadata.durationMs === "number" ? metadata.durationMs : undefined,
    timedOut: metadata.timedOut === true ? true : undefined,
  };
}

function fileChangeTool(tool: AgentToolCall): FileChangeData | undefined {
  const metadata = tool.metadata;
  const kind = metadata?.toolKind;
  if (
    (kind !== "edit" && kind !== "write") ||
    typeof metadata?.filePath !== "string"
  ) {
    return undefined;
  }
  const text = (value: unknown) =>
    typeof value === "string" ? value : undefined;
  return {
    filePath: metadata.filePath,
    kind,
    oldText: text(metadata.oldText),
    newText: text(metadata.newText),
    content: text(metadata.content),
    lineCount:
      typeof metadata.lineCount === "number" ? metadata.lineCount : undefined,
    truncated: metadata.truncated === true,
  };
}

function ActivityToolValue({
  label,
  value,
  language: sourceLanguage,
  options,
}: {
  label: string;
  value: string;
  language?: string | undefined;
  options?: Array<[string, string]> | undefined;
}) {
  const language = useMemo(
    () => sourceLanguage ?? (isJsonText(value) ? "json" : undefined),
    [sourceLanguage, value],
  );
  return (
    <CodeBlock size="sm" className="agentkit-activity-summary-section">
      <CodeBlockHeader>
        <CodeBlockTitle>{label}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={value} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent
        wrap
        language={language}
        role="group"
        aria-label={label}
        className="agentkit-activity-summary-value"
      >
        {value}
      </CodeBlockContent>
      {options ? (
        <CodeBlockFooter>
          <dl className="agentkit-activity-tool-options">
            {options.map(([key, option]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{option}</dd>
              </div>
            ))}
          </dl>
        </CodeBlockFooter>
      ) : null}
    </CodeBlock>
  );
}

function isJsonText(text: string): boolean {
  const start = text.trimStart()[0];
  if (start !== "{" && start !== "[") return false;
  try {
    JSON.parse(text);
    return true;
    // coercion-ok: text that does not parse is the predicate's false answer.
  } catch {
    return false;
  }
}

/** The same page cited twice counts as one source. */
export function AgentSources({ citations }: { citations: CitationPart[] }) {
  const { labels } = useAgentKit();
  const sources = useMemo(() => {
    const seen = new Set<string>();
    return citations.filter((citation) => {
      const key = safeAgentHref(citation.url) ?? `title:${citation.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [citations]);
  const label = (
    sources.length === 1
      ? labels.workStepSourcesOne
      : labels.workStepSourcesOther
  ).replace("{{count}}", () => `${sources.length}`);
  return (
    <Trace className="agentkit-sources">
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <IconWorld aria-hidden="true" className="agentkit-icon" />
            </TraceIcon>
            <span className="agentkit-disclosure-label">{label}</span>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent keepMounted>
          <ul className="agentkit-sources-list">
            {sources.map((source, index) => (
              <li key={`${index}:${source.url ?? source.title}`}>
                <AgentLink href={source.url}>
                  <TraceLine>
                    <TraceIcon>
                      <IconWorld aria-hidden="true" className="agentkit-icon" />
                    </TraceIcon>
                    <TraceTitle>{sourceTitle(source)}</TraceTitle>
                  </TraceLine>
                </AgentLink>
              </li>
            ))}
          </ul>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function sourceTitle(source: CitationPart): string {
  const title = readableText(source.title);
  if (title) return title;
  const href = safeAgentHref(source.url);
  if (!href) return source.title;
  try {
    return new URL(href).hostname;
  } catch {
    return href;
  }
}

function traceStatus(status: AgentActivity["status"]): TraceStatus | undefined {
  return status === "running"
    ? "running"
    : status === "failed"
      ? "error"
      : undefined;
}

function ActivitySourceIcon({
  activity,
  threadId,
  compact = false,
}: {
  activity: AgentActivity;
  threadId: string;
  compact?: boolean;
}) {
  const { registry } = useAgentKit();
  const thread = useAgentThreadSlice(
    (previous, next) => previous.tools[activity.id] === next.tools[activity.id],
    threadId,
  );
  const tool = thread.tools[activity.id];
  const source = tool ? registry.toolSource?.(tool) : undefined;
  return source ? source.icon : compact ? null : activityIcon(activity.kind);
}

function formatToolDiagnostic(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value || undefined;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function toolToActivity(
  tool: AgentToolCall,
  labels: Partial<AgentKitLabels> = {},
): AgentActivity {
  const failed = tool.status === "failed";
  const errorMessage = failed
    ? ((tool.error?.message?.trim()
        ? formatActivityToolValue(tool.error.message, labels)
        : undefined) ??
      formatActivityToolValue(tool.output, labels) ??
      formatActivityToolValue(tool.error?.details, labels))
    : undefined;
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
    detail: failed
      ? undefined
      : typeof tool.output === "string"
        ? tool.output
        : typeof tool.input === "string"
          ? tool.input
          : undefined,
    summary:
      failed && errorMessage
        ? [{ type: "text", text: errorMessage }]
        : undefined,
  };
}

interface AgentEventRange {
  runId?: RunId | undefined;
  afterSequence?: number | undefined;
  throughSequence?: number | undefined;
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

/**
 * Span from the first to the last reasoning delta. One delta has no span, so
 * it is unknown rather than zero.
 */
function reasoningDurationMs(
  events: readonly AgentEvent[],
  messageIds: ReadonlySet<string>,
): number | undefined {
  let first: number | undefined;
  let last: number | undefined;
  let count = 0;
  for (const event of events) {
    if (event.type !== "reasoning.delta" || !messageIds.has(event.messageId)) {
      continue;
    }
    const at = Date.parse(event.occurredAt);
    if (!Number.isFinite(at)) continue;
    count += 1;
    first = first === undefined ? at : Math.min(first, at);
    last = last === undefined ? at : Math.max(last, at);
  }
  return count < 2 || first === undefined || last === undefined
    ? undefined
    : last - first;
}

/** A finished turn's row: "Worked for 59s", or "Worked" when untimed. */
function workedSummaryLabel(
  durationMs: number | undefined,
  labels: Pick<AgentKitLabels, "worked" | "workedFor">,
  formatDuration: (ms: number) => string,
): string {
  // A reloaded thread may have no timing; that must not read as instant.
  return durationMs !== undefined && durationMs >= 1_000
    ? labels.workedFor.replace("{{duration}}", () => formatDuration(durationMs))
    : labels.worked;
}

function isVisibleReasoningPart(part: AgentMessagePart): boolean {
  return (
    part.type === "reasoning" &&
    part.visibility !== "hidden" &&
    Boolean(part.text.trim())
  );
}

function hasVisibleReasoning(message: AgentMessage): boolean {
  return message.parts.some(isVisibleReasoningPart);
}

/** Reasoning that precedes a reply's first answer content, if any. */
function leadingReasoningCount(message: AgentMessage): number {
  let count = 0;
  for (const part of message.parts) {
    if (part.type !== "reasoning") break;
    count += 1;
  }
  return message.parts.slice(0, count).some(isVisibleReasoningPart) ? count : 0;
}

function leadingReasoningMessage(
  message: AgentMessage | undefined,
): AgentMessage | undefined {
  if (message?.role !== "assistant") return undefined;
  const count = leadingReasoningCount(message);
  return count
    ? { ...message, parts: message.parts.slice(0, count) }
    : undefined;
}

function withoutLeadingReasoning(message: AgentMessage): AgentMessage {
  const count = leadingReasoningCount(message);
  return count ? { ...message, parts: message.parts.slice(count) } : message;
}

function reasoningMessageId(event: AgentEvent): string | undefined {
  if (event.type === "reasoning.delta" && event.text.trim()) {
    return event.messageId;
  }
  if (
    (event.type === "message.created" || event.type === "message.completed") &&
    event.message.role === "assistant" &&
    event.message.parts.some(
      (part) => part.type === "reasoning" && part.text.trim(),
    )
  ) {
    return event.message.id;
  }
  return undefined;
}

function workEventIdentity(event: AgentEvent): string | undefined {
  const messageId = reasoningMessageId(event);
  if (messageId) return `reasoning:${messageId}`;
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

function widgetHasVisibleAssistantOutput(
  widget: AgentWidget,
  widgetRenderer: AgentKitSlots["widget"],
  widgetRenderers: AgentKitRegistry["widgets"],
  messagePartRenderers: AgentKitRegistry["messageParts"],
): boolean {
  return Boolean(
    messagePartRenderers?.widget ||
    widgetRenderers?.[widget.kind] ||
    widgetRenderer ||
    hasVisibleDefaultWidgetOutput(widget),
  );
}

function messageHasVisibleAssistantOutput(
  message: AgentMessage,
  messageRenderer: AgentKitSlots["message"],
  textRenderer: AgentKitSlots["text"],
  dataRenderer: AgentKitSlots["data"],
  widgetRenderer: AgentKitSlots["widget"],
  widgetRenderers: AgentKitRegistry["widgets"],
  messagePartRenderers: AgentKitRegistry["messageParts"],
  attachedWidgets: readonly AgentWidget[] = [],
): boolean {
  if (message.role !== "assistant") return false;
  if (messageRenderer) return true;
  return (
    message.parts.some((part) => {
      if (part.type === "reasoning") return false;
      if (part.type === "text") {
        return (
          Boolean(textRenderer || messagePartRenderers?.text) ||
          part.text.trim().length > 0
        );
      }
      if (part.type === "data") {
        return Boolean(dataRenderer || messagePartRenderers?.data);
      }
      if (part.type === "widget") {
        return widgetHasVisibleAssistantOutput(
          part.widget,
          widgetRenderer,
          widgetRenderers,
          messagePartRenderers,
        );
      }
      if (part.type.startsWith("x-")) {
        return Boolean(messagePartRenderers?.[part.type]);
      }
      return true;
    }) ||
    attachedWidgets.some((widget) =>
      widgetHasVisibleAssistantOutput(
        widget,
        widgetRenderer,
        widgetRenderers,
        messagePartRenderers,
      ),
    )
  );
}

function eventHasVisibleAssistantOutput(
  event: AgentEvent,
  assistantMessageIds: ReadonlySet<string>,
  messageRenderer: AgentKitSlots["message"],
  textRenderer: AgentKitSlots["text"],
  dataRenderer: AgentKitSlots["data"],
  widgetRenderer: AgentKitSlots["widget"],
  widgetRenderers: AgentKitRegistry["widgets"],
  messagePartRenderers: AgentKitRegistry["messageParts"],
): boolean {
  if (event.type === "message.delta") {
    return (
      assistantMessageIds.has(event.messageId) &&
      (event.text.trim().length > 0 ||
        Boolean(messageRenderer || textRenderer || messagePartRenderers?.text))
    );
  }
  if (event.type === "widget.created" || event.type === "widget.updated") {
    return Boolean(
      event.messageId &&
      assistantMessageIds.has(event.messageId) &&
      widgetHasVisibleAssistantOutput(
        event.widget,
        widgetRenderer,
        widgetRenderers,
        messagePartRenderers,
      ),
    );
  }
  if (event.type !== "message.created" && event.type !== "message.completed") {
    return false;
  }
  return messageHasVisibleAssistantOutput(
    event.message,
    messageRenderer,
    textRenderer,
    dataRenderer,
    widgetRenderer,
    widgetRenderers,
    messagePartRenderers,
  );
}

/**
 * True when nothing a run-scoped work renderer reads changed: the run's own
 * events, the tools, activities and reasoning messages they name, and the run.
 */
function sameRunWork(
  previous: AgentThreadState,
  next: AgentThreadState,
  runId: RunId | undefined,
): boolean {
  const runEvents = agentRunEvents(next, runId);
  if (agentRunEvents(previous, runId) !== runEvents) return false;
  if (runId !== undefined && previous.runs[runId] !== next.runs[runId]) {
    return false;
  }
  const sameTools = previous.tools === next.tools;
  const sameActivities = previous.activities === next.activities;
  const sameTasks = previous.tasks === next.tasks;
  const sameMessages = previous.messages === next.messages;
  if (sameTools && sameActivities && sameTasks && sameMessages) return true;
  const previousMessages = agentMessagesById(previous.messages);
  const nextMessages = agentMessagesById(next.messages);
  for (const event of runEvents) {
    if (
      !sameActivities &&
      (event.type === "activity.started" ||
        event.type === "activity.updated" ||
        event.type === "activity.completed") &&
      previous.activities[event.activity.id] !==
        next.activities[event.activity.id]
    ) {
      return false;
    }
    if (!sameTools) {
      const toolId =
        event.type === "tool.started" || event.type === "tool.updated"
          ? event.toolCall.id
          : event.type === "tool.delta"
            ? event.toolCallId
            : undefined;
      if (toolId && previous.tools[toolId] !== next.tools[toolId]) {
        return false;
      }
    }
    if (
      !sameTasks &&
      (event.type === "task.created" ||
        event.type === "task.updated" ||
        event.type === "task.completed") &&
      previous.tasks[event.task.id] !== next.tasks[event.task.id]
    ) {
      return false;
    }
    if (!sameMessages) {
      const messageId = reasoningMessageId(event);
      if (
        messageId &&
        previousMessages.get(messageId)?.message !==
          nextMessages.get(messageId)?.message
      ) {
        return false;
      }
    }
  }
  return true;
}

export const AgentActivityGroup = memo(function AgentActivityGroup({
  runId,
  afterSequence,
  throughSequence,
  excludeAgentActivities = false,
  isCurrentSegment = true,
  messageId,
  foldedReasoningMessageId,
  summarizesTurn = false,
  part,
}: {
  runId?: RunId | undefined;
  afterSequence?: number | undefined;
  throughSequence?: number | undefined;
  excludeAgentActivities?: boolean | undefined;
  isCurrentSegment?: boolean | undefined;
  /** The reply this work segment precedes. */
  messageId?: string | undefined;
  /** A saved reply whose reasoning before its answer joins this group. */
  foldedReasoningMessageId?: string | undefined;
  /** This segment is its run's whole turn, so it shows a row with no work. */
  summarizesTurn?: boolean | undefined;
  /** Only the steps' result cards, or only the work row; both by default. */
  part?: "results" | "row" | undefined;
}) {
  const {
    threadId,
    slots,
    registry,
    labels,
    formatWorkedForDuration,
    loadRunUsage,
  } = useAgentKit();
  const thread = useAgentThreadSlice((previous, next) =>
    sameRunWork(previous, next, runId),
  );
  const runEvents = agentRunEvents(thread, runId);
  const activityMap = new Map<string, AgentActivity>();
  const toolMap = new Map<string, AgentToolCall>();
  const messagesById = agentMessagesById(thread.messages);
  const latestEventOrder = new Map<string, number>();
  const isInternalActivity = (activity: AgentActivity) =>
    activity.id.startsWith("agentkit:internal:") ||
    activity.id === "activity:Starting agent" ||
    activity.id === "activity:Contacting model";
  const delegatedActivityIds = new Set<string>();
  const delegatedToolIds = new Set<string>();
  if (excludeAgentActivities) {
    for (const event of runEvents) {
      if (
        event.type === "activity.started" ||
        event.type === "activity.updated" ||
        event.type === "activity.completed"
      ) {
        const activity = thread.activities[event.activity.id] ?? event.activity;
        if (event.activity.agentId || activity.agentId) {
          delegatedActivityIds.add(event.activity.id);
        }
      }
      if (event.type === "tool.started" || event.type === "tool.updated") {
        const tool = thread.tools[event.toolCall.id] ?? event.toolCall;
        if (event.toolCall.agentId || tool.agentId) {
          delegatedToolIds.add(event.toolCall.id);
        }
      }
      if (
        event.type === "tool.delta" &&
        thread.tools[event.toolCallId]?.agentId
      ) {
        delegatedToolIds.add(event.toolCallId);
      }
    }
  }
  let latestUsefulActivity:
    | { activity: AgentActivity; sequence: number; eventOrder: number }
    | undefined;
  const usefulActivities = new Map<
    string,
    { activity: AgentActivity; sequence: number; eventOrder: number }
  >();
  const rememberUsefulActivity = (
    activity: AgentActivity,
    sequence: number,
    eventOrder: number,
  ) => {
    if (
      isInternalActivity(activity) ||
      activity.label.trim().toLowerCase() ===
        labels.reasoning.trim().toLowerCase()
    ) {
      return;
    }
    const candidate = { activity, sequence, eventOrder };
    usefulActivities.set(activity.id, candidate);
    if (
      !latestUsefulActivity ||
      (runId === undefined
        ? latestUsefulActivity.eventOrder <= eventOrder
        : latestUsefulActivity.sequence <= sequence)
    ) {
      latestUsefulActivity = candidate;
    }
  };
  const seenItems = new Set<string>();
  for (const [eventOrder, event] of runEvents.entries()) {
    const messageId = reasoningMessageId(event);
    const message = messageId
      ? messagesById.get(messageId)?.message
      : undefined;
    if (
      message?.role === "assistant" &&
      message.parts.some(
        (part) =>
          part.type === "reasoning" &&
          part.visibility !== "hidden" &&
          part.text.trim(),
      )
    ) {
      const id = `reasoning:${message.id}`;
      const activity: AgentActivity = {
        id,
        kind: "reasoning",
        label: labels.reasoning,
        status: message.status === "streaming" ? "running" : "completed",
      };
      activityMap.set(id, activity);
      seenItems.add(id);
      latestEventOrder.set(id, eventOrder);
      rememberUsefulActivity(activity, event.sequence, eventOrder);
    }
    if (
      event.type === "activity.started" ||
      event.type === "activity.updated" ||
      event.type === "activity.completed"
    ) {
      const activity = thread.activities[event.activity.id] ?? event.activity;
      if (
        excludeAgentActivities &&
        delegatedActivityIds.has(event.activity.id)
      ) {
        continue;
      }
      activityMap.set(event.activity.id, activity);
      latestEventOrder.set(event.activity.id, eventOrder);
      rememberUsefulActivity(activity, event.sequence, eventOrder);
    }
    if (event.type === "tool.started" || event.type === "tool.updated") {
      const tool = thread.tools[event.toolCall.id] ?? event.toolCall;
      if (excludeAgentActivities && delegatedToolIds.has(event.toolCall.id)) {
        continue;
      }
      toolMap.set(event.toolCall.id, tool);
      latestEventOrder.set(event.toolCall.id, eventOrder);
      rememberUsefulActivity(
        toolToActivity(tool, labels),
        event.sequence,
        eventOrder,
      );
    }
    if (event.type === "tool.delta") {
      if (excludeAgentActivities && delegatedToolIds.has(event.toolCallId)) {
        continue;
      }
      const tool = thread.tools[event.toolCallId];
      if (tool) {
        toolMap.set(tool.id, tool);
        rememberUsefulActivity(
          toolToActivity(tool, labels),
          event.sequence,
          eventOrder,
        );
      }
      latestEventOrder.set(event.toolCallId, eventOrder);
    }
  }
  const foldedReasoning = foldedReasoningMessageId
    ? leadingReasoningMessage(
        messagesById.get(foldedReasoningMessageId)?.message,
      )
    : undefined;
  const callIdOf = (event: AgentEvent): string | undefined => {
    if (
      event.type === "activity.started" ||
      event.type === "activity.updated" ||
      event.type === "activity.completed"
    ) {
      return excludeAgentActivities &&
        delegatedActivityIds.has(event.activity.id)
        ? undefined
        : event.activity.id;
    }
    const toolId =
      event.type === "tool.started" || event.type === "tool.updated"
        ? event.toolCall.id
        : event.type === "tool.delta"
          ? event.toolCallId
          : undefined;
    return toolId && !(excludeAgentActivities && delegatedToolIds.has(toolId))
      ? toolId
      : undefined;
  };
  const timeline = agentWorkTimeline({
    events: runEvents,
    callIdOf,
    reasoningOf: (event) => {
      const id =
        event.type === "reasoning.delta"
          ? event.messageId
          : reasoningMessageId(event);
      const message = id ? messagesById.get(id)?.message : undefined;
      return message?.role === "assistant" && hasVisibleReasoning(message)
        ? message
        : undefined;
    },
    includes:
      runId === undefined
        ? undefined
        : (event) =>
            sequenceInRange(event.sequence, { afterSequence, throughSequence }),
    // It came after every streamed step unless its parts name their calls.
    folded:
      foldedReasoning && !seenItems.has(`reasoning:${foldedReasoning.id}`)
        ? foldedReasoning
        : undefined,
  });
  const reasoningEntries = new Map<
    string,
    Extract<AgentWorkTimelineEntry, { type: "reasoning" }>
  >();
  const items = timeline.flatMap((entry): AgentActivity[] => {
    if (entry.type === "reasoning") {
      reasoningEntries.set(entry.key, entry);
      return [
        {
          id: entry.key,
          kind: "reasoning",
          label: labels.reasoning,
          status: entry.active ? "running" : "completed",
        },
      ];
    }
    const activity = activityMap.get(entry.id);
    if (activity) return [activity];
    const tool = toolMap.get(entry.id);
    return tool ? [toolToActivity(tool, labels)] : [];
  });
  const toolFor = (id: string): AgentToolCall | undefined =>
    toolMap.get(id) ?? thread.tools[id];
  // A result whose widget shows on its message already appears there, as it
  // does after a reload; drawing it here too would show a live run's card
  // twice. A widget with no message or nothing to draw it leaves the card here.
  const showsAsMessageWidget = (tool: AgentToolCall) =>
    [`${tool.id}:chat-ui`, `${tool.id}:mcp-app`].some((id) => {
      const widget = id in thread.widgets ? thread.widgets[id] : undefined;
      const messageId =
        id in thread.widgetMessageIds ? thread.widgetMessageIds[id] : undefined;
      if (!widget || !messageId || !messagesById.has(messageId)) return false;
      return widgetHasVisibleAssistantOutput(
        widget,
        slots.widget,
        registry.widgets,
        registry.messageParts,
      );
    });
  const durableToolResults = items.flatMap((activity) => {
    const tool = toolMap.get(activity.id);
    const Renderer = tool ? registry.tools?.[tool.name] : undefined;
    if (!tool || tool.status === "running") return [];
    if (Renderer) return [{ tool, Renderer }];
    if (tool.metadata?.chatUI || tool.metadata?.mcpApp) {
      return slots.tool && !showsAsMessageWidget(tool)
        ? [{ tool, Renderer: slots.tool }]
        : [];
    }
    return [];
  });
  const durableToolResultIds = new Set(
    durableToolResults.map(({ tool }) => tool.id),
  );
  const activityItems = items.filter(
    (activity) =>
      !durableToolResultIds.has(activity.id) && !isInternalActivity(activity),
  );
  const hasUsefulActivity =
    activityItems.length > 0 || durableToolResults.length > 0;
  const latestRunningUsefulActivity = [...usefulActivities.values()].reduce<
    typeof latestUsefulActivity | undefined
  >((current, candidate) => {
    if (candidate.activity.status !== "running") return current;
    return !current ||
      (runId === undefined
        ? candidate.eventOrder > current.eventOrder
        : candidate.sequence > current.sequence)
      ? candidate
      : current;
  }, undefined);
  const running = items.some((item) => item.status === "running");
  const run = runId ? thread.runs[runId] : undefined;
  const segmentStartedEvent = firstWorkEvents(runEvents).find(
    (event) =>
      runId === undefined ||
      sequenceInRange(event.sequence, { afterSequence, throughSequence }),
  );
  const startedAt =
    afterSequence === undefined && run?.startedAt
      ? Date.parse(run.startedAt)
      : segmentStartedEvent
        ? Date.parse(segmentStartedEvent.occurredAt)
        : Number.NaN;
  const responseStartedEvent =
    runId === undefined || throughSequence === undefined
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
  const hasTerminalRunEvent = runEvents.some(
    (event) =>
      event.runId === runId &&
      (event.type === "run.completed" ||
        event.type === "run.failed" ||
        event.type === "run.cancelled"),
  );
  // A local run, such as voice chat's, never starts on the server, so it
  // stays queued while it works; its own events show it is working.
  const localRunWorking =
    run?.status === "queued" && runEvents.length > 0 && !hasTerminalRunEvent;
  const activelyWorking =
    isCurrentSegment &&
    (run
      ? run.status === "running" || localRunWorking
      : running && !hasTerminalRunEvent);
  const waitingLabel =
    isCurrentSegment && run?.status === "awaiting_approval"
      ? labels.waitingForApproval
      : isCurrentSegment && run?.status === "awaiting_input"
        ? labels.waitingForInput
        : undefined;
  const completedRunSummary =
    hasUsefulActivity &&
    !activelyWorking &&
    (throughSequence !== undefined ||
      (items.length > 0 && !running) ||
      hasTerminalRunEvent ||
      (afterSequence === undefined &&
        run !== undefined &&
        ["completed", "failed", "cancelled"].includes(run.status)));
  const formatDuration = (ms: number) =>
    formatWorkedForDuration?.(ms) ??
    formatAgentKitDuration(ms, {
      hour: labels.durationHourShort,
      minute: labels.durationMinuteShort,
      second: labels.durationSecondShort,
    });
  const resultCards =
    durableToolResults.length && part !== "row" ? (
      <div data-agentkit-tool-results="true">
        {durableToolResults.map(({ tool, Renderer }) => (
          <Renderer key={tool.id} value={tool} threadId={threadId} />
        ))}
      </div>
    ) : null;
  if (part === "results") return resultCards;
  if (
    activityItems.length === 0 &&
    durableToolResults.length === 0 &&
    !activelyWorking
  ) {
    const runFinished = run
      ? ["completed", "failed", "cancelled"].includes(run.status)
      : hasTerminalRunEvent;
    // Untimed or under a second, a bare "Worked" would read as instant.
    if (
      !summarizesTurn ||
      !runFinished ||
      durationMs === undefined ||
      durationMs < 1_000
    ) {
      return null;
    }
    // With no steps, the run's details (cost, model) are what it opens to, so
    // it opens only when it can show one of them.
    const selectedModel = selectedRunModel(thread.messages, messageId);
    const hasRunDetails =
      runId !== undefined &&
      (loadRunUsage !== undefined ||
        (selectedModel !== undefined && selectedModel !== "auto"));
    return (
      <AgentWorkDisclosure
        label={workedSummaryLabel(durationMs, labels, formatDuration)}
        icon={<IconClock aria-hidden="true" className="agentkit-icon" />}
        expandable={hasRunDetails}
        {...(runId === undefined ? {} : { runId })}
        {...(messageId === undefined ? {} : { messageId })}
      >
        {null}
      </AgentWorkDisclosure>
    );
  }
  const currentActivity = activelyWorking
    ? (latestRunningUsefulActivity?.activity ??
      latestUsefulActivity?.activity ?? {
        id: `thinking:${runId ?? thread.id}`,
        kind: "model",
        label: labels.reasoning,
        status: "running",
      })
    : undefined;
  const currentActivityLabel = currentActivity
    ? activityLabel(currentActivity, labels.working)
    : undefined;
  const workItems = activityItems.map((activity): AgentWorkItem => {
    const entry = reasoningEntries.get(activity.id);
    if (entry) {
      return {
        type: "reasoning",
        key: entry.key,
        text: entry.text,
        active: entry.active,
      };
    }
    const tool = toolFor(activity.id);
    const sourceId = tool ? registry.toolSource?.(tool)?.id : undefined;
    return {
      type: "call",
      call: {
        id: activity.id,
        activity,
        ...(tool ? { tool } : {}),
        ...(sourceId ? { sourceId } : {}),
        standalone: Boolean(
          (tool && registry.tools?.[tool.name]) ||
          (registry.activities?.[activity.kind] ?? slots.activity),
        ),
      },
    };
  });
  const steps = agentWorkSteps(workItems);
  const hasExpandableActivity = steps.length > 0;
  const failedCount = steps.reduce((sum, step) => sum + step.failedCount, 0);
  const reasoningMessageIds = activityItems.flatMap((activity) => {
    const entry = reasoningEntries.get(activity.id);
    return entry ? [entry.messageId] : [];
  });
  const reasoningOnly =
    activityItems.length > 0 &&
    durableToolResults.length === 0 &&
    reasoningMessageIds.length === activityItems.length;
  const baseSummaryLabel =
    activelyWorking ||
    (activityItems.length === 0 && durableToolResults.length > 0)
      ? ""
      : waitingLabel && hasUsefulActivity
        ? waitingLabel
        : completedRunSummary
          ? workedSummaryLabel(
              durationMs ??
                (reasoningOnly
                  ? reasoningDurationMs(runEvents, new Set(reasoningMessageIds))
                  : undefined),
              labels,
              formatDuration,
            )
          : hasUsefulActivity
            ? labels.activities
            : "";
  const summaryLabel =
    baseSummaryLabel && failedCount > 0
      ? labels.workSummaryFailedCount
          .replace("{{summary}}", () => baseSummaryLabel)
          .replace("{{count}}", String(failedCount))
      : baseSummaryLabel;
  const visiblyRunning = activelyWorking;
  const summaryIcon = currentActivity ? (
    <ActivitySourceIcon activity={currentActivity} threadId={threadId} />
  ) : reasoningOnly && !completedRunSummary ? (
    activityIcon("reasoning")
  ) : (
    <IconClock aria-hidden="true" className="agentkit-icon" />
  );
  const renderCall = (call: AgentWorkCall) => {
    const ToolRenderer = call.tool
      ? (registry.tools?.[call.tool.name] ?? slots.tool)
      : undefined;
    if (call.tool && ToolRenderer) {
      return (
        <ToolRenderer key={call.id} value={call.tool} threadId={threadId} />
      );
    }
    const Renderer =
      registry.activities?.[call.activity.kind] ??
      slots.activity ??
      AgentActivityItem;
    return <Renderer key={call.id} value={call.activity} threadId={threadId} />;
  };
  return (
    <>
      {resultCards}
      {hasExpandableActivity || activelyWorking ? (
        <AgentWorkDisclosure
          label={baseSummaryLabel}
          failedCount={failedCount}
          icon={summaryIcon}
          running={visiblyRunning}
          expandable={hasExpandableActivity}
          runId={runId}
          messageId={messageId}
          current={
            currentActivity ? (
              <span
                className="agentkit-activities-current"
                data-running="true"
                data-agentkit-current-activity="true"
              >
                <ActivitySourceIcon
                  activity={currentActivity}
                  threadId={threadId}
                  compact
                />
                <span className="agentkit-activities-current-label agent-running-shimmer">
                  {currentActivityLabel}
                </span>
              </span>
            ) : null
          }
          currentLabel={
            currentActivity ? (
              <span
                className="agentkit-activities-current"
                data-running="true"
                data-agentkit-current-activity="true"
              >
                <span className="agentkit-activities-current-label agent-running-shimmer">
                  {currentActivityLabel}
                </span>
              </span>
            ) : null
          }
        >
          <AgentWorkStepList
            steps={steps}
            threadId={threadId}
            running={activelyWorking}
            renderCall={renderCall}
          />
        </AgentWorkDisclosure>
      ) : (
        <div className="agentkit-activities-static">
          {summaryLabel || currentActivity ? (
            <AgentKitDisclosureSummary
              as="static"
              className="agentkit-activities-summary"
              open={false}
              onToggle={() => {}}
              expandable={false}
              status={summaryLabel ? undefined : "running"}
              icon={summaryIcon}
              label={
                summaryLabel ? (
                  <span className="agentkit-activities-label">
                    {summaryLabel}
                  </span>
                ) : (
                  <span
                    className="agentkit-activities-current"
                    data-running="true"
                    data-agentkit-current-activity="true"
                  >
                    <span className="agentkit-activities-current-label agent-running-shimmer">
                      {currentActivityLabel}
                    </span>
                  </span>
                )
              }
            />
          ) : null}
        </div>
      )}
    </>
  );
});

const WORK_STEP_PREVIEW_COUNT = 6;
const WORK_GROUP_PREVIEW_COUNT = 4;
const WORK_OBJECT_PREVIEW_COUNT = 2;

function countLabel(one: string, other: string, count: number): string {
  return (count === 1 ? one : other).replace("{{count}}", () =>
    count.toLocaleString(),
  );
}

function workGroupLabel(
  verb: Exclude<AgentWorkVerb, "used">,
  count: number,
  labels: AgentKitLabels,
): string {
  const pairs: Record<typeof verb, [string, string]> = {
    searched: [labels.workStepSearchedOne, labels.workStepSearchedOther],
    readPages: [labels.workStepReadPagesOne, labels.workStepReadPagesOther],
    fetched: [labels.workStepFetchedOne, labels.workStepFetchedOther],
    readFiles: [labels.workStepReadFilesOne, labels.workStepReadFilesOther],
    edited: [labels.workStepEditedOne, labels.workStepEditedOther],
    ranCommands: [
      labels.workStepRanCommandsOne,
      labels.workStepRanCommandsOther,
    ],
    ranActions: [labels.workStepRanActionsOne, labels.workStepRanActionsOther],
  };
  const [one, other] = pairs[verb];
  return countLabel(one, other, count);
}

function workStepVerbTitle(
  verb: AgentWorkVerb | undefined,
  labels: AgentKitLabels,
): string {
  switch (verb) {
    case "searched":
      return labels.workStepSearching;
    case "readPages":
      return labels.workStepReadingPages;
    case "fetched":
      return labels.workStepFetching;
    case "readFiles":
      return labels.workStepReadingFiles;
    case "edited":
      return labels.workStepEditing;
    case "ranCommands":
      return labels.workStepRunningCommands;
    case "ranActions":
      return labels.workStepRunningActions;
    case "used":
    case undefined:
    default:
      return labels.working;
  }
}

function workVerbIcon(verb: AgentWorkVerb): ReactNode {
  const props = { "aria-hidden": true, className: "agentkit-icon" } as const;
  switch (verb) {
    case "searched":
      return <IconSearch {...props} />;
    case "readPages":
      return <IconWorld {...props} />;
    case "fetched":
      return <IconWorldDownload {...props} />;
    case "readFiles":
      return <IconFileText {...props} />;
    case "edited":
      return <IconPencil {...props} />;
    case "ranCommands":
      return <IconTerminal2 {...props} />;
    case "ranActions":
      return <IconBolt {...props} />;
    case "used":
    default:
      return null;
  }
}

/** A tool's display name inside a sentence, keeping acronyms intact. */
function inlineToolName(name: string): string {
  return /^[A-Z][a-z]/.test(name)
    ? name.charAt(0).toLowerCase() + name.slice(1)
    : name;
}

function AgentWorkObjects({ objects }: { objects: AgentWorkObject[] }) {
  const { labels } = useAgentKit();
  const readable = objects
    .map((object) => ({ ...object, text: readableText(object.text) }))
    .filter((object) => object.text);
  if (!readable.length) return null;
  const shown = readable.slice(0, WORK_OBJECT_PREVIEW_COUNT);
  const more = readable.length - shown.length;
  return (
    <>
      <span {...SESSION_REPLAY_MASK_PROPS} className="agentkit-work-objects">
        {shown.map((object, index) =>
          object.kind === "query" ? (
            <q key={index} className="agentkit-work-object" data-kind="query">
              {object.text}
            </q>
          ) : (
            <span
              key={index}
              className="agentkit-work-object"
              data-kind={object.kind}
            >
              {object.text}
            </span>
          ),
        )}
      </span>
      {more > 0 ? (
        <span className="agentkit-work-objects-more">
          {labels.workStepMoreObjects.replace("{{count}}", () =>
            more.toLocaleString(),
          )}
        </span>
      ) : null}
    </>
  );
}

function AgentWorkGroupRow({
  group,
  threadId,
  renderCall,
}: {
  group: AgentWorkGroup;
  threadId: string;
  renderCall: (call: AgentWorkCall) => ReactNode;
}) {
  const { slots, registry, labels } = useAgentKit();
  const thread = useAgentThreadSlice(sameAgents);
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const [first] = group.calls;
  const activity = first.activity;
  const count = group.calls.length;
  const agent = activity.agentId ? thread.agents[activity.agentId] : undefined;
  const AgentRenderer = agent
    ? (registry.agents?.[agent.kind ?? ""] ??
      slots.agent ??
      AgentParticipantView)
    : undefined;
  const ObjectRenderer = slots.object ?? AgentObjectReferenceView;
  const source = first.tool ? registry.toolSource?.(first.tool) : undefined;
  const label = group.failed
    ? labels.workStepFailedCount.replace("{{count}}", () =>
        count.toLocaleString(),
      )
    : group.verb === "used"
      ? first.tool
        ? labels.workStepUsedTool.replace("{{tool}}", () =>
            inlineToolName(activityLabel(activity, labels.working)),
          )
        : activityLabel(activity, labels.working)
      : workGroupLabel(group.verb, count, labels);
  const reference =
    group.verb === "used" && !group.objects.length
      ? (activity.object ??
        sourceObjectUnlessRepresented(activity.source, thread, [
          activity.agentId,
        ]))
      : undefined;
  const reason = group.reason ? readableText(group.reason) : "";
  return (
    <div
      className="agentkit-work-group"
      data-verb={group.verb}
      data-failed={group.failed ? "true" : undefined}
      data-running={group.running ? "true" : undefined}
      data-open={open ? "true" : "false"}
    >
      <AgentKitDisclosureSummary
        rowClassName="agentkit-activity-row agentkit-work-group-row"
        open={open}
        onToggle={() => setOpen((current) => !current)}
        controls={contentId}
        status={group.failed ? "error" : group.running ? "running" : undefined}
        icon={
          group.failed ? (
            <IconAlertTriangle aria-hidden="true" className="agentkit-icon" />
          ) : (
            (source?.icon ??
            workVerbIcon(group.verb) ??
            activityIcon(activity.kind))
          )
        }
        label={
          <>
            {agent && AgentRenderer ? (
              <AgentRenderer value={agent} threadId={threadId} />
            ) : activity.agentId ? (
              <AgentIdentityChip
                id={activity.agentId}
                name={resolveAgentName(
                  thread,
                  activity.agentId,
                  [activity.source, activity.object],
                  labels.assistant,
                )}
                fallbackName={labels.assistant}
              />
            ) : null}
            <span className="agentkit-activity-label agentkit-work-group-label">
              {label}
            </span>
            {group.verb === "used" && !group.failed && count > 1 ? (
              <span className="agentkit-activity-cluster-count">×{count}</span>
            ) : null}
          </>
        }
        meta={
          reason || group.objects.length || reference ? (
            <span className="agentkit-work-group-meta">
              {reason ? (
                // Replays mask text but record attributes, so it gets no title.
                <span
                  {...SESSION_REPLAY_MASK_PROPS}
                  className="agentkit-work-failure-reason"
                >
                  {reason}
                </span>
              ) : null}
              <AgentWorkObjects objects={group.objects} />
              {reference ? (
                <ObjectRenderer value={reference} threadId={threadId} />
              ) : null}
            </span>
          ) : null
        }
      />
      <AgentKitDisclosureContent
        id={contentId}
        open={open}
        onReveal={() => setOpen(true)}
      >
        <div className="agentkit-activity-cluster-items">
          {group.calls.map(renderCall)}
        </div>
      </AgentKitDisclosureContent>
    </div>
  );
}

/** Step bodies render reasoning inline; hosts read this to drop their own disclosure. */
const AgentKitWorkStepBodyContext = createContext(false);

/** True inside a work step's expanded reasoning, where the step is the disclosure. */
export function useAgentKitInWorkStep(): boolean {
  return useContext(AgentKitWorkStepBodyContext);
}

/** Moves focus to the first row a Show more click revealed, since the button unmounts. */
function useRevealFocus(
  listRef: RefObject<HTMLElement | null>,
  revealed: boolean,
  firstRevealedIndex: number,
) {
  const pendingRef = useRef(false);
  useEffect(() => {
    if (!revealed || !pendingRef.current) return;
    pendingRef.current = false;
    const row = listRef.current?.children[firstRevealedIndex];
    if (!(row instanceof HTMLElement)) return;
    const target = row.querySelector<HTMLElement>(
      "button:not([tabindex='-1']), a[href], [tabindex]:not([tabindex='-1'])",
    );
    if (target) {
      target.focus();
      return;
    }
    row.tabIndex = -1;
    row.focus();
  }, [firstRevealedIndex, listRef, revealed]);
  return () => {
    pendingRef.current = true;
  };
}

function AgentWorkStepItem({
  step,
  plain,
  threadId,
  renderCall,
}: {
  step: AgentWorkStep;
  plain: boolean;
  threadId: string;
  renderCall: (call: AgentWorkCall) => ReactNode;
}) {
  const { registry, slots, labels } = useAgentKit();
  const [open, setOpen] = useState(false);
  const [allGroups, setAllGroups] = useState(false);
  const bodyId = useId();
  const groupsRef = useRef<HTMLUListElement>(null);
  const requestGroupFocus = useRevealFocus(
    groupsRef,
    allGroups,
    step.groups.findIndex(
      (group, index) => index >= WORK_GROUP_PREVIEW_COUNT && !group.failed,
    ),
  );
  const ReasoningRenderer = registry.messageParts?.reasoning ?? slots.reasoning;
  const title =
    step.title ??
    (plain ? undefined : workStepVerbTitle(step.dominantVerb, labels));
  const hasBody = Boolean(
    step.body || (ReasoningRenderer && step.reasoning?.trim()),
  );
  // Failures stay in view past the preview, so the summary's failed count
  // can always be found.
  const groups = allGroups
    ? step.groups
    : step.groups.filter(
        (group, index) => index < WORK_GROUP_PREVIEW_COUNT || group.failed,
      );
  const hiddenGroups = step.groups.length - groups.length;
  return (
    <li
      className="agentkit-work-step"
      data-running={step.running ? "true" : undefined}
      data-untitled={step.title ? undefined : "true"}
      data-open={open ? "true" : "false"}
    >
      {plain ? null : (
        <span className="agentkit-work-step-marker" aria-hidden="true">
          <IconPointFilled className="agentkit-icon" />
        </span>
      )}
      <div className="agentkit-work-step-content">
        {title ? (
          <AgentKitDisclosureSummary
            className="agentkit-work-step-title"
            open={open}
            onToggle={() => setOpen((current) => !current)}
            status={step.active ? "running" : undefined}
            expandable={hasBody}
            as={hasBody ? "button" : "static"}
            controls={hasBody ? bodyId : undefined}
            label={
              <span
                className="agentkit-work-step-label"
                data-active={step.active ? "true" : undefined}
              >
                {title}
              </span>
            }
          />
        ) : null}
        {hasBody ? (
          <AgentKitDisclosureContent
            id={bodyId}
            open={open}
            onReveal={() => setOpen(true)}
          >
            <div className="agentkit-reasoning-content agentkit-work-step-body">
              {ReasoningRenderer ? (
                <AgentKitWorkStepBodyContext.Provider value={true}>
                  <ReasoningRenderer
                    value={{ type: "reasoning", text: step.reasoning ?? "" }}
                    threadId={threadId}
                    active={step.active}
                    resetKey={`${threadId}:${step.key}`}
                  />
                </AgentKitWorkStepBodyContext.Provider>
              ) : (
                <AgentMarkdown text={step.body} streaming={step.active} />
              )}
            </div>
          </AgentKitDisclosureContent>
        ) : null}
        {step.groups.length ? (
          <ul ref={groupsRef} className="agentkit-work-groups" role="list">
            {groups.map((group) => (
              <li key={group.key}>
                {group.standalone ||
                (group.verb === "used" &&
                  !group.failed &&
                  group.calls.length === 1) ? (
                  group.calls.map(renderCall)
                ) : (
                  <AgentWorkGroupRow
                    group={group}
                    threadId={threadId}
                    renderCall={renderCall}
                  />
                )}
              </li>
            ))}
            {hiddenGroups ? (
              <li>
                <button
                  type="button"
                  className="agentkit-disclosure-summary agentkit-work-more"
                  onClick={() => {
                    requestGroupFocus();
                    setAllGroups(true);
                  }}
                >
                  <span
                    className="agentkit-disclosure-icon-slot"
                    aria-hidden="true"
                  />
                  <span className="agentkit-disclosure-label">
                    {labels.workStepMoreGroups.replace("{{count}}", () =>
                      hiddenGroups.toLocaleString(),
                    )}
                  </span>
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The expanded work: one step per reasoning heading, each with the calls that
 * followed it. Long runs show the first steps and keep a running step in view.
 */
function AgentWorkStepList({
  steps,
  threadId,
  running,
  renderCall,
}: {
  steps: AgentWorkStep[];
  threadId: string;
  running: boolean;
  renderCall: (call: AgentWorkCall) => ReactNode;
}) {
  const { labels } = useAgentKit();
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const plain = steps.length === 1 && steps.every((step) => !step.title);
  // Past the preview, the running step and any step with a failure stay in
  // view after the Show more row.
  const kept = (step: AgentWorkStep, index: number) =>
    step.failedCount > 0 || (running && index === steps.length - 1);
  const requestFocus = useRevealFocus(
    listRef,
    expanded,
    steps.findIndex(
      (step, index) => index >= WORK_STEP_PREVIEW_COUNT && !kept(step, index),
    ),
  );
  const head = expanded ? steps : steps.slice(0, WORK_STEP_PREVIEW_COUNT);
  const tail = expanded
    ? []
    : steps
        .slice(WORK_STEP_PREVIEW_COUNT)
        .filter((step, index) => kept(step, index + WORK_STEP_PREVIEW_COUNT));
  const hiddenCount = steps.length - head.length - tail.length;
  const renderStep = (step: AgentWorkStep) => (
    <AgentWorkStepItem
      key={step.key}
      step={step}
      plain={plain}
      threadId={threadId}
      renderCall={renderCall}
    />
  );
  return (
    <ol
      ref={listRef}
      className="agentkit-work-steps"
      aria-label={labels.activities}
      role="list"
      data-plain={plain ? "true" : undefined}
    >
      {head.map(renderStep)}
      {hiddenCount ? (
        <li className="agentkit-work-steps-more">
          <button
            type="button"
            className="agentkit-disclosure-summary agentkit-work-more"
            onClick={() => {
              requestFocus();
              setExpanded(true);
            }}
          >
            <span
              className="agentkit-disclosure-icon-slot"
              aria-hidden="true"
            />
            <span className="agentkit-disclosure-label">
              {countLabel(
                labels.showMoreWorkStepsOne,
                labels.showMoreWorkStepsOther,
                hiddenCount,
              )}
            </span>
          </button>
        </li>
      ) : null}
      {tail.map(renderStep)}
    </ol>
  );
}

function AgentWorkDisclosure({
  label,
  failedCount = 0,
  icon,
  running,
  expandable = true,
  current,
  currentLabel,
  runId,
  messageId,
  children,
}: {
  label: string;
  failedCount?: number;
  icon?: ReactNode;
  running?: boolean;
  expandable?: boolean;
  /** Self-contained current activity, icon included, for the summary slot. */
  current?: ReactNode;
  currentLabel?: ReactNode;
  /** The run whose details lead the expanded content. */
  runId?: RunId;
  /** The reply this work precedes. */
  messageId?: string;
  children: ReactNode;
}) {
  const { slots, labels, workedForRowLayout } = useAgentKit();
  const row = useContext(AgentWorkRowOpenContext);
  const [open, setOpen] = useState(() => row?.opened.has(row.key) ?? false);
  useEffect(() => {
    if (!row) return;
    if (open) row.opened.add(row.key);
    else row.opened.delete(row.key);
  }, [open, row]);
  const contentId = useId();
  const Summary = slots.workedForSummary;
  const failed =
    label && failedCount > 0
      ? labels.workSummaryFailedCount.replace("{{count}}", () =>
          failedCount.toLocaleString(),
        )
      : "";
  // The failed count reads in amber, so the localized template splits
  // around the summary it wraps.
  const [failedBefore, failedAfter] = failed.includes("{{summary}}")
    ? failed.split("{{summary}}")
    : ["", ""];
  const fullLabel = failed ? failed.replace("{{summary}}", () => label) : label;
  const footerHost = useAgentMessageWorkHost(messageId);
  const summaryLabel = label ? (
    <span className="agentkit-activities-label">
      {failedBefore || failedAfter ? (
        <>
          {failedBefore}
          {label}
          <span className="agentkit-activities-failed">{failedAfter}</span>
        </>
      ) : (
        fullLabel
      )}
    </span>
  ) : (
    currentLabel
  );
  const summaryContent = Summary ? (
    <Summary
      label={fullLabel}
      {...(running === undefined ? {} : { running })}
      expandable={expandable}
      open={open}
      current={current}
      {...(workedForRowLayout === undefined
        ? {}
        : { layout: workedForRowLayout })}
    />
  ) : undefined;
  // The row stays one mounted trigger from "Thinking" through the first
  // activity, so it never flickers; until then it is not a tab stop. Finished
  // work with nothing to expand is text, not a disabled button.
  const disclosure = (
    <div
      className="agentkit-activities"
      data-running={running ? "true" : undefined}
      data-expandable={expandable ? "true" : "false"}
      data-open={open ? "true" : "false"}
    >
      <AgentKitDisclosureSummary
        as={expandable || running ? "button" : "static"}
        className="agentkit-activities-summary"
        rowClassName="agentkit-activities-row"
        open={open}
        onToggle={() => setOpen((value) => !value)}
        status={running ? "running" : undefined}
        expandable={expandable}
        controls={contentId}
        style={workedForRowSummaryStyle(workedForRowLayout)}
        chevronStyle={workedForRowChevronStyle(workedForRowLayout)}
        icon={icon}
        label={summaryLabel}
      >
        {summaryContent}
      </AgentKitDisclosureSummary>
      <AgentKitDisclosureContent
        id={contentId}
        open={open}
        onReveal={expandable ? () => setOpen(true) : undefined}
      >
        {runId && expandable && !running ? (
          <AgentRunDetails runId={runId} messageId={messageId} open={open} />
        ) : null}
        {children}
      </AgentKitDisclosureContent>
    </div>
  );
  // A reply's work sits on its footer line, live or finished, so the finish
  // never moves it.
  return footerHost ? createPortal(disclosure, footerHost) : disclosure;
}

function AgentReasoningPartDisclosure({
  label,
  text,
  active,
  resetKey,
}: {
  label: string;
  text: string;
  active: boolean;
  resetKey: string;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <div
      className="agentkit-reasoning"
      data-active={active ? "true" : undefined}
      data-open={open ? "true" : "false"}
    >
      <AgentKitDisclosureSummary
        className="agentkit-reasoning-summary"
        open={open}
        onToggle={() => setOpen((value) => !value)}
        controls={contentId}
        status={active ? "running" : undefined}
        icon={activityIcon("reasoning")}
        label={<span className="agentkit-reasoning-label">{label}</span>}
      />
      <AgentKitDisclosureContent
        id={contentId}
        open={open}
        onReveal={() => setOpen(true)}
      >
        <div className="agentkit-reasoning-content">
          <AgentStreamingText text={text} active={active} resetKey={resetKey}>
            {(visibleText) => (
              <AgentMarkdown
                text={visibleText}
                streaming={active || visibleText !== text}
              />
            )}
          </AgentStreamingText>
        </div>
      </AgentKitDisclosureContent>
    </div>
  );
}

/** A reply's own reasoning as work steps, as a turn with tool calls lists it. */
function AgentReasoningSteps({
  message,
  threadId,
  active,
}: {
  message: AgentMessage;
  threadId: string;
  active: boolean;
}) {
  const steps = useMemo(
    () =>
      agentWorkSteps(
        message.parts.flatMap((part, index): AgentWorkItem[] =>
          part.type === "reasoning" && isVisibleReasoningPart(part)
            ? [
                {
                  type: "reasoning",
                  key: `reasoning:${message.id}:part:${index}`,
                  text: part.text,
                  active,
                  ...(part.label ? { label: part.label } : {}),
                },
              ]
            : [],
        ),
      ),
    [active, message],
  );
  return (
    <AgentWorkStepList
      steps={steps}
      threadId={threadId}
      running={active}
      renderCall={() => null}
    />
  );
}

/** `sequence` is the entry's latest event. */
type AgentCollaborationEntry =
  | { type: "interaction"; value: AgentInteraction; sequence: number }
  | { type: "activity"; value: AgentActivity; sequence: number };

type AgentCollaborationItem =
  | { type: "entry"; key: string; entry: AgentCollaborationEntry }
  | {
      type: "subagent";
      key: string;
      agentId: string;
      entries: AgentCollaborationEntry[];
    };

function collaborationSubjectId(
  entry: AgentCollaborationEntry,
  thread: AgentThreadState,
): string | undefined {
  const isPrimary = (id: string | undefined) =>
    id !== undefined && thread.agents[id]?.kind === "primary";
  if (entry.type === "activity") {
    const id = entry.value.agentId;
    return id && !isPrimary(id) ? id : undefined;
  }
  const { agentId, targetAgentId } = entry.value;
  if (isPrimary(agentId)) {
    return targetAgentId && !isPrimary(targetAgentId)
      ? targetAgentId
      : undefined;
  }
  return agentId;
}

/** Each delegated agent's entries fold into one item where it first appears. */
function agentCollaborationItems(
  thread: AgentThreadState,
  runEvents: readonly AgentEvent[],
  labels: Partial<AgentKitLabels>,
  range: {
    afterSequence?: number | undefined;
    throughSequence?: number | undefined;
  },
): AgentCollaborationItem[] {
  const entries = new Map<string, AgentCollaborationEntry>();
  const firstSequence = new Map<string, number>();
  const order: string[] = [];
  const delegatedAgentIds = new Map<string, string>();
  // A delegated agent's own tool calls leave the parent's work for its step.
  const delegatedToolAgentIds = new Map<string, string>();
  for (const event of runEvents) {
    if (
      event.type === "activity.started" ||
      event.type === "activity.updated" ||
      event.type === "activity.completed"
    ) {
      const activity = thread.activities[event.activity.id] ?? event.activity;
      const agentId = event.activity.agentId ?? activity.agentId;
      if (agentId) delegatedAgentIds.set(event.activity.id, agentId);
    }
    if (event.type === "tool.started" || event.type === "tool.updated") {
      const agentId =
        event.toolCall.agentId ?? thread.tools[event.toolCall.id]?.agentId;
      if (agentId) delegatedToolAgentIds.set(event.toolCall.id, agentId);
    }
  }
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
    entries.set(key, { ...entry, sequence });
  };
  for (const event of runEvents) {
    if (event.type === "agent.interaction") {
      remember(`interaction:${event.interaction.id}`, event.sequence, {
        type: "interaction",
        value: event.interaction,
      });
    }
    if (
      event.type === "activity.started" ||
      event.type === "activity.updated" ||
      event.type === "activity.completed"
    ) {
      const agentId = delegatedAgentIds.get(event.activity.id);
      if (!agentId) continue;
      const activity = thread.activities[event.activity.id] ?? event.activity;
      remember(`activity:${event.activity.id}`, event.sequence, {
        type: "activity",
        value: { ...activity, agentId },
      });
    }
    const toolId =
      event.type === "tool.started" || event.type === "tool.updated"
        ? event.toolCall.id
        : event.type === "tool.delta"
          ? event.toolCallId
          : undefined;
    const toolAgentId = toolId ? delegatedToolAgentIds.get(toolId) : undefined;
    if (toolId && toolAgentId) {
      const tool =
        toolId in thread.tools
          ? thread.tools[toolId]
          : event.type === "tool.started" || event.type === "tool.updated"
            ? event.toolCall
            : undefined;
      if (tool) {
        remember(`tool:${toolId}`, event.sequence, {
          type: "activity",
          value: { ...toolToActivity(tool, labels), agentId: toolAgentId },
        });
      }
    }
  }
  const items: AgentCollaborationItem[] = [];
  const subagents = new Map<string, AgentCollaborationEntry[]>();
  for (const key of order) {
    const sequence = firstSequence.get(key);
    const entry = entries.get(key);
    if (!entry || sequence === undefined || !sequenceInRange(sequence, range)) {
      continue;
    }
    const agentId = collaborationSubjectId(entry, thread);
    if (!agentId) {
      items.push({ type: "entry", key, entry });
      continue;
    }
    const grouped = subagents.get(agentId);
    if (grouped) {
      grouped.push(entry);
      continue;
    }
    const created = [entry];
    subagents.set(agentId, created);
    items.push({
      type: "subagent",
      key: `subagent:${agentId}`,
      agentId,
      entries: created,
    });
  }
  return items;
}

/** The one task a Subagent step shows: the agent's active task, else its first. */
function subagentStepTask(
  thread: AgentThreadState,
  agentId: string,
): AgentTask | undefined {
  const agent = agentId in thread.agents ? thread.agents[agentId] : undefined;
  return Object.values(thread.tasks).find(
    (candidate) =>
      candidate.assignedAgentId === agentId &&
      (agent?.activeTaskId === undefined ||
        candidate.id === agent.activeTaskId),
  );
}

/** Tasks the Subagent steps in this range of a run show. */
function subagentStepTaskIds(
  thread: AgentThreadState,
  runId: RunId | undefined,
  labels: Partial<AgentKitLabels>,
  range: {
    afterSequence?: number | undefined;
    throughSequence?: number | undefined;
  },
): Set<string> {
  const ids = new Set<string>();
  for (const item of agentCollaborationItems(
    thread,
    agentRunEvents(thread, runId),
    labels,
    range,
  )) {
    if (item.type !== "subagent") continue;
    const task = subagentStepTask(thread, item.agentId);
    if (task) ids.add(task.id);
  }
  return ids;
}

/** Set inside a Subagent step, so its rows do not repeat the agent's chip. */
const AgentSubagentStepContext = createContext<string | undefined>(undefined);

const SUBAGENT_LIFECYCLE_KINDS = new Set([
  "started",
  "resumed",
  "delegated",
  "paused",
  "completed",
  "failed",
  "closed",
]);

type SubagentState = "running" | "paused" | "completed" | "failed" | "closed";

function subagentState(
  agent: AgentParticipant | undefined,
  entries: readonly AgentCollaborationEntry[],
): SubagentState {
  switch (agent?.status) {
    case "waiting":
    case "paused":
      return "paused";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "closed":
      return "closed";
    case "idle":
    case "working":
    case undefined:
      break;
  }
  // Status can stay "working" past its last event; a finished call is not a finished agent.
  const newestFirst = [...entries].sort((a, b) => b.sequence - a.sequence);
  for (const entry of newestFirst) {
    if (entry.type === "activity") {
      if (entry.value.status === "running") return "running";
      continue;
    }
    switch (entry.value.kind) {
      case "completed":
        return "completed";
      case "failed":
        return "failed";
      case "paused":
        return "paused";
      case "closed":
        return "closed";
      case "started":
      case "resumed":
      case "delegated":
        return "running";
      case "messaged":
      default:
        break;
    }
  }
  if (agent?.status === "working") return "running";
  const latest = newestFirst.at(0);
  return latest?.type === "activity" && latest.value.status === "failed"
    ? "failed"
    : latest?.type === "activity" && latest.value.status === "completed"
      ? "completed"
      : "running";
}

function metadataDurationMs(
  metadata: Record<string, unknown> | undefined,
): number | undefined {
  const value = metadata?.durationMs;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function subagentDurationMs(
  agent: AgentParticipant | undefined,
  entries: readonly AgentCollaborationEntry[],
): number | undefined {
  const fromAgent = metadataDurationMs(agent?.metadata);
  if (fromAgent !== undefined) return fromAgent;
  for (const entry of [...entries].sort((a, b) => b.sequence - a.sequence)) {
    const fromEntry = metadataDurationMs(entry.value.metadata);
    if (fromEntry !== undefined) return fromEntry;
  }
  const started = agent?.startedAt ? Date.parse(agent.startedAt) : Number.NaN;
  const completed = agent?.completedAt
    ? Date.parse(agent.completedAt)
    : Number.NaN;
  return Number.isFinite(started) &&
    Number.isFinite(completed) &&
    completed >= started
    ? completed - started
    : undefined;
}

/** One row per delegated agent, with its own calls and its result inside. */
export function AgentSubagentStep({
  agentId,
  entries,
  runId,
  threadId,
}: {
  agentId: string;
  entries: readonly AgentCollaborationEntry[];
  runId: RunId | undefined;
  threadId: string;
}) {
  const {
    slots,
    registry,
    labels,
    formatWorkedForDuration,
    formatAgentInteractionDetail,
  } = useAgentKit();
  const thread = useAgentThreadSlice(
    (previous, next) =>
      sameAgentsAndTasks(previous, next) &&
      previous.tools === next.tools &&
      previous.runs === next.runs,
  );
  const [open, setOpen] = useState(false);
  const agent = agentId in thread.agents ? thread.agents[agentId] : undefined;
  const AgentRenderer = agent
    ? (registry.agents?.[agent.kind ?? ""] ??
      slots.agent ??
      AgentParticipantView)
    : undefined;
  const name = resolveAgentName(
    thread,
    agentId,
    entries.map((entry) => entry.value.source),
    labels.assistant,
  );
  const runStatus =
    runId === undefined ? undefined : thread.runs[runId]?.status;
  const liveState = subagentState(agent, entries);
  // Agents can outlive their run, so one still "working" after it settled has stopped.
  const settledStatus =
    liveState !== "running"
      ? undefined
      : runStatus === "completed"
        ? "completed"
        : runStatus === "failed"
          ? "failed"
          : runStatus === "cancelled"
            ? "closed"
            : undefined;
  const state: SubagentState = settledStatus ?? liveState;
  const durationMs =
    state === "running" ? undefined : subagentDurationMs(agent, entries);
  const duration =
    durationMs === undefined
      ? undefined
      : (formatWorkedForDuration?.(durationMs) ??
        formatAgentKitDuration(durationMs, {
          hour: labels.durationHourShort,
          minute: labels.durationMinuteShort,
          second: labels.durationSecondShort,
        }));
  const task = subagentStepTask(thread, agentId);
  const taskTitle = task ? humanizeAgentLabel(task.title) : "";
  const shownTaskTitle =
    taskTitle && taskTitle.toLocaleLowerCase() !== name.toLocaleLowerCase()
      ? taskTitle
      : "";
  const newestFirst = [...entries].sort((a, b) => b.sequence - a.sequence);
  const latest = <T,>(
    pick: (entry: AgentCollaborationEntry) => T | undefined,
  ) => {
    for (const entry of newestFirst) {
      const value = pick(entry);
      if (value !== undefined) return value;
    }
    return undefined;
  };
  // A call's detail is its output, which is no headline.
  const progress =
    state === "running"
      ? latest((entry) =>
          entry.type === "activity" &&
          entry.value.status === "running" &&
          !(entry.value.id in thread.tools) &&
          readableText(entry.value.detail)
            ? entry.value
            : undefined,
        )
      : undefined;
  const progressDetail = progress ? readableText(progress.detail) : "";
  const failureDetail =
    state === "failed"
      ? latest((entry) =>
          entry.type === "interaction" && entry.value.kind === "failed"
            ? readableText(
                formatAgentInteractionDetail?.(entry.value) ??
                  entry.value.detail,
              ) || undefined
            : entry.type === "activity" && entry.value.status === "failed"
              ? readableText(entry.value.detail) || undefined
              : undefined,
        )
      : undefined;
  const status =
    state === "running"
      ? labels.agentWorking
      : state === "failed"
        ? labels.agentFailed
        : state === "paused"
          ? labels.agentPaused
          : state === "closed"
            ? labels.agentClosed
            : duration
              ? labels.agentWorkedFor.replace("{{duration}}", () => duration)
              : labels.agentCompleted;
  const content = entries.flatMap((entry): ReactNode[] => {
    const key = `${entry.type}:${entry.value.id}`;
    if (entry.type === "interaction") {
      const interaction = entry.value;
      const Custom =
        registry.agentInteractions?.[interaction.kind] ??
        slots.agentInteraction;
      if (Custom) {
        return [<Custom key={key} value={interaction} threadId={threadId} />];
      }
      // The row's own status, duration and error line already say these.
      if (
        SUBAGENT_LIFECYCLE_KINDS.has(interaction.kind) &&
        (interaction.kind === "failed" ||
          !(
            interaction.label ||
            interaction.detail ||
            interaction.object ||
            interaction.targetAgentId
          ))
      ) {
        return [];
      }
      return [
        <AgentInteractionItem
          key={key}
          value={interaction}
          threadId={threadId}
        />,
      ];
    }
    const activity = entry.value;
    const Custom = registry.activities?.[activity.kind] ?? slots.activity;
    if (Custom) {
      return [<Custom key={key} value={activity} threadId={threadId} />];
    }
    if (activity.id in thread.tools) {
      return [
        <AgentActivityItem key={key} value={activity} threadId={threadId} />,
      ];
    }
    // The agent's report is the step's result, so it shows in place.
    const summary = (activity.summary ?? []).flatMap((part, partIndex) => {
      const safePart =
        part.type === "text"
          ? {
              ...part,
              text: part.text.trim()
                ? formatActivityText(part.text, labels)
                : "",
            }
          : part;
      return safePart.type === "text" && !safePart.text
        ? []
        : [
            <AgentMessagePartView
              key={`${key}:summary:${partIndex}`}
              value={safePart}
              threadId={threadId}
            />,
          ];
    });
    if (summary.length) return summary;
    // A summary-less "agent" activity is the status line the header carries.
    if (activity === progress || activity.kind === "agent") return [];
    return [
      <AgentActivityItem key={key} value={activity} threadId={threadId} />,
    ];
  });
  const failed = state === "failed";
  const line = (
    <TraceLine
      status={state === "running" ? "running" : failed ? "error" : undefined}
    >
      <TraceIcon>
        {/* A failed agent's chip already carries the triangle. */}
        <IconArrowFork aria-hidden="true" className="agentkit-icon" />
      </TraceIcon>
      <span className="agentkit-disclosure-label">
        {agent && AgentRenderer ? (
          <AgentRenderer
            value={settledStatus ? { ...agent, status: settledStatus } : agent}
            threadId={threadId}
          />
        ) : (
          <AgentIdentityChip
            id={agentId}
            name={name}
            fallbackName={labels.assistant}
            {...(failed
              ? { status: "failed" as const }
              : state === "running"
                ? { status: "working" as const }
                : {})}
          />
        )}
        <TraceTitle className="agentkit-activity-label">{status}</TraceTitle>
      </span>
    </TraceLine>
  );
  const detail = shownTaskTitle || progressDetail;
  const ObjectRenderer = slots.object ?? AgentObjectReferenceView;
  const taskObject = task
    ? (task.object ??
      sourceObjectUnlessRepresented(task.source, thread, [agentId]))
    : undefined;
  const meta =
    detail || taskObject ? (
      <>
        {taskObject ? (
          <ObjectRenderer value={taskObject} threadId={threadId} />
        ) : null}
        {detail ? (
          <TraceDescription
            {...SESSION_REPLAY_MASK_PROPS}
            className="agentkit-activity-detail"
          >
            {detail}
          </TraceDescription>
        ) : null}
      </>
    ) : null;
  const errorLine = failureDetail ? (
    <span {...SESSION_REPLAY_MASK_PROPS} className="agentkit-activity-error">
      {failureDetail}
    </span>
  ) : null;
  const rootProps = {
    className: "agentkit-subagent-step",
    "data-agent-id": agentId,
    // Not data-state: the collapsible keeps its open state there.
    "data-status": state,
  };
  if (!content.length) {
    return (
      <div {...rootProps}>
        <div className="agentkit-disclosure-row agentkit-activity-row">
          <span className="agentkit-disclosure-summary" data-expandable="false">
            {line}
          </span>
          {meta}
        </div>
        {errorLine}
      </div>
    );
  }
  return (
    <TraceCollapsible {...rootProps} open={open} onOpenChange={setOpen}>
      <div
        className="agentkit-disclosure-row agentkit-activity-row"
        data-expandable="true"
        onClick={(event) => {
          const target = event.target;
          if (
            target instanceof Element &&
            target.closest(DISCLOSURE_ROW_INTERACTIVE)
          )
            return;
          if (globalThis.getSelection()?.toString()) return;
          setOpen((current) => !current);
        }}
      >
        <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
        {meta}
      </div>
      {errorLine}
      <TraceCollapsibleContent
        key={open ? "open" : "closed"}
        keepMounted
        {...(failed || !open ? SESSION_REPLAY_BLOCK_PROPS : {})}
        className="agentkit-subagent-content"
      >
        <AgentSubagentStepContext.Provider value={agentId}>
          {content}
        </AgentSubagentStepContext.Provider>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

export function AgentCollaborationFeed({
  runId,
  afterSequence,
  throughSequence,
}: AgentEventRange) {
  const { threadId, slots, registry, labels } = useAgentKit();
  const thread = useAgentThreadSlice((previous, next) =>
    sameRunWork(previous, next, runId),
  );
  const items = agentCollaborationItems(
    thread,
    agentRunEvents(thread, runId),
    labels,
    { afterSequence, throughSequence },
  );
  if (items.length === 0) return null;
  return (
    <section
      className="agentkit-agent-feed"
      aria-label={labels.agents}
      data-agent-collaboration-feed="true"
    >
      {items.map((item) => {
        if (item.type === "subagent") {
          return (
            <AgentSubagentStep
              key={item.key}
              agentId={item.agentId}
              entries={item.entries}
              runId={runId}
              threadId={threadId}
            />
          );
        }
        const { entry, key } = item;
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

function taskStatusPresentation(
  status: AgentTask["status"],
  labels: ReturnType<typeof useAgentKit>["labels"],
): { icon: ReactNode; label: string } {
  const props = {
    "aria-hidden": true,
    className: "agentkit-icon agentkit-task-status-icon",
  } as const;
  switch (status) {
    case "running":
      return {
        icon: <IconLoader2 {...props} />,
        label: labels.taskStatusRunning,
      };
    case "completed":
      return {
        icon: <IconCircleCheck {...props} />,
        label: labels.taskStatusCompleted,
      };
    case "failed":
      return {
        icon: <IconAlertTriangle {...props} />,
        label: labels.taskStatusFailed,
      };
    case "awaiting_input":
      return {
        icon: <IconMessageQuestion {...props} />,
        label: labels.taskStatusAwaitingInput,
      };
    case "cancelled":
      return { icon: <IconX {...props} />, label: labels.runStopped };
    case "pending":
    default:
      return {
        icon: <IconCircle {...props} />,
        label: labels.taskStatusPending,
      };
  }
}

export function AgentTaskItem({
  value: task,
  threadId,
}: AgentKitRenderProps<AgentTask>) {
  const { slots, registry, labels } = useAgentKit();
  const thread = useAgentThreadSlice(sameAgents);
  const ObjectRenderer = slots.object ?? AgentObjectReferenceView;
  const agent = task.assignedAgentId
    ? thread.agents[task.assignedAgentId]
    : undefined;
  const agentName = resolveAgentName(
    thread,
    task.assignedAgentId,
    [task.source, task.object],
    labels.assistant,
  );
  const AgentRenderer = agent
    ? (registry.agents?.[agent.kind ?? ""] ??
      slots.agent ??
      AgentParticipantView)
    : undefined;
  const taskProgress = task.progress;
  const progress = taskProgress
    ? labels.tasksProgress
        .replace("{{completed}}", () => String(taskProgress.completed))
        .replace("{{total}}", () => String(taskProgress.total))
    : undefined;
  const title =
    humanizeAgentLabel(task.title) ||
    (task.assignedAgentId ? agentName : labels.untitledTask);
  const detail = readableText(task.detail);
  const object =
    task.object ??
    sourceObjectUnlessRepresented(task.source, thread, [task.assignedAgentId]);
  const showAgent =
    task.assignedAgentId &&
    title.toLocaleLowerCase() !== agentName.toLocaleLowerCase();
  const status = taskStatusPresentation(task.status, labels);
  return (
    <TraceLine
      className="agentkit-task-row"
      data-status={task.status}
      status={
        task.status === "running"
          ? "running"
          : task.status === "failed"
            ? "error"
            : undefined
      }
    >
      <TraceIcon>{status.icon}</TraceIcon>
      <span className="agentkit-visually-hidden">{status.label}</span>
      {showAgent && agent && AgentRenderer ? (
        <AgentRenderer value={agent} threadId={threadId} />
      ) : showAgent && task.assignedAgentId ? (
        <AgentIdentityChip
          id={task.assignedAgentId}
          name={agentName}
          fallbackName={labels.assistant}
        />
      ) : null}
      <TraceTitle className="agentkit-task-title">{title}</TraceTitle>
      {object ? <ObjectRenderer value={object} threadId={threadId} /> : null}
      {detail ? (
        <span className="agentkit-task-detail" title={detail}>
          {detail}
        </span>
      ) : null}
      {progress ? (
        <TraceDescription className="agentkit-task-progress">
          {progress}
        </TraceDescription>
      ) : null}
    </TraceLine>
  );
}

export function AgentTaskGroup({
  runId,
  afterSequence,
  throughSequence,
}: AgentEventRange) {
  const { threadId, slots, registry, labels } = useAgentKit();
  const thread = useAgentThreadSlice((previous, next) =>
    sameRunWork(previous, next, runId),
  );
  const [open, setOpen] = useState(false);
  const listId = useId();
  const ids: string[] = [];
  const tasks = new Map<string, AgentTask>();
  const firstSequence = new Map<string, number>();
  for (const event of agentRunEvents(thread, runId)) {
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
    tasks.set(event.task.id, thread.tasks[event.task.id] ?? event.task);
  }
  // Only the task a Subagent step shows moves out of this list.
  const stepTaskIds = subagentStepTaskIds(thread, runId, labels, {
    afterSequence,
    throughSequence,
  });
  const selectedIds = ids.filter((id) => {
    const sequence = firstSequence.get(id);
    return (
      sequence !== undefined &&
      sequenceInRange(sequence, { afterSequence, throughSequence }) &&
      !stepTaskIds.has(id)
    );
  });
  if (selectedIds.length === 0) return null;
  const completedCount = selectedIds.filter(
    (id) => tasks.get(id)?.status === "completed",
  ).length;
  return (
    <div className="agentkit-tasks" data-open={open ? "true" : "false"}>
      <AgentKitDisclosureSummary
        className="agentkit-tasks-summary"
        open={open}
        onToggle={() => setOpen((value) => !value)}
        controls={listId}
        icon={<IconChecklist aria-hidden="true" className="agentkit-icon" />}
        label={
          <>
            <span>{labels.tasks}</span>
            <span className="agentkit-tasks-count">
              {labels.tasksProgress
                .replace("{{completed}}", () => String(completedCount))
                .replace("{{total}}", () => String(selectedIds.length))}
            </span>
          </>
        }
      />
      <AgentKitDisclosureContent
        id={listId}
        open={open}
        onReveal={() => setOpen(true)}
      >
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
      </AgentKitDisclosureContent>
    </div>
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
  const [pressedId, setPressedId] = useState<string>();
  const optionsRef = useRef<HTMLDivElement>(null);
  const resolution = useAgentKitMutation(
    (response: Parameters<typeof control.resolveApproval>[2]) =>
      control.resolveApproval(runId, request.id, response),
  );
  const kind = approvalRequestKind(request);
  const choice = kind === "choice";
  const options = request.options ?? [];
  const allowOther = choice
    ? request.allowOther !== false
    : request.allowOther === true;
  const exclusive = !request.allowMultiple;
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
    if (exclusive) setSelected([]);
  };
  const resolve = (
    actionId: string,
    response: Parameters<typeof control.resolveApproval>[2],
  ) => {
    setPressedId(actionId);
    void resolution
      .execute(response)
      .catch(() => undefined)
      .finally(() => requestComposerFocus(threadId));
  };
  const choiceIds = choice
    ? [
        ...options.map((option) => option.id),
        ...(allowOther ? [APPROVAL_OTHER_OPTION_ID] : []),
      ]
    : [];
  const checkedId = otherSelected ? APPROVAL_OTHER_OPTION_ID : selected.at(0);
  const focusableId = checkedId ?? choiceIds.at(0);
  // Arrows only move focus. Choosing stays an explicit press, so arrowing onto
  // Other never mounts its autofocused field and pulls focus out of the group.
  const moveChoice = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!exclusive || choiceIds.length === 0) return;
    const step =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const buttons = Array.from(
      optionsRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-option-id]",
      ) ?? [],
    );
    const focusedId = buttons.find(
      (button) => button === document.activeElement,
    )?.dataset.optionId;
    const current = Math.max(
      0,
      choiceIds.indexOf(focusedId ?? focusableId ?? ""),
    );
    const nextId = choiceIds.at(
      (current + step + choiceIds.length) % choiceIds.length,
    );
    buttons.find((button) => button.dataset.optionId === nextId)?.focus();
  };
  const optionProps = (id: string, active: boolean) =>
    exclusive
      ? {
          role: "radio" as const,
          "aria-checked": active,
          tabIndex: id === focusableId ? 0 : -1,
        }
      : { "aria-pressed": active };
  const inputMissing =
    Boolean(request.input?.required) && input.trim().length === 0;
  const fieldValues = {
    ...(request.input ? { input: { [request.input.id]: input } } : {}),
    ...(allowOther && other.trim() ? { other: other.trim() } : {}),
  };
  const actions: ApprovalCardAction[] = choice
    ? [
        {
          id: "submit",
          label: labels.approvalSubmit,
          intent: "primary",
          disabled:
            (selected.length === 0 && !otherSelected && !request.input) ||
            (otherSelected && other.trim().length === 0) ||
            inputMissing,
          onPress: () =>
            resolve("submit", {
              decision: "approve",
              ...(selected.length ? { optionIds: selected } : {}),
              ...(otherSelected ? { other: other.trim() } : {}),
              ...(request.input
                ? { input: { [request.input.id]: input } }
                : {}),
            }),
        },
      ]
    : approvalPromptActions(request, kind, labels).map((action) => ({
        id: action.id,
        label: action.label,
        intent: action.intent,
        disabled: action.decision === "approve" && inputMissing,
        onPress: () =>
          resolve(action.id, {
            decision: action.decision,
            ...(action.optionIds ? { optionIds: action.optionIds } : {}),
            ...fieldValues,
          }),
      }));
  const fields =
    (choice && choiceIds.length > 0) ||
    (allowOther && (!choice || otherSelected)) ||
    request.input ? (
      <>
        {choice && choiceIds.length > 0 ? (
          <div
            ref={optionsRef}
            className="agentkit-approval-options"
            role={exclusive ? "radiogroup" : "group"}
            aria-label={request.title}
            onKeyDown={moveChoice}
          >
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                {...optionProps(option.id, selected.includes(option.id))}
                data-option-id={option.id}
                data-kind={option.kind}
                disabled={resolution.pending}
                onClick={() => toggle(option.id)}
              >
                <span>{option.label}</span>
                {option.description ? (
                  <small>{option.description}</small>
                ) : null}
              </button>
            ))}
            {allowOther ? (
              <button
                type="button"
                {...optionProps(APPROVAL_OTHER_OPTION_ID, otherSelected)}
                data-option-id={APPROVAL_OTHER_OPTION_ID}
                data-kind="other"
                disabled={resolution.pending}
                onClick={toggleOther}
              >
                <span>{labels.approvalOther}</span>
              </button>
            ) : null}
          </div>
        ) : null}
        {allowOther && (!choice || otherSelected) ? (
          <TextField
            autoFocus={choice}
            className="agentkit-approval-input gap-1"
            label={labels.approvalOther}
            disabled={resolution.pending}
            placeholder={labels.approvalOtherPlaceholder}
            value={other}
            onChange={setOther}
          />
        ) : null}
        {request.input ? (
          <TextField
            className="agentkit-approval-input gap-1"
            {...(request.input.label === undefined
              ? {}
              : { label: request.input.label })}
            type={request.input.type === "url" ? "url" : "text"}
            {...(request.input.type === "number"
              ? { inputMode: "decimal" as const }
              : {})}
            {...(request.input.required === undefined
              ? {}
              : { required: request.input.required })}
            disabled={resolution.pending}
            {...(request.input.placeholder === undefined
              ? {}
              : { placeholder: request.input.placeholder })}
            value={input}
            onChange={setInput}
          />
        ) : null}
      </>
    ) : undefined;
  return (
    <ApprovalCard
      title={request.title}
      detail={request.description}
      status={
        kind === "approval"
          ? labels.approvalPending
          : labels.approvalAnswerPending
      }
      icon={
        kind === "approval" ? undefined : (
          <IconMessageQuestion aria-hidden="true" className="size-4" />
        )
      }
      actions={actions.map((action) => ({
        ...action,
        pending: resolution.pending && pressedId === action.id,
      }))}
      busy={resolution.pending}
      error={resolution.error?.message}
    >
      {fields}
    </ApprovalCard>
  );
}

interface ApprovalPromptAction {
  id: string;
  label: string;
  decision: ApprovalDecision;
  optionIds?: string[];
  intent: "primary" | "neutral" | "danger";
}

function approvalPromptActions(
  request: AgentApprovalRequest,
  kind: "approval" | "input",
  labels: Pick<
    AgentKitLabels,
    "approvalApprove" | "approvalDeny" | "approvalSubmit"
  >,
): ApprovalPromptAction[] {
  const options = request.options ?? [];
  if (options.length === 0) {
    return kind === "input"
      ? [
          {
            id: "submit",
            label: labels.approvalSubmit,
            decision: "approve",
            intent: "primary",
          },
        ]
      : [
          {
            id: "approve",
            label: labels.approvalApprove,
            decision: "approve",
            optionIds: ["approve"],
            intent: "primary",
          },
          {
            id: "deny",
            label: labels.approvalDeny,
            decision: "deny",
            optionIds: ["deny"],
            intent: "neutral",
          },
        ];
  }
  const actions = options.map(
    (option): ApprovalPromptAction => ({
      id: option.id,
      label: option.label,
      decision: approvalOptionDecision(option),
      optionIds: [option.id],
      intent:
        option.kind === "primary"
          ? "primary"
          : option.kind === "danger"
            ? "danger"
            : "neutral",
    }),
  );
  if (actions.every((action) => action.intent === "neutral")) {
    const lead = actions.find((action) => action.decision === "approve");
    if (lead) lead.intent = "primary";
  }
  return actions;
}

const APPROVAL_OTHER_OPTION_ID = "agentkit:other";

function titleCaseProvider(provider: string): string {
  return provider
    .replace(/[._-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function AgentConnectionRequestCard({
  request,
  runId,
  providerLabel,
  retry = false,
  onConnect,
}: {
  request: AgentConnectionRequest;
  runId: string;
  providerLabel?: string;
  retry?: boolean;
  onConnect?: (
    request: AgentConnectionRequest,
  ) => boolean | void | Promise<boolean | void>;
}) {
  const { labels, onConnectionRequest, requestComposerFocus, threadId } =
    useAgentKit();
  const control = useAgentKitControl();
  const resolution = useAgentKitMutation(
    async (decision: "connect" | "decline") => {
      if (decision === "connect" && onConnect) {
        if ((await onConnect(request)) === false) {
          throw new Error(labels.connectionFailed);
        }
        return;
      }
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
  const providerName =
    providerLabel?.trim() || titleCaseProvider(request.provider);
  const adminRequired = request.reason === "admin_required";
  const title =
    request.status === "connected"
      ? labels.connectionConnected
      : request.status === "failed"
        ? labels.connectionFailed
        : request.status === "declined"
          ? labels.connectionDeclined.replace(
              "{{provider}}",
              () => providerName,
            )
          : adminRequired
            ? labels.connectionAdminRequiredTitle.replace(
                "{{provider}}",
                () => providerName,
              )
            : labels.connectionConnectProvider.replace(
                "{{provider}}",
                () => providerName,
              );
  const description =
    request.detail?.trim() ||
    (adminRequired && !terminal ? labels.connectionAdminRequired : undefined);
  return (
    <Surface
      as="section"
      className="agentkit-connection-request"
      elevation="none"
      padding="none"
      data-status={request.status}
      aria-labelledby={`${request.id}-title`}
    >
      <div className="agentkit-connection-request-copy">
        <IconPlugConnected aria-hidden="true" className="agentkit-icon" />
        <div>
          <h3 id={`${request.id}-title`}>{title}</h3>
          {description ? <p>{description}</p> : null}
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
            disabled={
              resolution.pending || (!onConnectionRequest && !onConnect)
            }
            pending={resolution.pending}
            onPress={() => resolve("connect")}
          >
            {resolution.pending
              ? labels.connectionConnecting
              : retry
                ? labels.connectionRetry
                : labels.connectionConnect}
          </ActionButton>
        </div>
      ) : request.status === "failed" && (onConnectionRequest || onConnect) ? (
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
          <IconAlertTriangle aria-hidden="true" className="agentkit-icon" />
          <span {...SESSION_REPLAY_MASK_PROPS}>{resolution.error.message}</span>
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
        <span
          {...SESSION_REPLAY_MASK_PROPS}
          className="agentkit-command-error"
          role="alert"
        >
          {invocation.error.message}
        </span>
      ) : null}
    </div>
  );
}

function hasVisibleDefaultWidgetOutput(widget: AgentWidget): boolean {
  return Boolean(
    widget.title ||
    (typeof widget.data === "string" && widget.data.trim().length > 0) ||
    widget.actions?.length,
  );
}

export function AgentWidgetView({
  value: widget,
  threadId,
}: AgentKitRenderProps<AgentWidget>) {
  if (!hasVisibleDefaultWidgetOutput(widget)) return null;
  const titleId = `${widget.id}-title`;
  return (
    <section
      className="agentkit-widget-shell"
      data-widget-kind={widget.kind}
      aria-labelledby={widget.title ? titleId : undefined}
    >
      <Surface
        className="agentkit-widget shadow-(--agent-kit-control-elevation)"
        elevation="low"
        padding="none"
      >
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

function AgentMentionIcon({ icon }: { icon: string }) {
  const props = { size: 14, className: "agentkit-mention-icon" };
  switch (icon) {
    case "folder":
      return <IconFolder {...props} />;
    case "document":
      return <IconFileText {...props} />;
    case "form":
      return <IconCheckbox {...props} />;
    case "email":
      return <IconMail {...props} />;
    case "user":
      return <IconUser {...props} />;
    case "deck":
      return <IconPresentation {...props} />;
    case "agent":
      return <IconMessageChatbot {...props} />;
    case "file":
      return <IconFile {...props} />;
    default:
      return <IconStack2 {...props} />;
  }
}

// Only the composer's serialized `@[label|icon]` form is a mention. A bare
// "@word" is whatever the user typed — an address, a handle, "@3pm" — and
// rendering it as a chip claims a reference the message never carried.
function renderUserMessageText(text: string): ReactNode[] {
  const richMatches = Array.from(text.matchAll(/@\[([^\]|]+)\|([^\]]+)\]/g));
  if (!richMatches.length) return [text];
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  richMatches.forEach((match, index) => {
    const start = match.index ?? 0;
    if (start > lastIndex) parts.push(text.slice(lastIndex, start));
    const label = match[1] ?? "";
    parts.push(
      <span
        key={`rich-mention:${start}:${index}`}
        className="agentkit-mention"
        data-mention-label={label}
      >
        <AgentMentionIcon icon={match[2] ?? ""} />
        <span className="agentkit-mention-label">{label}</span>
      </span>,
    );
    lastIndex = start + match[0].length;
  });
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function AgentUserMessageText({ text }: { text: string }) {
  const { labels } = useAgentKit();
  const [expanded, setExpanded] = useState(false);
  const [expandable, setExpandable] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const content = useMemo(
    () => renderUserMessageText(splitAgentKitMessageContext(text).message),
    [text],
  );

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const measure = () => setExpandable(element.scrollHeight > 200);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [content]);

  return (
    <div className="agentkit-user-message-text">
      <div
        className="agentkit-user-message-text-clip"
        data-clamped={!expanded && expandable ? "true" : undefined}
      >
        <div
          ref={contentRef}
          className="agentkit-user-message-text-content"
          dir="auto"
        >
          {content}
        </div>
      </div>
      {expandable ? (
        <button
          type="button"
          className="agentkit-message-expand"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? labels.collapseMessage : labels.expandMessage}
        </button>
      ) : null}
    </div>
  );
}

function AgentImageAttachmentPreview({
  src,
  alt,
}: {
  src: string;
  alt: string;
}) {
  const { labels } = useAgentKit();
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={alt || labels.imagePreview}
      closeLabel={labels.closePreview}
      size="fullscreen"
      trigger={
        <button
          type="button"
          className="agentkit-image-attachment-trigger"
          aria-label={labels.previewAttachment.replace("{{name}}", () => alt)}
          title={alt}
        >
          <img src={src} alt={alt} />
        </button>
      }
    >
      <div className="agentkit-image-preview">
        <img src={src} alt={alt} draggable={false} />
      </div>
    </Dialog>
  );
}

export interface AgentMessagePartViewProps extends AgentKitRenderProps<AgentMessagePart> {
  active?: boolean;
  resetKey?: string;
  userMessage?: boolean;
}

/** False for a part that AgentMessagePartView renders as nothing. */
function messagePartRenders(
  part: AgentMessagePart,
  slots: AgentKitSlots,
  registry: AgentKitRegistry,
): boolean {
  if (registry.messageParts?.[part.type]) return true;
  switch (part.type) {
    case "reasoning":
      return part.visibility !== "hidden";
    case "data":
      return Boolean(slots.data);
    case "text":
    case "citation":
    case "annotation":
    case "file":
    case "widget":
      return true;
    default:
      return false;
  }
}

export function AgentMessagePartView({
  value: part,
  threadId,
  active = false,
  resetKey = `${threadId}:${part.type}`,
  userMessage = false,
}: AgentMessagePartViewProps) {
  const { labels, slots, registry } = useAgentKit();
  if (part.type === "reasoning" && part.visibility === "hidden") return null;
  const displayPart =
    part.type === "text"
      ? { ...part, text: splitAgentKitMessageContext(part.text).message }
      : part;
  const RegisteredRenderer = registry.messageParts?.[part.type];
  if (RegisteredRenderer) {
    return (
      <RegisteredRenderer
        value={displayPart}
        threadId={threadId}
        active={active}
        resetKey={resetKey}
      />
    );
  }
  switch (part.type) {
    case "text": {
      const textPart = displayPart as Extract<
        AgentMessagePart,
        { type: "text" }
      >;
      const Renderer = userMessage ? undefined : slots.text;
      return Renderer ? (
        <Renderer
          value={textPart}
          threadId={threadId}
          active={active}
          resetKey={resetKey}
        />
      ) : userMessage ? (
        <AgentUserMessageText text={textPart.text} />
      ) : textPart.format === "markdown" ? (
        <AgentStreamingText
          text={textPart.text}
          active={active}
          resetKey={resetKey}
        >
          {(visibleText) => (
            <AgentMarkdown
              text={visibleText}
              streaming={active || visibleText !== textPart.text}
            />
          )}
        </AgentStreamingText>
      ) : (
        <p data-format="plain">
          <AgentStreamingText
            text={textPart.text}
            active={active}
            resetKey={resetKey}
          />
        </p>
      );
    }
    case "reasoning": {
      const Renderer = slots.reasoning;
      return Renderer ? (
        <Renderer
          value={part}
          threadId={threadId}
          active={active}
          resetKey={resetKey}
        />
      ) : (
        <AgentReasoningPartDisclosure
          label={part.label ?? labels.reasoning}
          text={part.text}
          active={active}
          resetKey={resetKey}
        />
      );
    }
    case "citation": {
      const Renderer = slots.citation;
      if (Renderer) return <Renderer value={part} threadId={threadId} />;
      return <AgentLink href={part.url}>{part.title}</AgentLink>;
    }
    case "annotation": {
      const Renderer = slots.annotation;
      if (Renderer) return <Renderer value={part} threadId={threadId} />;
      return (
        <AgentLink href={part.annotation.url}>
          {part.annotation.label}
        </AgentLink>
      );
    }
    case "file": {
      const Renderer = slots.file;
      if (Renderer) return <Renderer value={part} threadId={threadId} />;
      const href = safeAgentHref(part.url);
      if (userMessage && part.mediaType?.startsWith("image/") && href) {
        return <AgentImageAttachmentPreview src={href} alt={part.name} />;
      }
      if (userMessage && part.name.startsWith("pasted-text-")) {
        return href ? (
          <a
            className="agentkit-file agentkit-file--pasted-text"
            href={href}
            download={part.name}
            title={part.name}
          >
            <IconFileText aria-hidden="true" className="agentkit-icon" />
            <span>{labels.pastedText}</span>
          </a>
        ) : (
          <span className="agentkit-file agentkit-file--pasted-text">
            <IconFileText aria-hidden="true" className="agentkit-icon" />
            <span>{labels.pastedText}</span>
          </span>
        );
      }
      return href ? (
        <a className="agentkit-file" href={href} download={part.name}>
          <IconFile aria-hidden="true" className="agentkit-icon" />
          <span>{part.name}</span>
        </a>
      ) : (
        <span
          className="agentkit-file"
          title={part.omitted ? labels.attachmentNotSaved : undefined}
        >
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

/** Resolves the stable server request identity without exposing local UI ids. */
export function resolveAgentMessageRequestId(
  message: AgentMessage,
  events: readonly AgentEvent[],
): RunId | undefined {
  return (
    messageMetadataId(message, ["requestId", "runId"]) ??
    agentThreadEventIndex(events).messageRunIds.get(message.id)
  );
}

interface AgentMessageEditContextValue {
  enabled: boolean;
  message: AgentMessage | null;
  setMessage: (message: AgentMessage | null) => void;
}

const AgentMessageEditContext =
  createContext<AgentMessageEditContextValue | null>(null);

function messageText(message: AgentMessage): string {
  return message.parts
    .filter(
      (part): part is Extract<AgentMessagePart, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
}

function messageCopyText(message: AgentMessage, text: string): string {
  const files = message.parts.flatMap((part) => {
    if (part.type !== "file") return [];
    const href = safeAgentHref(part.url);
    return [[part.name, ...(href ? [href] : [])].join("\n")];
  });
  return [text, ...files].filter(Boolean).join("\n\n");
}

function findPreviousMessage(
  messages: readonly AgentMessage[],
  messageId: string,
): AgentMessage | null | undefined {
  const index = messages.findIndex((message) => message.id === messageId);
  return index < 0 ? null : messages[index - 1];
}

function findPreviousUserMessage(
  messages: readonly AgentMessage[],
  messageId: string,
): AgentMessage | undefined {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) return undefined;
  for (let previous = index - 1; previous >= 0; previous -= 1) {
    const message = messages[previous];
    if (message?.role === "user") return message;
  }
  return undefined;
}

function messageRunOptions(message: AgentMessage): AgentRunOptions {
  const metadata = message.metadata ?? {};
  const effort = metadata.reasoningEffort ?? metadata.effort;
  const reasoningEffort = [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ].includes(String(effort))
    ? (String(effort) as AgentRunOptions["reasoningEffort"])
    : undefined;
  return {
    ...(typeof metadata.agentId === "string"
      ? { agentId: metadata.agentId }
      : {}),
    ...(typeof metadata.model === "string" ? { model: metadata.model } : {}),
    ...(typeof (metadata.requestMode ?? metadata.mode) === "string"
      ? { mode: String(metadata.requestMode ?? metadata.mode) }
      : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    metadata,
  };
}

/** Forks before `sourceMessage` and sends it again in the fork. */
async function forkAndResubmitMessage({
  controller,
  threadId,
  sourceMessage,
  onThreadForked,
  messageUnavailable,
}: {
  controller: ReturnType<typeof useAgentKit>["controller"];
  threadId: string;
  sourceMessage: AgentMessage;
  onThreadForked?: (thread: AgentThread) => void;
  messageUnavailable: string;
}): Promise<void> {
  const messages = controller.getThread(threadId).messages;
  const previousMessage = findPreviousMessage(messages, sourceMessage.id);
  if (previousMessage === null) {
    throw new Error(messageUnavailable);
  }
  const options = messageRunOptions(sourceMessage);
  const metadata = sourceMessage.metadata;
  const engine = metadata?.engine ?? options.metadata?.engine;
  // Readiness runs before the fork so a missing AI setup leaves no orphan.
  await controller.assertAiSetupReady({
    engine: typeof engine === "string" ? engine : undefined,
  });
  const forkedThread = await controller.forkThread(
    threadId,
    previousMessage?.id,
  );
  onThreadForked?.(forkedThread);
  await controller.sendMessage({
    threadId: forkedThread.id,
    text: messageText(sourceMessage),
    attachments: sourceMessage.parts.filter(
      (part): part is Extract<AgentMessagePart, { type: "file" }> =>
        part.type === "file" && !part.omitted,
    ),
    options,
    metadata,
  });
}

function messageMetadataString(
  message: AgentMessage | undefined,
  key: string,
): string | undefined {
  const metadata = message?.metadata as
    | (Record<string, unknown> & { custom?: Record<string, unknown> })
    | undefined;
  for (const value of [metadata?.[key], metadata?.custom?.[key]]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** The model a reply, or the request before it, was sent with. */
function selectedRunModel(
  messages: readonly AgentMessage[],
  messageId: string | undefined,
): string | undefined {
  if (!messageId) return undefined;
  return (
    messageMetadataString(
      agentMessagesById(messages).get(messageId)?.message,
      "model",
    ) ??
    messageMetadataString(findPreviousUserMessage(messages, messageId), "model")
  );
}

/**
 * A finished reply's footer offers a host under its message id, and the
 * reply's work row portals into it so it shares the line with the controls.
 */
interface AgentMessageWorkHosts {
  get: (messageId: string) => HTMLElement | undefined;
  set: (messageId: string, element: HTMLElement) => void;
  release: (messageId: string, element: HTMLElement) => void;
  subscribe: (listener: () => void) => () => void;
}

function createAgentMessageWorkHosts(): AgentMessageWorkHosts {
  const hosts = new Map<string, HTMLElement>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    get: (messageId) => hosts.get(messageId),
    set(messageId, element) {
      if (hosts.get(messageId) === element) return;
      hosts.set(messageId, element);
      notify();
    },
    release(messageId, element) {
      if (hosts.get(messageId) !== element) return;
      hosts.delete(messageId);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * The work rows the reader opened, by run and segment. A segment's row
 * remounts when narration hides it and again when the run finishes, and an
 * opened row comes back open.
 */
const AgentWorkRowOpenContext = createContext<{
  key: string;
  opened: Set<string>;
} | null>(null);

const AgentMessageWorkHostsContext =
  createContext<AgentMessageWorkHosts | null>(null);

function noopSubscribe() {
  return () => undefined;
}

function useAgentMessageWorkHost(
  messageId: string | undefined,
): HTMLElement | null {
  const hosts = useContext(AgentMessageWorkHostsContext);
  return useSyncExternalStore(
    hosts?.subscribe ?? noopSubscribe,
    () => (messageId ? (hosts?.get(messageId) ?? null) : null),
    () => null,
  );
}

/** A callback ref that offers its element as a reply's work row host. */
function useAgentMessageWorkHostRef(
  messageId: string | undefined,
): (element: HTMLElement | null) => void {
  const hosts = useContext(AgentMessageWorkHostsContext);
  const [element, setElement] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!hosts || !messageId || !element) return;
    hosts.set(messageId, element);
    return () => hosts.release(messageId, element);
  }, [element, hosts, messageId]);
  return setElement;
}

type AgentRunUsageState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; data: AgentKitRunUsage | null };

const RUN_USAGE_CACHE_MS = 5 * 60_000;

/** Loads a run's usage while `enabled`, reusing a recent result for the run. */
function useAgentRunUsage(
  runId: RunId | undefined,
  enabled: boolean,
): AgentRunUsageState | undefined {
  const { controller, threadId, loadRunUsage } = useAgentKit();
  const runFinished = useAgentKitSelector((snapshot) => {
    if (!runId) return false;
    const thread = snapshot.threads[threadId] ?? controller.getThread(threadId);
    return agentThreadEventIndex(thread.events).finishedRunIds.has(runId);
  });
  const [usage, setUsage] = useState<
    (AgentRunUsageState & { runId: RunId }) | null
  >(null);
  const cacheRef = useRef<{
    runId: RunId;
    fetchedAt: number;
    runFinished: boolean;
    data: AgentKitRunUsage;
  } | null>(null);
  useEffect(() => {
    if (!enabled || !runId || !loadRunUsage) return;
    const cached = cacheRef.current;
    if (
      cached?.runId === runId &&
      cached.runFinished === runFinished &&
      Date.now() - cached.fetchedAt < RUN_USAGE_CACHE_MS
    ) {
      setUsage({ runId, status: "loaded", data: cached.data });
      return;
    }
    const abort = new AbortController();
    let active = true;
    setUsage({ runId, status: "loading" });
    void loadRunUsage({ runId, signal: abort.signal })
      .then((data) => {
        if (!active) return;
        if (data)
          cacheRef.current = {
            runId,
            fetchedAt: Date.now(),
            runFinished,
            data,
          };
        setUsage({ runId, status: "loaded", data });
      })
      .catch(() => {
        if (!active || abort.signal.aborted) return;
        setUsage({ runId, status: "error" });
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [enabled, loadRunUsage, runFinished, runId]);
  if (!runId || !loadRunUsage) return undefined;
  return usage?.runId === runId ? usage : { status: "loading" };
}

function formatRunUsageAmount(
  amount: string,
  source: "reported" | "estimated" | "mixed" | null,
  labels: AgentKitLabels,
): string {
  if (source === "estimated")
    return labels.runDetailEstimated.replace("{{amount}}", () => amount);
  if (source === "mixed")
    return labels.runDetailMixed.replace("{{amount}}", () => amount);
  return amount;
}

/** Credits, tool calls and model for the run behind a work summary. */
function AgentRunDetails({
  runId,
  messageId,
  open,
}: {
  runId: RunId;
  messageId?: string | undefined;
  open: boolean;
}) {
  const { controller, threadId, labels, formatModelName } = useAgentKit();
  const details = useAgentKitSelector(
    (snapshot) => {
      const thread =
        snapshot.threads[threadId] ?? controller.getThread(threadId);
      // A saved run keeps its tool calls on the thread and may keep only
      // their activity events, so all three sources count.
      const toolIds = new Set<string>();
      for (const tool of Object.values(thread.tools)) {
        if (tool.runId === runId) toolIds.add(tool.id);
      }
      for (const event of agentThreadEventIndex(thread.events).byRun.get(
        runId,
      ) ?? EMPTY_EVENTS) {
        if (event.type === "tool.started" || event.type === "tool.updated") {
          toolIds.add(event.toolCall.id);
        } else if (event.type === "tool.delta") {
          toolIds.add(event.toolCallId);
        } else if (
          (event.type === "activity.started" ||
            event.type === "activity.updated" ||
            event.type === "activity.completed") &&
          (thread.tools[event.activity.id] as AgentToolCall | undefined)
        ) {
          toolIds.add(event.activity.id);
        }
      }
      return {
        toolCalls: toolIds.size,
        model: selectedRunModel(thread.messages, messageId),
      };
    },
    (previous, next) =>
      previous.toolCalls === next.toolCalls && previous.model === next.model,
  );
  const usage = useAgentRunUsage(runId, open);
  const credits = (() => {
    if (!usage) return null;
    if (usage.status === "loading") {
      return {
        key: labels.runCreditsUsed,
        value: (
          <Skeleton
            className="agentkit-run-details-skeleton h-3 w-12"
            role="status"
            aria-label={labels.usageLoading}
          />
        ),
      };
    }
    if (usage.status === "error") {
      return { key: labels.runCreditsUsed, value: labels.runDetailUnavailable };
    }
    const billing = usage.data?.billing;
    if (!billing) {
      return { key: labels.runCreditsUsed, value: labels.runDetailNotRecorded };
    }
    if (billing.incomplete) {
      return { key: labels.runCreditsUsed, value: labels.runDetailIncomplete };
    }
    // Zero credits give way to a provider charge, which is the real cost.
    if (
      billing.builderCredits !== null &&
      (billing.builderCredits !== 0 || !billing.providerCostUsd)
    ) {
      return {
        key: labels.runCreditsUsed,
        value: formatRunUsageAmount(
          billing.builderCredits.toLocaleString(undefined, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          }),
          billing.builderCreditsSource,
          labels,
        ),
        measuredZero: billing.builderCredits === 0,
      };
    }
    if (billing.providerCostUsd !== null) {
      const usd = billing.providerCostUsd;
      return {
        key: labels.runCost,
        value: formatRunUsageAmount(
          usd > 0 && usd < 0.0001
            ? "<$0.0001"
            : usd.toLocaleString(undefined, {
                style: "currency",
                currency: "USD",
                minimumFractionDigits: 2,
                maximumFractionDigits: 4,
              }),
          billing.providerCostSource,
          labels,
        ),
        measuredZero: usd === 0,
      };
    }
    return { key: labels.runCreditsUsed, value: labels.runDetailNotRecorded };
  })();
  // The model the run's calls reported wins over the request's selection,
  // which stands in only until, or unless, the usage names one. Auto is a
  // selection, not a model, so it never shows as one.
  const reportedModel =
    (usage?.status === "loaded" ? usage.data?.model : undefined) ??
    details.model;
  const model = reportedModel === "auto" ? undefined : reportedModel;
  const rows: { id: string; key: string; value: ReactNode }[] = [
    ...(details.toolCalls > 0
      ? [
          {
            id: "tool-calls",
            key: labels.runToolCalls,
            value: details.toolCalls.toLocaleString(),
          },
        ]
      : []),
    ...(model
      ? [
          {
            id: "model",
            key: labels.runModel,
            value: formatModelName?.(model) ?? model,
          },
        ]
      : []),
  ];
  // A measured zero has nothing to tell beside other details; a missing or
  // failed reading always shows, so it is never mistaken for a free run. Alone,
  // the zero still shows, so a row that opened to its details is never empty.
  if (credits && (!credits.measuredZero || rows.length === 0)) {
    rows.unshift({ id: "credits", key: credits.key, value: credits.value });
  }
  if (rows.length === 0) return null;
  return (
    <dl
      className="agentkit-run-details"
      aria-label={labels.runDetails}
      data-agentkit-run-details="true"
    >
      {rows.map((row) => (
        <div
          key={row.id}
          className="agentkit-run-details-row"
          data-detail={row.id}
        >
          <dt>{row.key}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function messageMetadataId(
  message: AgentMessage,
  keys: readonly string[],
): RunId | undefined {
  const metadata = message.metadata as
    | (Record<string, unknown> & {
        custom?: Record<string, unknown>;
      })
    | undefined;
  for (const source of [metadata?.custom, metadata]) {
    for (const key of keys) {
      const value = source?.[key];
      if (typeof value === "string" && value) return value as RunId;
    }
  }
  return undefined;
}

function shallowEqualValues<T extends Record<string, unknown>>(
  previous: T,
  next: T,
): boolean {
  const keys = Object.keys(previous);
  return (
    keys.length === Object.keys(next).length &&
    keys.every((key) => Object.is(previous[key], next[key]))
  );
}

function formatAgentMessageTimestamp(createdAt: string): {
  text: string;
  title: string;
} {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime()))
    return { text: createdAt, title: createdAt };
  const now = new Date();
  const today =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return {
    text: today
      ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : new Intl.DateTimeFormat(undefined, {
          month: "short",
          day: "numeric",
        }).format(date),
    title: new Intl.DateTimeFormat(undefined, {
      dateStyle: "full",
      timeStyle: "short",
    }).format(date),
  };
}

function AgentMessageTimestamp({
  createdAt,
  format,
}: {
  createdAt: string;
  format?: ((createdAt: string) => string) | undefined;
}) {
  const fallback = formatAgentMessageTimestamp(createdAt);
  return (
    <time dateTime={createdAt} title={fallback.title}>
      {format?.(createdAt) ?? fallback.text}
    </time>
  );
}

/** Enter and Space fire a click with no pointer detail. */
function pressedByKeyboard(event: { detail: number } | undefined): boolean {
  return event?.detail === 0;
}

/** Keyboard presses only: focusing the composer on touch opens the on-screen keyboard. */
function useRescueFocusToComposer(threadId: string): () => void {
  const { requestComposerFocus } = useAgentKit();
  return useCallback(() => {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body) requestComposerFocus(threadId);
    });
  }, [requestComposerFocus, threadId]);
}

/**
 * Names an icon-only message action on hover and keyboard focus. Below the
 * button, so it never covers the message it acts on.
 */
function MessageActionButton({
  title,
  busy = false,
  unavailable = false,
  icon,
  onPress,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof IconButton> & {
  /** Stays focusable: disabling the pressed button drops focus to the page. */
  busy?: boolean;
  /** Announced with aria-disabled and kept focusable. */
  unavailable?: boolean;
}) {
  // Only a native title explains a disabled button, never also the tooltip. An
  // unavailable one stays focusable and a press opens its tooltip: taps never hover.
  const inactive = Boolean(props.disabled || props.pending || busy);
  const reason = inactive ? undefined : title;
  const reasonId = useId();
  const [tooltipOpen, setTooltipOpen] = useState(false);
  return (
    <>
      <Tooltip
        open={tooltipOpen}
        onOpenChange={setTooltipOpen}
        content={
          reason ? (
            <>
              {props.label}
              <span className="block text-muted-foreground">{reason}</span>
            </>
          ) : (
            props.label
          )
        }
        placement="bottom"
        trigger={
          <IconButton
            {...props}
            icon={
              busy ? (
                <IconLoader2 aria-hidden="true" className="animate-spin" />
              ) : (
                icon
              )
            }
            {...(unavailable
              ? {
                  className: `${className ?? ""} aria-disabled:cursor-default aria-disabled:opacity-50`,
                }
              : className
                ? { className }
                : {})}
            {...(busy ? { "aria-busy": true } : {})}
            {...(unavailable ? { "aria-disabled": true } : {})}
            {...(reason ? { "aria-describedby": reasonId } : {})}
            onPress={(event) => {
              if (unavailable) {
                if (reason) setTooltipOpen(true);
                return;
              }
              if (busy) return;
              onPress?.(event);
            }}
            {...(inactive && title !== undefined ? { title } : {})}
          />
        }
      />
      {reason ? (
        <span id={reasonId} hidden>
          {reason}
        </span>
      ) : null}
    </>
  );
}

export const AgentMessageActions = memo(function AgentMessageActions({
  value: message,
  threadId,
}: AgentKitRenderProps<AgentMessage>) {
  const {
    controller,
    labels,
    slots,
    onThreadForked,
    onCopyMessage,
    branchNavigation,
  } = useAgentKit();
  const rescueFocusToComposer = useRescueFocusToComposer(threadId);
  const feedbackCapability = useAgentCapability("feedback");
  const forkingCapability = useAgentCapability("threadForking");
  const control = useAgentKitControl(threadId);
  const editContext = useContext(AgentMessageEditContext);
  const text = splitAgentKitMessageContext(messageText(message)).message;
  const metadataRequestId = messageMetadataId(message, ["requestId", "runId"]);
  const metadataRunId = messageMetadataId(message, ["runId"]);
  const position = useAgentKitSelector((snapshot) => {
    const thread = snapshot.threads[threadId] ?? controller.getThread(threadId);
    const located = agentMessagesById(thread.messages).get(message.id);
    let hasPreviousUserMessage = false;
    if (message.role === "assistant" && located) {
      for (let index = located.index - 1; index >= 0; index -= 1) {
        if (thread.messages[index]?.role === "user") {
          hasPreviousUserMessage = true;
          break;
        }
      }
    }
    const eventRunId = agentThreadEventIndex(thread.events).messageRunIds.get(
      message.id,
    );
    return {
      messageSeq: located?.index ?? -1,
      isLast: thread.messages.at(-1)?.id === message.id,
      hasPreviousUserMessage,
      requestId: metadataRequestId ?? eventRunId,
      runId: metadataRunId ?? eventRunId,
      active: threadHasActiveRuns(thread),
    };
  }, shallowEqualValues);
  const { messageSeq, requestId, runId } = position;
  const isAssistant = message.role === "assistant";
  const isLastAssistantMessage = isAssistant && position.isLast;
  // The reply's work row sits on this footer line, live or finished.
  const workHostRef = useAgentMessageWorkHostRef(
    isAssistant ? message.id : undefined,
  );
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"positive" | "negative" | null>(
    null,
  );
  const [feedbackConfirmed, setFeedbackConfirmed] = useState(false);
  const [requestIdCopied, setRequestIdCopied] = useState(false);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackConfirmedTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const requestIdCopiedTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const toolbarRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  // One tab stop per message: the toolbar for a reply, the row for a sent message.
  useRovingFocus(toolbarRef, isAssistant);
  useRovingFocus(actionsRef, !isAssistant);
  const moreToggleRef = useRef<HTMLButtonElement>(null);
  const secondaryActionsRef = useRef<HTMLDivElement>(null);
  const pendingFocusRef = useRef<"secondary" | "toggle" | null>(null);
  const secondaryActionsId = useId();
  const copyText = messageCopyText(message, text);
  const showRetry =
    isLastAssistantMessage &&
    position.hasPreviousUserMessage &&
    forkingCapability.visible &&
    Boolean(onThreadForked);
  const showFork = forkingCapability.visible && Boolean(onThreadForked);
  const hasSecondaryActions = showRetry || showFork || Boolean(requestId);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      if (requestIdCopiedTimer.current)
        clearTimeout(requestIdCopiedTimer.current);
      if (feedbackConfirmedTimer.current)
        clearTimeout(feedbackConfirmedTimer.current);
    },
    [message.id],
  );
  const setMoreActions = useCallback(
    (open: boolean, focus: "secondary" | "toggle" | null) => {
      pendingFocusRef.current = focus;
      setMoreActionsOpen(open);
    },
    [],
  );
  // Runs after React drops `inert` from the incoming set, so it can take focus.
  useLayoutEffect(() => {
    const focus = pendingFocusRef.current;
    pendingFocusRef.current = null;
    if (focus === "secondary") {
      secondaryActionsRef.current
        ?.querySelector<HTMLElement>("button:not(:disabled)")
        ?.focus();
    } else if (focus === "toggle") {
      moreToggleRef.current?.focus();
    }
  }, [moreActionsOpen]);
  useEffect(() => {
    if (!moreActionsOpen) return;
    const collapseOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && toolbarRef.current?.contains(target)) {
        return;
      }
      setMoreActions(false, null);
    };
    document.addEventListener("pointerdown", collapseOnOutsidePointer, true);
    return () =>
      document.removeEventListener(
        "pointerdown",
        collapseOnOutsidePointer,
        true,
      );
  }, [moreActionsOpen, setMoreActions]);
  useEffect(() => {
    if (!hasSecondaryActions && moreActionsOpen) setMoreActions(false, null);
  }, [hasSecondaryActions, moreActionsOpen, setMoreActions]);
  const copyAction = useAgentKitMutation(async () => {
    const handled = await onCopyMessage?.({ message, text: copyText });
    if (!handled && !(await writeClipboardText(copyText))) {
      throw new Error(labels.copyUnavailable);
    }
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1_400);
  }, `${threadId}:${message.id}:copy`);
  const feedbackAction = useAgentKitMutation(
    (value: "positive" | "negative") => {
      const options = {
        ...(runId ? { runId } : {}),
        ...(messageSeq >= 0 ? { messageSeq } : {}),
      };
      return Object.keys(options).length
        ? control.submitFeedback(message.id, value, options)
        : control.submitFeedback(message.id, value);
    },
    `${threadId}:${message.id}:feedback`,
  );
  const branchNavigationAction = useAgentKitMutation(
    async (direction: "previous" | "next") => {
      if (direction === "previous") await branchNavigation?.onPrevious();
      else await branchNavigation?.onNext();
    },
    `${threadId}:${message.id}:branch-navigation`,
  );
  const requestIdAction = useAgentKitMutation(
    async () => {
      if (!requestId) throw new Error(labels.requestIdUnavailable);
      if (!(await writeClipboardText(requestId))) {
        throw new Error(labels.copyUnavailable);
      }
      setRequestIdCopied(true);
      if (requestIdCopiedTimer.current)
        clearTimeout(requestIdCopiedTimer.current);
      requestIdCopiedTimer.current = setTimeout(() => {
        setRequestIdCopied(false);
      }, 1_400);
    },
    `${threadId}:${message.id}:request-id:${requestId ?? "unavailable"}`,
  );
  const forkAction = useAgentKitMutation(async () => {
    const thread = await control.fork(message.id);
    onThreadForked?.(thread);
  }, `${threadId}:${message.id}:fork`);
  const regenerateAction = useAgentKitMutation(async () => {
    const previousUserMessage = findPreviousUserMessage(
      controller.getThread(threadId).messages,
      message.id,
    );
    if (!previousUserMessage) throw new Error(labels.messageUnavailable);
    await forkAndResubmitMessage({
      controller,
      threadId,
      sourceMessage: previousUserMessage,
      onThreadForked,
      messageUnavailable: labels.messageUnavailable,
    });
  }, `${threadId}:${message.id}:regenerate`);
  const rateResponse = async (value: "positive" | "negative") => {
    if (feedbackAction.pending || feedback === value) return;
    try {
      await feedbackAction.execute(value);
    } catch {
      // coercion-ok: feedbackAction.error renders in the footer and the rating is unchanged.
      return;
    }
    setFeedback(value);
    setFeedbackConfirmed(true);
    if (feedbackConfirmedTimer.current)
      clearTimeout(feedbackConfirmedTimer.current);
    feedbackConfirmedTimer.current = setTimeout(
      () => setFeedbackConfirmed(false),
      1_400,
    );
  };
  const footerError =
    copyAction.error ??
    feedbackAction.error ??
    branchNavigationAction.error ??
    requestIdAction.error ??
    forkAction.error ??
    regenerateAction.error;
  const placement = isAssistant ? "inline" : undefined;
  const copyButton = (
    <MessageActionButton
      label={copied ? labels.copied : labels.copy}
      icon={
        copyAction.pending ? (
          <IconLoader2 aria-hidden="true" className="animate-spin" />
        ) : copied ? (
          <IconCircleCheck aria-hidden="true" />
        ) : (
          <IconCopy aria-hidden="true" />
        )
      }
      size="compact"
      className="size-6 rounded-[var(--agent-kit-radius-xs,0.25rem)]"
      // Copies stay enabled while they run: disabling the pressed button drops
      // focus to the page, where Escape can no longer close the toolbar.
      aria-busy={copyAction.pending || undefined}
      onPress={() => {
        if (copyAction.pending) return;
        void copyAction.execute().catch(() => undefined);
      }}
    />
  );
  const branchControls =
    branchNavigation && branchNavigation.count > 1 ? (
      <div
        className="agentkit-branch-navigation"
        role="group"
        aria-label={labels.branchPositionLabel
          .replace("{{index}}", String(branchNavigation.index))
          .replace("{{count}}", String(branchNavigation.count))}
      >
        <MessageActionButton
          label={labels.previousBranch}
          icon={<IconChevronLeft aria-hidden="true" />}
          size="compact"
          className="size-6 rounded-[var(--agent-kit-radius-xs,0.25rem)]"
          unavailable={branchNavigation.index <= 1}
          busy={branchNavigationAction.pending}
          onPress={() =>
            void branchNavigationAction
              .execute("previous")
              .catch(() => undefined)
          }
        />
        <span aria-hidden="true">
          {labels.branchPosition
            .replace("{{index}}", String(branchNavigation.index))
            .replace("{{count}}", String(branchNavigation.count))}
        </span>
        <span className="agentkit-visually-hidden" aria-live="polite">
          {labels.branchPositionLabel
            .replace("{{index}}", String(branchNavigation.index))
            .replace("{{count}}", String(branchNavigation.count))}
        </span>
        <MessageActionButton
          label={labels.nextBranch}
          icon={<IconChevronRight aria-hidden="true" />}
          size="compact"
          className="size-6 rounded-[var(--agent-kit-radius-xs,0.25rem)]"
          unavailable={branchNavigation.index >= branchNavigation.count}
          busy={branchNavigationAction.pending}
          onPress={() =>
            void branchNavigationAction.execute("next").catch(() => undefined)
          }
        />
      </div>
    ) : null;
  const toolbar = isAssistant ? (
    <div
      ref={toolbarRef}
      className="agentkit-message-toolbar"
      role="toolbar"
      aria-label={labels.messageActions}
      data-placement={placement}
      data-latest={isLastAssistantMessage ? "true" : undefined}
      data-streaming={message.status === "streaming" ? "true" : undefined}
      data-expanded={moreActionsOpen ? "true" : undefined}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !moreActionsOpen) return;
        event.preventDefault();
        event.stopPropagation();
        setMoreActions(false, "toggle");
      }}
      onMouseDown={(event) => {
        // Safari does not focus a pressed button; it focuses the transcript
        // instead, which blur below reads as leaving and collapses the set
        // before the click lands. Keep focus on the button that was pressed.
        const button =
          event.target instanceof Element
            ? event.target.closest("button")
            : null;
        if (!button || button.disabled) return;
        if (!event.currentTarget.contains(button)) return;
        event.preventDefault();
        button.focus({ preventScroll: true });
      }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!moreActionsOpen || !(next instanceof Node)) return;
        if (event.currentTarget.contains(next)) return;
        setMoreActions(false, null);
      }}
    >
      {slots.messageActionsTrailing ? (
        <div className="agentkit-message-actions-trailing">
          <slots.messageActionsTrailing
            value={stripAgentMessageContext(message)}
            threadId={threadId}
          />
        </div>
      ) : null}
      {branchControls}
      <div className="agentkit-message-actions-swap">
        <div
          className="agentkit-message-actions-set"
          data-set="primary"
          data-active={moreActionsOpen ? "false" : "true"}
          inert={moreActionsOpen}
        >
          {copyButton}
          {feedbackCapability.visible
            ? (["positive", "negative"] as const).map((value) => {
                const chosen = feedback === value;
                const renderFeedbackButton = (
                  toggle?: () => void,
                  open?: boolean,
                  contentId?: string,
                ) => (
                  <MessageActionButton
                    key={value}
                    label={
                      value === "positive"
                        ? labels.feedbackGood
                        : labels.feedbackBad
                    }
                    icon={
                      value === "positive" ? (
                        chosen ? (
                          <IconThumbUpFilled aria-hidden="true" />
                        ) : (
                          <IconThumbUp aria-hidden="true" />
                        )
                      ) : chosen ? (
                        <IconThumbDownFilled aria-hidden="true" />
                      ) : (
                        <IconThumbDown aria-hidden="true" />
                      )
                    }
                    size="compact"
                    className="size-6 rounded-[var(--agent-kit-radius-xs,0.25rem)]"
                    data-message-action={`feedback-${value}`}
                    aria-pressed={chosen}
                    aria-haspopup={toggle ? "dialog" : undefined}
                    aria-expanded={toggle ? open : undefined}
                    aria-controls={toggle && open ? contentId : undefined}
                    unavailable={!feedbackCapability.enabled}
                    busy={feedbackAction.pending}
                    {...(feedbackCapability.reason === undefined
                      ? {}
                      : { title: feedbackCapability.reason })}
                    onPress={() => {
                      toggle?.();
                      // raw-sql-ok: This submits a UI feedback rating, not SQL.
                      void rateResponse(value);
                    }}
                  />
                );
                return value === "negative" && slots.feedbackNote ? (
                  <slots.feedbackNote
                    key={value}
                    threadId={threadId}
                    {...(runId ? { runId } : {})}
                    {...(messageSeq >= 0 ? { messageSeq } : {})}
                    renderTrigger={renderFeedbackButton}
                  />
                ) : (
                  renderFeedbackButton()
                );
              })
            : null}
        </div>
        {hasSecondaryActions ? (
          <div
            ref={secondaryActionsRef}
            id={secondaryActionsId}
            className="agentkit-message-actions-set"
            data-set="secondary"
            data-active={moreActionsOpen ? "true" : "false"}
            inert={!moreActionsOpen}
          >
            {showRetry ? (
              <MessageActionButton
                label={labels.regenerateResponse}
                icon={<IconRefresh aria-hidden="true" />}
                size="compact"
                className="size-6 rounded-[var(--agent-kit-radius-xs,0.25rem)]"
                data-message-action="retry"
                busy={regenerateAction.pending}
                unavailable={position.active || !forkingCapability.enabled}
                {...(forkingCapability.reason === undefined
                  ? {}
                  : { title: forkingCapability.reason })}
                onPress={(event) => {
                  const keyboard = pressedByKeyboard(event);
                  void regenerateAction
                    .execute()
                    .catch(() => undefined)
                    // The new response replaces this toolbar.
                    .finally(() => {
                      if (keyboard) rescueFocusToComposer();
                    });
                }}
              />
            ) : null}
            {showFork ? (
              <MessageActionButton
                label={labels.forkFromHere}
                icon={<IconArrowFork aria-hidden="true" />}
                size="compact"
                className="size-6 rounded-[var(--agent-kit-radius-xs,0.25rem)]"
                data-message-action="fork"
                busy={forkAction.pending}
                unavailable={!forkingCapability.enabled}
                {...(forkingCapability.reason === undefined
                  ? {}
                  : { title: forkingCapability.reason })}
                onPress={() => void forkAction.execute().catch(() => undefined)}
              />
            ) : null}
            {requestId ? (
              <MessageActionButton
                label={requestIdCopied ? labels.copied : labels.copyRequestId}
                icon={
                  requestIdAction.pending ? (
                    <IconLoader2 aria-hidden="true" className="animate-spin" />
                  ) : requestIdCopied ? (
                    <IconCircleCheck aria-hidden="true" />
                  ) : (
                    <IconId aria-hidden="true" />
                  )
                }
                size="compact"
                className="size-6 rounded-[var(--agent-kit-radius-xs,0.25rem)]"
                data-message-action="request-id"
                aria-busy={requestIdAction.pending || undefined}
                onPress={() => {
                  if (requestIdAction.pending) return;
                  void requestIdAction.execute().catch(() => undefined);
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {hasSecondaryActions ? (
        <MessageActionButton
          elementRef={moreToggleRef}
          label={labels.moreMessageActions}
          icon={<IconDots aria-hidden="true" />}
          size="compact"
          // Hover is lighter than open, the toolkit's menu-trigger pattern,
          // so pressing it reads as a change while the pointer is still on it.
          className="agentkit-message-actions-toggle size-6 rounded-[var(--agent-kit-radius-xs,0.25rem)] hover:bg-accent/60 aria-expanded:bg-accent aria-expanded:text-foreground"
          data-message-actions-toggle=""
          aria-expanded={moreActionsOpen}
          aria-controls={secondaryActionsId}
          onPress={() =>
            setMoreActions(
              !moreActionsOpen,
              moreActionsOpen ? "toggle" : "secondary",
            )
          }
        />
      ) : null}
      <span className="agentkit-visually-hidden" aria-live="polite">
        {feedbackConfirmed
          ? labels.feedbackSubmitted
          : requestIdCopied || copied
            ? labels.copied
            : ""}
      </span>
    </div>
  ) : null;
  return (
    <div
      ref={actionsRef}
      className="agentkit-message-actions"
      data-role={message.role}
      data-placement={placement}
      data-latest={isLastAssistantMessage ? "true" : undefined}
      data-streaming={message.status === "streaming" ? "true" : undefined}
      data-expanded={moreActionsOpen ? "true" : undefined}
      data-has-error={footerError ? "true" : undefined}
      {...(isAssistant
        ? {}
        : { role: "toolbar", "aria-label": labels.messageActions })}
    >
      {isAssistant ? (
        <>
          <div ref={workHostRef} className="agentkit-message-work-host" />
          {toolbar}
        </>
      ) : (
        <>
          <div className="agentkit-message-actions-leading">
            {copyButton}
            {editContext?.enabled &&
            message.metadata?.pendingSubmission !== true &&
            forkingCapability.visible &&
            text.trim() ? (
              <MessageActionButton
                label={labels.editMessage}
                icon={<IconPencil aria-hidden="true" />}
                size="compact"
                className="size-6 rounded-[var(--agent-kit-radius-xs,0.25rem)]"
                unavailable={position.active || !forkingCapability.enabled}
                {...(forkingCapability.reason === undefined
                  ? {}
                  : { title: forkingCapability.reason })}
                aria-pressed={editContext.message?.id === message.id}
                onPress={() => editContext.setMessage(message)}
              />
            ) : null}
          </div>
          <div className="agentkit-message-actions-trailing">
            {message.createdAt ? (
              <AgentMessageTimestamp
                createdAt={message.createdAt}
                format={labels.formatTimestamp}
              />
            ) : null}
          </div>
          <span className="agentkit-visually-hidden" aria-live="polite">
            {copied ? labels.copied : ""}
          </span>
        </>
      )}
      {footerError ? (
        <span
          {...SESSION_REPLAY_MASK_PROPS}
          className="agentkit-command-error"
          role="alert"
        >
          {footerError.message}
        </span>
      ) : null}
    </div>
  );
});

const AgentKitPostWidgetTextContext =
  createContext<AgentChatTranscriptLayout["postWidgetText"]>(undefined);

interface AgentMessageAttachments {
  widgets: AgentWidget[];
  annotations: AgentThreadState["annotations"][string][];
  events: AgentEvent[];
}

function shallowEqualArrays<T>(previous: readonly T[], next: readonly T[]) {
  return (
    previous.length === next.length &&
    previous.every((item, index) => item === next[index])
  );
}

export const AgentMessageView = memo(function AgentMessageView({
  value: message,
  threadId,
}: AgentKitRenderProps<AgentMessage>) {
  const { controller, labels, slots, registry, resolveMessageContentOrder } =
    useAgentKit();
  const postWidgetText = useContext(AgentKitPostWidgetTextContext);
  const editing =
    useContext(AgentMessageEditContext)?.message?.id === message.id;
  const attachments = useAgentKitSelector<AgentMessageAttachments>(
    (snapshot) => {
      const thread =
        snapshot.threads[threadId] ?? controller.getThread(threadId);
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
      const widgets = Object.values(thread.widgets).filter(
        (widget) =>
          thread.widgetMessageIds[widget.id] === message.id &&
          !embeddedWidgetIds.has(widget.id),
      );
      const annotations = Object.values(thread.annotations).filter(
        (annotation) =>
          thread.annotationMessageIds[annotation.id] === message.id &&
          !embeddedAnnotationIds.has(annotation.id),
      );
      return {
        widgets,
        annotations,
        // Content order reads the stream only to place attached widgets.
        events:
          widgets.length > 0 || resolveMessageContentOrder
            ? thread.events
            : EMPTY_EVENTS,
      };
    },
    (previous, next) =>
      previous.events === next.events &&
      shallowEqualArrays(previous.widgets, next.widgets) &&
      shallowEqualArrays(previous.annotations, next.annotations),
  );
  const visibleMessage = useMemo(
    () => stripAgentMessageContext(message),
    [message],
  );
  const Supplement = slots.messageSupplement;
  const Actions = slots.messageActions ?? AgentMessageActions;
  const attachedWidgets = attachments.widgets;
  const attachedAnnotations = attachments.annotations;
  const orderedContent = useMemo(
    () =>
      orderMessageContent(
        visibleMessage,
        visibleMessage.parts,
        attachedWidgets,
        attachments.events,
        resolveMessageContentOrder,
      ),
    [
      attachedWidgets,
      attachments.events,
      resolveMessageContentOrder,
      visibleMessage,
    ],
  );
  if (
    !message.parts.some((part) => messagePartRenders(part, slots, registry)) &&
    !attachedWidgets.length &&
    !attachedAnnotations.length
  ) {
    return Supplement ? (
      <Supplement value={visibleMessage} threadId={threadId} />
    ) : null;
  }
  let hasSeenWidget = false;
  const renderedContent: ReactNode[] = [];
  let citationRun: ReactNode[] = [];
  let citationParts: CitationPart[] = [];
  let citationRunKey = "";
  const flushCitations = () => {
    if (!citationRun.length) return;
    renderedContent.push(
      // A host citation renderer keeps the inline run it was written for.
      slots.citation || registry.messageParts?.citation ? (
        <span
          key={`citations:${citationRunKey}`}
          className="agentkit-citations"
        >
          {citationRun}
        </span>
      ) : (
        <AgentSources
          key={`citations:${citationRunKey}`}
          citations={citationParts}
        />
      ),
    );
    citationRun = [];
    citationParts = [];
  };
  orderedContent.forEach((item, index) => {
    const isWidget = item.type === "widget" || item.part.type === "widget";
    const followsWidget =
      message.role === "assistant" &&
      postWidgetText !== undefined &&
      hasSeenWidget &&
      item.type === "part" &&
      item.part.type === "text";
    if (isWidget) hasSeenWidget = true;
    const content = (
      <AgentMessagePartView
        value={
          item.type === "widget"
            ? { type: "widget", widget: item.widget }
            : item.part
        }
        threadId={threadId}
        active={message.status === "streaming"}
        resetKey={`${threadId}:${message.id}:${index}`}
        userMessage={message.role === "user"}
      />
    );
    if (item.type === "part" && item.part.type === "citation") {
      if (!citationRun.length) citationRunKey = item.key;
      citationRun.push(<Fragment key={item.key}>{content}</Fragment>);
      citationParts.push(item.part);
      return;
    }
    flushCitations();
    renderedContent.push(
      followsWidget ? (
        <div key={item.key} data-post-widget-text="true">
          {content}
        </div>
      ) : (
        <Fragment key={item.key}>{content}</Fragment>
      ),
    );
  });
  flushCitations();
  return (
    <article
      className="agentkit-message"
      data-role={message.role}
      data-message-id={message.id}
      data-pending={
        message.metadata?.pendingSubmission === true ? "true" : undefined
      }
      data-editing={editing ? "true" : undefined}
      aria-label={message.role === "user" ? labels.you : labels.assistant}
      aria-busy={message.status === "streaming"}
    >
      {/* Lets screen-reader users jump between turns by heading. */}
      <h2 className="agentkit-visually-hidden">
        {message.role === "user" ? labels.you : labels.assistant}
      </h2>
      <div className="agentkit-message-content">
        {renderedContent}
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
        {Supplement ? (
          <Supplement value={visibleMessage} threadId={threadId} />
        ) : null}
      </div>
      <Actions
        value={slots.messageActions ? visibleMessage : message}
        threadId={threadId}
      />
    </article>
  );
});

function stripAgentMessageContext(message: AgentMessage): AgentMessage {
  const metadata = stripAgentContextMetadata(message.metadata);
  return {
    ...message,
    ...(metadata ? { metadata } : {}),
    parts: message.parts.map((part) =>
      part.type === "text"
        ? { ...part, text: splitAgentKitMessageContext(part.text).message }
        : part,
    ),
  };
}

function stripAgentContextMetadata(
  metadata?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!metadata) return metadata;
  const visibleMetadata = { ...metadata };
  delete visibleMetadata.contextItems;
  return visibleMetadata;
}

function sameAgentError(a: AgentError, b: AgentError): boolean {
  return a === b || (a.code === b.code && a.message === b.message);
}

export function AgentRunFailure({
  error,
  runId,
  threadId,
}: AgentRunFailureRenderProps) {
  const { controller, labels } = useAgentKit();
  const control = useAgentKitControl(threadId);
  const [continuing, setContinuing] = useState(false);
  const [continueFailed, setContinueFailed] = useState(false);
  // Continuing resumes the stopped run's own turn, so only that turn's newest
  // run can be continued; once anything ran after it, the card is history.
  const { superseded, latestFailure } = useAgentKitSelector((snapshot) => {
    const runs = Object.values(
      (snapshot.threads[threadId] ?? controller.getThread(threadId)).runs,
    );
    const startedAt = runs.find((run) => run.id === runId)?.startedAt;
    const laterRun = (run: (typeof runs)[number]) =>
      run.id !== runId &&
      Boolean(run.startedAt && startedAt && run.startedAt > startedAt);
    return {
      superseded: runs.some(laterRun),
      latestFailure: !runs.some(
        (run) => run.status === "failed" && laterRun(run),
      ),
    };
  }, shallowEqualValues);
  const canContinue =
    error.retryable === true && control.canContinueRun && !superseded;
  const continueRun = () => {
    setContinuing(true);
    setContinueFailed(false);
    control.continueRun(runId).catch(() => {
      setContinuing(false);
      setContinueFailed(true);
    });
  };
  // Amber, not red, even when not retryable: a failed run destroys nothing.
  return (
    <div
      className="agentkit-run-failure"
      data-tone="warning"
      data-error-code={error.code}
      data-run-id={runId}
      data-thread-id={threadId}
      role={!superseded && latestFailure ? "alert" : undefined}
    >
      <IconAlertTriangle aria-hidden="true" className="agentkit-icon" />
      <div className="agentkit-run-failure-copy">
        <strong>{labels.runFailed}</strong>
        <span {...SESSION_REPLAY_MASK_PROPS}>{error.message}</span>
        {canContinue ? (
          <div className="agentkit-error-actions">
            <ActionButton
              emphasis="outline"
              size="compact"
              pending={continuing}
              onPress={continueRun}
            >
              {labels.continueRun}
            </ActionButton>
          </div>
        ) : null}
        {continueFailed && !superseded ? (
          <span className="agentkit-command-error" role="alert">
            {labels.continueRunUnavailable}
          </span>
        ) : null}
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
  dismiss,
}: AgentConnectionErrorRenderProps) {
  const { labels } = useAgentKit();
  return (
    <ComposerNotice
      tone="warning"
      role="alert"
      noticeId="connection-error"
      className="agentkit-connection-notice"
      rootProps={{ "data-error-code": error.code, "data-thread-id": threadId }}
      onDismiss={dismiss}
      dismissLabel={labels.dismissNotice}
      actions={
        error.retryable ? (
          <ActionButton
            emphasis="outline"
            size="compact"
            className="h-6 px-2 text-xs"
            pending={recovering}
            onPress={() => void recover().catch(() => undefined)}
          >
            {labels.reconnect}
          </ActionButton>
        ) : undefined
      }
    >
      <span {...SESSION_REPLAY_MASK_PROPS}>{error.message}</span>
      {recoveryError ? (
        <span {...SESSION_REPLAY_MASK_PROPS} className="block">
          {recoveryError.message}
        </span>
      ) : null}
    </ComposerNotice>
  );
}

export interface AgentKitComposerProps extends Omit<
  Pick<
    PromptComposerProps,
    | "slashCommands"
    | "slashSkills"
    | "includeDefaultSlashCommands"
    | "includeDefaultSlashSkills"
    | "onSlashCommand"
    | "plusMenuMode"
    | "voiceEnabled"
    | "onVoiceChatStart"
    | "autoFocus"
    | "disabled"
    | "isReferenceTarget"
    | "submissionDisabled"
    | "onDisabledClick"
    | "onSetupCardClick"
    | "initialText"
    | "initialTextKey"
    | "layoutVariant"
    | "availableModels"
    | "modelListLoading"
    | "selectedModel"
    | "selectedEngine"
    | "selectedEffort"
    | "placeholder"
    | "onConnectProvider"
    | "onConnectLocalRuntime"
    | "imageModelMenu"
    | "onModelChange"
    | "onEffortChange"
    | "availableAgents"
    | "selectedAgent"
    | "agentOnly"
    | "onAgentChange"
    | "onModelSelectorOpenChange"
    | "modelStatusChecksEnabled"
    | "showMissingApiKeySetup"
    | "setupCardVisible"
    | "onModelConnectionRequiredChange"
    | "contextUsageSlot"
    | "attachmentsEnabled"
    | "onAttachmentRequest"
    | "contextButtonTooltipDisabled"
    | "onTextChange"
    | "contextItems"
    | "onRemoveContextItem"
    | "onInspectContextItem"
    | "onRetryContextItem"
    | "onPasteContext"
    | "contextMenuItems"
    | "attachmentAdapter"
    | "inlineTextAttachments"
    | "extraActionButton"
    | "onSubmit"
    | "onSubmissionPendingChange"
    | "onAttachmentError"
    | "interceptBuildRequestsForBuilder"
    | "stopButton"
  >,
  "onSubmit" | "initialText" | "initialTextKey"
> {
  /** Programmatically seed the composer with plain text. */
  initialText?: string | undefined;
  /** Stable key used to re-apply `initialText` when the host picks a preset. */
  initialTextKey?: string | number | undefined;
  /** Override the default AgentKit submit path when the host owns send options. */
  onSubmit?: PromptComposerProps["onSubmit"];
  /** Opt in to Agent-Native provider UI when this host owns that setup flow. */
  requireAgentEngine?: boolean;
  beforeSend?: (submission: AgentKitComposerSubmission) => void | Promise<void>;
  composerRef?: { current: TiptapComposerHandle | null };
  threadId?: string;
  className?: string;
  /** The host transcript renders its own accessible submission status. */
  announcePendingSubmission?: boolean;
  queueWhileRunning?: boolean;
  showModelSelector?: boolean;
  /** Hide `/plan`, so every message from this composer acts. */
  planModeDisabled?: boolean;
  /** Shared host toolbar controls shown above the composer. */
  toolbarSlot?: ReactNode;
}

function hasActiveRuns(thread: AgentThreadState): boolean {
  return threadHasActiveRuns(thread);
}

const AgentKitTranscriptFollowContext = createContext<(() => void) | null>(
  null,
);

/**
 * Returns a callback a custom composer calls, synchronously, as the user
 * submits: the transcript jumps to the latest turn without waiting for the
 * server to echo the message back.
 */
export function useAgentKitFollowTranscript(): () => void {
  return useContext(AgentKitTranscriptFollowContext) ?? noop;
}

function noop() {}

export function AgentKitComposer({
  threadId: requestedThreadId,
  className,
  announcePendingSubmission = true,
  queueWhileRunning = true,
  showModelSelector = true,
  slashCommands,
  slashSkills,
  includeDefaultSlashCommands,
  includeDefaultSlashSkills,
  onSlashCommand,
  plusMenuMode,
  voiceEnabled = false,
  onVoiceChatStart,
  autoFocus = true,
  toolbarSlot,
  disabled,
  isReferenceTarget,
  submissionDisabled,
  onDisabledClick,
  onSetupCardClick,
  placeholder,
  initialText,
  initialTextKey,
  layoutVariant,
  availableModels,
  modelListLoading,
  selectedModel,
  selectedEngine,
  selectedEffort,
  onConnectProvider,
  onConnectLocalRuntime,
  imageModelMenu,
  onModelChange,
  onEffortChange,
  availableAgents,
  selectedAgent,
  agentOnly,
  onAgentChange,
  onModelSelectorOpenChange,
  modelStatusChecksEnabled,
  requireAgentEngine = false,
  showMissingApiKeySetup,
  setupCardVisible,
  onModelConnectionRequiredChange,
  contextUsageSlot,
  attachmentsEnabled,
  onAttachmentRequest,
  contextButtonTooltipDisabled,
  onTextChange,
  composerRef: hostComposerRef,
  contextItems,
  onRemoveContextItem,
  extraActionButton,
  onSubmit: onSubmitOverride,
  onSubmissionPendingChange,
  onAttachmentError,
  interceptBuildRequestsForBuilder,
  planModeDisabled,
  stopButton,
  onInspectContextItem,
  onRetryContextItem,
  onPasteContext,
  contextMenuItems,
  attachmentAdapter,
  // AgentKit always uploads attached files and the server reads their text,
  // so also pasting a text file into the message sends it twice: the copy
  // here has only a weak truncation note and a read failure here is silent.
  inlineTextAttachments = false,
  beforeSend,
}: AgentKitComposerProps) {
  const {
    threadId: contextThreadId,
    controller,
    labels,
    onThreadForked,
    registerComposerFocus,
    slots,
  } = useAgentKit();
  const editContext = useContext(AgentMessageEditContext);
  const followTranscript = useAgentKitFollowTranscript();
  const editingMessage = editContext?.message ?? null;
  const threadId = requestedThreadId ?? contextThreadId;
  const [stopError, setStopError] = useState<string | null>(null);
  const defaultStopButton = useAgentKitStopButton({
    label: labels.stop,
    threadId,
    beforeCancel: () => {
      setStopError(null);
      return true;
    },
    onError: (error) => setStopError(error.message || labels.error),
  });
  const stopAvailable = defaultStopButton !== undefined;
  useEffect(() => {
    if (!stopAvailable) setStopError(null);
  }, [stopAvailable]);
  const connection = useAgentConnection();
  const submitFailureDraftScopeRef = useRef<string | null>(null);
  const getSubmitFailureDraftScope = useCallback(() => {
    const scope = submitFailureDraftScopeRef.current;
    submitFailureDraftScopeRef.current = null;
    return scope;
  }, []);
  const queueCapability = useAgentCapability("messageQueue");
  const suggestionsCapability = useAgentCapability("suggestions");
  const uploadsCapability = useAgentCapability("uploads");
  const modelSelectionCapability = useAgentCapability("modelSelection");
  const canQueue = queueCapability.enabled;
  const canUpload = uploadsCapability.enabled && attachmentsEnabled !== false;
  const uploadGateRef = useRef({
    enabled: canUpload,
    reason: uploadsCapability.reason,
  });
  uploadGateRef.current = {
    enabled: canUpload,
    reason: uploadsCapability.reason,
  };
  // The host opts in through showModelSelector, so a capability the backend
  // never reported keeps the selector instead of silently removing a control
  // the host asked for. Only an explicit denial or outage takes it away.
  const canSelectModel =
    modelSelectionCapability.state === "unknown" ||
    modelSelectionCapability.enabled;
  const control = useAgentKitControl(threadId);
  const beginPendingSubmission = useAgentKitBeginPendingSubmission();
  const thread = useAgentThread(threadId);
  const command = useAgentKitMutation(
    (execute: () => Promise<unknown>) => execute(),
    threadId,
  );
  // A send in flight does not block the next one: once its turn is in
  // progress the next draft queues behind it, as it would behind a run.
  const send = useAgentKitMutation(
    (execute: () => Promise<unknown>) => execute(),
    threadId,
  );
  const sendOrCommandError = send.error ?? command.error;
  const resetSendOrCommandError = () => {
    send.reset();
    command.reset();
  };
  const submissionBlocked = Boolean(submissionDisabled) || command.pending;
  const [submissionPending, setSubmissionPending] = useState(false);
  const handleSubmissionPendingChange = useCallback(
    (pending: boolean) => {
      setSubmissionPending(pending);
      onSubmissionPendingChange?.(pending);
    },
    [onSubmissionPendingChange],
  );
  const suggestionSubmitBlocked = submissionBlocked || submissionPending;
  // A failed send also fails the connection with the same error; the chat's
  // connection notice already shows it, so this one would repeat it.
  const connectionCoversCommandError =
    connection.status === "error" &&
    sendOrCommandError !== undefined &&
    connection.error?.message === sendOrCommandError.message;
  const localComposerRef = useRef<TiptapComposerHandle>(null);
  const composerRef = hostComposerRef ?? localComposerRef;
  const selectedSuggestionRef = useRef<
    AgentKitSuggestionsRenderProps["suggestions"][number] | undefined
  >(undefined);
  const suggestionScope = useRef({ threadId, enabled: false, mounted: true });
  suggestionScope.current = {
    ...suggestionScope.current,
    threadId,
    enabled:
      !disabled &&
      !submissionDisabled &&
      suggestionsCapability.enabled &&
      !editingMessage,
  };
  useEffect(() => {
    suggestionScope.current.mounted = true;
    return () => {
      suggestionScope.current.mounted = false;
    };
  }, []);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const composerTranslate = useComposerRuntimeAdapters().translate;
  useEffect(() => {
    setAttachmentError(null);
    setStopError(null);
  }, [threadId]);
  const composerAttachmentAdapter = useMemo(
    () => attachmentAdapter ?? createChatAttachmentAdapter(composerTranslate),
    [attachmentAdapter, composerTranslate],
  );
  const formatUploadError = (error: unknown): string => {
    const formatFailure = (failure: unknown): string => {
      const code =
        failure && typeof failure === "object" && "code" in failure
          ? failure.code
          : undefined;
      const key =
        code === "upload_too_large"
          ? "agentChat.composer.fileTooLarge"
          : code === "upload_session_expired"
            ? "agentChat.composer.sessionExpired"
            : code === "upload_unsupported_type"
              ? "agentChat.composer.unsupportedFileType"
              : code === "upload_network_error"
                ? "agentChat.composer.uploadOffline"
                : code === "upload_unavailable"
                  ? "agentChat.composer.uploadUnavailable"
                  : code === "upload_invalid_response"
                    ? "agentChat.composer.uploadFailed"
                    : undefined;
      return key
        ? composerTranslate(key, { size: 25 })
        : formatAttachmentError(failure, labels.dropFileFailed);
    };
    return error instanceof AgentKitUploadError
      ? error.failures
          .map((failure) => `${failure.name}: ${formatFailure(failure.error)}`)
          .join("\n")
      : formatFailure(error);
  };
  const coreFileStorageSetup = useContext(CoreFileStorageSetupContext);
  const storageAnchorRef = useRef<HTMLDivElement>(null);
  const [storageState, setStorageState] = useState<
    "unknown" | "pending" | "ready" | "missing" | "unavailable"
  >("unknown");
  const [storageOpen, setStorageOpen] = useState(false);
  const storageOpenRef = useRef(false);
  const changeStorageOpen = useCallback((open: boolean) => {
    storageOpenRef.current = open;
    setStorageOpen(open);
  }, []);
  const storageScope = useMemo(
    () => ({ current: true }),
    [controller, threadId, canUpload, coreFileStorageSetup?.scopeKey],
  );
  useEffect(() => {
    storageScope.current = true;
    return () => {
      storageScope.current = false;
    };
  }, [storageScope, changeStorageOpen]);
  useEffect(() => {
    changeStorageOpen(false);
    setStorageState("unknown");
  }, [storageScope, changeStorageOpen]);
  const storageReadRef = useRef<{
    scope: typeof storageScope;
    pending: Promise<{ configured: boolean }>;
  } | null>(null);
  const requestCoreAttachment = useCallback(async () => {
    const isCurrentScope = () => storageScope.current;
    if (!canUpload || !isCurrentScope() || !coreFileStorageSetup)
      return "stale" as const;
    setStorageState("pending");
    changeStorageOpen(false);
    const previous = storageReadRef.current;
    const sharedRead =
      previous?.scope === storageScope ? previous.pending : null;
    const pending = sharedRead ?? coreFileStorageSetup.readStatus();
    storageReadRef.current = { scope: storageScope, pending };
    try {
      const status = await pending;
      if (!isCurrentScope()) return "stale" as const;
      setStorageState(status.configured ? "ready" : "missing");
      changeStorageOpen(!status.configured);
      return status.configured ? ("ready" as const) : ("missing" as const);
    } catch (error) {
      if (!isCurrentScope()) return "stale" as const;
      setStorageState("unavailable");
      changeStorageOpen(true);
      onAttachmentError?.(formatAttachmentError(error, labels.dropFileFailed));
      return "unavailable" as const;
    } finally {
      const currentRead = () => storageReadRef.current;
      if (currentRead()?.pending === pending) storageReadRef.current = null;
    }
  }, [
    canUpload,
    coreFileStorageSetup,
    storageScope,
    onAttachmentError,
    labels.dropFileFailed,
    changeStorageOpen,
  ]);
  const starting = useAgentKitSubmissionStarting(threadId);
  const active = hasActiveRuns(thread) || starting;
  const composerInitialText = editingMessage
    ? splitAgentKitMessageContext(messageText(editingMessage)).message
    : initialText;
  const composerInitialTextKey = editingMessage
    ? `edit:${editingMessage.id}`
    : initialTextKey;
  const forkingCapability = useAgentCapability("threadForking");
  // ArrowUp recall opens the same edit flow as a sent message's pencil, under
  // the same conditions: editing is on, nothing is running, forking works.
  const recallLastMessage = () => {
    if (
      !editContext?.enabled ||
      editingMessage ||
      active ||
      !forkingCapability.visible ||
      !forkingCapability.enabled
    ) {
      return false;
    }
    const last = thread.messages.findLast(
      (message) =>
        message.role === "user" &&
        message.metadata?.pendingSubmission !== true &&
        messageText(message).trim(),
    );
    if (!last) return false;
    editContext.setMessage(last);
    return true;
  };
  const focusComposer = useCallback(() => {
    if (!autoFocus || storageOpenRef.current) return;
    composerRef.current?.focus();
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(() => {
        if (!storageOpenRef.current) composerRef.current?.focus();
      });
    }
  }, [autoFocus]);
  const reportAttachmentError = useCallback(
    (message: string) => {
      if (onAttachmentError) onAttachmentError(message);
      else setAttachmentError(message);
    },
    [onAttachmentError],
  );
  const addDroppedAttachment = useCallback(
    async (file: File) => {
      try {
        const composer = composerRef.current;
        if (!composer) throw new Error(labels.error);
        await composer.addAttachment(file);
        setAttachmentError(null);
      } catch (error) {
        reportAttachmentError(
          `${file.name}: ${formatAttachmentError(error, labels.dropFileFailed)}`,
        );
        throw error;
      }
    },
    [labels.dropFileFailed, labels.error, reportAttachmentError],
  );
  useEffect(() => {
    const receiveAttachments = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          threadId: string;
          files: readonly File[];
        }>
      ).detail;
      if (detail?.threadId !== threadId || !canUpload) return;
      void Promise.all(
        detail.files.map((file) => addDroppedAttachment(file)),
      ).catch(() => undefined);
    };
    window.addEventListener("agentkit:attach-files", receiveAttachments);
    return () =>
      window.removeEventListener("agentkit:attach-files", receiveAttachments);
  }, [addDroppedAttachment, canUpload, threadId]);
  const editingLabelId = useId();
  const cancelEditing = useCallback(() => {
    composerRef.current?.setText(initialText ?? "");
    editContext?.setMessage(null);
    focusComposer();
  }, [editContext, focusComposer, initialText]);
  const editingRow = editingMessage ? (
    <div
      role="group"
      aria-labelledby={editingLabelId}
      className="agentkit-editing-row flex h-6 min-w-0 items-center gap-2 text-xs text-muted-foreground"
      data-agentkit-editing-row="true"
    >
      <Tooltip
        placement="top"
        align="start"
        trigger={
          <span
            tabIndex={0}
            className="inline-flex min-w-0 items-center gap-2 rounded-[var(--agent-kit-radius-xs,0.25rem)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconPencil aria-hidden="true" className="size-4 shrink-0" />
            <span id={editingLabelId} className="truncate">
              {labels.editingMessage}
            </span>
          </span>
        }
        content={labels.editingMessageHint}
      />
      <ActionButton
        emphasis="ghost"
        size="compact"
        className="-me-2 ms-auto h-6 shrink-0 px-2 text-xs"
        onPress={cancelEditing}
      >
        {labels.cancelEditing}
      </ActionButton>
    </div>
  ) : null;
  useEffect(
    () => registerComposerFocus(threadId, focusComposer),
    [focusComposer, registerComposerFocus, threadId],
  );
  // i18n-ignore: These type-level callback property names are not visible copy.
  const submitMessage = async (
    text: string,
    files: PromptComposerFile[],
    references: Parameters<PromptComposerProps["onSubmit"]>[2], // i18n-ignore: Type-only callback tuple, not rendered copy.
    options: Parameters<PromptComposerProps["onSubmit"]>[3],
    suggestion?: AgentKitSuggestionsRenderProps["suggestions"][number],
  ) => {
    submitFailureDraftScopeRef.current = null;
    const assertSuggestionCurrent = () => {
      if (
        suggestion &&
        (!suggestionScope.current.enabled ||
          !suggestionScope.current.mounted ||
          suggestionScope.current.threadId !== threadId ||
          !isCurrentAgentSuggestion(controller.getThread(threadId), suggestion))
      )
        throw new Error(labels.error);
    };
    assertSuggestionCurrent();
    const onLocalSubmit = () => {
      options.onLocalSubmit?.();
    };
    if (files.length && !uploadGateRef.current.enabled) {
      throw new AgentKitCapabilityError(
        "uploads",
        "unavailable",
        uploadGateRef.current.reason ?? labels.error,
      );
    }
    if (files.length && coreFileStorageSetup) {
      const status = await requestCoreAttachment();
      if (status !== "ready") {
        throw new Error(
          composerTranslate(
            status === "missing"
              ? "onboarding.fileStorage.title"
              : "onboarding.fileStorage.statusUnavailable",
          ),
        );
      }
    }
    if (!editingMessage && onSubmitOverride) {
      const readinessEngine = options.engine ?? selectedEngine;
      await controller.assertAiSetupReady({
        engine:
          typeof readinessEngine === "string" ? readinessEngine : undefined,
      });
      const submitOptions = {
        ...(suggestion ? { ...options, suggestion } : options),
        onLocalSubmit,
      };
      await onSubmitOverride(text, files, references, submitOptions);
      return;
    }
    const effort = options.effort;
    const executionMode = options.requestMode ?? "act";
    const contextItemsForSubmission = options.contextItems ?? contextItems;
    // A fork resends the edited message as a new request.
    const editedMetadata = { ...editingMessage?.metadata };
    delete editedMetadata[AGENTKIT_CLIENT_REQUEST_ID_METADATA_KEY];
    const metadata = {
      ...editedMetadata,
      ...(options.submissionId
        ? { [AGENTKIT_CLIENT_REQUEST_ID_METADATA_KEY]: options.submissionId }
        : {}),
      ...(suggestion ? { suggestion } : {}),
      ...(contextItemsForSubmission === undefined
        ? {}
        : { contextItems: contextItemsForSubmission }),
      ...(references.length ? { references } : {}),
      ...(options.engine ? { engine: options.engine } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(effort ? { effort } : {}),
      ...(selectedAgent ? { agentId: selectedAgent } : {}),
      mode: executionMode,
      requestMode: executionMode,
    };
    const runOptions: AgentRunOptions = {
      ...(selectedAgent ? { agentId: selectedAgent } : {}),
      model: options.model,
      mode: executionMode,
      reasoningEffort:
        effort && !["auto", "max"].includes(effort)
          ? (effort as AgentRunOptions["reasoningEffort"])
          : undefined,
      metadata,
    };
    const uploadFiles = files.map((file: PromptComposerFile) => ({
      name: file.name,
      mediaType: file.type || "application/octet-stream",
      size: file.size,
      body: file,
    }));

    if (editingMessage) {
      if (!onThreadForked) {
        throw new Error(labels.navigationUnavailable);
      }
      const previousMessage = findPreviousMessage(
        thread.messages,
        editingMessage.id,
      );
      if (previousMessage === null) {
        throw new Error(labels.messageUnavailable);
      }
      const selectedEngine = metadata.engine ?? runOptions.metadata?.engine;
      await controller.assertAiSetupReady({
        engine: typeof selectedEngine === "string" ? selectedEngine : undefined,
      });
      const forkedThread = await controller.forkThread(
        threadId,
        previousMessage?.id,
      );
      submitFailureDraftScopeRef.current = `agentkit:${forkedThread.id}`;
      onThreadForked(forkedThread);
      const uploadedAttachments = uploadFiles.length
        ? await controller.uploadFiles(forkedThread.id, uploadFiles)
        : [];
      const previousAttachments = editingMessage.parts.filter(
        (part): part is Extract<AgentMessagePart, { type: "file" }> =>
          part.type === "file" && !part.omitted,
      );
      const draft = createAgentKitComposerSubmission({
        threadId: forkedThread.id,
        intent: "immediate",
        text,
        composerModeContext: options.composerModeContext,
        contextItems: contextItemsForSubmission,
        references,
        options: runOptions,
      });
      const payload = Object.freeze({
        ...draft,
        attachments: snapshotComposerValue([
          ...previousAttachments,
          ...uploadedAttachments,
        ]),
      });
      await beforeSend?.(payload);
      const sendMetadata = {
        ...payload.options.metadata,
        ...(payload.references.length
          ? { references: payload.references }
          : {}),
        ...(payload.contextItems === undefined
          ? {}
          : { contextItems: payload.contextItems }),
      };
      await controller.sendMessage({
        threadId: forkedThread.id,
        text: payload.text,
        attachments: [...payload.attachments],
        ...(payload.references.length
          ? { references: [...payload.references] }
          : {}),
        options: payload.options,
        metadata: sendMetadata,
        onLocalSubmit,
      });
      submitFailureDraftScopeRef.current = null;
      editContext?.setMessage(null);
      return;
    }
    const submissionThread = controller.getThread(threadId);
    const activeAtSubmit = hasActiveRuns(submissionThread);
    const draft = createAgentKitComposerSubmission({
      threadId,
      intent:
        canQueue &&
        (options.intent === "queued" || (activeAtSubmit && queueWhileRunning))
          ? "queued"
          : "immediate",
      text,
      composerModeContext: options.composerModeContext,
      contextItems: contextItemsForSubmission,
      references,
      options: runOptions,
    });
    const attachments = uploadFiles.length
      ? await control.uploadFiles(uploadFiles)
      : [];
    const payload = Object.freeze({
      ...draft,
      attachments: snapshotComposerValue(attachments),
    });
    await beforeSend?.(payload);
    assertSuggestionCurrent();
    const sendMetadata = {
      ...payload.options.metadata,
      ...(payload.references.length ? { references: payload.references } : {}),
      ...(payload.contextItems === undefined
        ? {}
        : { contextItems: payload.contextItems }),
    };
    const message = {
      text: payload.text,
      attachments: [...payload.attachments],
      ...(payload.references.length
        ? { references: [...payload.references] }
        : {}),
      options: payload.options,
      metadata: sendMetadata,
      queueWhileRunning,
      ...(options.steer ? { deliverInActiveRun: true } : {}),
      onLocalSubmit,
    };
    await control.sendMessage({
      ...message,
      queuedWhileRunActive: activeAtSubmit || payload.intent === "queued",
    });
  };
  const startPendingSubmission: PromptComposerProps["onSubmitStart"] = (
    submission,
  ) => {
    if (
      disabled ||
      editingMessage ||
      submission.intent === "queued" ||
      agentKitTurnInProgress(controller, threadId)
    )
      return undefined;
    const files = pendingSubmissionFiles(submission.attachments);
    return beginPendingSubmission(
      threadId,
      {
        text: submission.text,
        attachments: files.attachments,
        references: submission.references,
      },
      { release: files.release, adoptable: true },
    );
  };
  const prepareHostSubmit = () => {
    if (disabled) {
      onDisabledClick?.();
      return false;
    }
    if (submissionDisabled) return false;
    return true;
  };
  const sendQueued =
    (options: Parameters<typeof control.steerQueued>[1]) =>
    (item: { id: string }) =>
      void command
        .execute(async () => {
          if (!(await prepareHostSubmit())) return;
          await control.steerQueued(item.id, options);
        })
        .catch(() => undefined)
        .finally(focusComposer);
  // Send now goes into the running turn at its next step; only Stop and send
  // cuts the current response off.
  const steerQueued: AgentKitQueueRenderProps["onSteer"] =
    !disabled && !submissionDisabled
      ? sendQueued({ deliverInActiveRun: true })
      : undefined;
  const stopAndSendQueued =
    !disabled && !submissionDisabled && active
      ? sendQueued({ interruptActiveRun: true })
      : undefined;
  const supportsQueueReordering =
    controller.supportsQueuedMessageReordering?.() ?? false;
  const supportsQueueOrdering =
    controller.supportsQueuedMessageOrdering?.() ?? false;
  const moveQueuedToTop = useAgentKitMutation(
    (messageId: string) => control.moveQueuedMessageToTop(messageId),
    `${threadId}:move-queued-to-top`,
  );
  const removeQueued: AgentKitQueueRenderProps["onRemove"] = (item) =>
    void command
      .execute(() => control.removeQueued(item.id))
      .catch(() => undefined)
      .finally(focusComposer);
  const selectSuggestion: AgentKitSuggestionsRenderProps["onSelect"] = (
    suggestion,
  ) => {
    if (
      disabled ||
      suggestionSubmitBlocked ||
      !suggestionsCapability.enabled ||
      selectedSuggestionRef.current ||
      !isCurrentAgentSuggestion(controller.getThread(threadId), suggestion)
    )
      return;
    const composer = composerRef.current;
    if (!composer) return;
    selectedSuggestionRef.current = suggestion;
    void composer
      .submitWithText(agentSuggestionPrompt(suggestion))
      .catch(() => undefined)
      .finally(() => {
        if (selectedSuggestionRef.current === suggestion)
          selectedSuggestionRef.current = undefined;
        focusComposer();
      });
  };
  const Queue = slots.queue;
  const Suggestions = slots.suggestions;
  const suggestions = selectAgentSuggestions(thread);
  return (
    <ComposerNoticeScope>
      <div
        ref={storageAnchorRef}
        className={`agentkit-composer-stack ${className ?? ""}`}
      >
        {coreFileStorageSetup && canUpload && (
          <>
            <coreFileStorageSetup.Setup
              open={storageOpen}
              anchorRef={storageAnchorRef}
              onOpenChange={(open) => {
                changeStorageOpen(open);
                if (!open) composerRef.current?.focus();
              }}
              onConnected={() => {
                void requestCoreAttachment();
              }}
              {...(storageState === "unavailable"
                ? {
                    status: "unavailable" as const,
                    onRetry: () => {
                      void requestCoreAttachment();
                    },
                  }
                : { status: "missing" as const })}
            />
            {storageState === "pending" && (
              <span role="status" className="text-sm text-foreground">
                {composerTranslate("agentChat.common.loading", {
                  defaultValue: "Loading...",
                })}
              </span>
            )}
          </>
        )}
        {announcePendingSubmission && submissionPending ? (
          <span
            className="agentkit-visually-hidden"
            role="status"
            aria-live="polite"
          >
            {labels.activityBuckets?.thinking ?? labels.reasoning}
          </span>
        ) : null}
        {queueCapability.visible ? (
          Queue ? (
            <Queue
              items={thread.queuedMessages.map((message) => {
                const metadata = stripAgentContextMetadata(message.metadata);
                return {
                  ...message,
                  text: splitAgentKitMessageContext(message.text).message,
                  ...(metadata ? { metadata } : {}),
                };
              })}
              threadId={threadId}
              active={active}
              pending={command.pending || send.pending || Boolean(disabled)}
              {...(steerQueued ? { onSteer: steerQueued } : {})}
              onRemove={removeQueued}
            />
          ) : (
            <MessageQueueDrawer
              variant="recessed"
              items={thread.queuedMessages.map((message) => ({
                id: message.id,
                text: splitAgentKitMessageContext(message.text).message,
                images: (message.attachments ?? []).flatMap((attachment) => {
                  if (!attachment.mediaType?.startsWith("image/")) return [];
                  const src = safeAgentImageSrc(attachment.url);
                  return src ? [src] : [];
                }),
                ...(message.delivery === "after_reply"
                  ? { status: "after-reply" as const }
                  : message.delivery === "steering" && active
                    ? { status: "sending" as const }
                    : {}),
              }))}
              {...(stopAndSendQueued
                ? { onStopAndSend: stopAndSendQueued }
                : {})}
              disabled={command.pending || send.pending || Boolean(disabled)}
              // The drawer keeps the new order while this settles and rolls
              // back with its own notice when it rejects.
              {...(supportsQueueOrdering
                ? {
                    onReorder: (messageIds) =>
                      control.reorderQueuedMessages(messageIds),
                  }
                : {})}
              {...(steerQueued
                ? {
                    onSteer: (item) => {
                      const message = thread.queuedMessages.find(
                        (candidate) => candidate.id === item.id,
                      );
                      if (message) steerQueued(message);
                    },
                  }
                : {})}
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
                sendNow: labels.queueSendNow,
                sendNowHint: labels.queueSendNowHint,
                remove: labels.queueRemove,
                moreActions: labels.queueMore,
              }}
              {...(supportsQueueReordering
                ? {
                    getItemActions: (item) => {
                      if (item.id === thread.queuedMessages[0]?.id) return [];

                      return [
                        {
                          id: "move-to-top",
                          label: labels.queueSendNext,
                          hint: labels.queueSendNextHint,
                          disabled: moveQueuedToTop.pending,
                          onSelect: (selected) =>
                            void command
                              .execute(() =>
                                moveQueuedToTop.execute(selected.id),
                              )
                              .catch(() => undefined),
                        },
                      ];
                    },
                  }
                : {})}
            />
          )
        ) : null}
        {suggestionsCapability.enabled &&
        !disabled &&
        !editingMessage &&
        suggestions.length ? (
          Suggestions ? (
            <Suggestions
              suggestions={suggestions}
              threadId={threadId}
              pending={suggestionSubmitBlocked}
              onSelect={selectSuggestion}
            />
          ) : (
            // A fixed single line: a wrapped second line would grow the footer
            // and push the transcript up again.
            <div
              className="agentkit-suggestions-row"
              data-agentkit-suggestions-row="true"
            >
              <AgentSuggestionBar
                suggestions={suggestions.map((suggestion) => ({
                  ...suggestion,
                  disabled: suggestionSubmitBlocked || Boolean(disabled),
                }))}
                ariaLabel={labels.suggestions}
                title={labels.suggestedActions}
                onSelect={selectSuggestion}
                className="agentkit-suggestions py-0"
                layout="single-line"
              />
            </div>
          )
        ) : null}
        <PromptComposer
          {...definedProps({
            contextItems,
            onRemoveContextItem,
            onInspectContextItem,
            onRetryContextItem,
            onPasteContext,
            contextMenuItems,
            inlineTextAttachments,
            disabled,
            isReferenceTarget,
            onDisabledClick,
            onSetupCardClick,
            onConnectProvider,
            onConnectLocalRuntime,
            imageModelMenu,
            autoFocus,
            composerRef,
            availableModels,
            modelListLoading,
            selectedModel,
            selectedEngine,
            selectedEffort,
            onModelChange,
            onEffortChange,
            availableAgents,
            selectedAgent,
            agentOnly,
            onAgentChange,
            onModelSelectorOpenChange,
            modelStatusChecksEnabled,
            requireAgentEngine,
            showMissingApiKeySetup,
            setupCardVisible,
            onModelConnectionRequiredChange,
            contextUsageSlot,
            layoutVariant,
            toolbarSlot,
            onTextChange,
            extraActionButton,
            getSubmitFailureDraftScope,
            interceptBuildRequestsForBuilder,
            onAttachmentRequest,
            contextButtonTooltipDisabled,
            slashCommands,
            slashSkills,
            onSlashCommand,
            voiceEnabled,
            onVoiceChatStart,
            replyPlaceholder: placeholder ?? labels.composerReplyPlaceholder,
            onEscape: editingMessage ? cancelEditing : undefined,
            initialText: composerInitialText,
            initialTextKey: composerInitialTextKey,
          })}
          attachmentAdapter={composerAttachmentAdapter}
          rootClassName="agentkit-composer"
          className={
            queueCapability.visible && thread.queuedMessages.length > 0
              ? "agent-composer-area--attached-above px-0"
              : "px-0"
          }
          draftScope={`agentkit:${threadId}${editingMessage ? `:edit:${editingMessage.id}` : ""}`}
          ariaLabel={labels.composerLabel}
          // A host placeholder (run state, setup) wins in both states; the
          // labels pick between a new chat and a reply.
          placeholder={placeholder ?? labels.composerPlaceholder}
          conversationStarted={thread.messages.length > 0}
          onRecallLastMessage={recallLastMessage}
          submissionDisabled={submissionBlocked}
          willQueue={active && queueWhileRunning && canQueue}
          queuesBehindSubmission={queueWhileRunning && canQueue}
          onEmptySubmit={() => {
            const next = thread.queuedMessages.at(0);
            if (next) steerQueued?.(next);
          }}
          showModelSelector={showModelSelector && canSelectModel}
          headerSlot={editingRow}
          sendButtonDisabled={submissionPending && !active}
          onSubmissionPendingChange={handleSubmissionPendingChange}
          onSubmitStart={startPendingSubmission}
          clearOnSubmitImmediately
          onAttachmentError={reportAttachmentError}
          planCommand={!planModeDisabled}
          stopButton={stopButton === undefined ? defaultStopButton : stopButton}
          noticeOutlet
          attachmentsEnabled={canUpload}
          onAttachmentRequest={onAttachmentRequest}
          contextButtonTooltipDisabled={
            contextButtonTooltipDisabled || storageOpen
          }
          includeDefaultSlashCommands={includeDefaultSlashCommands ?? false}
          includeDefaultSlashSkills={includeDefaultSlashSkills ?? false}
          plusMenuMode={plusMenuMode ?? "full"}
          onSubmit={async (text, files, references, options) => {
            if (disabled) {
              onDisabledClick?.();
              return;
            }
            followTranscript();
            focusComposer();
            setAttachmentError(null);
            setStopError(null);
            if (command.error) command.reset();
            try {
              await send.execute(async () => {
                await submitMessage(
                  text,
                  files,
                  references,
                  options,
                  selectedSuggestionRef.current,
                );
              });
            } finally {
              focusComposer();
            }
          }}
        />
        {sendOrCommandError && !connectionCoversCommandError ? (
          <ComposerNotice
            role="alert"
            noticeId="submit"
            onDismiss={resetSendOrCommandError}
            dismissLabel={labels.dismissNotice}
          >
            <span {...SESSION_REPLAY_MASK_PROPS}>
              {formatUploadError(sendOrCommandError)}
            </span>
          </ComposerNotice>
        ) : null}
        {attachmentError ? (
          <ComposerNotice
            role="alert"
            noticeId="attachment"
            onDismiss={() => setAttachmentError(null)}
            dismissLabel={labels.dismissNotice}
          >
            <span {...SESSION_REPLAY_MASK_PROPS}>{attachmentError}</span>
          </ComposerNotice>
        ) : null}
        {stopError && stopButton === undefined ? (
          <ComposerNotice
            role="alert"
            noticeId="stop"
            onDismiss={() => setStopError(null)}
            dismissLabel={labels.dismissNotice}
          >
            <span {...SESSION_REPLAY_MASK_PROPS}>{stopError}</span>
          </ComposerNotice>
        ) : null}
      </div>
    </ComposerNoticeScope>
  );
}

export interface AgentKitChatProps {
  title?: ReactNode;
  toolbar?: ReactNode;
  composer?: boolean;
  /** Configures the reference composer without replacing its slot. */
  composerProps?: Omit<AgentKitComposerProps, "threadId">;
  /** Marks conversations with messages supplied by a custom transcript slot. */
  hasRenderedMessages?: boolean;
  /** New conversations center the composer; embedded panels can anchor it. */
  emptyComposerPlacement?: "center" | "bottom";
  /** Follow new output until the user deliberately scrolls away. */
  autoScroll?: boolean;
  /** Hold a sent message near the top while its reply streams; `false` follows the bottom. */
  anchorTurns?: boolean;
  /** Optional transcript geometry. Omitted values keep the shared defaults. */
  transcriptLayout?: AgentChatTranscriptLayout;
  /**
   * Whether the host expects this thread to exist already. A load can't tell a
   * deleted thread from a new one: `true` shows the transcript skeleton while
   * the thread loads and the unavailable state when it is missing. Leaving it
   * unset or `false` shows the empty state immediately, so new chats never
   * flash a skeleton before centering the composer.
   */
  expectExistingThread?: boolean;
  /** Offered from the unavailable state when a thread no longer exists. */
  onStartNewChat?: () => void;
  className?: string;
}

type AgentKitTranscriptContentStyle = CSSProperties & {
  "--agentkit-transcript-top-inset"?: string | undefined;
  "--agentkit-transcript-message-gap"?: string | undefined;
  "--agentkit-transcript-message-line-height"?: string | undefined;
  "--agentkit-transcript-font-family"?: string | undefined;
  "--agentkit-transcript-post-widget-text-color"?: string | undefined;
  "--agentkit-transcript-post-widget-paragraph-padding-block"?:
    | string
    | undefined;
  "--agentkit-user-bubble-line-height"?: string | undefined;
  "--agentkit-user-bubble-max-width"?: string | undefined;
  "--agentkit-user-bubble-offset-inline"?: string | undefined;
  "--agentkit-user-bubble-padding-block"?: string | undefined;
  "--agentkit-user-bubble-padding-inline"?: string | undefined;
};

type AgentKitChatLaneStyle = CSSProperties & {
  "--agentkit-transcript-lane-width"?: string;
  "--agentkit-transcript-lane-offset-inline"?: string;
};

function transcriptLength(value: number | undefined, name: string) {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `transcriptLayout.${name} must be a non-negative number`,
    );
  }
  return `${value}px`;
}

function transcriptOffset(value: number | undefined, name: string) {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) {
    throw new RangeError(`transcriptLayout.${name} must be a finite number`);
  }
  return `${value}px`;
}

// The lane sits on the chat section so the transcript and the composer share
// one column; the composer is outside the transcript content.
function chatLaneStyle(
  layout?: AgentChatTranscriptLayout,
): AgentKitChatLaneStyle | undefined {
  if (!layout) return undefined;
  return {
    "--agentkit-transcript-lane-width": transcriptLength(
      layout.messageLaneWidth,
      "messageLaneWidth",
    ),
    "--agentkit-transcript-lane-offset-inline": transcriptOffset(
      layout.messageLaneOffsetInline,
      "messageLaneOffsetInline",
    ),
  };
}

function transcriptContentStyle(
  layout?: AgentChatTranscriptLayout,
): AgentKitTranscriptContentStyle | undefined {
  if (!layout) return undefined;
  return {
    "--agentkit-transcript-top-inset": transcriptLength(
      layout.topInset,
      "topInset",
    ),
    "--agentkit-transcript-message-gap": transcriptLength(
      layout.messageGap,
      "messageGap",
    ),
    "--agentkit-transcript-message-line-height": transcriptLength(
      layout.messageLineHeight,
      "messageLineHeight",
    ),
    "--agentkit-transcript-font-family": layout.fontFamily,
    "--agentkit-transcript-post-widget-text-color":
      layout.postWidgetText?.tone === "muted"
        ? "var(--agentkit-text-muted)"
        : undefined,
    "--agentkit-transcript-post-widget-paragraph-padding-block":
      transcriptLength(
        layout.postWidgetText?.paragraphPaddingBlock,
        "postWidgetText.paragraphPaddingBlock",
      ),
    "--agentkit-user-bubble-line-height": transcriptLength(
      layout.userBubbleLineHeight,
      "userBubbleLineHeight",
    ),
    "--agentkit-user-bubble-max-width": transcriptLength(
      layout.userBubbleMaxWidth,
      "userBubbleMaxWidth",
    ),
    "--agentkit-user-bubble-offset-inline": transcriptOffset(
      layout.userBubbleOffsetInline,
      "userBubbleOffsetInline",
    ),
    "--agentkit-user-bubble-padding-block": transcriptLength(
      layout.userBubblePadding?.block,
      "userBubblePadding.block",
    ),
    "--agentkit-user-bubble-padding-inline": transcriptLength(
      layout.userBubblePadding?.inline,
      "userBubblePadding.inline",
    ),
  };
}

const AGENTKIT_TRANSCRIPT_BOTTOM_THRESHOLD = 24;
const AGENTKIT_INITIAL_HISTORY_ROWS = 20;
const AGENTKIT_HISTORY_ROW_CHUNK = 16;
const AGENTKIT_TRANSCRIPT_SCROLLBAR_IDLE_MS = 900;
/** Outlasts the reveal's bounded drain after a run ends. */
const AGENTKIT_TRANSCRIPT_GLIDE_AFTER_RUN_MS = 2_000;
/** How much of the previous turn shows above an anchored message. */
const AGENTKIT_TURN_ANCHOR_PEEK_PX = 32;
const AGENTKIT_TRANSCRIPT_SCROLL_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " ",
]);
// Long enough for a screen reader to finish speaking between step names.
const AGENTKIT_ACTIVITY_ANNOUNCE_INTERVAL_MS = 10_000;

export function isAgentKitTranscriptNearBottom(
  element: Pick<HTMLElement, "clientHeight" | "scrollHeight" | "scrollTop">,
  threshold = AGENTKIT_TRANSCRIPT_BOTTOM_THRESHOLD,
) {
  return (
    element.scrollHeight - element.clientHeight - element.scrollTop <= threshold
  );
}

/** Layout-matching placeholder for a conversation whose history is loading. */
export function AgentKitTranscriptSkeleton({
  label = defaultAgentKitLabels.loadingConversation,
  className,
}: {
  /** Announced to screen readers; defaults to the English loading label. */
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={`agentkit-transcript-skeleton ${className ?? ""}`}
      role="status"
      aria-busy="true"
    >
      <span className="agentkit-visually-hidden">{label}</span>
      <div className="agentkit-transcript-skeleton-user" aria-hidden="true">
        <Skeleton className="agentkit-transcript-skeleton-bubble ms-auto h-11 w-2/5 rounded-[var(--agent-kit-radius-sm,0.5rem)]" />
      </div>
      <div
        className="agentkit-transcript-skeleton-assistant"
        aria-hidden="true"
      >
        <Skeleton className="agentkit-transcript-skeleton-line h-4 w-full" />
        <Skeleton className="agentkit-transcript-skeleton-line h-4 w-11/12" />
        <Skeleton className="agentkit-transcript-skeleton-line h-4 w-3/5" />
      </div>
    </div>
  );
}

function AgentThreadUnavailable({
  onStartNewChat,
}: {
  onStartNewChat?: (() => void) | undefined;
}) {
  const { labels } = useAgentKit();
  return (
    <div className="agentkit-thread-unavailable" role="status">
      <p>{labels.threadUnavailable}</p>
      {onStartNewChat ? (
        <ActionButton
          emphasis="outline"
          size="compact"
          onPress={onStartNewChat}
        >
          {labels.newChat}
        </ActionButton>
      ) : null}
    </div>
  );
}

function AgentThreadLoadFailed({
  retry,
  retrying,
  retryError,
}: {
  retry: () => void;
  retrying: boolean;
  retryError?: Error | undefined;
}) {
  const { labels } = useAgentKit();
  return (
    <div
      className="agentkit-thread-unavailable"
      data-load-status="failed"
      role="alert"
    >
      <IconAlertTriangle
        aria-hidden="true"
        className="agentkit-icon"
        style={{ color: "var(--agentkit-warning)" }}
      />
      <p>{labels.threadLoadFailed}</p>
      <ActionButton
        emphasis="outline"
        size="compact"
        pending={retrying}
        onPress={retry}
      >
        {labels.threadLoadRetry}
      </ActionButton>
      {retryError ? (
        <span
          {...SESSION_REPLAY_MASK_PROPS}
          className="agentkit-command-error"
          role="alert"
        >
          {retryError.message}
        </span>
      ) : null}
    </div>
  );
}

function latestRunId(thread: AgentThreadState): RunId | undefined {
  const active = thread.activeRunIds.at(-1);
  if (active) return active;
  let latest: { id: RunId; startedAt: string } | undefined;
  for (const run of Object.values(thread.runs)) {
    if (run.startedAt && (!latest || run.startedAt > latest.startedAt)) {
      latest = { id: run.id, startedAt: run.startedAt };
    }
  }
  return latest?.id ?? thread.events.at(-1)?.runId;
}

function currentRunActivityLabel(
  thread: AgentThreadState,
  runId: RunId,
  labels: ReturnType<typeof useAgentKit>["labels"],
): string {
  const runEvents = agentRunEvents(thread, runId);
  for (const event of [...runEvents].reverse()) {
    if (
      event.type === "activity.started" ||
      event.type === "activity.updated"
    ) {
      const activity = thread.activities[event.activity.id] ?? event.activity;
      if (
        activity.status === "running" &&
        !activity.id.startsWith("agentkit:internal:")
      ) {
        return activityLabel(activity, labels.working);
      }
    }
    if (event.type === "tool.started" || event.type === "tool.updated") {
      const tool = thread.tools[event.toolCall.id] ?? event.toolCall;
      if (tool.status === "running") {
        return activityLabel(toolToActivity(tool, labels), labels.working);
      }
    }
  }
  return labels.working;
}

// A run that stops to wait on the user is as much news as one that ends.
const RUN_STATUS_ANNOUNCEMENTS: Partial<
  Record<
    string,
    | "responseReady"
    | "responseFailed"
    | "runStopped"
    | "waitingForApproval"
    | "waitingForInput"
  >
> = {
  completed: "responseReady",
  failed: "responseFailed",
  cancelled: "runStopped",
  awaiting_approval: "waitingForApproval",
  awaiting_input: "waitingForInput",
};

/**
 * One polite status region for the whole chat. The transcript itself stays
 * aria-live="off": streamed text would otherwise be read token by token.
 */
function AgentKitLiveStatus({ threadId }: { threadId: string }) {
  const { labels } = useAgentKit();
  const thread = useAgentThread(threadId);
  const runId = latestRunId(thread);
  const run = runId ? thread.runs[runId] : undefined;
  const status = run?.status;
  // A failure with an error has its own alert; announcing it here reads it twice.
  const failureHasAlert = status === "failed" && Boolean(run?.error);
  const running = status === "running";
  const activityText =
    running && runId ? currentRunActivityLabel(thread, runId, labels) : "";
  const [announcement, setAnnouncement] = useState("");
  const lastAnnouncedAtRef = useRef(0);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const observedRef = useRef<{
    runId?: RunId | undefined;
    status?: string | undefined;
  }>({});
  useEffect(
    () => () => {
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    },
    [],
  );
  useEffect(() => {
    const previous = observedRef.current;
    observedRef.current = { runId, status };
    if (!runId || previous.runId !== runId || previous.status === status) {
      return;
    }
    const announced = status ? RUN_STATUS_ANNOUNCEMENTS[status] : undefined;
    if (!announced) return;
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = undefined;
    lastAnnouncedAtRef.current = Date.now();
    // Cleared rather than left on the last step name, which is stale now.
    setAnnouncement(failureHasAlert ? "" : labels[announced]);
  }, [failureHasAlert, labels, runId, status]);
  useEffect(() => {
    if (!activityText) return;
    const announce = () => {
      pendingTimerRef.current = undefined;
      lastAnnouncedAtRef.current = Date.now();
      setAnnouncement(activityText);
    };
    const wait =
      lastAnnouncedAtRef.current +
      AGENTKIT_ACTIVITY_ANNOUNCE_INTERVAL_MS -
      Date.now();
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    if (wait <= 0) announce();
    else pendingTimerRef.current = setTimeout(announce, wait);
  }, [activityText]);
  return (
    <div
      className="agentkit-visually-hidden"
      role="status"
      aria-live="polite"
      data-agentkit-live-status="true"
    >
      {announcement}
    </div>
  );
}

function isTerminalRunStatus(status: string | undefined): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

export interface AgentKitEmptyStateProps {
  text: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** The default empty state: a visible greeting, then optional starters. */
export function AgentKitEmptyState({
  text,
  children,
  className,
}: AgentKitEmptyStateProps) {
  return (
    <div
      className={`agentkit-empty-state ${className ?? ""}`}
      data-agentkit-empty-state="true"
    >
      <p className="agentkit-empty-state-greeting">{text}</p>
      {children}
    </div>
  );
}

export function AgentKitChat({
  title,
  toolbar,
  composer = true,
  composerProps,
  hasRenderedMessages = false,
  emptyComposerPlacement = "center",
  autoScroll = true,
  anchorTurns = true,
  transcriptLayout,
  expectExistingThread,
  onStartNewChat,
  className,
}: AgentKitChatProps) {
  const {
    controller,
    threadId,
    slots,
    registry,
    labels,
    onThreadForked,
    threadLoad,
    formatWorkedForDuration,
    requestComposerFocus,
  } = useAgentKit();
  const formatReasoningDuration = (ms: number) =>
    formatWorkedForDuration?.(ms) ??
    formatAgentKitDuration(ms, {
      hour: labels.durationHourShort,
      minute: labels.durationMinuteShort,
      second: labels.durationSecondShort,
    });
  const connection = useAgentConnection();
  const loadStatus = useAgentThreadLoadStatus(threadId);
  const uploadsCapability = useAgentCapability("uploads");
  const control = useAgentKitControl(threadId);
  const recovery = useAgentKitMutation(() => control.load(), threadId);
  const thread = useAgentThread(threadId);
  const pendingSubmissions = useAgentKitPendingSubmissions(threadId);
  const [pendingEdit, setPendingEdit] = useState<{
    threadId: string;
    message: AgentMessage;
  } | null>(null);
  const editingMessage =
    pendingEdit?.threadId === threadId ? pendingEdit.message : null;
  const setEditingMessage = useCallback(
    (message: AgentMessage | null) => {
      setPendingEdit(message ? { threadId, message } : null);
    },
    [threadId],
  );
  const messageEditEnabled = composer && Boolean(onThreadForked);
  const messageEditContext = useMemo<AgentMessageEditContextValue>(
    () => ({
      enabled: messageEditEnabled,
      message: editingMessage,
      setMessage: setEditingMessage,
    }),
    [editingMessage, messageEditEnabled, setEditingMessage],
  );
  const [messageWorkHosts] = useState(createAgentMessageWorkHosts);
  const [openedWorkRows] = useState(() => new Set<string>());
  const hasConversation =
    thread.messages.length > 0 ||
    pendingSubmissions.length > 0 ||
    hasRenderedMessages;
  const threadSettled = hasConversation || thread.thread !== undefined;
  const threadLoading =
    !threadSettled &&
    expectExistingThread === true &&
    (loadStatus === undefined
      ? connection.status === "connecting"
      : loadStatus === "pending");
  const threadMissing =
    !threadSettled && expectExistingThread === true && loadStatus === "missing";
  const threadLoadFailed =
    !threadSettled && expectExistingThread === true && loadStatus === "failed";
  // The root re-runs its own load; a host-tracked load without a retry falls
  // back to reloading through the controller.
  const hostLoadRetry =
    threadLoad?.threadId === threadId ? threadLoad.retry : undefined;
  const showEmptyState =
    !hasConversation && !threadLoading && !threadMissing && !threadLoadFailed;
  // The header row exists from the empty state on, so the first send never
  // pushes the transcript down; the title waits for a conversation.
  const hasHeader = Boolean(title || toolbar);
  const showTitle = hasConversation && Boolean(title);
  const Message = slots.message ?? AgentMessageView;
  const EmptyState = slots.emptyState;
  const ThreadUnavailable = slots.threadUnavailable;
  const Composer = slots.composer ?? AgentKitComposer;
  const approvalEntries = Object.entries(thread.approvals);
  const connectionRequestEntries = Object.entries(
    thread.connectionRequests ?? {},
  );
  const ErrorState = slots.connectionError ?? AgentConnectionErrorView;
  const RunFailure = slots.runFailure ?? AgentRunFailure;
  const Approval = slots.approval;
  const ConnectionRequest = slots.connectionRequest;
  const Header = slots.header;
  const Toolbar = slots.toolbar;
  const Transcript = slots.transcript;
  const Footer = slots.footer;
  const transcriptRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = transcriptRef.current;
    if (!threadId || !element) return;
    return registerChatThreadView(threadId, element);
  }, [threadId]);
  useRealtimeVoiceTranscripts(controller, threadId, hasActiveRuns(thread));
  const transcriptContentRef = useRef<HTMLDivElement>(null);
  const turnSpacerRef = useRef<HTMLDivElement>(null);
  // Set by a message sent in this thread; a thread that opens has no anchor.
  const turnAnchoredRef = useRef(false);
  const fileDragDepthRef = useRef(0);
  const followsTranscriptRef = useRef(true);
  const programmaticScrollTopRef = useRef<number | undefined>(undefined);
  const lastScrollTopRef = useRef(0);
  const transcriptThreadIdRef = useRef(threadId);
  const previousLastMessageIdRef = useRef<string | undefined>(undefined);
  const transcriptFollowFrameRef = useRef<number | undefined>(undefined);
  const transcriptGlideRef = useRef<{
    element: HTMLDivElement;
    glide: TranscriptGlide;
  } | null>(null);
  // Growth glides while a run streams and while its reveal drains after it.
  const transcriptGlidesUntilRef = useRef(0);
  const transcriptStreaming = hasActiveRuns(thread);
  const prefersReducedMotion = usePrefersReducedMotion();
  const prefersReducedMotionRef = useRef(prefersReducedMotion);
  prefersReducedMotionRef.current = prefersReducedMotion;
  const transcriptScrollbarInteractionRef = useRef(false);
  const transcriptScrollbarTimeoutRef = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const [transcriptScrollbarVisible, setTranscriptScrollbarVisible] =
    useState(false);
  const [transcriptAwayFromBottom, setTranscriptAwayFromBottom] =
    useState(false);
  const [fileDragActive, setFileDragActive] = useState(false);
  const lastMessage = thread.messages.at(-1);
  const lastEventId = thread.events.at(-1)?.id;
  const connectionError =
    connection.status === "error" ? connection.error : undefined;
  // A connection error is controller-wide, but its notice belongs to the
  // thread it surfaced on; switching threads or sending again clears it, and
  // the next failure is a new error object, so it shows again.
  const [connectionNotice, setConnectionNotice] = useState<{
    threadId: string;
    cleared?: AgentError | undefined;
  }>({ threadId });
  if (connectionNotice.threadId !== threadId) {
    setConnectionNotice({ threadId, cleared: connectionError });
  }
  const connectionErrorRef = useRef(connectionError);
  connectionErrorRef.current = connectionError;
  const clearConnectionNotice = useCallback(
    () =>
      setConnectionNotice((current) => ({
        ...current,
        cleared: connectionErrorRef.current,
      })),
    [],
  );
  const visibleConnectionError =
    connectionError &&
    connectionNotice.threadId === threadId &&
    connectionError !== connectionNotice.cleared &&
    // The failed-load view already offers the retry for this error.
    !(threadLoadFailed && connectionError.code === "thread_load_failed")
      ? connectionError
      : undefined;

  const canDropFiles =
    composer &&
    uploadsCapability.enabled &&
    composerProps?.attachmentsEnabled !== false;
  const hasFiles = (event: ReactDragEvent<HTMLElement>) =>
    Array.from(event.dataTransfer.types).includes("Files");
  const attachDroppedFiles = (files: File[]) => {
    if (!files.length) return;
    window.dispatchEvent(
      new CustomEvent("agentkit:attach-files", {
        detail: { threadId, files },
      }),
    );
  };
  const observeFileDrop = (nativeEvent: DragEvent, files: File[]) => {
    const eventPath = nativeEvent.composedPath();
    const lastPathTarget = eventPath.at(-1);
    let pending = true;
    const finishDrop = (dropEvent: Event) => {
      if (!pending) return;
      const reachedEnd = dropEvent.currentTarget === lastPathTarget;
      if (
        !dropEvent.defaultPrevented &&
        !dropEvent.cancelBubble &&
        !reachedEnd
      ) {
        return;
      }
      pending = false;
      for (const target of eventPath) {
        target.removeEventListener("drop", finishDrop);
      }
      if (dropEvent.defaultPrevented) return;
      dropEvent.preventDefault();
      attachDroppedFiles(files);
    };
    // Observe each path target so a stopped event can still be claimed there.
    for (const target of eventPath) {
      target.addEventListener("drop", finishDrop);
    }
  };
  const handleFileDragEnter = (event: ReactDragEvent<HTMLElement>) => {
    if (!canDropFiles || event.defaultPrevented || !hasFiles(event)) return;
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }
    event.preventDefault();
    fileDragDepthRef.current += 1;
    setFileDragActive(true);
  };
  const handleFileDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!canDropFiles || event.defaultPrevented || !hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setFileDragActive(true);
  };
  const handleFileDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    if (!canDropFiles || !hasFiles(event)) return;
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    setFileDragActive(fileDragDepthRef.current > 0);
  };
  const handleFileDropCapture = (event: ReactDragEvent<HTMLElement>) => {
    if (!canDropFiles || !hasFiles(event)) return;
    fileDragDepthRef.current = 0;
    setFileDragActive(false);
    if (event.defaultPrevented) return;
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) return;
    observeFileDrop(event.nativeEvent, files);
  };
  const handleFileDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (!canDropFiles || !hasFiles(event)) return;
    if (event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    attachDroppedFiles(Array.from(event.dataTransfer.files));
  };

  // Follow state changes on every scroll; it lives in a ref and is mirrored to
  // the DOM so styling can react without re-rendering the transcript.
  const setTranscriptFollow = useCallback((follow: boolean) => {
    followsTranscriptRef.current = follow;
    transcriptRef.current?.setAttribute(
      "data-follow",
      follow ? "true" : "false",
    );
  }, []);

  const writeTranscriptScrollTop = useCallback(
    (transcript: HTMLDivElement, scrollTop: number) => {
      programmaticScrollTopRef.current = scrollTop;
      lastScrollTopRef.current = scrollTop;
      transcript.scrollTop = scrollTop;
    },
    [],
  );

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

  // The spacer pads what the reply has not filled, so following the bottom holds
  // the sent message near the top. Sized imperatively so streaming never re-renders.
  const updateTurnSpacer = useCallback(() => {
    const transcript = transcriptRef.current;
    const content = transcriptContentRef.current;
    const spacer = turnSpacerRef.current;
    if (!transcript || !content || !spacer) return;
    // No stylesheet may size the spacer: its inline height is read back as-is.
    const current = Number.parseFloat(spacer.style.blockSize) || 0;
    const rows = content.querySelectorAll<HTMLElement>(
      '.agentkit-message[data-role="user"]',
    );
    const row = rows.length ? rows[rows.length - 1] : undefined;
    if (!anchorTurns || !turnAnchoredRef.current || !row) {
      if (current) spacer.style.blockSize = "";
      return;
    }
    const rowTop =
      row.getBoundingClientRect().top -
      transcript.getBoundingClientRect().top +
      transcript.scrollTop;
    const anchorTop = Math.max(0, rowTop - AGENTKIT_TURN_ANCHOR_PEEK_PX);
    const next = Math.max(
      0,
      Math.ceil(
        anchorTop +
          transcript.clientHeight -
          (transcript.scrollHeight - current),
      ),
    );
    if (next !== current) spacer.style.blockSize = next ? `${next}px` : "";
  }, [anchorTurns]);

  const scrollTranscriptToBottom = useCallback(() => {
    updateTurnSpacer();
    const transcript = transcriptRef.current;
    if (!autoScroll || !transcript || !followsTranscriptRef.current) return;
    const nextScrollTop = Math.max(
      0,
      transcript.scrollHeight - transcript.clientHeight,
    );
    if (Math.abs(transcript.scrollTop - nextScrollTop) <= 1) return;
    writeTranscriptScrollTop(transcript, nextScrollTop);
  }, [autoScroll, updateTurnSpacer, writeTranscriptScrollTop]);

  const stopTranscriptGlide = useCallback(() => {
    transcriptGlideRef.current?.glide.stop();
  }, []);

  // Streamed growth glides to the new bottom; anything else (opening a
  // thread, a long jump) lands there at once instead of gliding through it.
  const followTranscriptToBottom = useCallback(() => {
    updateTurnSpacer();
    const transcript = transcriptRef.current;
    if (!autoScroll || !transcript || !followsTranscriptRef.current) return;
    const distance =
      transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop;
    const glides =
      !prefersReducedMotionRef.current &&
      performance.now() < transcriptGlidesUntilRef.current &&
      distance <= transcript.clientHeight;
    if (!glides) {
      stopTranscriptGlide();
      scrollTranscriptToBottom();
      return;
    }
    if (transcriptGlideRef.current?.element !== transcript) {
      transcriptGlideRef.current?.glide.stop();
      transcriptGlideRef.current = {
        element: transcript,
        glide: new TranscriptGlide({
          // Size the spacer first so an anchored message holds still as the reply grows.
          element: {
            get scrollTop() {
              return transcript.scrollTop;
            },
            set scrollTop(value: number) {
              transcript.scrollTop = value;
            },
            get scrollHeight() {
              updateTurnSpacer();
              return transcript.scrollHeight;
            },
            get clientHeight() {
              return transcript.clientHeight;
            },
          },
          write: (scrollTop) => writeTranscriptScrollTop(transcript, scrollTop),
          following: () => followsTranscriptRef.current,
        }),
      };
    }
    transcriptGlideRef.current.glide.follow();
  }, [
    autoScroll,
    scrollTranscriptToBottom,
    stopTranscriptGlide,
    updateTurnSpacer,
    writeTranscriptScrollTop,
  ]);

  useEffect(() => {
    if (transcriptStreaming) {
      transcriptGlidesUntilRef.current = Infinity;
    } else if (transcriptGlidesUntilRef.current === Infinity) {
      transcriptGlidesUntilRef.current =
        performance.now() + AGENTKIT_TRANSCRIPT_GLIDE_AFTER_RUN_MS;
    }
  }, [transcriptStreaming]);

  const returnTranscriptToBottom = useCallback(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    stopTranscriptGlide();
    setTranscriptFollow(true);
    const nextScrollTop = Math.max(
      0,
      transcript.scrollHeight - transcript.clientHeight,
    );
    const reducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    programmaticScrollTopRef.current = nextScrollTop;
    if (typeof transcript.scrollTo === "function") {
      transcript.scrollTo({
        top: nextScrollTop,
        behavior: reducedMotion ? "auto" : "smooth",
      });
    } else {
      transcript.scrollTop = nextScrollTop;
    }
    setTranscriptAwayFromBottom(false);
  }, [setTranscriptFollow, stopTranscriptGlide]);

  const followTranscriptOnSubmit = useCallback(() => {
    clearConnectionNotice();
    if (!autoScroll) return;
    const transcript = transcriptRef.current;
    setTranscriptFollow(true);
    hideTranscriptScrollbar();
    setTranscriptAwayFromBottom(false);
    if (!transcript) return;
    writeTranscriptScrollTop(
      transcript,
      Math.max(0, transcript.scrollHeight - transcript.clientHeight),
    );
  }, [
    autoScroll,
    clearConnectionNotice,
    hideTranscriptScrollbar,
    setTranscriptFollow,
    writeTranscriptScrollTop,
  ]);

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
      followTranscriptToBottom();
    });
  }, [autoScroll, followTranscriptToBottom, scrollTranscriptToBottom]);

  useEffect(
    () => () => {
      clearTranscriptScrollbarTimeout();
      cancelScheduledTranscriptFollow();
      stopTranscriptGlide();
    },
    [
      cancelScheduledTranscriptFollow,
      clearTranscriptScrollbarTimeout,
      stopTranscriptGlide,
    ],
  );

  useLayoutEffect(() => {
    let jumps = false;
    if (transcriptThreadIdRef.current !== threadId) {
      transcriptThreadIdRef.current = threadId;
      previousLastMessageIdRef.current = undefined;
      turnAnchoredRef.current = false;
      transcriptGlidesUntilRef.current = 0;
      jumps = true;
      setTranscriptFollow(true);
      setTranscriptAwayFromBottom(false);
      hideTranscriptScrollbar();
    }
    const previousLastMessageId = previousLastMessageIdRef.current;
    previousLastMessageIdRef.current = lastMessage?.id;
    if (!autoScroll) return;
    if (
      lastMessage?.role === "user" &&
      lastMessage.id !== previousLastMessageId
    ) {
      jumps = true;
      // Only a send anchors: the first render of an opened thread is not one.
      if (previousLastMessageId !== undefined) turnAnchoredRef.current = true;
      setTranscriptFollow(true);
      hideTranscriptScrollbar();
    }
    if (jumps) {
      stopTranscriptGlide();
      scrollTranscriptToBottom();
    } else {
      followTranscriptToBottom();
    }
  }, [
    autoScroll,
    followTranscriptToBottom,
    hideTranscriptScrollbar,
    lastEventId,
    lastMessage?.id,
    lastMessage?.role,
    scrollTranscriptToBottom,
    setTranscriptFollow,
    stopTranscriptGlide,
    threadId,
  ]);

  // Anchor from the pending submission so the message never lands at the bottom first.
  const newestPendingSubmissionId = pendingSubmissions.at(-1)?.id;
  const previousPendingSubmissionIdRef = useRef(newestPendingSubmissionId);
  useLayoutEffect(() => {
    const previous = previousPendingSubmissionIdRef.current;
    previousPendingSubmissionIdRef.current = newestPendingSubmissionId;
    if (
      !autoScroll ||
      !newestPendingSubmissionId ||
      newestPendingSubmissionId === previous
    ) {
      return;
    }
    turnAnchoredRef.current = true;
    setTranscriptFollow(true);
    stopTranscriptGlide();
    scrollTranscriptToBottom();
  }, [
    autoScroll,
    newestPendingSubmissionId,
    scrollTranscriptToBottom,
    setTranscriptFollow,
    stopTranscriptGlide,
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
    const scrollTop = transcript.scrollTop;
    const expectedScrollTop = programmaticScrollTopRef.current;
    programmaticScrollTopRef.current = undefined;
    const ownScroll =
      expectedScrollTop !== undefined &&
      Math.abs(scrollTop - expectedScrollTop) <= 1;
    // A glide still on its way down is following, not away from the bottom.
    const nearBottom =
      isAgentKitTranscriptNearBottom(transcript) ||
      (ownScroll && followsTranscriptRef.current);
    if (nearBottom) {
      setTranscriptFollow(true);
    } else if (
      !ownScroll &&
      (transcriptScrollbarInteractionRef.current ||
        scrollTop < lastScrollTopRef.current - 1)
    ) {
      // Wheel, keys, Tab focus, drag-select and find-in-page all move the
      // view up without telling us why; any of them means the reader left.
      setTranscriptFollow(false);
    }
    lastScrollTopRef.current = scrollTop;
    setTranscriptAwayFromBottom(!nearBottom);
    if (transcriptScrollbarInteractionRef.current) {
      scheduleTranscriptScrollbarHide();
    }
  }, [scheduleTranscriptScrollbarHide, setTranscriptFollow]);

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
  const eventIndex = agentThreadEventIndex(thread.events);
  const messageRunIds = useMemo(() => {
    const activeMessageRuns = Object.values(thread.runs).flatMap((run) =>
      run.activeMessageId !== undefined &&
      !eventIndex.messageRunIds.has(run.activeMessageId)
        ? [{ runId: run.id, messageId: run.activeMessageId }]
        : [],
    );
    if (!activeMessageRuns.length) return eventIndex.messageRunIds;
    const result = new Map(eventIndex.messageRunIds);
    for (const { runId, messageId } of activeMessageRuns) {
      result.set(messageId, runId);
    }
    return result;
  }, [eventIndex, thread.runs]);
  const dataRenderer = slots.data;
  const messageRenderer = slots.message;
  const textRenderer = slots.text;
  const widgetRenderer = slots.widget;
  const widgetRenderers = registry.widgets;
  const messagePartRenderers = registry.messageParts;
  const attachedWidgetsByMessage = useMemo(() => {
    const result = new Map<string, AgentWidget[]>();
    for (const [widgetId, messageId] of Object.entries(
      thread.widgetMessageIds,
    )) {
      const widget = thread.widgets[widgetId] as AgentWidget | undefined;
      if (!widget) continue;
      const widgets = result.get(messageId) ?? [];
      widgets.push(widget);
      result.set(messageId, widgets);
    }
    return result;
  }, [thread.widgetMessageIds, thread.widgets]);
  const messageBoundarySequences = useMemo(() => {
    const firstVisibleSequence = new Map<string, number>();
    const lastTextDeltaSequence = new Map<string, number>();
    const lastWidgetSequence = new Map<string, number>();
    const createdSequence = new Map<string, number>();
    const assistantMessageIds = new Set(
      thread.messages
        .filter((message) => message.role === "assistant")
        .map((message) => message.id),
    );
    for (const event of thread.events) {
      if (
        event.type === "message.created" &&
        !createdSequence.has(event.message.id)
      ) {
        createdSequence.set(event.message.id, event.sequence);
      }
      if (
        !eventHasVisibleAssistantOutput(
          event,
          assistantMessageIds,
          messageRenderer,
          textRenderer,
          dataRenderer,
          widgetRenderer,
          widgetRenderers,
          messagePartRenderers,
        )
      ) {
        continue;
      }
      const messageId =
        event.type === "message.created" || event.type === "message.completed"
          ? event.message.id
          : event.type === "message.delta"
            ? event.messageId
            : event.type === "widget.created" || event.type === "widget.updated"
              ? event.messageId
              : undefined;
      if (!messageId) continue;
      if (!firstVisibleSequence.has(messageId)) {
        firstVisibleSequence.set(messageId, event.sequence);
      }
      if (event.type === "message.delta") {
        lastTextDeltaSequence.set(messageId, event.sequence);
      }
      if (event.type === "widget.created" || event.type === "widget.updated") {
        lastWidgetSequence.set(messageId, event.sequence);
      }
    }
    const result = new Map<string, number>();
    for (const [messageId, sequence] of firstVisibleSequence) {
      result.set(
        messageId,
        Math.max(
          sequence,
          lastTextDeltaSequence.get(messageId) ?? sequence,
          lastWidgetSequence.get(messageId) ?? sequence,
        ),
      );
    }
    // A hydrated reply can show text that no streamed event carried. Its
    // creation is then the boundary, so earlier work stays above it instead
    // of jumping there when the first delta lands.
    for (const message of thread.messages) {
      if (message.role !== "assistant" || result.has(message.id)) continue;
      if (
        !messageHasVisibleAssistantOutput(
          message,
          messageRenderer,
          textRenderer,
          dataRenderer,
          widgetRenderer,
          widgetRenderers,
          messagePartRenderers,
          attachedWidgetsByMessage.get(message.id),
        )
      ) {
        continue;
      }
      const created = createdSequence.get(message.id);
      const runId = messageRunIds.get(message.id);
      const fallback =
        created ??
        (runId && thread.runs[runId]?.activeMessageId === message.id
          ? thread.runs[runId]?.lastSequence
          : undefined);
      if (fallback !== undefined) result.set(message.id, fallback);
    }
    return result;
  }, [
    attachedWidgetsByMessage,
    dataRenderer,
    messagePartRenderers,
    messageRenderer,
    messageRunIds,
    textRenderer,
    widgetRenderer,
    widgetRenderers,
    thread.events,
    thread.messages,
    thread.runs,
  ]);
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
  const cancelledRuns = useMemo(
    () =>
      new Set(
        Object.values(thread.runs)
          .filter((run) => run.status === "cancelled")
          .map((run) => run.id),
      ),
    [thread.runs],
  );
  const runWorkStarts = useMemo(
    () => firstWorkEvents(thread.events),
    [thread.events],
  );
  const groupedReasoningMessageIds = new Set(
    runWorkStarts.flatMap((event) => {
      const messageId = reasoningMessageId(event);
      return messageId ? [messageId] : [];
    }),
  );
  // A saved reply's reasoning before its answer joins the work group above
  // it, so the turn shows one disclosure; the stream did not place it there.
  const foldsLeadingReasoning = (message: AgentMessage) =>
    message.status !== "streaming" &&
    !groupedReasoningMessageIds.has(message.id) &&
    leadingReasoningMessage(message) !== undefined;
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
  // A message the user sent into a running turn ends the run's work so far,
  // even when no reply was written before it.
  const { runSegmentEnds, runSegmentStarts, steerSequences } = useMemo(() => {
    const deliveredAt = new Map<string, number>();
    for (const event of thread.events) {
      if (
        event.type === "message.created" &&
        event.message.role === "user" &&
        !deliveredAt.has(event.message.id)
      ) {
        deliveredAt.set(event.message.id, event.sequence);
      }
    }
    const ends = new Map<RunId, { id: string; sequence: number }>();
    const starts = new Map<RunId, { id: string; sequence: number }>();
    const steers = new Map<string, number>();
    const endSegment = (runId: RunId, id: string, sequence: number) => {
      const previous = ends.get(runId);
      if (previous) starts.set(runId, previous);
      ends.set(runId, { id, sequence });
    };
    for (const message of thread.messages) {
      const runId = messageRunIds.get(message.id);
      if (!runId) continue;
      if (message.role === "assistant") {
        const sequence = messageBoundarySequences.get(message.id);
        if (sequence !== undefined) endSegment(runId, message.id, sequence);
        continue;
      }
      const sequence =
        message.role === "user" ? deliveredAt.get(message.id) : undefined;
      if (sequence === undefined) continue;
      const afterSequence = ends.get(runId)?.sequence;
      const workBefore = runWorkStarts.some(
        (event) =>
          event.runId === runId &&
          sequenceInRange(event.sequence, {
            afterSequence,
            throughSequence: sequence,
          }),
      );
      if (!workBefore) continue;
      steers.set(message.id, sequence);
      endSegment(runId, message.id, sequence);
    }
    return {
      runSegmentEnds: ends,
      runSegmentStarts: starts,
      steerSequences: steers,
    };
  }, [
    messageBoundarySequences,
    messageRunIds,
    runWorkStarts,
    thread.events,
    thread.messages,
  ]);
  const activeRunsBeforeAssistantOutput = thread.activeRunIds.filter(
    (runId) =>
      thread.runs[runId]?.status === "running" &&
      !thread.messages.some(
        (message) =>
          messageRunIds.get(message.id) === runId &&
          messageHasVisibleAssistantOutput(
            message,
            messageRenderer,
            textRenderer,
            dataRenderer,
            widgetRenderer,
            widgetRenderers,
            messagePartRenderers,
            attachedWidgetsByMessage.get(message.id),
          ),
      ),
  );
  const pendingRunIds = Array.from(
    new Set([
      ...runWorkStarts
        .filter((event) => {
          const boundary = runSegmentEnds.get(event.runId);
          return boundary === undefined || event.sequence > boundary.sequence;
        })
        .map((event) => event.runId),
      ...activeRunsBeforeAssistantOutput,
    ]),
  );
  const pendingRuns = new Set(pendingRunIds);
  // While a run works on its reply, the reply's work is one row below its
  // latest text, shown while work runs there: above the reply, narration
  // pushes it out of view, and split at that text, the work before reads as
  // finished while the run works. Result cards stay above the reply, where
  // they sit once it finishes. A finished reply with nothing running after
  // it keeps its row in its footer.
  const liveReplies = new Map<
    RunId,
    {
      replyId: string;
      start: { id: string; sequence: number } | undefined;
      foldsReasoning: boolean;
    }
  >();
  for (const [runId, reply] of lastAssistantMessagesByRun) {
    if (
      thread.runs[runId]?.status !== "running" ||
      runSegmentEnds.get(runId)?.id !== reply.id
    ) {
      continue;
    }
    const start = runSegmentStarts.get(runId);
    const message = thread.messages.find(({ id }) => id === reply.id);
    if (
      (message?.status === "streaming" || pendingRuns.has(runId)) &&
      hasRunWork(runId, start?.sequence)
    ) {
      liveReplies.set(runId, {
        replyId: reply.id,
        start,
        foldsReasoning: message ? foldsLeadingReasoning(message) : false,
      });
    }
  }
  const runRevision = (runId: RunId) =>
    `${runId}:${eventIndex.byRun.get(runId)?.length ?? 0}`;
  const renderRunFailure = (runId: RunId) => {
    const error = failedRuns.get(runId);
    // A lost stream fails the run and the connection with the same error;
    // the row yields only while that notice is on screen. Once it is
    // dismissed or the thread changes, the row is the only record left.
    if (
      error &&
      visibleConnectionError &&
      sameAgentError(error, visibleConnectionError)
    ) {
      return null;
    }
    return error ? (
      <RunFailure error={error} runId={runId} threadId={threadId} />
    ) : null;
  };
  const renderRunStopped = (runId: RunId) => (
    <p
      key={`run-stopped:${runId}`}
      className="agentkit-run-stopped"
      data-run-id={runId}
    >
      {labels.runStopped}
    </p>
  );
  // Unchanged rows keep their element, so a thread change rebuilds only the
  // rows it touched instead of every row's element tree.
  const rowElementCacheRef = useRef(
    new Map<string, { deps: readonly unknown[]; element: ReactElement }>(),
  );
  const usedRowElementKeys = new Set<string>();
  const cachedRowElement = (
    key: string,
    deps: readonly unknown[],
    create: () => ReactElement,
  ): ReactElement => {
    usedRowElementKeys.add(key);
    const cached = rowElementCacheRef.current.get(key);
    if (cached && shallowEqualArrays(cached.deps, deps)) return cached.element;
    const element = create();
    rowElementCacheRef.current.set(key, { deps, element });
    return element;
  };
  const renderRunWork = ({
    runId,
    anchor,
    afterSequence,
    throughSequence,
    messageId,
    foldedReasoningMessageId,
    summarizesTurn,
    part,
  }: {
    runId: RunId;
    anchor: string;
    afterSequence?: number | undefined;
    throughSequence?: number | undefined;
    messageId?: string | undefined;
    foldedReasoningMessageId?: string | undefined;
    summarizesTurn?: boolean | undefined;
    part?: "results" | "row" | undefined;
  }) => {
    const openKey = `${threadId}:${runId}:${anchor}`;
    const key = `run-work:${openKey}${part === "row" ? ":row" : ""}`;
    const resetKey = `${anchor}:${runRevision(runId)}`;
    return cachedRowElement(
      key,
      [
        resetKey,
        afterSequence,
        throughSequence,
        messageId,
        foldedReasoningMessageId,
        summarizesTurn,
        part,
      ],
      () =>
        renderRunWorkElement({
          key,
          openKey,
          resetKey,
          runId,
          afterSequence,
          throughSequence,
          messageId,
          foldedReasoningMessageId,
          summarizesTurn,
          part,
        }),
    );
  };
  const renderRunWorkElement = ({
    key,
    openKey,
    resetKey,
    runId,
    afterSequence,
    throughSequence,
    messageId,
    foldedReasoningMessageId,
    summarizesTurn,
    part,
  }: {
    key: string;
    openKey: string;
    resetKey: string;
    runId: RunId;
    afterSequence?: number | undefined;
    throughSequence?: number | undefined;
    messageId?: string | undefined;
    foldedReasoningMessageId?: string | undefined;
    summarizesTurn?: boolean | undefined;
    part?: "results" | "row" | undefined;
  }) => (
    <AgentKitSurfaceBoundary key={key} surface="activity" resetKey={resetKey}>
      <AgentWorkRowOpenContext.Provider
        value={{ key: openKey, opened: openedWorkRows }}
      >
        {part === "row" ? null : (
          <>
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
          </>
        )}
        <AgentActivityGroup
          runId={runId}
          afterSequence={afterSequence}
          throughSequence={throughSequence}
          excludeAgentActivities
          isCurrentSegment={throughSequence === undefined}
          messageId={messageId}
          foldedReasoningMessageId={foldedReasoningMessageId}
          summarizesTurn={summarizesTurn}
          part={part}
        />
      </AgentWorkRowOpenContext.Provider>
    </AgentKitSurfaceBoundary>
  );
  const renderRunTail = (runId: RunId) => {
    const items: ReactNode[] = [];
    const liveReply = liveReplies.get(runId);
    if (liveReply) {
      // While the reply's text is the newest output the text is the focus,
      // so the row shows only while work runs after it.
      if (pendingRuns.has(runId)) {
        items.push(
          renderRunWork({
            runId,
            anchor: liveReply.start?.id ?? "start",
            afterSequence: liveReply.start?.sequence,
            messageId: liveReply.replyId,
            foldedReasoningMessageId: liveReply.foldsReasoning
              ? liveReply.replyId
              : undefined,
            part: "row",
          }),
        );
      }
    } else if (pendingRuns.has(runId)) {
      const boundary = runSegmentEnds.get(runId);
      items.push(
        renderRunWork({
          runId,
          anchor: boundary?.id ?? "start",
          afterSequence: boundary?.sequence,
        }),
      );
    }
    if (failedRuns.has(runId)) {
      items.push(
        <AgentKitSurfaceBoundary
          key={`run-failure:${runId}`}
          surface="activity"
          resetKey={runRevision(runId)}
        >
          {renderRunFailure(runId)}
        </AgentKitSurfaceBoundary>,
      );
    }
    if (cancelledRuns.has(runId)) items.push(renderRunStopped(runId));
    return items;
  };
  // A run's work after its last reply, and its failure, belong to its turn: a
  // finished run's tail goes before the first message written after it ended.
  const runEndedAt = new Map<RunId, number>();
  for (const event of thread.events) {
    const occurredAt = Date.parse(event.occurredAt);
    if (!Number.isFinite(occurredAt)) continue;
    runEndedAt.set(
      event.runId,
      Math.max(runEndedAt.get(event.runId) ?? occurredAt, occurredAt),
    );
  }
  // A run loaded without its events, such as one stopped before a reload,
  // still has its end time; without it the tail falls below later turns.
  for (const run of Object.values(thread.runs)) {
    if (runEndedAt.has(run.id) || !run.completedAt) continue;
    const completedAt = Date.parse(run.completedAt);
    if (Number.isFinite(completedAt)) runEndedAt.set(run.id, completedAt);
  }
  const tailRunIds = Array.from(
    new Set([
      ...pendingRunIds,
      ...liveReplies.keys(),
      ...Array.from(failedRuns.keys()).filter(
        (runId) => !lastAssistantMessagesByRun.has(runId),
      ),
      ...Array.from(cancelledRuns).filter(
        (runId) => !lastAssistantMessagesByRun.has(runId),
      ),
    ]),
  );
  const tailsBeforeMessage = new Map<number, RunId[]>();
  const tailsAtEnd: RunId[] = [];
  for (const runId of tailRunIds) {
    const status = thread.runs[runId]?.status;
    const endedAt = runEndedAt.get(runId);
    const lastOwnMessage = thread.messages.findLastIndex(
      (message) => messageRunIds.get(message.id) === runId,
    );
    const before =
      endedAt !== undefined && isTerminalRunStatus(status)
        ? thread.messages.findIndex(
            (message, index) =>
              index > lastOwnMessage &&
              messageRunIds.get(message.id) !== runId &&
              Date.parse(message.createdAt ?? "") > endedAt,
          )
        : -1;
    if (before === -1) {
      tailsAtEnd.push(runId);
    } else {
      tailsBeforeMessage.set(before, [
        ...(tailsBeforeMessage.get(before) ?? []),
        runId,
      ]);
    }
  }
  // Finished messages keep their object identity so memoized views skip them
  // while another message streams.
  const displayMessageCacheRef = useRef(
    new Map<
      string,
      {
        source: AgentMessage;
        renderers: readonly unknown[];
        value: AgentMessage;
      }
    >(),
  );
  const displayRenderers = [
    messageRenderer,
    textRenderer,
    messagePartRenderers?.text,
  ] as const;
  const displayMessageCache = displayMessageCacheRef.current;
  const visibleMessageIds = new Set<string>();
  const displayMessageFor = (message: AgentMessage): AgentMessage => {
    visibleMessageIds.add(message.id);
    const cached = displayMessageCache.get(message.id);
    if (
      cached?.source === message &&
      shallowEqualArrays(cached.renderers, displayRenderers)
    ) {
      return cached.value;
    }
    const displayMessage =
      message.role === "assistant"
        ? {
            ...message,
            parts: message.parts.filter(
              (part) =>
                part.type !== "reasoning" &&
                (part.type !== "text" ||
                  part.text.trim() ||
                  messageRenderer ||
                  textRenderer ||
                  messagePartRenderers?.text),
            ),
          }
        : message;
    const value = messageRenderer
      ? stripAgentMessageContext(displayMessage)
      : displayMessage;
    displayMessageCache.set(message.id, {
      source: message,
      renderers: displayRenderers,
      value,
    });
    return value;
  };
  const transcriptItems: ReactNode[] = [];
  const previousSegmentEndByRun = new Map<
    RunId,
    { id: string; sequence: number }
  >();
  for (const [messageIndex, message] of thread.messages.entries()) {
    for (const runId of tailsBeforeMessage.get(messageIndex) ?? []) {
      transcriptItems.push(...renderRunTail(runId));
    }
    const runId = messageRunIds.get(message.id);
    const steerSequence = steerSequences.get(message.id);
    if (runId && steerSequence !== undefined) {
      const previous = previousSegmentEndByRun.get(runId);
      // No reply line follows to carry this finished row, so it stays here.
      transcriptItems.push(
        renderRunWork({
          runId,
          anchor: previous?.id ?? "start",
          afterSequence: previous?.sequence,
          throughSequence: steerSequence,
        }),
      );
      previousSegmentEndByRun.set(runId, {
        id: message.id,
        sequence: steerSequence,
      });
    }
    const sequence = messageBoundarySequences.get(message.id);
    const isAssistantBoundary =
      message.role === "assistant" &&
      runId !== undefined &&
      sequence !== undefined;
    const previousAssistant =
      isAssistantBoundary && runId
        ? previousSegmentEndByRun.get(runId)
        : undefined;
    // A turn that only answered still gets one "Worked for" row: it is the
    // run's only reply, nothing ran after it, and it shows no reasoning row.
    const summarizesTurn = Boolean(
      isAssistantBoundary &&
      runId &&
      previousAssistant === undefined &&
      lastAssistantMessagesByRun.get(runId)?.id === message.id &&
      !hasRunWork(runId, sequence) &&
      !hasVisibleReasoning(message),
    );
    const isLiveReply =
      isAssistantBoundary && liveReplies.get(runId)?.replyId === message.id;
    const rendersRunWork = Boolean(
      isAssistantBoundary &&
      runId &&
      (summarizesTurn ||
        hasRunWork(
          runId,
          previousAssistant?.sequence,
          isLiveReply ? undefined : sequence,
        )),
    );
    const foldsReasoning = rendersRunWork && foldsLeadingReasoning(message);
    if (rendersRunWork && runId) {
      transcriptItems.push(
        renderRunWork({
          runId,
          anchor: previousAssistant?.id ?? "start",
          afterSequence: previousAssistant?.sequence,
          throughSequence: isLiveReply ? undefined : sequence,
          messageId: message.id,
          foldedReasoningMessageId: foldsReasoning ? message.id : undefined,
          summarizesTurn,
          part: isLiveReply ? "results" : undefined,
        }),
      );
    }
    const messageValue = displayMessageFor(message);
    const standaloneReasoning = foldsReasoning
      ? withoutLeadingReasoning(message)
      : message;
    if (
      message.role === "assistant" &&
      !groupedReasoningMessageIds.has(message.id) &&
      hasVisibleReasoning(standaloneReasoning)
    ) {
      const active =
        message.status === "streaming" && messageValue.parts.length === 0;
      transcriptItems.push(
        <AgentWorkDisclosure
          key={`reasoning:${threadId}:${message.id}`}
          label={
            active
              ? labels.reasoning
              : workedSummaryLabel(
                  reasoningDurationMs(thread.events, new Set([message.id])),
                  labels,
                  formatReasoningDuration,
                )
          }
          icon={
            active ? (
              activityIcon("reasoning")
            ) : (
              <IconClock aria-hidden="true" className="agentkit-icon" />
            )
          }
          running={active}
          runId={runId}
          messageId={message.id}
        >
          <AgentReasoningSteps
            message={standaloneReasoning}
            threadId={threadId}
            active={active}
          />
        </AgentWorkDisclosure>,
      );
    }
    const messageRowKey = `message:${threadId}:${message.id}`;
    const messageResetKey = `${message.id}:${message.status ?? ""}:${message.parts.length}`;
    transcriptItems.push(
      cachedRowElement(
        messageRowKey,
        [messageValue, Message, messageResetKey],
        () => (
          <AgentKitSurfaceBoundary
            key={messageRowKey}
            surface="message"
            resetKey={messageResetKey}
          >
            <Message value={messageValue} threadId={threadId} />
          </AgentKitSurfaceBoundary>
        ),
      ),
    );
    if (isAssistantBoundary && runId) {
      previousSegmentEndByRun.set(runId, { id: message.id, sequence });
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
          resetKey={runRevision(runId)}
        >
          {renderRunFailure(runId)}
        </AgentKitSurfaceBoundary>,
      );
    }
    if (concludesRun && !pendingRuns.has(runId) && cancelledRuns.has(runId)) {
      transcriptItems.push(renderRunStopped(runId));
    }
  }
  for (const runId of tailsAtEnd) {
    transcriptItems.push(...renderRunTail(runId));
  }
  for (const message of pendingSubmissions) {
    transcriptItems.push(
      <AgentKitSurfaceBoundary
        key={`message:${threadId}:${message.id}`}
        surface="message"
        resetKey={message.id}
      >
        <Message value={message} threadId={threadId} />
      </AgentKitSurfaceBoundary>,
    );
  }
  for (const messageId of displayMessageCache.keys()) {
    if (!visibleMessageIds.has(messageId)) {
      displayMessageCache.delete(messageId);
    }
  }
  for (const key of rowElementCacheRef.current.keys()) {
    if (!usedRowElementKeys.has(key)) rowElementCacheRef.current.delete(key);
  }
  // A long history paints its newest rows first; older rows mount in idle
  // chunks, so opening a thread never waits on every row's Markdown at once.
  // Every row is mounted within a few idle periods, which is when
  // find-in-page can reach the oldest ones.
  const [historyWindow, setHistoryWindow] = useState<{
    threadId: string;
    hidden: number | undefined;
    long: boolean;
  }>({ threadId, hidden: undefined, long: false });
  let hiddenHistoryRows =
    historyWindow.threadId === threadId ? historyWindow.hidden : undefined;
  let longHistory = historyWindow.threadId === threadId && historyWindow.long;
  if (hiddenHistoryRows === undefined && transcriptItems.length > 0) {
    hiddenHistoryRows = Math.max(
      0,
      transcriptItems.length - AGENTKIT_INITIAL_HISTORY_ROWS,
    );
    longHistory = hiddenHistoryRows > 0;
    setHistoryWindow({
      threadId,
      hidden: hiddenHistoryRows,
      long: longHistory,
    });
  } else if (historyWindow.threadId !== threadId) {
    setHistoryWindow({ threadId, hidden: undefined, long: false });
  }
  const renderedTranscriptItems = hiddenHistoryRows
    ? transcriptItems.slice(hiddenHistoryRows)
    : transcriptItems;
  const historyScrollAnchorRef = useRef<{
    scrollTop: number;
    scrollHeight: number;
    distanceFromBottom: number;
  } | null>(null);
  useEffect(() => {
    if (!hiddenHistoryRows) return;
    return scheduleIdleMount(() => {
      const transcript = transcriptRef.current;
      historyScrollAnchorRef.current = transcript
        ? {
            scrollTop: transcript.scrollTop,
            scrollHeight: transcript.scrollHeight,
            distanceFromBottom:
              transcript.scrollHeight -
              transcript.clientHeight -
              transcript.scrollTop,
          }
        : null;
      setHistoryWindow((current) =>
        current.threadId === threadId && current.hidden
          ? {
              ...current,
              hidden: Math.max(0, current.hidden - AGENTKIT_HISTORY_ROW_CHUNK),
            }
          : current,
      );
    });
  }, [hiddenHistoryRows, threadId]);
  // Rows mounted above the view must not move it: a following transcript
  // keeps its distance from the bottom, and a reader scrolled up keeps the
  // rows they were reading where they were (when the browser did not
  // already anchor them).
  useLayoutEffect(() => {
    const anchor = historyScrollAnchorRef.current;
    historyScrollAnchorRef.current = null;
    const transcript = transcriptRef.current;
    if (!anchor || !transcript) return;
    if (!followsTranscriptRef.current) {
      if (Math.abs(transcript.scrollTop - anchor.scrollTop) <= 1) {
        writeTranscriptScrollTop(
          transcript,
          anchor.scrollTop + transcript.scrollHeight - anchor.scrollHeight,
        );
      }
      return;
    }
    const keepDistance = () => {
      if (!followsTranscriptRef.current) return;
      writeTranscriptScrollTop(
        transcript,
        Math.max(
          0,
          transcript.scrollHeight -
            transcript.clientHeight -
            anchor.distanceFromBottom,
        ),
      );
    };
    keepDistance();
    // Rows just mounted above can settle their height a frame later (an
    // off-screen placeholder resolving); a resting view corrects before that
    // frame paints instead of waiting for the next follow. A gliding view
    // already follows growth on its own.
    const content = transcriptContentRef.current;
    if (
      anchor.distanceFromBottom > 1 ||
      !content ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }
    const observer = new ResizeObserver(keepDistance);
    observer.observe(content);
    const settle = setTimeout(() => observer.disconnect(), 500);
    return () => {
      clearTimeout(settle);
      observer.disconnect();
    };
  }, [hiddenHistoryRows, writeTranscriptScrollTop]);
  return (
    <ComposerNoticeScope>
      <AgentMessageEditContext.Provider value={messageEditContext}>
        <AgentMessageWorkHostsContext.Provider value={messageWorkHosts}>
          <AgentKitTranscriptFollowContext.Provider
            value={followTranscriptOnSubmit}
          >
            <section
              // The transcript region already carries the conversation label; a
              // second landmark with the same name is ambiguous to screen readers.
              aria-label={typeof title === "string" ? title : undefined}
              className={`agentkit-chat ${className ?? ""}`}
              data-empty={showEmptyState}
              data-has-header={hasHeader}
              data-empty-composer-placement={
                showEmptyState ? emptyComposerPlacement : "bottom"
              }
              style={chatLaneStyle(transcriptLayout)}
              onDragEnter={handleFileDragEnter}
              onDragOver={handleFileDragOver}
              onDragLeave={handleFileDragLeave}
              onDropCapture={handleFileDropCapture}
              onDrop={handleFileDrop}
            >
              {fileDragActive ? (
                <div className="agentkit-file-drop-overlay" role="status">
                  {labels.dropFilesToAttach}
                </div>
              ) : null}
              {hasHeader ? (
                <AgentKitSurfaceBoundary surface="header" resetKey={threadId}>
                  <AgentKitRegionSlot slot={Header} threadId={threadId}>
                    <header
                      className="agentkit-chat-header"
                      data-agentkit-region="header"
                      data-agentkit-chat-header="true"
                      data-has-title={showTitle}
                    >
                      {showTitle ? (
                        <div className="agentkit-chat-title">{title}</div>
                      ) : null}
                      {toolbar ? (
                        <AgentKitRegionSlot slot={Toolbar} threadId={threadId}>
                          <div
                            // Host buttons carry the primitive's own radius
                            // utility, which beats layered CSS.
                            className="agentkit-chat-toolbar [&_:is(button,[role=button])]:rounded-[var(--agentkit-radius-xs)]"
                          >
                            {toolbar}
                          </div>
                        </AgentKitRegionSlot>
                      ) : null}
                    </header>
                  </AgentKitRegionSlot>
                </AgentKitSurfaceBoundary>
              ) : null}
              {composer && !showEmptyState ? (
                <button
                  type="button"
                  className="agentkit-skip-link"
                  data-agentkit-skip-link="composer"
                  onClick={() => requestComposerFocus(threadId)}
                >
                  {labels.skipToComposer}
                </button>
              ) : null}
              <div
                ref={transcriptRef}
                className="agentkit-transcript"
                role="region"
                aria-label={labels.conversation}
                aria-live="off"
                tabIndex={0}
                data-follow="true"
                data-scrollbar-visible={transcriptScrollbarVisible}
                onKeyDown={handleTranscriptKeyDown}
                onPointerDown={handleTranscriptPointerDown}
                onScroll={handleTranscriptScroll}
                onTouchMove={revealTranscriptScrollbar}
                onWheel={revealTranscriptScrollbar}
              >
                <div
                  ref={transcriptContentRef}
                  className="agentkit-transcript-content"
                  data-lane-offset-mode={
                    transcriptLayout?.messageLaneOffsetMode ?? "clamped"
                  }
                  style={transcriptContentStyle(transcriptLayout)}
                >
                  <AgentKitRegionSlot slot={Transcript} threadId={threadId}>
                    {threadLoading ? (
                      <AgentKitTranscriptSkeleton
                        label={labels.loadingConversation}
                      />
                    ) : threadMissing ? (
                      ThreadUnavailable ? (
                        <ThreadUnavailable threadId={threadId} />
                      ) : (
                        <AgentThreadUnavailable
                          onStartNewChat={onStartNewChat}
                        />
                      )
                    ) : threadLoadFailed ? (
                      <AgentThreadLoadFailed
                        retry={
                          hostLoadRetry ??
                          (() => void recovery.execute().catch(() => undefined))
                        }
                        retrying={hostLoadRetry ? false : recovery.pending}
                        retryError={hostLoadRetry ? undefined : recovery.error}
                      />
                    ) : showEmptyState ? (
                      EmptyState ? (
                        <EmptyState threadId={threadId} />
                      ) : (
                        <AgentKitEmptyState text={labels.emptyStateText} />
                      )
                    ) : null}
                    <AgentKitPostWidgetTextContext.Provider
                      value={transcriptLayout?.postWidgetText}
                    >
                      <AgentKitDeferClosedContentContext.Provider
                        value={longHistory}
                      >
                        {renderedTranscriptItems}
                      </AgentKitDeferClosedContentContext.Provider>
                    </AgentKitPostWidgetTextContext.Provider>
                    {approvalEntries.map(([approvalId, request]) => (
                      <AgentKitSurfaceBoundary
                        key={`${threadId}:${approvalId}`}
                        surface="approval"
                        resetKey={`${approvalId}:${runRevision(
                          thread.approvalRunIds[approvalId] ?? "",
                        )}`}
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
                        key={`${threadId}:${requestId}`}
                        surface="connection-request"
                        resetKey={`${requestId}:${request.status}`}
                      >
                        {ConnectionRequest ? (
                          <ConnectionRequest
                            value={request}
                            threadId={threadId}
                            runId={
                              thread.connectionRequestRunIds[requestId] ?? ""
                            }
                          />
                        ) : (
                          <AgentConnectionRequestCard
                            request={request}
                            runId={
                              thread.connectionRequestRunIds[requestId] ?? ""
                            }
                          />
                        )}
                      </AgentKitSurfaceBoundary>
                    ))}
                    {visibleConnectionError ? (
                      <AgentKitSurfaceBoundary
                        surface="connection-error"
                        resetKey={`${threadId}:${visibleConnectionError.code}`}
                      >
                        <ErrorState
                          error={visibleConnectionError}
                          threadId={threadId}
                          recover={recovery.execute}
                          recovering={recovery.pending}
                          {...(recovery.error === undefined
                            ? {}
                            : { recoveryError: recovery.error })}
                          dismiss={clearConnectionNotice}
                        />
                      </AgentKitSurfaceBoundary>
                    ) : null}
                  </AgentKitRegionSlot>
                  <div
                    ref={turnSpacerRef}
                    className="agentkit-turn-spacer"
                    aria-hidden="true"
                  />
                </div>
              </div>
              {/* Outside the scroller so its shadow is never clipped and it
                stacks above the footer scrim. */}
              <div
                className="agentkit-scroll-to-bottom-control"
                data-visible={transcriptAwayFromBottom ? "true" : "false"}
                aria-hidden={transcriptAwayFromBottom ? undefined : true}
                inert={!transcriptAwayFromBottom}
              >
                <IconButton
                  label={labels.scrollToBottom}
                  icon={<IconArrowDown aria-hidden="true" />}
                  size="compact"
                  className="rounded-[var(--agent-kit-radius-sm,0.5rem)] border border-[color:var(--agentkit-border)] bg-(--agentkit-surface) text-[color:var(--agentkit-text)] shadow-(--agent-kit-overlay-elevation) hover:bg-(--agentkit-subtle) hover:text-[color:var(--agentkit-text)]"
                  onPress={(event) => {
                    returnTranscriptToBottom();
                    // The control goes inert at the bottom, which would drop
                    // a keyboard user's focus to the page.
                    if (pressedByKeyboard(event))
                      requestComposerFocus(threadId);
                  }}
                />
              </div>
              <AgentKitLiveStatus threadId={threadId} />
              {composer ? (
                <footer className="agentkit-chat-footer">
                  <AgentKitSurfaceBoundary
                    surface="composer"
                    resetKey={threadId}
                  >
                    <AgentKitRegionSlot slot={Footer} threadId={threadId}>
                      {slots.composer ? (
                        <Composer threadId={threadId} />
                      ) : (
                        <AgentKitComposer
                          {...composerProps}
                          threadId={threadId}
                        />
                      )}
                    </AgentKitRegionSlot>
                  </AgentKitSurfaceBoundary>
                </footer>
              ) : null}
            </section>
          </AgentKitTranscriptFollowContext.Provider>
        </AgentMessageWorkHostsContext.Provider>
      </AgentMessageEditContext.Provider>
    </ComposerNoticeScope>
  );
}

export { useAgentKitStopButton } from "./stop-button.js";
