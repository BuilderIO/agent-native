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
  useMessageRuntime,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  AttachmentPrimitive,
} from "@assistant-ui/react";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import {
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  CompositeAttachmentAdapter,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { createAgentChatAdapter } from "./agent-chat-adapter.js";
import { cn } from "./utils.js";
import {
  TiptapComposer,
  type TiptapComposerHandle,
} from "./composer/TiptapComposer.js";
import type { Reference } from "./composer/types.js";

// ─── Icons ──────────────────────────────────────────────────────────────────

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z" />
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

function PaperclipIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ArrowDownIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 5v14M19 12l-7 7-7-7" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

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

function ComposerAttachmentPreview() {
  return (
    <AttachmentPrimitive.Root className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-foreground m-1.5 mb-0">
      <span className="max-w-[160px] truncate">
        <AttachmentPrimitive.Name />
      </span>
      <AttachmentPrimitive.Remove asChild>
        <button className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full hover:bg-accent text-muted-foreground hover:text-foreground">
          <XIcon className="h-3 w-3" />
        </button>
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
}

// ─── Tool Call Fallback ─────────────────────────────────────────────────────

function ToolCallFallback({
  toolName,
  args,
  result,
}: ToolCallMessagePartProps) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = result === undefined;
  const argsStr = Object.entries(args as Record<string, unknown>)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");

  return (
    <div className="my-1 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-mono w-full text-left overflow-hidden",
          isRunning
            ? "bg-amber-500/10 text-amber-400"
            : "bg-muted text-muted-foreground hover:bg-accent",
        )}
      >
        <span className="shrink-0">
          {isRunning ? (
            <svg
              className="h-3 w-3 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
                strokeDasharray="31 62"
              />
            </svg>
          ) : (
            <CheckIcon className="h-3 w-3 text-emerald-500" />
          )}
        </span>
        <span className="truncate min-w-0">
          <span className="font-medium">{toolName}</span>
          {argsStr && <span className="opacity-60 ml-1">({argsStr})</span>}
        </span>
        {!isRunning && (
          <ChevronDownIcon
            className={cn(
              "ml-auto h-3 w-3 shrink-0 opacity-40",
              expanded && "rotate-180",
            )}
          />
        )}
      </button>
      {expanded && result !== undefined && (
        <div className="mt-1 rounded-md bg-muted/50 px-3 py-2 text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
          {typeof result === "string"
            ? result
            : JSON.stringify(result, null, 2)}
        </div>
      )}
    </div>
  );
}

// ─── Message Components ─────────────────────────────────────────────────────

function UserMessage() {
  return (
    <div className="flex justify-end" style={{ contentVisibility: "auto" }}>
      <div className="max-w-[85%] rounded-lg bg-accent text-foreground px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words">
        <MessagePrimitive.Parts
          components={{
            Text: ({ text }) => <>{text}</>,
          }}
        />
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
              <CheckIcon className="h-3 w-3" />
            ) : (
              <CopyIcon className="h-3 w-3" />
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
          <CheckIcon className="h-4 w-4" />
          API key saved. Reloading...
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 my-6 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
          <SparklesIcon className="h-4.5 w-4.5 text-muted-foreground" />
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

// ─── Terminal Icon ──────────────────────────────────────────────────────────

function TerminalIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
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
  /** API endpoint URL. Default: "/api/agent-chat" */
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
}

// ─── Queue Composer ──────────────────────────────────────────────────────────
// Custom composer shown while the agent is running. Uses a plain textarea
// (not ComposerPrimitive) so we can submit without interrupting the active run.

function QueueComposer({
  composerRef,
  addToQueue,
  queuedCount,
  onStop,
}: {
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  addToQueue: (text: string) => void;
  queuedCount: number;
  onStop: () => void;
}) {
  const [value, setValue] = useState("");

  const handleSubmit = useCallback(() => {
    const text = value.trim();
    if (!text) return;
    addToQueue(text);
    setValue("");
    // Re-focus after submit
    setTimeout(() => composerRef.current?.focus(), 0);
  }, [value, addToQueue, composerRef]);

  const handleAutoResize = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value);
      e.target.style.height = "auto";
      e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
    },
    [],
  );

  return (
    <div className="flex flex-col rounded-lg border border-input bg-background focus-within:ring-1 focus-within:ring-ring">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <div className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground">
          <PaperclipIcon className="h-4 w-4 opacity-30" />
        </div>
        <textarea
          ref={composerRef}
          value={value}
          onChange={handleAutoResize}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={
            queuedCount > 0
              ? `${queuedCount} queued — type another...`
              : "Queue a message..."
          }
          className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none leading-[1.625rem]"
          rows={1}
        />
        <button
          onClick={onStop}
          className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground hover:opacity-90"
          title="Stop generating"
        >
          <StopIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export const CHAT_STORAGE_PREFIX = "agent-chat:";

/** Remove persisted chat for a given tabId (or "default"). */
export function clearChatStorage(tabId?: string) {
  try {
    sessionStorage.removeItem(`${CHAT_STORAGE_PREFIX}${tabId || "default"}`);
  } catch {}
}

/** Extract title and preview from a thread runtime export */
function extractThreadMeta(repo: any): { title: string; preview: string } {
  const msgs = repo?.messages;
  if (!Array.isArray(msgs) || msgs.length === 0)
    return { title: "", preview: "" };

  // Find the first user message for the title
  let title = "";
  let preview = "";
  for (const msg of msgs) {
    if (msg.role !== "user") continue;
    const textParts = Array.isArray(msg.content)
      ? msg.content
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join(" ")
      : typeof msg.content === "string"
        ? msg.content
        : "";
    if (textParts.trim()) {
      if (!title) title = textParts.trim().slice(0, 80);
      preview = textParts.trim().slice(0, 120);
    }
  }
  return { title, preview };
}

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
  },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const thread = useThread();
  const threadRuntime = useThreadRuntime();
  const isRunning = thread.isRunning;
  const messages = thread.messages;
  const [missingApiKey, setMissingApiKey] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const [showContinue, setShowContinue] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const wasRunningRef = useRef(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const tiptapRef = useRef<TiptapComposerHandle>(null);

  // ─── Chat persistence ──────────────────────────────────────────────
  const hasRestoredRef = useRef(false);
  const [isRestoring, setIsRestoring] = useState(!!threadId);
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
              // Agent is still running — poll until complete, then refresh
              setIsReconnecting(true);
              const pollForCompletion = async () => {
                while (true) {
                  await new Promise((r) => setTimeout(r, 2000));
                  try {
                    const check = await fetch(
                      `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId)}`,
                    );
                    if (!check.ok) break; // 404 = run completed
                  } catch {
                    break;
                  }
                }
                // Run finished — re-fetch thread data from server
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
                setIsReconnecting(false);
              };
              pollForCompletion();
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
        threadRuntime.append({
          role: "user",
          content: [{ type: "text", text: next }],
        });
      }, 100);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, queuedMessages, threadRuntime]);

  const addToQueue = useCallback(
    (text: string) => {
      setShowContinue(false);
      if (isRunning) {
        setQueuedMessages((prev) => [...prev, text]);
      } else {
        threadRuntime.append({
          role: "user",
          content: [{ type: "text", text }],
        });
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
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      const threshold = 40;
      isNearBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

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
                <TerminalIcon className="h-3.5 w-3.5" />
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
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16 px-4 h-full">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <SparklesIcon className="h-5 w-5 text-muted-foreground" />
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
            {isReconnecting && !isRunning && (
              <div className="flex items-center gap-2 px-4 py-2">
                <div className="flex gap-1">
                  <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse" />
                  <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse [animation-delay:150ms]" />
                  <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse [animation-delay:300ms]" />
                </div>
                <span className="text-xs text-muted-foreground">
                  Agent is working...
                </span>
              </div>
            )}
            {queuedMessages.map((msg, i) => (
              <div key={`queued-${i}`} className="flex justify-end">
                <div className="max-w-[85%] rounded-lg bg-accent/50 text-foreground/60 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wide">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3 w-3"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    Queued
                  </div>
                  {msg}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="shrink-0 px-3 py-2">
        {isRunning ? (
          <QueueComposer
            composerRef={composerRef}
            addToQueue={addToQueue}
            queuedCount={queuedMessages.length}
            onStop={() => threadRuntime.cancelRun()}
          />
        ) : (
          <ComposerPrimitive.Root className="flex flex-col rounded-lg border border-input bg-background focus-within:ring-1 focus-within:ring-ring">
            {/* Attachment previews */}
            <ComposerPrimitive.Attachments
              components={{
                Attachment: ComposerAttachmentPreview,
              }}
            />
            <TiptapComposer focusRef={tiptapRef} />
          </ComposerPrimitive.Root>
        )}
      </div>
    </div>
  );
});

export const AssistantChat = forwardRef<
  AssistantChatHandle,
  AssistantChatProps
>(function AssistantChat(
  { apiUrl = "/api/agent-chat", tabId, threadId, ...props },
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
