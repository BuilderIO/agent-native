import React, { useState, useMemo } from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ActionBarPrimitive,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import type { FC } from "react";
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

function TrashIcon({ className }: { className?: string }) {
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
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
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
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

// ─── Markdown Text ──────────────────────────────────────────────────────────

const MarkdownText: FC<any> = (props) => {
  return (
    <MarkdownTextPrimitive
      {...props}
      className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-pre:my-2 prose-headings:my-2 prose-li:my-0.5 prose-code:text-[13px] prose-code:before:content-none prose-code:after:content-none"
    />
  );
};

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
            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
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
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-3.5 py-2.5 text-sm leading-relaxed">
        <MessagePrimitive.Parts
          components={{
            Text: ({ text }) => (
              <span className="whitespace-pre-wrap">{text}</span>
            ),
          }}
        />
      </div>
    </div>
  );
}

function AssistantMessage() {
  return (
    <div className="group relative">
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
      {/* Action bar: copy + retry on hover */}
      <div className="mt-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
        <ActionBarPrimitive.Copy asChild>
          <button className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
            <CopyIcon className="h-3.5 w-3.5" />
          </button>
        </ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload asChild>
          <button className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
            <RefreshIcon className="h-3.5 w-3.5" />
          </button>
        </ActionBarPrimitive.Reload>
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

// ─── Thread Components ──────────────────────────────────────────────────────

function EmptyState({
  text,
  suggestions,
}: {
  text?: string;
  suggestions?: string[];
}) {
  return (
    <ThreadPrimitive.Empty>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-12">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <SparklesIcon className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground text-center max-w-[240px]">
          {text ?? "How can I help you?"}
        </p>
        {suggestions && suggestions.length > 0 && (
          <div className="flex flex-col gap-1.5 w-full max-w-[280px]">
            {suggestions.map((suggestion) => (
              <ThreadPrimitive.Suggestion
                key={suggestion}
                prompt={suggestion}
                autoSend
                asChild
              >
                <button className="w-full rounded-lg border border-border px-3 py-2 text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground">
                  {suggestion}
                </button>
              </ThreadPrimitive.Suggestion>
            ))}
          </div>
        )}
      </div>
    </ThreadPrimitive.Empty>
  );
}

function ScrollToBottom() {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <button className="absolute bottom-2 left-1/2 -translate-x-1/2 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background shadow-sm text-muted-foreground hover:text-foreground hover:bg-accent">
        <ArrowDownIcon className="h-4 w-4" />
      </button>
    </ThreadPrimitive.ScrollToBottom>
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
}

function AssistantChatInner({
  emptyStateText,
  suggestions,
  showHeader = true,
  className,
}: Omit<AssistantChatProps, "apiUrl">) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col overflow-hidden bg-background",
        className,
      )}
    >
      {showHeader && (
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
          <span className="text-[13px] font-medium text-muted-foreground">
            Agent
          </span>
        </div>
      )}

      <ThreadPrimitive.Root className="flex flex-1 flex-col overflow-hidden">
        <ThreadPrimitive.Viewport className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-[3px] [&::-webkit-scrollbar-thumb]:bg-border hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/40">
          <EmptyState text={emptyStateText} suggestions={suggestions} />

          <ThreadPrimitive.Messages
            components={{
              UserMessage,
              AssistantMessage,
            }}
          />

          {/* Thinking indicator while generating with no content yet */}
          <ThreadPrimitive.If running>
            <ThinkingIndicator />
          </ThreadPrimitive.If>
        </ThreadPrimitive.Viewport>

        <ScrollToBottom />

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
            <ThreadPrimitive.If running>
              <ComposerPrimitive.Cancel asChild>
                <button className="shrink-0 flex h-8 w-8 items-center justify-center rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  <StopIcon className="h-3.5 w-3.5" />
                </button>
              </ComposerPrimitive.Cancel>
            </ThreadPrimitive.If>
            <ThreadPrimitive.If running={false}>
              <ComposerPrimitive.Send asChild>
                <button className="shrink-0 flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed">
                  <SendIcon className="h-3.5 w-3.5" />
                </button>
              </ComposerPrimitive.Send>
            </ThreadPrimitive.If>
          </ComposerPrimitive.Root>
        </div>
      </ThreadPrimitive.Root>
    </div>
  );
}

export function AssistantChat({ apiUrl, ...props }: AssistantChatProps) {
  const adapter = useMemo(() => createAgentChatAdapter({ apiUrl }), [apiUrl]);
  const runtime = useLocalRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AssistantChatInner {...props} />
    </AssistantRuntimeProvider>
  );
}
