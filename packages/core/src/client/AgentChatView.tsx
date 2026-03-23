/**
 * AgentChatView — Standalone chat UI for the production agent.
 *
 * Renders a message list with tool call visualization and a text input.
 * Can be used inside ProductionAgentPanel or embedded independently
 * (e.g., in the CLI harness sidebar).
 *
 * Usage:
 *   import { AgentChatView, useProductionAgent } from "@agent-native/core/client";
 *   const agent = useProductionAgent({ apiBase: "/api/myapp" });
 *   <AgentChatView {...agent} />
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import type { ProductionAgentMessage } from "./useProductionAgent.js";

// ─── Utilities ──────────────────────────────────────────────────────────────

function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

// ─── Icons ──────────────────────────────────────────────────────────────────

function AgentIcon({ className }: { className?: string }) {
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
      <path d="M12 2a6 6 0 0 1 6 6v2a6 6 0 0 1-12 0V8a6 6 0 0 1 6-6z" />
      <path d="M9 22v-2a3 3 0 0 1 6 0v2" />
      <path d="M2 18a10 10 0 0 1 20 0" />
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
      <path d="m22 2-7 20-4-9-9-4 20-7z" />
      <path d="M22 2 11 13" />
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

// ─── Tool call display ──────────────────────────────────────────────────────

function ToolCallBubble({
  tool,
  input,
  result,
}: {
  tool: string;
  input: Record<string, string>;
  result?: string;
}) {
  const args = Object.entries(input)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  const pending = result === undefined;

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2 text-[12px] font-mono",
        pending
          ? "bg-amber-500/10 text-amber-400/80"
          : "bg-white/5 text-white/40",
      )}
    >
      <span className="shrink-0 mt-0.5">
        {pending ? (
          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
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
          <svg
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              d="M20 7 9 18l-5-5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span className="min-w-0">
        <span className="text-white/60">{tool}</span>
        {args && <span className="text-white/30 ml-1">({args})</span>}
      </span>
    </div>
  );
}

// ─── Message bubble ─────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ProductionAgentMessage }) {
  const isUser = msg.role === "user";

  return (
    <div
      className={cn(
        "flex flex-col gap-1",
        isUser ? "items-end" : "items-start",
      )}
    >
      {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
        <div className="flex flex-col gap-1 w-full max-w-[85%]">
          {msg.toolCalls.map((tc, i) => (
            <ToolCallBubble
              key={i}
              tool={tc.tool}
              input={tc.input}
              result={tc.result}
            />
          ))}
        </div>
      )}
      {msg.content && (
        <div
          className={cn(
            "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap break-words",
            isUser
              ? "bg-white text-black rounded-br-sm"
              : "bg-white/10 text-white/90 rounded-bl-sm",
          )}
        >
          {msg.content}
        </div>
      )}
    </div>
  );
}

// ─── Thinking indicator ─────────────────────────────────────────────────────

function ThinkingIndicator() {
  return (
    <div className="flex items-start">
      <div className="rounded-2xl rounded-bl-sm bg-white/10 px-4 py-3">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-white/40 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export interface AgentChatViewProps {
  messages: ProductionAgentMessage[];
  isGenerating: boolean;
  sendMessage: (text: string) => void;
  clearHistory: () => void;
  /** Placeholder text for empty state. Default: "Ask the agent anything" */
  emptyStateText?: string;
  /** Suggestion prompts shown when no messages */
  suggestions?: string[];
  /** Whether to show the header bar. Default: true */
  showHeader?: boolean;
  /** CSS class for the outer container */
  className?: string;
}

export function AgentChatView({
  messages,
  isGenerating,
  sendMessage,
  clearHistory,
  emptyStateText = "Ask the agent anything",
  suggestions,
  showHeader = true,
  className,
}: AgentChatViewProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isGenerating]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isGenerating) return;
    setInput("");
    sendMessage(text);
  }, [input, isGenerating, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  return (
    <div
      className={cn(
        "flex flex-1 flex-col overflow-hidden bg-[#111]",
        className,
      )}
    >
      {/* Header */}
      {showHeader && (
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/[0.08] px-4">
          <span className="text-[13px] font-medium text-white/60">Agent</span>
          {messages.length > 0 && (
            <button
              onClick={clearHistory}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-white/30 hover:text-white/60 hover:bg-white/5"
              title="Clear conversation"
            >
              <TrashIcon className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12">
            <div className="h-10 w-10 rounded-full bg-white/5 flex items-center justify-center">
              <AgentIcon className="h-5 w-5 text-white/30" />
            </div>
            <p className="text-[13px] text-white/30 text-center max-w-[200px]">
              {emptyStateText}
            </p>
            {suggestions && suggestions.length > 0 && (
              <div className="flex flex-col gap-1.5 w-full max-w-[260px]">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => sendMessage(suggestion)}
                    className="w-full rounded-xl border border-white/[0.08] px-3 py-2 text-left text-[12.5px] text-white/40 hover:bg-white/5 hover:text-white/60"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        {isGenerating &&
          messages[messages.length - 1]?.role !== "assistant" && (
            <ThinkingIndicator />
          )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-white/[0.08] px-3 py-3">
        <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message agent..."
            rows={1}
            className="flex-1 resize-none bg-transparent text-[14px] text-white placeholder:text-white/25 outline-none leading-relaxed min-h-[24px]"
            style={{ maxHeight: 120 }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isGenerating}
            className={cn(
              "shrink-0 flex h-7 w-7 items-center justify-center rounded-full",
              input.trim() && !isGenerating
                ? "bg-white text-black"
                : "bg-white/10 text-white/20",
            )}
          >
            <SendIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
