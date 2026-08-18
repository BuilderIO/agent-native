import {
  IconAlertCircle,
  IconAsteriskSimple,
  IconCopy,
  IconDiamond,
  IconEye,
  IconFlower,
  IconHexagon,
  IconRosette,
  IconRefresh,
  IconSparkles,
  type TablerIcon,
} from "@tabler/icons-react";
import { useState } from "react";

import type {
  ChatFirstAgentActivity,
  ChatFirstAgentActivityStatus,
} from "./chat-first.js";
import { defaultChatFirstCopy } from "./chat-first/copy.js";
import type { ChatFirstCopy } from "./chat-first/types.js";
import { writeClipboardText } from "./clipboard.js";
import { cn } from "./utils.js";

export interface ChatFirstAgentActivityPanelProps {
  activities: readonly ChatFirstAgentActivity[];
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onWatch?: (activity: ChatFirstAgentActivity) => void;
  copy?: ChatFirstCopy;
}

const STATUS_KEYS: Record<ChatFirstAgentActivityStatus, string> = {
  queued: "agentActivityStatusQueued",
  running: "agentActivityStatusRunning",
  paused: "agentActivityStatusPaused",
  "needs-approval": "agentActivityStatusNeedsApproval",
  completed: "agentActivityStatusCompleted",
  errored: "agentActivityStatusErrored",
  recent: "agentActivityStatusRecent",
  unknown: "agentActivityStatusUnknown",
};

const AGENT_GLYPHS: Array<{ icon: TablerIcon; color: string }> = [
  { icon: IconSparkles, color: "text-primary" },
  { icon: IconFlower, color: "text-destructive" },
  { icon: IconRosette, color: "text-accent-foreground" },
  { icon: IconHexagon, color: "text-ring" },
  { icon: IconDiamond, color: "text-primary/70" },
  { icon: IconAsteriskSimple, color: "text-muted-foreground" },
];

function glyphForSession(sessionId: string) {
  let hash = 0;
  for (const character of sessionId) {
    hash = (hash * 31 + character.codePointAt(0)!) | 0;
  }
  return AGENT_GLYPHS[Math.abs(hash) % AGENT_GLYPHS.length];
}

export function ChatFirstAgentActivityPanel({
  activities,
  loading = false,
  error = null,
  onRefresh,
  onWatch,
  copy = defaultChatFirstCopy,
}: ChatFirstAgentActivityPanelProps) {
  const [copiedSessionId, setCopiedSessionId] = useState<string | null>(null);

  async function copySessionId(sessionId: string) {
    const copied = await writeClipboardText(sessionId);
    if (!copied) return;
    setCopiedSessionId(sessionId);
    window.setTimeout(() => {
      setCopiedSessionId((current) => (current === sessionId ? null : current));
    }, 1600);
  }

  const statusLabel = (status: ChatFirstAgentActivityStatus) =>
    copy(STATUS_KEYS[status]);

  return (
    <section
      className="flex min-h-0 flex-col overflow-auto px-3 pb-3 pt-2"
      data-chat-first-agents-surface
      aria-label={copy("agentsTitle")}
    >
      <header className="flex min-h-7 items-center justify-between gap-2 px-2">
        <p className="m-0 text-[11px] font-medium text-muted-foreground">
          {copy("agentsTitle")}
        </p>
        {onRefresh ? (
          <button
            type="button"
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onRefresh}
            aria-label={copy("refreshAgentActivity")}
            title={copy("refreshAgentActivity")}
          >
            <IconRefresh size={15} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      {error ? (
        <div
          className="flex items-center gap-1.5 px-2 py-2 text-[11px] text-destructive"
          role="alert"
          data-chat-first-agents-error
        >
          <IconAlertCircle size={15} aria-hidden="true" />
          <span>{error}</span>
          {onRefresh ? (
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={onRefresh}
            >
              {copy("retry")}
            </button>
          ) : null}
        </div>
      ) : null}

      {loading && activities.length === 0 ? (
        <div className="grid min-h-0 gap-px" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="flex h-7 items-center gap-2 px-2" key={index}>
              <span className="size-3 animate-pulse rounded-full bg-muted" />
              <span className="h-2.5 w-28 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : activities.length === 0 ? (
        <p className="m-0 px-2 py-3 text-[11px] text-muted-foreground">
          {copy("noAgentSessions")}
        </p>
      ) : (
        <div className="grid min-h-0 gap-px">
          {activities.map((activity) => {
            const { icon: AgentGlyph, color } = glyphForSession(
              activity.sessionId,
            );
            const copied = copiedSessionId === activity.sessionId;
            return (
              <div
                className="group flex min-h-7 items-center gap-2 rounded-md px-2 py-0.5 transition-colors hover:bg-accent/50 focus-within:bg-accent/50"
                key={activity.sessionId}
              >
                <AgentGlyph
                  size={14}
                  strokeWidth={1.9}
                  aria-hidden="true"
                  className={cn("shrink-0", color)}
                />
                <strong
                  className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground"
                  title={activity.title}
                >
                  {activity.title}
                </strong>
                <span className="shrink-0 text-[10px] text-muted-foreground group-hover:hidden group-focus-within:hidden">
                  {statusLabel(activity.status)}
                </span>
                <div className="ms-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  {onWatch ? (
                    <button
                      type="button"
                      onClick={() => onWatch(activity)}
                      className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={copy("watchSession")}
                      title={copy("watchSession")}
                    >
                      <IconEye size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void copySessionId(activity.sessionId)}
                    className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={copy("copySessionIdFor", {
                      name: activity.title,
                    })}
                    title={
                      copied ? copy("sessionIdCopied") : copy("copySessionId")
                    }
                  >
                    <IconCopy size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
