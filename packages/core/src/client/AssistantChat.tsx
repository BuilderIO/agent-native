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
import { createAgentChatAdapter } from "./agent-chat-adapter.js";
import { type ContentPart, readSSEStreamRaw } from "./sse-event-processor.js";
import { cn } from "./utils.js";
import {
  TiptapComposer,
  type TiptapComposerHandle,
} from "./composer/TiptapComposer.js";
import type { Reference } from "./composer/types.js";
import {
  IconSparkles,
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
.agent-markdown code { font-size: 0.875em; padding: 0.15em 0.35em; border-radius: 0.25em; background: var(--color-muted, hsl(0 0% 15%)); }
.agent-markdown pre { margin: 0.5em 0; padding: 0.75em 1em; border-radius: 0.375em; background: var(--color-muted, hsl(0 0% 15%)); overflow-x: auto; }
.agent-markdown pre code { padding: 0; background: transparent; font-size: 0.8125em; }
.agent-markdown hr { border: none; border-top: 1px solid var(--color-border, hsl(0 0% 20%)); margin: 0.75em 0; }
.agent-markdown a { text-decoration: underline; text-underline-offset: 2px; }
.agent-markdown blockquote { border-left: 2px solid var(--color-border, hsl(0 0% 20%)); padding-left: 0.75em; margin: 0.5em 0; opacity: 0.8; }
.agent-markdown table { border-collapse: collapse; margin: 0.5em 0; font-size: 0.875em; }
.agent-markdown th, .agent-markdown td { border: 1px solid var(--color-border, hsl(0 0% 20%)); padding: 0.35em 0.65em; text-align: left; }
.agent-markdown th { font-weight: 600; background: var(--color-muted, hsl(0 0% 15%)); }
`;

let stylesInjected = false;
function injectMarkdownStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = markdownStyles;
  document.head.appendChild(style);
}

function MarkdownText() {
  useEffect(() => {
    injectMarkdownStyles();
  }, []);
  return (
    <MarkdownTextPrimitive smooth className="agent-markdown break-words" />
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

// ─── Tool Call Fallback ─────────────────────────────────────────────────────

function ToolCallFallback({
  toolName,
  args,
  argsText,
  result,
}: ToolCallMessagePartProps) {
  const [expanded, setExpanded] = useState(false);
  const thread = useThread();
  const isRunning = result === undefined && thread.isRunning;
  const isAgentCall = toolName.startsWith("agent:");
  const agentName = isAgentCall ? toolName.slice(6) : null;
  const isAgentError = isAgentCall && result === "Error calling agent";
  // For agent calls, argsText holds the streaming response text
  const agentStreamText = isAgentCall ? (argsText ?? "") : "";
  const hasStreamText = agentStreamText.length > 0;
  const argsStr = isAgentCall
    ? ""
    : Object.entries(args as Record<string, unknown>)
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

  // Agent calls with streaming text auto-expand while running, and are toggleable when done
  const canExpand = isAgentCall ? hasStreamText : result !== undefined;
  const isExpanded = isAgentCall
    ? hasStreamText && (isRunning || expanded)
    : expanded;

  return (
    <div className="my-1 overflow-hidden">
      <button
        onClick={() => canExpand && setExpanded(!isExpanded)}
        className={cn(
          "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-mono w-full text-left overflow-hidden",
          isRunning
            ? "bg-muted text-muted-foreground"
            : isAgentCall
              ? "bg-muted text-muted-foreground hover:bg-accent"
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
        <div className="mt-1 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
          {agentStreamText}
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

// ─── Reconnect Stream Message ───────────────────────────────────────────────
// Renders the agent's in-progress response during reconnection (outside
// assistant-ui's runtime). Uses the same visual styling as normal messages.

function ReconnectStreamToolCall({
  toolName,
  argsText,
  args,
  result,
}: {
  toolName: string;
  argsText?: string;
  args: Record<string, string>;
  result?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = result === undefined;
  const isAgentCall = toolName.startsWith("agent:");
  const agentName = isAgentCall ? toolName.slice(6) : null;
  const isAgentError = isAgentCall && result === "Error calling agent";
  const agentStreamText = isAgentCall ? (argsText ?? "") : "";
  const hasStreamText = agentStreamText.length > 0;
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
  const isExpanded = isAgentCall
    ? hasStreamText && (isRunning || expanded)
    : expanded;

  return (
    <div className="my-1 overflow-hidden">
      <button
        onClick={() => canExpand && setExpanded(!isExpanded)}
        className={cn(
          "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-mono w-full text-left overflow-hidden",
          isRunning
            ? "bg-muted text-muted-foreground"
            : isAgentCall
              ? "bg-muted text-muted-foreground hover:bg-accent"
              : "bg-muted text-muted-foreground hover:bg-accent",
        )}
      >
        <span className="shrink-0">
          {isRunning ? (
            <IconLoader2 className="h-3 w-3 animate-spin" />
          ) : isAgentError ? (
            <IconCircleX className="h-3 w-3 text-destructive" />
          ) : (
            <IconCheck className="h-3 w-3 text-emerald-500" />
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
        <div className="mt-1 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
          {agentStreamText}
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

function ReconnectStreamMessage({ content }: { content: ContentPart[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [content]);

  return (
    <div className="flex justify-start px-4 py-2">
      <div className="max-w-[85%] space-y-1">
        <div className="flex items-center gap-1.5 mb-1">
          <IconSparkles className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
            Agent
          </span>
        </div>
        {content.map((part, i) => {
          if (part.type === "text") {
            return (
              <div
                key={`reconnect-text-${i}`}
                className="text-sm leading-relaxed whitespace-pre-wrap break-words"
              >
                {part.text}
              </div>
            );
          }
          if (part.type === "tool-call") {
            return (
              <ReconnectStreamToolCall
                key={`reconnect-tool-${i}`}
                toolName={part.toolName}
                argsText={part.argsText}
                args={part.args}
                result={part.result}
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
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let hasRichMentions = false;

  // First try rich mentions (@[label|icon])
  richMentionPattern.lastIndex = 0;
  while ((match = richMentionPattern.exec(text)) !== null) {
    hasRichMentions = true;
    const matchStart = match.index;
    if (matchStart > lastIndex) {
      parts.push(text.slice(lastIndex, matchStart));
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
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }
    return <>{parts}</>;
  }

  // Fallback: plain @word mentions (for older messages)
  plainMentionPattern.lastIndex = 0;
  while ((match = plainMentionPattern.exec(text)) !== null) {
    const matchStart = match.index;
    if (matchStart > lastIndex) {
      parts.push(text.slice(lastIndex, matchStart));
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

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts.length > 0 ? parts : text}</>;
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
  const [dots, setDots] = useState(1);
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d % 3) + 1);
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
          <IconSparkles className="h-4.5 w-4.5 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Connect your AI
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Add an Anthropic API key to enable the agent
          </p>
        </div>
      </div>

      <div className="space-y-3">
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

// ─── Main Component ─────────────────────────────────────────────────────────

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
  onSaveThread?: (data: {
    threadData: string;
    title: string;
    preview: string;
    messageCount: number;
  }) => void;
  /** Callback to generate a title from the first user message */
  onGenerateTitle?: (message: string) => void;
  /** Optional content rendered just above the composer input */
  composerSlot?: React.ReactNode;
  /** When true, skip the restore skeleton (used for freshly created threads with no messages) */
  isNewThread?: boolean;
}

export const CHAT_STORAGE_PREFIX = "agent-chat:";

/** Remove persisted chat for a given tabId (or "default"). */
export function clearChatStorage(tabId?: string) {
  try {
    sessionStorage.removeItem(`${CHAT_STORAGE_PREFIX}${tabId || "default"}`);
  } catch {}
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
  },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const thread = useThread();
  const threadRuntime = useThreadRuntime();
  const isRunning = thread.isRunning;
  const messages = thread.messages;
  const [missingApiKey, setMissingApiKey] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<
    Array<{ text: string; images?: string[]; references?: Reference[] }>
  >([]);
  const [showContinue, setShowContinue] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectContent, setReconnectContent] = useState<ContentPart[]>([]);
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
              threadRuntime.import(repo);
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
              // Agent is still running — subscribe to live SSE stream
              setIsReconnecting(true);
              setReconnectContent([]);

              const streamReconnect = async () => {
                try {
                  const sseRes = await fetch(
                    `${apiUrl}/runs/${encodeURIComponent(runInfo.runId)}/events?after=0`,
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
                  // Stream error — fall through to re-fetch
                }

                // Run finished — re-fetch thread data from server
                // (server now persists assistant response on completion)
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
                        threadRuntime.import(repo);
                      }
                    }
                  }
                } catch {}
                setReconnectContent([]);
                setIsReconnecting(false);
              };
              streamReconnect();
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
            threadRuntime.import(repo);
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
    onGenerateTitleRef.current?.(text.trim());
  }, [messages]);

  // Save title/preview eagerly when messages change (even while agent is running)
  // so that the history popover shows meaningful labels immediately.
  const savedTitleRef = useRef("");
  useEffect(() => {
    if (!hasRestoredRef.current) return;
    if (messages.length === 0) return;
    if (!threadId || !onSaveThreadRef.current) return;

    const repo = threadRuntime.export();
    const { title, preview } = extractThreadMeta(repo);
    // Save full thread data while running so hot reloads don't lose messages
    if (isRunning && title && title !== savedTitleRef.current) {
      savedTitleRef.current = title;
      onSaveThreadRef.current({
        threadData: JSON.stringify(repo),
        title,
        preview,
        messageCount: messages.length,
      });
    }
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
      onSaveThreadRef.current({
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

  const addToQueue = useCallback(
    (text: string, images?: string[], references?: Reference[]) => {
      setShowContinue(false);
      if (isRunning) {
        setQueuedMessages((prev) => [...prev, { text, images, references }]);
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
        {missingApiKey ? (
          <div className="flex flex-col items-center justify-center h-full px-2">
            <ApiKeySetupCard apiUrl={apiUrl} />
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
              <IconSparkles className="h-5 w-5 text-muted-foreground" />
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
          <div className="flex flex-col gap-4 px-4 py-4">
            <ThreadPrimitive.Messages
              components={{
                UserMessage,
                AssistantMessage,
              }}
            />
            {showContinue && !isRunning && (
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
            {isRunning && <ThinkingIndicator />}
            {isReconnecting && !isRunning && reconnectContent.length > 0 && (
              <ReconnectStreamMessage content={reconnectContent} />
            )}
            {isReconnecting && !isRunning && reconnectContent.length === 0 && (
              <ThinkingIndicator />
            )}
            {queuedMessages.map((msg, i) => (
              <div key={`queued-${i}`} className="flex justify-end">
                <div className="max-w-[85%] rounded-lg bg-accent/50 text-foreground/60 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wide">
                    <IconClock className="h-3 w-3" />
                    Queued
                  </div>
                  {msg.text}
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
                </div>
              </div>
            ))}
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
      <div className="shrink-0 px-3 py-2">
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
            actionButton={
              isRunning ? (
                <button
                  onClick={() => threadRuntime.cancelRun()}
                  className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground hover:opacity-90"
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
