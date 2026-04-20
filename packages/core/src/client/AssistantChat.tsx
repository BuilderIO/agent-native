import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useThreadRuntime,
  useThread,
  useAui,
  useComposer,
  useMessageRuntime,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
} from "@assistant-ui/react";
import type { ToolCallMessagePartProps, Attachment } from "@assistant-ui/react";
import {
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  CompositeAttachmentAdapter,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createAgentChatAdapter } from "./agent-chat-adapter.js";
import { type ContentPart, readSSEStreamRaw } from "./sse-event-processor.js";
import { cn } from "./utils.js";
import { AgentTaskCard } from "./AgentTaskCard.js";
import { ConnectBuilderCard } from "./ConnectBuilderCard.js";
import { IframeEmbed, parseEmbedBody } from "./IframeEmbed.js";
import {
  TiptapComposer,
  type TiptapComposerHandle,
} from "./composer/TiptapComposer.js";
import type { Reference } from "./composer/types.js";
import {
  IconMessage,
  IconX,
  IconPlayerStop,
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconTerminal,
  IconLoader2,
  IconCircleX,
  IconSquareFilled,
  IconClock,
  IconFile,
  IconFolder,
  IconFileText,
  IconCheckbox,
  IconMail,
  IconUser,
  IconPresentation,
  IconStack2,
  IconMessageChatbot,
  IconLock,
} from "@tabler/icons-react";

// ─── Markdown Text ──────────────────────────────────────────────────────────

const markdownStyles = `
.agent-markdown > :first-child { margin-top: 0; }
.agent-markdown > :last-child { margin-bottom: 0; }
.agent-markdown p { margin: 0.5em 0; }
.agent-markdown ul, .agent-markdown ol { margin: 0.5em 0; padding-left: 1.5em; }
.agent-markdown li { margin: 0.2em 0; }
.agent-markdown li > p { margin: 0; }
.agent-markdown h1 { font-size: 1.25em; font-weight: 600; margin: 0.75em 0 0.25em; }
.agent-markdown h2 { font-size: 1.125em; font-weight: 600; margin: 0.75em 0 0.25em; }
.agent-markdown h3 { font-size: 1em; font-weight: 600; margin: 0.75em 0 0.25em; }
.agent-markdown strong { font-weight: 600; }
.agent-markdown em { font-style: italic; }
.agent-markdown code { font-size: 0.875em; padding: 0.15em 0.35em; border-radius: 0.25em; background: hsl(var(--muted, 0 0% 15%)); color: hsl(var(--foreground, 0 0% 90%)); }
.agent-markdown pre { margin: 0.5em 0; padding: 0.75em 1em; border-radius: 0.375em; background: hsl(var(--muted, 0 0% 15%)); color: hsl(var(--foreground, 0 0% 90%)); overflow-x: auto; }
.agent-markdown pre code { padding: 0; background: transparent; font-size: 0.8125em; color: inherit; }
.agent-markdown-shiki { margin: 0.5em 0; border-radius: 0.375em; overflow: hidden; font-size: 0.8125em; }
.agent-markdown-shiki pre { margin: 0; padding: 0.75em 1em; overflow-x: auto; background: var(--shiki-light-bg); color: var(--shiki-light); }
.agent-markdown-shiki pre code { background: transparent; padding: 0; font-size: inherit; color: inherit; }
.agent-markdown-shiki pre span { color: var(--shiki-light); background: var(--shiki-light-bg); }
.dark .agent-markdown-shiki pre { background: var(--shiki-dark-bg); color: var(--shiki-dark); }
.dark .agent-markdown-shiki pre span { color: var(--shiki-dark); background: var(--shiki-dark-bg); }
@media (prefers-color-scheme: dark) { :root:not(.light) .agent-markdown-shiki pre { background: var(--shiki-dark-bg); color: var(--shiki-dark); } :root:not(.light) .agent-markdown-shiki pre span { color: var(--shiki-dark); background: var(--shiki-dark-bg); } }
.agent-markdown hr { border: none; border-top: 1px solid hsl(var(--border, 0 0% 20%)); margin: 0.75em 0; }
.agent-markdown a { text-decoration: underline; text-underline-offset: 2px; }
.agent-markdown blockquote { border-left: 2px solid hsl(var(--border, 0 0% 20%)); padding-left: 0.75em; margin: 0.5em 0; opacity: 0.8; }
.agent-markdown table { border-collapse: collapse; margin: 0.5em 0; font-size: 0.875em; }
.agent-markdown th, .agent-markdown td { border: 1px solid hsl(var(--border, 0 0% 20%)); padding: 0.35em 0.65em; text-align: left; }
.agent-markdown th { font-weight: 600; background: hsl(var(--muted, 0 0% 15%)); color: hsl(var(--foreground, 0 0% 90%)); }
`;

let stylesInjected = false;
function injectMarkdownStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = markdownStyles;
  document.head.appendChild(style);
}

function extractCodeText(child: React.ReactNode): string {
  if (typeof child === "string") return child;
  if (Array.isArray(child)) return child.map(extractCodeText).join("");
  if (React.isValidElement(child)) {
    const props = child.props as { children?: React.ReactNode };
    return extractCodeText(props.children);
  }
  return "";
}

// Lazy-loaded shiki highlighter — themes work for both light and dark mode
// via shiki's dual-theme support which emits CSS vars for each theme.
let shikiLoader: Promise<typeof import("shiki")> | null = null;
function loadShiki() {
  if (!shikiLoader) shikiLoader = import("shiki");
  return shikiLoader;
}

function HighlightedCodeBlock({
  code,
  lang,
}: {
  code: string;
  lang: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadShiki()
      .then(({ codeToHtml }) =>
        codeToHtml(code, {
          lang: lang || "text",
          themes: {
            light: "github-light-default",
            dark: "github-dark-default",
          },
          defaultColor: false,
        }),
      )
      .then((out) => {
        if (!cancelled) setHtml(out);
      })
      .catch(() => {
        // Unknown language or other shiki failure — fall back to plain pre.
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  if (html) {
    return (
      <div
        className="agent-markdown-shiki"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <pre>
      <code className={lang ? `language-${lang}` : undefined}>{code}</code>
    </pre>
  );
}

const markdownComponents = {
  pre(props: React.HTMLAttributes<HTMLPreElement>) {
    const { children, ...rest } = props;
    if (React.isValidElement(children)) {
      const childProps = children.props as {
        className?: string;
        children?: React.ReactNode;
      };
      const className = childProps.className || "";
      if (/\blanguage-embed\b/.test(className)) {
        const body = extractCodeText(childProps.children);
        const parsed = parseEmbedBody(body);
        return (
          <IframeEmbed {...(parsed as Parameters<typeof IframeEmbed>[0])} />
        );
      }
      const langMatch = className.match(/\blanguage-([\w+-]+)\b/);
      if (langMatch) {
        const code = extractCodeText(childProps.children).replace(/\n$/, "");
        return <HighlightedCodeBlock code={code} lang={langMatch[1]} />;
      }
    }
    return <pre {...rest}>{children}</pre>;
  },
};

function MarkdownText() {
  useEffect(() => {
    injectMarkdownStyles();
  }, []);
  return (
    <MarkdownTextPrimitive
      smooth
      className="agent-markdown break-words"
      remarkPlugins={[remarkGfm]}
      components={markdownComponents}
    />
  );
}

// ─── Composer Attachment Preview ─────────────────────────────────────────────

function getImageAttachmentSrc(attachment: Attachment): string | null {
  if (attachment.type !== "image") return null;

  if ("file" in attachment && attachment.file) {
    return URL.createObjectURL(attachment.file);
  }

  const imagePart = attachment.content?.find((part) => part.type === "image");
  return imagePart && "image" in imagePart ? imagePart.image : null;
}

function ComposerAttachmentPreviewCard({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: (id: string) => void;
}) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  useEffect(() => {
    const nextSrc = getImageAttachmentSrc(attachment);
    setImageSrc(nextSrc);

    return () => {
      if (nextSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(nextSrc);
      }
    };
  }, [attachment]);

  const isImage = !!imageSrc;

  return (
    <div
      className={cn(
        "group relative overflow-hidden border border-border/70 bg-muted/50 text-foreground",
        isImage
          ? "h-20 w-20 rounded-xl shadow-[0_12px_30px_-18px_rgba(0,0,0,0.7)]"
          : "inline-flex max-w-[220px] items-center gap-2 rounded-lg px-2.5 py-2 text-xs",
      )}
    >
      {isImage ? (
        <>
          <img
            src={imageSrc}
            alt={attachment.name}
            className="h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-2 py-1.5">
            <div className="truncate text-[10px] font-medium text-white/95">
              {attachment.name}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {attachment.name.split(".").pop() || "file"}
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium">{attachment.name}</div>
            <div className="text-[11px] text-muted-foreground">
              {attachment.contentType || attachment.type}
            </div>
          </div>
        </>
      )}
      <button
        type="button"
        onClick={() => onRemove(attachment.id)}
        className={cn(
          "absolute flex h-6 w-6 items-center justify-center rounded-full border border-border/60 bg-background/95 text-muted-foreground shadow-sm transition hover:text-foreground",
          isImage
            ? "right-1.5 top-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100"
            : "right-1.5 top-1.5",
        )}
        aria-label={`Remove ${attachment.name}`}
      >
        <IconX className="h-3 w-3" />
      </button>
    </div>
  );
}

function ComposerAttachmentPreviewStrip() {
  const attachments = useComposer((state) => state.attachments);
  const aui = useAui();

  const handleRemove = useCallback(
    (id: string) => {
      void aui.composer().attachment({ id }).remove();
    },
    [aui],
  );

  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-2 pt-2">
      {attachments.map((attachment) => (
        <ComposerAttachmentPreviewCard
          key={attachment.id}
          attachment={attachment}
          onRemove={handleRemove}
        />
      ))}
    </div>
  );
}

// Provides the parent's combined running state to tool-call renderers so they
// can stop spinning when the user clicks stop. `thread.isRunning` alone misses
// the force-stopped case; `part.result === undefined` alone ignores stop.
const ChatRunningContext = React.createContext(false);

// ─── Tool Call Display ──────────────────────────────────────────────────────
// Shared presentational component for rendering a tool call pill + result.
// Used by both the normal message path (ToolCallFallback) and the reconnect
// stream path (ReconnectStreamMessage). All state is passed as props — no
// assistant-ui hooks here.

function ToolCallDisplay({
  toolName,
  argsText,
  args,
  result,
  isRunning,
}: {
  toolName: string;
  argsText?: string;
  args: Record<string, unknown>;
  result?: string;
  isRunning: boolean;
}) {
  const streamRef = useRef<HTMLDivElement>(null);
  const isAgentCall = toolName.startsWith("agent:");
  const [expanded, setExpanded] = useState(isAgentCall);
  const agentName = isAgentCall ? toolName.slice(6) : null;
  const isAgentError = isAgentCall && result === "Error calling agent";
  const agentStreamText = isAgentCall ? (argsText ?? "") : "";
  const hasStreamText = agentStreamText.length > 0;

  // NOTE: All hooks must be above any conditional returns
  useEffect(() => {
    if (isAgentCall && isRunning && streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [agentStreamText, isAgentCall, isRunning]);

  // Render connect-builder as ConnectBuilderCard once the result is available
  if (toolName === "connect-builder" && result) {
    try {
      const parsed = JSON.parse(result);
      if (parsed?.kind === "connect-builder-card") {
        return (
          <ConnectBuilderCard
            configured={!!parsed.configured}
            builderEnabled={!!parsed.builderEnabled}
            connectUrl={parsed.connectUrl || ""}
            orgName={parsed.orgName ?? null}
            prompt={typeof parsed.prompt === "string" ? parsed.prompt : ""}
          />
        );
      }
    } catch {
      // fall through to default pill rendering
    }
  }

  // Render spawn-task as AgentTaskCard once the result is available
  if (toolName === "spawn-task" && result) {
    try {
      const parsed = JSON.parse(result);
      if (parsed.taskId && parsed.threadId) {
        return (
          <AgentTaskCard
            taskId={parsed.taskId}
            threadId={parsed.threadId}
            description={
              parsed.description ||
              (args as Record<string, string>)?.task ||
              "Sub-agent task"
            }
            onOpen={(tid) => {
              window.dispatchEvent(
                new CustomEvent("agent-task-open", {
                  detail: {
                    threadId: tid,
                    description:
                      parsed.description ||
                      (args as Record<string, string>)?.task ||
                      "",
                    name: parsed.name || "",
                  },
                }),
              );
            }}
          />
        );
      }
    } catch {
      // Fall through to default pill rendering
    }
  }

  const argsStr = isAgentCall
    ? ""
    : Object.entries(args)
        .map(
          ([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`,
        )
        .join(", ");

  const displayName = isAgentCall
    ? isRunning
      ? `Asking ${agentName}...`
      : isAgentError
        ? `Error asking ${agentName}`
        : `Asked ${agentName}`
    : toolName;

  const canExpand = isAgentCall ? hasStreamText : result !== undefined;
  const isExpanded = isAgentCall ? hasStreamText && expanded : expanded;

  return (
    <div className="my-1 overflow-hidden">
      <button
        onClick={() => canExpand && setExpanded(!isExpanded)}
        className={cn(
          "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-mono w-full text-left overflow-hidden",
          isRunning
            ? "bg-muted text-muted-foreground"
            : "bg-muted text-muted-foreground hover:bg-accent",
        )}
      >
        <span className="shrink-0">
          {isRunning ? (
            <IconLoader2 className="h-3 w-3 animate-spin" />
          ) : isAgentError ? (
            <IconCircleX className="h-3 w-3 text-destructive" />
          ) : result !== undefined ? (
            <IconCheck className="h-3 w-3 text-emerald-500" />
          ) : (
            <IconSquareFilled className="h-3 w-3 text-muted-foreground" />
          )}
        </span>
        <span className="truncate min-w-0">
          <span className="font-medium">{displayName}</span>
          {argsStr && <span className="opacity-60 ml-1">({argsStr})</span>}
        </span>
        {canExpand && !isRunning && (
          <IconChevronDown
            className={cn(
              "ml-auto h-3 w-3 shrink-0 opacity-40",
              isExpanded && "rotate-180",
            )}
          />
        )}
      </button>
      {isExpanded && isAgentCall && hasStreamText && (
        <div
          ref={streamRef}
          className="mt-1 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground break-words max-h-48 overflow-y-auto agent-markdown prose prose-sm prose-invert max-w-none"
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {agentStreamText}
          </ReactMarkdown>
        </div>
      )}
      {isExpanded && !isAgentCall && result !== undefined && (
        <div className="mt-1 rounded-md bg-muted/50 px-3 py-2 text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
          {typeof result === "string"
            ? result
            : JSON.stringify(result, null, 2)}
        </div>
      )}
    </div>
  );
}

function ToolCallFallback({
  toolName,
  args,
  argsText,
  result,
}: ToolCallMessagePartProps) {
  const chatRunning = React.useContext(ChatRunningContext);
  const isRunning = result === undefined && chatRunning;
  return (
    <ToolCallDisplay
      toolName={toolName}
      args={args as Record<string, unknown>}
      argsText={argsText}
      result={
        typeof result === "string"
          ? result
          : result !== undefined
            ? JSON.stringify(result)
            : undefined
      }
      isRunning={isRunning}
    />
  );
}

// ─── Reconnect Stream Message ───────────────────────────────────────────────
// Renders the agent's in-progress response during reconnection (outside
// assistant-ui's runtime). Uses the same visual styling as normal messages.

function ReconnectStreamMessage({ content }: { content: ContentPart[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const chatRunning = React.useContext(ChatRunningContext);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [content]);

  return (
    <div className="flex justify-start">
      <div className="max-w-[95%] text-sm leading-relaxed text-foreground space-y-1">
        {content.map((part, i) => {
          if (part.type === "text") {
            return (
              <div
                key={`reconnect-text-${i}`}
                className="agent-markdown break-words"
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {part.text}
                </ReactMarkdown>
              </div>
            );
          }
          if (part.type === "tool-call") {
            return (
              <ToolCallDisplay
                key={`reconnect-tool-${i}`}
                toolName={part.toolName}
                argsText={part.argsText}
                args={part.args}
                result={part.result}
                isRunning={part.result === undefined && chatRunning}
              />
            );
          }
          return null;
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}

// ─── Message Components ─────────────────────────────────────────────────────

const mentionIconProps = {
  size: 14,
  className: "shrink-0 text-muted-foreground",
};

function MentionChipIcon({ icon }: { icon?: string }) {
  switch (icon) {
    case "folder":
      return <IconFolder {...mentionIconProps} />;
    case "document":
      return <IconFileText {...mentionIconProps} />;
    case "form":
      return <IconCheckbox {...mentionIconProps} />;
    case "email":
      return <IconMail {...mentionIconProps} />;
    case "user":
      return <IconUser {...mentionIconProps} />;
    case "deck":
      return <IconPresentation {...mentionIconProps} />;
    case "agent":
      return <IconMessageChatbot {...mentionIconProps} />;
    case "file":
      return <IconFile {...mentionIconProps} />;
    default:
      return <IconStack2 {...mentionIconProps} />;
  }
}

// Matches rich mention format: @[label|icon] or plain @word
const richMentionPattern = /@\[([^\]|]+)\|([^\]]+)\]/g;
const plainMentionPattern = /((?:^|(?<=\s))@(\w+))/g;

function UserMessageText({ text }: { text: string }) {
  // Strip injected <context>...</context> blocks before display
  const displayText = text
    .replace(/<context>[\s\S]*?<\/context>\n?/g, "")
    .trim();

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let hasRichMentions = false;

  // First try rich mentions (@[label|icon])
  richMentionPattern.lastIndex = 0;
  while ((match = richMentionPattern.exec(displayText)) !== null) {
    hasRichMentions = true;
    const matchStart = match.index;
    if (matchStart > lastIndex) {
      parts.push(displayText.slice(lastIndex, matchStart));
    }
    const label = match[1];
    const icon = match[2];
    parts.push(
      <span
        key={matchStart}
        className="inline-flex items-center gap-1 rounded-md border border-input bg-muted/50 px-1.5 py-0.5 text-xs font-medium text-foreground align-middle mx-0.5 max-w-[200px] select-all"
        data-mention-label={label}
      >
        <MentionChipIcon icon={icon} />
        <span className="truncate">{label}</span>
      </span>,
    );
    lastIndex = matchStart + match[0].length;
  }

  if (hasRichMentions) {
    if (lastIndex < displayText.length) {
      parts.push(displayText.slice(lastIndex));
    }
    return <>{parts}</>;
  }

  // Fallback: plain @word mentions (for older messages)
  plainMentionPattern.lastIndex = 0;
  while ((match = plainMentionPattern.exec(displayText)) !== null) {
    const matchStart = match.index;
    if (matchStart > lastIndex) {
      parts.push(displayText.slice(lastIndex, matchStart));
    }
    const mentionName = match[2];
    parts.push(
      <span
        key={matchStart}
        className="inline-flex items-center gap-1 rounded-md border border-input bg-muted/50 px-1.5 py-0.5 text-xs font-medium text-foreground align-middle mx-0.5 select-all"
        data-mention-label={mentionName}
      >
        @{mentionName}
      </span>,
    );
    lastIndex = matchStart + match[0].length;
  }

  if (lastIndex < displayText.length) {
    parts.push(displayText.slice(lastIndex));
  }

  return <>{parts.length > 0 ? parts : displayText}</>;
}

function UserMessageAttachments() {
  const messageRuntime = useMessageRuntime();
  const msg = messageRuntime.getState();
  // assistant-ui stores user attachments on msg.attachments (separate from content).
  // Each attachment has: { id, type, name, contentType?, content: MessagePart[] }.
  // Image adapters put a {type:"image", image:"data:..."} part in content; text
  // adapters put a {type:"text", text:"<attachment>..."} part. Fall back to a
  // file chip when there's no inline image.
  const attachments = (msg as { attachments?: readonly Attachment[] })
    .attachments;
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap justify-end gap-1.5 mb-1.5">
      {attachments.map((att) => {
        const imagePart = att.content?.find(
          (p): p is { type: "image"; image: string } =>
            p.type === "image" && "image" in p && !!p.image,
        );
        if (imagePart) {
          return (
            <div
              key={att.id}
              className="h-16 w-16 overflow-hidden rounded-lg border border-border/70 bg-muted/50"
              title={att.name}
            >
              <img
                src={imagePart.image}
                alt={att.name}
                className="h-full w-full object-cover"
              />
            </div>
          );
        }
        return (
          <div
            key={att.id}
            className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground"
            title={att.name}
          >
            <IconFile className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate max-w-[120px]">{att.name || "file"}</span>
          </div>
        );
      })}
    </div>
  );
}

function UserMessage() {
  const [expanded, setExpanded] = useState(false);
  const [isExpandable, setIsExpandable] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const measure = () => {
      setIsExpandable(el.scrollHeight > 200);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex justify-end" style={{ contentVisibility: "auto" }}>
      <div className="max-w-[85%]">
        <UserMessageAttachments />
        <div
          className="relative rounded-lg bg-accent px-3 py-2 text-sm leading-relaxed text-foreground"
          onCopy={(e) => {
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) return;
            const fragment = selection.getRangeAt(0).cloneContents();
            const mentions = fragment.querySelectorAll("[data-mention-label]");
            if (mentions.length === 0) return;
            e.preventDefault();
            mentions.forEach((el) => {
              el.textContent = `@${el.getAttribute("data-mention-label")}`;
            });
            const div = document.createElement("div");
            div.appendChild(fragment);
            e.clipboardData.setData("text/plain", div.textContent || "");
          }}
        >
          <div
            ref={contentRef}
            className={cn(
              "whitespace-pre-wrap break-words",
              !expanded && isExpandable && "max-h-[200px] overflow-hidden",
            )}
          >
            <MessagePrimitive.Parts
              components={{
                Text: UserMessageText,
              }}
            />
          </div>
          {!expanded && isExpandable && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 rounded-b-lg bg-gradient-to-t from-accent via-accent/90 to-transparent" />
          )}
        </div>
        {isExpandable && (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            <IconChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                expanded && "rotate-180",
              )}
            />
            {expanded ? "Collapse" : "Expand"}
          </button>
        )}
      </div>
    </div>
  );
}

function AssistantMessage() {
  const [copied, setCopied] = useState(false);
  const messageRuntime = useMessageRuntime();
  const thread = useThread();
  const msg = messageRuntime.getState();
  const isLast =
    thread.messages.length > 0 &&
    thread.messages[thread.messages.length - 1].id === msg.id;
  const isComplete = !isLast || !thread.isRunning;

  const handleCopy = useCallback(() => {
    const m = messageRuntime.getState();
    const text = m.content
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [messageRuntime]);

  return (
    <div
      className="group relative"
      style={{ contentVisibility: isComplete ? "auto" : "visible" }}
    >
      <div className="max-w-[95%] text-sm leading-relaxed text-foreground">
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownText,
            tools: {
              Fallback: ToolCallFallback,
            },
          }}
        />
      </div>
      {/* Action bar — only show after message is complete */}
      {isComplete && (
        <div className="mt-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
          <button
            onClick={handleCopy}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {copied ? (
              <IconCheck className="h-3 w-3" />
            ) : (
              <IconCopy className="h-3 w-3" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Thinking Indicator ─────────────────────────────────────────────────────

function ThinkingIndicator() {
  const [dots, setDots] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d + 1) % 4);
    }, 400);
    return () => clearInterval(interval);
  }, []);
  return (
    <div className="flex items-center text-muted-foreground">
      <span className="text-xs">Thinking{".".repeat(dots)}</span>
    </div>
  );
}

// ─── API Key Setup Card ─────────────────────────────────────────────────────

function ApiKeySetupCard({ apiUrl }: { apiUrl: string }) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/save-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: apiKey.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      setSaved(true);
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div className="mx-4 my-6 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
        <div className="flex items-center gap-2 text-sm text-emerald-400">
          <IconCheck className="h-4 w-4" />
          API key saved. Reloading...
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 my-6 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
          <IconMessage className="h-4.5 w-4.5 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Connect your AI
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Connect Builder or add an Anthropic API key to enable the agent
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {/* Builder path — managed LLM proxy, no API key needed */}
        <div className="rounded-md border border-border px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-medium text-foreground">
                Connect Builder
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Use Builder's managed Anthropic proxy — no API key needed
              </p>
            </div>
            <span className="shrink-0 rounded border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              Coming soon
            </span>
          </div>
        </div>

        <div className="relative flex items-center">
          <div className="flex-grow border-t border-border" />
          <span className="mx-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
            or
          </span>
          <div className="flex-grow border-t border-border" />
        </div>

        <div className="rounded-md bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
          <p>
            1. Go to{" "}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-foreground/80 hover:text-foreground"
            >
              console.anthropic.com/settings/keys
            </a>
          </p>
          <p className="mt-1">2. Create a new API key and paste it below</p>
        </div>

        <input
          type="password"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          placeholder="sk-ant-..."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
          autoComplete="off"
        />

        {error && <p className="text-xs text-destructive">{error}</p>}

        <button
          onClick={handleSave}
          disabled={saving || !apiKey.trim()}
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? "Saving..." : "Save API key"}
        </button>
      </div>
    </div>
  );
}

// ─── Builder.io CTA Card (usage limit / code changes / CLI) ─────────────────

export function BuilderCtaCard({
  reason,
  usageCents,
  limitCents,
  apiUrl = "/_agent-native/agent-chat",
}: {
  reason: "usage_limit" | "code_changes" | "cli_tab";
  usageCents?: number;
  limitCents?: number;
  apiUrl?: string;
}) {
  const appName =
    typeof window !== "undefined"
      ? window.location.hostname.split(".")[0]
      : "app";
  const cloneCommand = `npx agent-native create ${appName}`;

  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/save-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: apiKey.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      setSaved(true);
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const title =
    reason === "usage_limit"
      ? "Free usage limit reached"
      : reason === "code_changes"
        ? "Code changes require a local setup"
        : "Get full access";

  const description =
    reason === "usage_limit"
      ? null
      : reason === "code_changes"
        ? "This app is running in hosted mode. To make code changes, add your own Anthropic API key or clone and run locally."
        : "This hosted app has limited AI features. Add your own Anthropic API key for the full experience, or clone and run locally.";

  if (saved) {
    return (
      <div className="mx-4 my-6 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
        <div className="flex items-center gap-2 text-sm text-emerald-400">
          <IconCheck className="h-4 w-4" />
          API key saved. Reloading...
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 my-6 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
          <IconMessage className="h-4.5 w-4.5 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {description}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-md bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
          <p>
            Paste an Anthropic API key (
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-foreground/80 hover:text-foreground"
            >
              console.anthropic.com/settings/keys
            </a>
            ) to skip the free-tier limit.
          </p>
        </div>

        <input
          type="password"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          placeholder="sk-ant-..."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
          autoComplete="off"
        />

        {error && <p className="text-xs text-destructive">{error}</p>}

        <button
          onClick={handleSave}
          disabled={saving || !apiKey.trim()}
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? "Saving..." : "Save API key"}
        </button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-card px-2 text-muted-foreground">or</span>
          </div>
        </div>

        <div className="rounded-md bg-muted/50 px-3 py-2.5">
          <p className="text-xs text-muted-foreground mb-1.5">
            Clone and run locally:
          </p>
          <code className="block text-xs text-foreground/80 font-mono break-all select-all">
            {cloneCommand}
          </code>
        </div>

        <div className="rounded-md border border-border px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-medium text-foreground">
                Connect Builder.io
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Builder's managed Anthropic proxy — no API key needed
              </p>
            </div>
            <span className="shrink-0 rounded border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              Coming soon
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export interface AssistantChatHandle {
  /** Programmatically send a message into this chat */
  sendMessage(text: string): void;
  /** Queue a message to send after the current run finishes */
  queueMessage(text: string): void;
  /** Whether the chat is currently running */
  isRunning(): boolean;
  /** Focus the composer input */
  focusComposer(): void;
}

export interface AssistantChatProps {
  /** API endpoint URL. Default: "/_agent-native/agent-chat" */
  apiUrl?: string;
  /** Stable tab identifier passed to the adapter for event correlation */
  tabId?: string;
  /** Thread ID for SQL-backed persistence. When set, messages are loaded from and saved to the server. */
  threadId?: string;
  /** Placeholder text for empty state */
  emptyStateText?: string;
  /** Suggestion prompts shown when no messages */
  suggestions?: string[];
  /** Whether to show the header bar. Default: true */
  showHeader?: boolean;
  /** CSS class for the outer container */
  className?: string;
  /** Callback when user clicks "Use CLI" button */
  onSwitchToCli?: () => void;
  /** Callback when message count changes */
  onMessageCountChange?: (count: number) => void;
  /** Callback to save thread data to the server (provided by useChatThreads) */
  onSaveThread?: (
    threadId: string,
    data: {
      threadData: string;
      title: string;
      preview: string;
      messageCount: number;
    },
  ) => void;
  /** Callback to generate a title from the first user message */
  onGenerateTitle?: (threadId: string, message: string) => void;
  /** Optional content rendered just above the composer input */
  composerSlot?: React.ReactNode;
  /** When true, skip the restore skeleton (used for freshly created threads with no messages) */
  isNewThread?: boolean;
  /** Called when a slash command (e.g. /clear, /help) is executed */
  onSlashCommand?: (command: string) => void;
  /** Current execution mode (build/plan) */
  execMode?: "build" | "plan";
  /** Callback to change execution mode */
  onExecModeChange?: (mode: "build" | "plan") => void;
}

export const CHAT_STORAGE_PREFIX = "agent-chat:";

/** Remove persisted chat for a given tabId (or "default"). */
export function clearChatStorage(tabId?: string) {
  try {
    sessionStorage.removeItem(`${CHAT_STORAGE_PREFIX}${tabId || "default"}`);
  } catch {}
}

/**
 * Ensure all messages in a thread repository have `metadata: {}`.
 * assistant-ui's _getMessageRuntime accesses `message.metadata.submittedFeedback`
 * without null-checking, so server-constructed messages without metadata crash.
 */
function ensureMessageMetadata(repo: any): any {
  if (!repo?.messages || !Array.isArray(repo.messages)) return repo;
  for (const entry of repo.messages) {
    // Handle both wrapped ({ message: { ... } }) and flat ({ role, ... }) formats
    const msg = entry?.message ?? entry;
    if (msg && !msg.metadata) {
      msg.metadata = {};
    }
  }
  return repo;
}

// Re-export for backwards compatibility
import { extractThreadMeta } from "../agent/thread-data-builder.js";
export { extractThreadMeta };

const AssistantChatInner = forwardRef<
  AssistantChatHandle,
  AssistantChatProps & { apiUrl: string }
>(function AssistantChatInner(
  {
    emptyStateText,
    suggestions,
    showHeader = true,
    onSwitchToCli,
    className,
    apiUrl,
    tabId,
    threadId,
    onMessageCountChange,
    onSaveThread,
    onGenerateTitle,
    composerSlot,
    isNewThread,
    onSlashCommand,
    execMode,
    onExecModeChange,
  },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const thread = useThread();
  const threadRuntime = useThreadRuntime();
  const isRuntimeRunning = thread.isRunning;
  const messages = thread.messages;
  const [missingApiKey, setMissingApiKey] = useState(false);
  const [authError, setAuthError] = useState<{
    sessionExpired?: boolean;
  } | null>(null);
  const [usageLimitReached, setUsageLimitReached] = useState<{
    usageCents: number;
    limitCents: number;
  } | null>(null);
  const [queuedMessages, setQueuedMessages] = useState<
    Array<{
      id: string;
      text: string;
      images?: string[];
      references?: Reference[];
    }>
  >([]);
  const [showContinue, setShowContinue] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectContent, setReconnectContent] = useState<ContentPart[]>([]);
  // When stop is clicked during reconnect, keep content visible (don't wipe it)
  const [reconnectFrozen, setReconnectFrozen] = useState(false);
  const reconnectRunIdRef = useRef<string | null>(null);
  const reconnectAbortRef = useRef<AbortController | null>(null);
  // Nuclear stop: user clicked stop. Clears the stop button/indicator AND
  // lets new submissions go through immediately — prevents the "stuck
  // queueing forever" state where isReconnecting or isRuntimeRunning gets
  // wedged (e.g. after a tab refresh + stop during reconnect).
  const [forceStopped, setForceStopped] = useState(false);
  // Real running state — drives submission/queue gating. Treat reconnecting
  // to an active run the same as running, UNLESS the user has explicitly
  // clicked stop (forceStopped).
  const isRunning = !forceStopped && (isRuntimeRunning || isReconnecting);
  // UI-only running state — drives the stop button and thinking indicator.
  const showRunningInUI = isRunning;
  const wasRunningRef = useRef(false);
  const tiptapRef = useRef<TiptapComposerHandle>(null);

  // ─── Chat persistence ──────────────────────────────────────────────
  const hasRestoredRef = useRef(false);
  const [isRestoring, setIsRestoring] = useState(!!threadId && !isNewThread);
  const onSaveThreadRef = useRef(onSaveThread);
  onSaveThreadRef.current = onSaveThread;
  const onGenerateTitleRef = useRef(onGenerateTitle);
  onGenerateTitleRef.current = onGenerateTitle;
  const titleGeneratedRef = useRef(false);

  // Restore messages from server on mount (when threadId is set)
  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;

    if (threadId) {
      // Load from server
      (async () => {
        try {
          const res = await fetch(
            `${apiUrl}/threads/${encodeURIComponent(threadId)}`,
          );
          if (!res.ok) return;
          const data = await res.json();
          if (data.threadData) {
            const repo =
              typeof data.threadData === "string"
                ? JSON.parse(data.threadData)
                : data.threadData;
            if (repo?.messages?.length > 0) {
              titleGeneratedRef.current = true; // Don't re-generate for restored threads
              threadRuntime.import(ensureMessageMetadata(repo));
            }
          }
          // Also skip title generation if thread already has a title
          if (data.title) {
            titleGeneratedRef.current = true;
          }

          // Check if there's an active run for this thread (e.g. after hot reload)
          try {
            const runRes = await fetch(
              `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId)}`,
            );
            if (runRes.ok) {
              const runInfo = await runRes.json();

              // If the run already completed, just re-fetch thread data
              // (don't enter "Thinking." reconnection mode)
              if (runInfo.status !== "running") {
                try {
                  const refreshRes = await fetch(
                    `${apiUrl}/threads/${encodeURIComponent(threadId)}`,
                  );
                  if (refreshRes.ok) {
                    const refreshData = await refreshRes.json();
                    if (refreshData.threadData) {
                      const repo =
                        typeof refreshData.threadData === "string"
                          ? JSON.parse(refreshData.threadData)
                          : refreshData.threadData;
                      if (repo?.messages?.length > 0) {
                        threadRuntime.import(ensureMessageMetadata(repo));
                      }
                    }
                  }
                } catch {}
                // Skip reconnection entirely
              } else {
                // Agent is still running — subscribe to live SSE stream
                reconnectRunIdRef.current = runInfo.runId;
                setIsReconnecting(true);
                setReconnectContent([]);
                // Signal tab running indicator
                window.dispatchEvent(
                  new CustomEvent("builder.chatRunning", {
                    detail: { isRunning: true, tabId: tabId || threadId },
                  }),
                );

                // Create AbortController before the async call so stop button
                // can abort it even if clicked before the function body runs.
                const abortCtrl = new AbortController();
                reconnectAbortRef.current = abortCtrl;

                // Watchdog: poll /runs/active to detect when the run is no
                // longer running server-side. If the SSE stream hangs (e.g.
                // because the agent process died but its SQL run row is still
                // marked "running", or the stream just never emits `done`),
                // this aborts the fetch so we fall through to thread refresh
                // instead of showing "Thinking..." forever.
                const watchdog = setInterval(async () => {
                  try {
                    const res = await fetch(
                      `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId)}`,
                    );
                    if (!res.ok) {
                      abortCtrl.abort();
                      clearInterval(watchdog);
                      return;
                    }
                    const info = await res.json();
                    if (info.status !== "running") {
                      abortCtrl.abort();
                      clearInterval(watchdog);
                    }
                  } catch {
                    // Network blip — keep polling
                  }
                }, 3000);

                // Hard cap: no single reconnect should wedge the UI for
                // more than 2 minutes. Even if the watchdog is fooled and
                // the SSE stream never closes, this guarantees "Thinking..."
                // eventually clears.
                const maxReconnectTimer = setTimeout(
                  () => {
                    abortCtrl.abort();
                    clearInterval(watchdog);
                  },
                  2 * 60 * 1000,
                );

                const streamReconnect = async () => {
                  try {
                    const sseRes = await fetch(
                      `${apiUrl}/runs/${encodeURIComponent(runInfo.runId)}/events?after=0`,
                      { signal: abortCtrl.signal },
                    );
                    if (sseRes.ok && sseRes.body) {
                      const content: ContentPart[] = [];
                      const toolCallCounter = { value: 0 };

                      // Throttle React state updates via requestAnimationFrame
                      let rafPending = false;
                      let latestSnapshot: ContentPart[] = [];
                      const scheduleUpdate = (snapshot: ContentPart[]) => {
                        latestSnapshot = snapshot;
                        if (!rafPending) {
                          rafPending = true;
                          requestAnimationFrame(() => {
                            rafPending = false;
                            setReconnectContent(latestSnapshot);
                          });
                        }
                      };

                      await readSSEStreamRaw(
                        sseRes.body,
                        content,
                        toolCallCounter,
                        tabId,
                        scheduleUpdate,
                      );

                      // Final update with complete content
                      setReconnectContent([...content]);
                    }
                  } catch {
                    // Stream error or abort — fall through to re-fetch
                  } finally {
                    clearInterval(watchdog);
                    clearTimeout(maxReconnectTimer);
                  }

                  // Poll for thread data — server's updateThreadData may not have
                  // committed yet when the SSE `done` event fires, so retry until
                  // an assistant message appears (up to ~5 s) before clearing.
                  setReconnectFrozen(true);
                  let loaded = false;
                  for (let attempt = 0; attempt < 10; attempt++) {
                    await new Promise((r) => setTimeout(r, 500));
                    // If the stop button fired mid-poll, bail out
                    if (!reconnectRunIdRef.current) break;
                    try {
                      const refreshRes = await fetch(
                        `${apiUrl}/threads/${encodeURIComponent(threadId)}`,
                      );
                      if (refreshRes.ok) {
                        const refreshData = await refreshRes.json();
                        if (refreshData.threadData) {
                          const repo =
                            typeof refreshData.threadData === "string"
                              ? JSON.parse(refreshData.threadData)
                              : refreshData.threadData;
                          const hasAssistant = repo?.messages?.some(
                            (m: {
                              message?: { role?: string };
                              role?: string;
                            }) => (m.message?.role ?? m.role) === "assistant",
                          );
                          if (hasAssistant) {
                            threadRuntime.import(ensureMessageMetadata(repo));
                            setReconnectContent([]);
                            setReconnectFrozen(false);
                            loaded = true;
                            break;
                          }
                        }
                      }
                    } catch {}
                  }
                  // Only clean up if the stop button hasn't already done it
                  if (reconnectRunIdRef.current) {
                    reconnectAbortRef.current = null;
                    // If loaded=true, reconnectContent already cleared above.
                    // If loaded=false (timeout), keep content frozen so user sees what happened.
                    setIsReconnecting(false);
                    reconnectRunIdRef.current = null;
                    window.dispatchEvent(
                      new CustomEvent("builder.chatRunning", {
                        detail: { isRunning: false, tabId: tabId || threadId },
                      }),
                    );
                  }
                };
                streamReconnect();
              } // end else (running)
            }
          } catch {
            // No active run — nothing to reconnect to
          }
        } catch {
          // Start fresh
        } finally {
          setIsRestoring(false);
        }
      })();
    } else {
      // Legacy: restore from sessionStorage
      const storageKey = `${CHAT_STORAGE_PREFIX}${tabId || "default"}`;
      try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved) {
          const repo = JSON.parse(saved);
          if (repo?.messages?.length > 0) {
            threadRuntime.import(ensureMessageMetadata(repo));
          }
        }
      } catch {}
      setIsRestoring(false);
    }
  }, [threadId, tabId, apiUrl, threadRuntime]);

  // Generate a title when the first user message is sent
  useEffect(() => {
    if (!hasRestoredRef.current) return;
    if (titleGeneratedRef.current) return;
    if (messages.length === 0) return;

    const firstUserMsg = messages.find((m) => m.role === "user");
    if (!firstUserMsg) return;

    // Extract text from the first user message
    const text =
      "content" in firstUserMsg
        ? Array.isArray(firstUserMsg.content)
          ? firstUserMsg.content
              .filter((p: any) => p.type === "text")
              .map((p: any) => p.text)
              .join(" ")
          : typeof firstUserMsg.content === "string"
            ? firstUserMsg.content
            : ""
        : "";

    if (!text.trim()) return;
    titleGeneratedRef.current = true;
    if (threadId) {
      onGenerateTitleRef.current?.(threadId, text.trim());
    }
  }, [messages, threadId]);

  // Periodically save thread data while the agent is running so refreshes
  // don't lose messages. Saves every 5 seconds while running.
  const savedTitleRef = useRef("");
  const lastSaveTimeRef = useRef(0);
  useEffect(() => {
    if (!hasRestoredRef.current) return;
    if (!isRunning) return;
    if (messages.length === 0) return;
    if (!threadId || !onSaveThreadRef.current) return;

    const now = Date.now();
    const timeSinceLastSave = now - lastSaveTimeRef.current;
    if (timeSinceLastSave < 5000) return;

    const repo = threadRuntime.export();
    const { title, preview } = extractThreadMeta(repo);
    if (!title) return;

    lastSaveTimeRef.current = now;
    savedTitleRef.current = title;
    onSaveThreadRef.current(threadId, {
      threadData: JSON.stringify(repo),
      title,
      preview,
      messageCount: messages.length,
    });
  }, [messages, isRunning, threadId, threadRuntime]);

  // Persist full thread data after each completed response
  useEffect(() => {
    if (!hasRestoredRef.current) return;
    if (isRunning) return;
    if (messages.length === 0) return;

    const repo = threadRuntime.export();

    if (threadId && onSaveThreadRef.current) {
      // Save to server via the hook callback
      const { title, preview } = extractThreadMeta(repo);
      savedTitleRef.current = title;
      onSaveThreadRef.current(threadId, {
        threadData: JSON.stringify(repo),
        title,
        preview,
        messageCount: messages.length,
      });
    } else {
      // Legacy: save to sessionStorage
      const storageKey = `${CHAT_STORAGE_PREFIX}${tabId || "default"}`;
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(repo));
      } catch {}
    }
  }, [messages, isRunning, threadId, tabId, threadRuntime]);

  useEffect(() => {
    onMessageCountChange?.(messages.length);
  }, [messages.length, onMessageCountChange]);

  // Listen for missing API key events from the adapter
  useEffect(() => {
    const handler = () => setMissingApiKey(true);
    window.addEventListener("agent-chat:missing-api-key", handler);
    return () =>
      window.removeEventListener("agent-chat:missing-api-key", handler);
  }, []);

  // Listen for auth error events from the adapter
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setAuthError({ sessionExpired: detail?.reason === "session-expired" });
    };
    window.addEventListener("agent-chat:auth-error", handler);
    return () => window.removeEventListener("agent-chat:auth-error", handler);
  }, []);

  // Listen for usage limit reached events from the adapter
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setUsageLimitReached({
        usageCents: detail?.usageCents ?? 0,
        limitCents: detail?.limitCents ?? 100,
      });
    };
    window.addEventListener("agent-chat:usage-limit-reached", handler);
    return () =>
      window.removeEventListener("agent-chat:usage-limit-reached", handler);
  }, []);

  // Listen for loop-limit events from the adapter
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!tabId || detail?.tabId === tabId) {
        setShowContinue(true);
      }
    };
    window.addEventListener("agent-chat:loop-limit", handler);
    return () => window.removeEventListener("agent-chat:loop-limit", handler);
  }, [tabId]);

  // Auto-dequeue: when agent finishes running, send the next queued message
  useEffect(() => {
    if (wasRunningRef.current && !isRunning && queuedMessages.length > 0) {
      const [next, ...rest] = queuedMessages;
      setQueuedMessages(rest);
      // Small delay to let the runtime settle after completion
      setTimeout(() => {
        const content: Array<
          { type: "text"; text: string } | { type: "image"; image: string }
        > = [{ type: "text", text: next.text }];
        if (next.images) {
          for (const img of next.images) {
            content.push({ type: "image", image: img });
          }
        }
        threadRuntime.append({
          role: "user",
          content,
          ...(next.references && next.references.length > 0
            ? { runConfig: { custom: { references: next.references } } }
            : {}),
        });
      }, 100);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, queuedMessages, threadRuntime]);

  // Clear frozen reconnect content + forceStopped only on the false→true
  // transition of isRuntimeRunning (i.e. a NEW run is actually starting).
  // Reacting to "isRuntimeRunning is currently true" would clear the
  // nuclear-stop flag immediately after the user clicks stop, since
  // cancellation is async and isRuntimeRunning is still true at that moment.
  const prevIsRuntimeRunningRef = useRef(isRuntimeRunning);
  useEffect(() => {
    const wasRunning = prevIsRuntimeRunningRef.current;
    prevIsRuntimeRunningRef.current = isRuntimeRunning;
    if (isRuntimeRunning && !wasRunning) {
      if (reconnectFrozen) {
        setReconnectFrozen(false);
        setReconnectContent([]);
      }
      if (forceStopped) {
        setForceStopped(false);
      }
    }
  }, [isRuntimeRunning, reconnectFrozen, forceStopped]);

  // Same transition guard for isReconnecting: only clear forceStopped on
  // the false→true edge (a new reconnect starting on page load).
  const prevIsReconnectingRef = useRef(isReconnecting);
  useEffect(() => {
    const wasReconnecting = prevIsReconnectingRef.current;
    prevIsReconnectingRef.current = isReconnecting;
    if (isReconnecting && !wasReconnecting && forceStopped) {
      setForceStopped(false);
    }
  }, [isReconnecting, forceStopped]);

  const addToQueue = useCallback(
    (text: string, images?: string[], references?: Reference[]) => {
      setShowContinue(false);
      if (isRunning) {
        setQueuedMessages((prev) => [
          ...prev,
          {
            id:
              typeof crypto !== "undefined" && crypto.randomUUID
                ? crypto.randomUUID()
                : `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            text,
            images,
            references,
          },
        ]);
      } else {
        const content: Array<
          { type: "text"; text: string } | { type: "image"; image: string }
        > = [{ type: "text", text }];
        if (images) {
          for (const img of images) {
            content.push({ type: "image", image: img });
          }
        }
        threadRuntime.append({ role: "user", content });
      }
    },
    [isRunning, threadRuntime],
  );

  // Expose imperative handle
  useImperativeHandle(
    ref,
    () => ({
      sendMessage(text: string) {
        addToQueue(text);
      },
      queueMessage(text: string) {
        addToQueue(text);
      },
      isRunning() {
        return thread.isRunning;
      },
      focusComposer() {
        tiptapRef.current?.focus();
      },
    }),
    [addToQueue, thread.isRunning],
  );

  // Track whether user has scrolled away from bottom
  const isNearBottomRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      const threshold = 40;
      const nearBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      isNearBottomRef.current = nearBottom;
      setShowScrollToBottom(!nearBottom && messages.length > 0);
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [messages.length]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      isNearBottomRef.current = true;
      setShowScrollToBottom(false);
    }
  }, []);

  // Scroll to bottom when a restored thread finishes loading
  const wasRestoringRef = useRef(isRestoring);
  useEffect(() => {
    if (wasRestoringRef.current && !isRestoring) {
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }
    wasRestoringRef.current = isRestoring;
  }, [isRestoring, scrollToBottom]);

  // Auto-scroll on new messages or queued messages (only if near bottom)
  useEffect(() => {
    const el = scrollRef.current;
    if (el && isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, queuedMessages]);

  // Continuous auto-scroll while streaming (only if near bottom)
  useEffect(() => {
    if (!isRunning) return;
    const el = scrollRef.current;
    if (!el) return;
    const interval = setInterval(() => {
      if (isNearBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    }, 100);
    return () => clearInterval(interval);
  }, [isRunning]);

  return (
    <ChatRunningContext.Provider value={isRunning}>
      <div
        className={cn(
          "flex flex-1 flex-col h-full min-h-0 text-foreground",
          className,
        )}
      >
        {showHeader && (
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
            <span className="text-[13px] font-medium text-muted-foreground">
              Agent
            </span>
            <div className="flex items-center gap-1">
              {onSwitchToCli && (
                <button
                  onClick={onSwitchToCli}
                  className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-accent"
                  title="Switch to CLI"
                >
                  <IconTerminal className="h-3.5 w-3.5" />
                  CLI
                </button>
              )}
            </div>
          </div>
        )}

        {/* Messages area */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto overflow-x-hidden min-h-0"
        >
          {authError ? (
            <div className="flex flex-col items-center justify-center h-full px-4 gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
                <IconLock className="h-5 w-5 text-destructive" />
              </div>
              <div className="text-center max-w-[280px]">
                <p className="text-sm font-medium text-foreground mb-1">
                  {authError.sessionExpired
                    ? "Session expired"
                    : "Authentication required"}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {authError.sessionExpired ? (
                    "Your session may have expired. Log out and log back in to reconnect."
                  ) : (
                    <>
                      You need to log in to use the agent. If you&apos;re
                      running locally, add{" "}
                      <code className="bg-muted px-1 py-0.5 rounded text-[10px]">
                        AUTH_MODE=local
                      </code>{" "}
                      to your{" "}
                      <code className="bg-muted px-1 py-0.5 rounded text-[10px]">
                        .env
                      </code>{" "}
                      file and restart the dev server.
                    </>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                {authError.sessionExpired && (
                  <button
                    onClick={async () => {
                      try {
                        await fetch("/_agent-native/auth/logout", {
                          method: "POST",
                        });
                      } catch {}
                      window.location.reload();
                    }}
                    className="text-xs text-destructive hover:text-destructive/80 px-3 py-1.5 rounded-md border border-destructive/30 hover:bg-destructive/10"
                  >
                    Log out
                  </button>
                )}
                <button
                  onClick={() => {
                    setAuthError(null);
                    window.location.reload();
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md border border-border hover:bg-accent"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : missingApiKey ? (
            <div className="flex flex-col items-center justify-center h-full px-2">
              <ApiKeySetupCard apiUrl={apiUrl} />
            </div>
          ) : usageLimitReached ? (
            <div className="flex flex-col items-center justify-center h-full px-2">
              <BuilderCtaCard
                reason="usage_limit"
                usageCents={usageLimitReached.usageCents}
                limitCents={usageLimitReached.limitCents}
                apiUrl={apiUrl}
              />
            </div>
          ) : isRestoring ? (
            <div className="flex flex-col gap-3 p-4">
              <div className="flex justify-end">
                <div className="h-8 w-32 rounded-lg bg-muted animate-pulse" />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="h-4 w-48 rounded bg-muted animate-pulse" />
                <div className="h-4 w-64 rounded bg-muted animate-pulse" />
                <div className="h-4 w-40 rounded bg-muted animate-pulse" />
              </div>
            </div>
          ) : messages.length === 0 && !isReconnecting ? (
            <div className="flex flex-col items-center justify-center gap-4 py-16 px-4 h-full">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <IconMessage className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground text-center max-w-[240px]">
                {emptyStateText ?? "How can I help you?"}
              </p>
              {suggestions && suggestions.length > 0 && (
                <div className="flex flex-col gap-1.5 w-full max-w-[280px]">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        threadRuntime.append({
                          role: "user",
                          content: [{ type: "text", text: suggestion }],
                        });
                      }}
                      className="w-full rounded-lg border border-border px-3 py-2 text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="agent-thread-content flex flex-col gap-4 px-4 py-4">
              <ThreadPrimitive.Messages
                components={{
                  UserMessage,
                  AssistantMessage,
                }}
              />
              {showContinue && !showRunningInUI && (
                <div className="flex justify-center py-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowContinue(false);
                      addToQueue("Continue from where you left off.");
                    }}
                    className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
                  >
                    Continue
                  </button>
                </div>
              )}
              {(isReconnecting || reconnectFrozen) &&
                reconnectContent.length > 0 && (
                  <ReconnectStreamMessage content={reconnectContent} />
                )}
              {/* Always show the thinking indicator while the agent is working,
                including during reconnect. The indicator sits BELOW any
                already-streamed reconnect content so the user sees both
                "what it did so far" and "it's still working". */}
              {showRunningInUI && <ThinkingIndicator />}
              {queuedMessages.map((msg) => {
                const displayText = msg.text
                  .replace(/<context>[\s\S]*?<\/context>\n?/g, "")
                  .trim();
                return (
                  <div key={msg.id} className="flex justify-end group">
                    <div className="relative max-w-[85%] rounded-lg bg-accent/50 text-foreground/60 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words">
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wide">
                        <IconClock className="h-3 w-3" />
                        Queued
                      </div>
                      {displayText}
                      {msg.images && msg.images.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {msg.images.map((img, j) => (
                            <img
                              key={j}
                              src={img}
                              alt=""
                              className="h-12 w-12 rounded object-cover border border-border/50"
                            />
                          ))}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setQueuedMessages((prev) =>
                            prev.filter((m) => m.id !== msg.id),
                          )
                        }
                        aria-label="Remove from queue"
                        className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground hover:bg-accent shadow-sm"
                      >
                        <IconX className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Scroll to bottom button */}
        {showScrollToBottom && (
          <div className="shrink-0 flex justify-center -mb-1">
            <button
              type="button"
              onClick={scrollToBottom}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background shadow-sm hover:bg-accent"
              aria-label="Scroll to bottom"
            >
              <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        )}

        {composerSlot}
        {/* Input area */}
        <div className="agent-composer-area shrink-0 px-3 py-2">
          <ComposerPrimitive.Root className="flex flex-col rounded-lg border border-input bg-background focus-within:ring-1 focus-within:ring-ring">
            <ComposerAttachmentPreviewStrip />
            <TiptapComposer
              focusRef={tiptapRef}
              placeholder={
                isRunning
                  ? queuedMessages.length > 0
                    ? `${queuedMessages.length} queued — type another...`
                    : "Queue a message..."
                  : undefined
              }
              onSubmit={
                isRunning
                  ? (text, references) =>
                      addToQueue(
                        text,
                        undefined,
                        references.length > 0 ? references : undefined,
                      )
                  : undefined
              }
              onSlashCommand={onSlashCommand}
              execMode={execMode}
              onExecModeChange={onExecModeChange}
              extraActionButton={
                showRunningInUI ? (
                  <button
                    type="button"
                    onClick={() => {
                      // Nuclear stop: flip forceStopped so isRunning is false
                      // immediately. This unblocks submission even if the
                      // runtime or reconnect state is stuck.
                      setForceStopped(true);

                      if (isReconnecting) {
                        if (reconnectRunIdRef.current) {
                          fetch(
                            `${apiUrl}/runs/${encodeURIComponent(reconnectRunIdRef.current)}/abort`,
                            { method: "POST" },
                          );
                        }
                        reconnectAbortRef.current?.abort();
                        reconnectAbortRef.current = null;
                        reconnectRunIdRef.current = null;
                        setIsReconnecting(false);
                        setReconnectFrozen(reconnectContent.length > 0);
                      }

                      threadRuntime.cancelRun();

                      window.dispatchEvent(
                        new CustomEvent("builder.chatRunning", {
                          detail: {
                            isRunning: false,
                            tabId: tabId || threadId,
                          },
                        }),
                      );
                    }}
                    className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md bg-muted text-foreground hover:bg-muted/80"
                    title="Stop generating"
                  >
                    <IconPlayerStop className="h-3.5 w-3.5" />
                  </button>
                ) : undefined
              }
            />
          </ComposerPrimitive.Root>
        </div>
      </div>
    </ChatRunningContext.Provider>
  );
});

export const AssistantChat = forwardRef<
  AssistantChatHandle,
  AssistantChatProps
>(function AssistantChat(
  { apiUrl = "/_agent-native/agent-chat", tabId, threadId, ...props },
  ref,
) {
  const adapter = useMemo(
    () => createAgentChatAdapter({ apiUrl, tabId, threadId }),
    [apiUrl, tabId, threadId],
  );
  const attachmentAdapter = useMemo(
    () =>
      new CompositeAttachmentAdapter([
        new SimpleImageAttachmentAdapter(),
        new SimpleTextAttachmentAdapter(),
      ]),
    [],
  );
  const runtime = useLocalRuntime(adapter, {
    adapters: { attachments: attachmentAdapter },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex flex-1 flex-col h-full min-h-0 overflow-x-hidden">
        <AssistantChatInner
          ref={ref}
          {...props}
          apiUrl={apiUrl}
          tabId={tabId}
          threadId={threadId}
        />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
});
