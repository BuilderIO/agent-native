import { useMemo, useState } from "react";
import {
  IconChevronRight,
  IconCircleCheck,
  IconAlertCircle,
  IconMessage,
  IconRobot,
  IconTool,
  IconUser,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export interface TranscriptEvent {
  seq: number;
  event: Record<string, unknown>;
}

interface RunTranscriptProps {
  events: TranscriptEvent[];
  /** Pulse the live indicator while the run is in-flight. */
  isLive?: boolean;
}

type NormalizedKind =
  | "user-message"
  | "assistant-message"
  | "tool-call"
  | "tool-result"
  | "agent-call"
  | "error"
  | "status";

interface NormalizedEntry {
  key: string;
  seq: number;
  kind: NormalizedKind;
  /** Tool calls and results are paired so the result can render inline. */
  tool?: string;
  /** Heading line — shown collapsed. */
  heading: string;
  /** Body shown when expanded. */
  body?: string;
  /** Raw event for the tool-result that follows a tool-call. */
  pairedResult?: NormalizedEntry;
}

/**
 * Collapsible timeline of agent-chat events for a single run.
 *
 * `agent_chat_events` come from the framework's run-store with the same
 * shape `AgentChatEvent` uses — text, tool_start/tool_done, agent_call,
 * error, etc. We collapse paired tool_start / tool_done so the user sees
 * one row per logical step with the result tucked in.
 */
export function RunTranscript({ events, isLive = false }: RunTranscriptProps) {
  const entries = useMemo(() => normalizeEvents(events), [events]);

  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No transcript events yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <TranscriptEntryRow key={entry.key} entry={entry} />
      ))}
      {isLive ? (
        <div
          className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground"
          aria-live="polite"
        >
          <span
            aria-hidden
            className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-500"
          />
          Live — new events stream in as the agent works.
        </div>
      ) : null}
    </div>
  );
}

function TranscriptEntryRow({ entry }: { entry: NormalizedEntry }) {
  const collapsible = entry.kind === "tool-call" || Boolean(entry.body);
  const [open, setOpen] = useState(entry.kind === "error");

  if (entry.kind === "status") {
    return (
      <div className="px-2 py-1 text-xs italic text-muted-foreground">
        {entry.heading}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md border bg-card",
        entry.kind === "error" && "border-red-500/30 bg-red-500/5",
        entry.kind === "user-message" && "border-blue-500/20 bg-blue-500/5",
      )}
    >
      <button
        type="button"
        onClick={() => collapsible && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm",
          collapsible && "cursor-pointer hover:bg-accent/40",
          !collapsible && "cursor-default",
        )}
        aria-expanded={collapsible ? open : undefined}
      >
        <KindIcon kind={entry.kind} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <KindLabel kind={entry.kind} tool={entry.tool} />
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                entry.kind === "assistant-message" && "text-foreground",
                entry.kind === "user-message" && "font-medium text-foreground",
                entry.kind === "tool-call" && "text-muted-foreground",
                entry.kind === "error" &&
                  "font-medium text-red-700 dark:text-red-300",
              )}
            >
              {entry.heading}
            </span>
          </div>
        </div>
        {collapsible ? (
          <IconChevronRight
            size={14}
            className={cn(
              "mt-1 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
            aria-hidden
          />
        ) : null}
      </button>
      {open && collapsible ? (
        <div className="space-y-2 border-t border-border bg-muted/30 px-3 py-2 text-xs">
          {entry.body ? (
            <pre className="whitespace-pre-wrap break-words font-mono leading-snug text-foreground/80">
              {entry.body}
            </pre>
          ) : null}
          {entry.pairedResult ? (
            <div className="space-y-1 border-t border-border/60 pt-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <IconCircleCheck size={11} aria-hidden /> Result
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono leading-snug text-foreground/80">
                {entry.pairedResult.body ?? entry.pairedResult.heading}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function KindIcon({ kind }: { kind: NormalizedKind }) {
  switch (kind) {
    case "assistant-message":
      return (
        <IconRobot
          size={16}
          className="mt-0.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
      );
    case "user-message":
      return (
        <IconUser
          size={16}
          className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400"
          aria-hidden
        />
      );
    case "tool-call":
      return (
        <IconTool
          size={16}
          className="mt-0.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
      );
    case "tool-result":
      return (
        <IconCircleCheck
          size={16}
          className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden
        />
      );
    case "agent-call":
      return (
        <IconMessage
          size={16}
          className="mt-0.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
      );
    case "error":
      return (
        <IconAlertCircle
          size={16}
          className="mt-0.5 shrink-0 text-red-600 dark:text-red-400"
          aria-hidden
        />
      );
    default:
      return null;
  }
}

function KindLabel({ kind, tool }: { kind: NormalizedKind; tool?: string }) {
  let text: string | null = null;
  switch (kind) {
    case "assistant-message":
      text = "Assistant";
      break;
    case "user-message":
      text = "You";
      break;
    case "tool-call":
      text = tool ?? "Tool";
      break;
    case "agent-call":
      text = "Sub-agent";
      break;
    case "error":
      text = "Error";
      break;
    default:
      return null;
  }
  return (
    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Event normalization
// ---------------------------------------------------------------------------

function normalizeEvents(events: TranscriptEvent[]): NormalizedEntry[] {
  const out: NormalizedEntry[] = [];
  // Map from tool-name → pending tool-call entry, so a tool_done can find
  // its matching tool_start. The framework's run-store doesn't carry a
  // correlation id, so we match on tool name + nearest unresolved entry.
  const pendingByTool = new Map<string, NormalizedEntry>();

  for (const ev of events) {
    const e = ev.event;
    const type = e.type as string | undefined;
    const key = `${ev.seq}`;

    if (type === "text" && typeof e.text === "string") {
      const text = e.text.trim();
      if (!text) continue;
      // Heuristic: framework-side runs only emit assistant text via
      // `text` events. User messages aren't replayed as events from the
      // run-store, so any `text` event we see is the assistant.
      out.push({
        key,
        seq: ev.seq,
        kind: "assistant-message",
        heading: text.split("\n")[0].slice(0, 280),
        body: text.length > 280 || text.includes("\n") ? text : undefined,
      });
      continue;
    }

    if (type === "tool_start") {
      const tool = (e.tool as string) ?? "tool";
      const input = e.input as Record<string, unknown> | undefined;
      const heading = formatToolInput(input);
      const entry: NormalizedEntry = {
        key,
        seq: ev.seq,
        kind: "tool-call",
        tool,
        heading: heading || "(no input)",
        body: input ? safeStringify(input) : undefined,
      };
      out.push(entry);
      pendingByTool.set(tool, entry);
      continue;
    }

    if (type === "tool_done") {
      const tool = (e.tool as string) ?? "tool";
      const result = (e.result as string) ?? "";
      const pending = pendingByTool.get(tool);
      if (pending) {
        pending.pairedResult = {
          key: `${key}-result`,
          seq: ev.seq,
          kind: "tool-result",
          heading: snippet(result, 120),
          body: result || undefined,
        };
        pendingByTool.delete(tool);
      } else {
        // Stray tool_done — render its own row.
        out.push({
          key,
          seq: ev.seq,
          kind: "tool-result",
          tool,
          heading: snippet(result, 120) || "Tool result",
          body: result || undefined,
        });
      }
      continue;
    }

    if (type === "agent_call" || type === "agent_call_text") {
      const agent = (e.agent as string) ?? "agent";
      const text =
        type === "agent_call_text" && typeof e.text === "string"
          ? e.text
          : ((e.status as string) ?? "called");
      out.push({
        key,
        seq: ev.seq,
        kind: "agent-call",
        heading: `${agent}: ${snippet(text, 200)}`,
        body: text.length > 200 ? text : undefined,
      });
      continue;
    }

    if (type === "error") {
      const text =
        (e.error as string) ?? (e.details as string) ?? "Unknown error";
      out.push({
        key,
        seq: ev.seq,
        kind: "error",
        heading: snippet(text, 280),
        body: text.length > 280 ? text : undefined,
      });
      continue;
    }

    if (type === "activity") {
      const label = (e.label as string) ?? "Working";
      out.push({
        key,
        seq: ev.seq,
        kind: "status",
        heading: label,
      });
      continue;
    }

    if (type === "loop_limit") {
      out.push({
        key,
        seq: ev.seq,
        kind: "status",
        heading: "Reached the maximum loop iterations.",
      });
      continue;
    }

    if (type === "auto_continue") {
      const reason = (e.reason as string) ?? "auto-continue";
      out.push({
        key,
        seq: ev.seq,
        kind: "status",
        heading: `Auto-continuing (${reason}).`,
      });
      continue;
    }

    if (type === "missing_api_key") {
      out.push({
        key,
        seq: ev.seq,
        kind: "error",
        heading: "Missing API key — the agent can't continue.",
      });
      continue;
    }

    // `done` and `clear` and unknown events: skip silently.
  }

  return out;
}

function formatToolInput(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  // Prefer commonly meaningful keys for the inline summary.
  const preferred = ["path", "file", "url", "query", "command", "name", "id"];
  for (const key of preferred) {
    const v = input[key];
    if (typeof v === "string" && v.length > 0) {
      return `${key}: ${snippet(v, 120)}`;
    }
  }
  const entries = Object.entries(input);
  if (entries.length === 0) return "";
  const [k, v] = entries[0];
  return `${k}: ${snippet(typeof v === "string" ? v : JSON.stringify(v), 120)}`;
}

function snippet(text: string, max: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
