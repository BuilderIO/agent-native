import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
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
} from "@assistant-ui/react";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { createAgentChatAdapter } from "./agent-chat-adapter.js";
import { cn } from "./utils.js";

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
    <div className="my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-mono w-full text-left",
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
        <span className="truncate">
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
    <div className="flex justify-end">
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

  const handleCopy = useCallback(() => {
    const msg = messageRuntime.getState();
    const text = msg.content
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [messageRuntime]);

  return (
    <div className="group relative">
      <div className="max-w-[95%] text-sm leading-relaxed text-foreground">
        <MessagePrimitive.Parts
          components={{
            Text: ({ text }) => (
              <div className="whitespace-pre-wrap break-words">{text}</div>
            ),
            tools: {
              Fallback: ToolCallFallback,
            },
          }}
        />
      </div>
      {/* Action bar on hover */}
      <div className="mt-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
        <button
          onClick={handleCopy}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {copied ? (
            <CheckIcon className="h-3.5 w-3.5" />
          ) : (
            <CopyIcon className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Thinking Indicator ─────────────────────────────────────────────────────

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground py-2">
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-current opacity-40 animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
      <span className="text-xs">Thinking...</span>
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

export interface AssistantChatProps {
  /** API endpoint URL. Default: "/api/agent-chat" */
  apiUrl?: string;
  /** Placeholder text for empty state */
  emptyStateText?: string;
  /** Suggestion prompts shown when no messages */
  suggestions?: string[];
  /** Whether to show the header bar. Default: true */
  showHeader?: boolean;
  /** CSS class for the outer container */
  className?: string;
  /** Whether to show the "Use CLI" hint in dev mode. Default: true */
  showDevHint?: boolean;
  /** Callback when user clicks "Use CLI" button */
  onSwitchToCli?: () => void;
}

function AssistantChatInner({
  emptyStateText,
  suggestions,
  showHeader = true,
  showDevHint = true,
  onSwitchToCli,
  className,
}: Omit<AssistantChatProps, "apiUrl">) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const thread = useThread();
  const threadRuntime = useThreadRuntime();
  const isRunning = thread.isRunning;
  const messages = thread.messages;

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isRunning]);

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
            {messages.length > 0 && (
              <button
                onClick={() => window.location.reload()}
                className="text-[12px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-accent"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        {messages.length === 0 ? (
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
            {showDevHint && onSwitchToCli && (
              <p className="text-xs text-muted-foreground/60 text-center max-w-[260px] mt-2">
                In dev mode you can also use the{" "}
                <button
                  onClick={onSwitchToCli}
                  className="underline hover:text-muted-foreground"
                >
                  CLI terminal
                </button>{" "}
                for full Claude Code capabilities.
              </p>
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
            {isRunning && <ThinkingIndicator />}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-border px-3 py-3">
        <ComposerPrimitive.Root className="flex items-end gap-2 rounded-lg border border-input bg-background px-3 py-2 focus-within:ring-1 focus-within:ring-ring">
          <ComposerPrimitive.Input
            placeholder="Message agent..."
            submitMode="enter"
            cancelOnEscape
            className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none leading-relaxed min-h-[24px] max-h-[120px]"
            rows={1}
          />
          {isRunning ? (
            <ComposerPrimitive.Cancel asChild>
              <button className="shrink-0 flex h-8 w-8 items-center justify-center rounded-md bg-destructive text-destructive-foreground hover:opacity-90">
                <StopIcon className="h-3.5 w-3.5" />
              </button>
            </ComposerPrimitive.Cancel>
          ) : (
            <ComposerPrimitive.Send asChild>
              <button className="shrink-0 flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed">
                <SendIcon className="h-3.5 w-3.5" />
              </button>
            </ComposerPrimitive.Send>
          )}
        </ComposerPrimitive.Root>
      </div>
    </div>
  );
}

export function AssistantChat({ apiUrl, ...props }: AssistantChatProps) {
  const adapter = useMemo(() => createAgentChatAdapter({ apiUrl }), [apiUrl]);
  const runtime = useLocalRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex flex-1 flex-col h-full min-h-0">
        <AssistantChatInner {...props} />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
