import {
  IconAlertCircle,
  IconCheck,
  IconCircleDot,
  IconClock,
  IconCopy,
  IconEye,
  IconLoader2,
  IconPlayerPause,
  IconRefresh,
  IconShieldExclamation,
} from "@tabler/icons-react";
import { useState } from "react";

import type {
  ChatFirstAgentActivity,
  ChatFirstAgentActivityStatus,
} from "./chat-first.js";
import { writeClipboardText } from "./clipboard.js";

export interface ChatFirstAgentActivityPanelProps {
  activities: readonly ChatFirstAgentActivity[];
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onWatch?: (activity: ChatFirstAgentActivity) => void;
}

const STATUS_LABELS: Record<ChatFirstAgentActivityStatus, string> = {
  queued: "Queued",
  running: "Running",
  paused: "Paused",
  "needs-approval": "Needs approval",
  completed: "Completed",
  errored: "Needs attention",
  recent: "Recent",
  unknown: "Unknown",
};

function statusIcon(status: ChatFirstAgentActivityStatus) {
  if (status === "running" || status === "queued") return IconLoader2;
  if (status === "paused") return IconPlayerPause;
  if (status === "needs-approval") return IconShieldExclamation;
  if (status === "completed" || status === "recent") return IconCheck;
  if (status === "errored") return IconAlertCircle;
  return IconCircleDot;
}

function relativeTime(value: string | number | undefined): string {
  if (value === undefined) return "";
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function clampProgress(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function ChatFirstAgentActivityPanel({
  activities,
  loading = false,
  error = null,
  onRefresh,
  onWatch,
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

  return (
    <section
      className="chat-first-agent-activity"
      data-chat-first-agents-surface
      aria-label="Agent activity"
    >
      <header className="chat-first-agent-activity__header">
        <div>
          <p className="chat-first-agent-activity__eyebrow">Workspace</p>
          <h2>Agent activity</h2>
          <p>Follow runs and open a second session beside this chat.</p>
        </div>
        {onRefresh ? (
          <button
            type="button"
            className="chat-first-agent-activity__icon-button"
            onClick={onRefresh}
            aria-label="Refresh agent activity"
            title="Refresh agent activity"
          >
            <IconRefresh size={15} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      {error ? (
        <div
          className="chat-first-agent-activity__error"
          role="alert"
          data-chat-first-agents-error
        >
          <IconAlertCircle size={15} aria-hidden="true" />
          <span>{error}</span>
          {onRefresh ? (
            <button type="button" onClick={onRefresh}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {loading && activities.length === 0 ? (
        <div className="chat-first-agent-activity__list" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="chat-first-agent-activity__skeleton" key={index} />
          ))}
        </div>
      ) : activities.length === 0 ? (
        <div className="chat-first-agent-activity__empty">
          <IconClock size={18} aria-hidden="true" />
          <strong>No agent sessions yet</strong>
          <span>Start an agent run and it will appear here.</span>
        </div>
      ) : (
        <div className="chat-first-agent-activity__list">
          {activities.map((activity) => {
            const StatusIcon = statusIcon(activity.status);
            const progress = clampProgress(activity.progressPercent);
            const copied = copiedSessionId === activity.sessionId;
            return (
              <article
                className="chat-first-agent-activity__row"
                key={activity.sessionId}
              >
                <div className="chat-first-agent-activity__row-main">
                  <StatusIcon
                    size={15}
                    aria-hidden="true"
                    className={
                      activity.status === "running" ||
                      activity.status === "queued"
                        ? "chat-first-agent-activity__spinning"
                        : undefined
                    }
                  />
                  <div className="chat-first-agent-activity__copy">
                    <strong title={activity.title}>{activity.title}</strong>
                    <span>
                      {activity.subtitle || STATUS_LABELS[activity.status]}
                      {relativeTime(activity.updatedAt)
                        ? ` · ${relativeTime(activity.updatedAt)}`
                        : ""}
                    </span>
                    {progress !== null ? (
                      <span className="chat-first-agent-activity__progress">
                        <span style={{ width: `${progress}%` }} />
                      </span>
                    ) : null}
                  </div>
                  <span
                    className={`chat-first-agent-activity__status chat-first-agent-activity__status--${activity.status}`}
                  >
                    {STATUS_LABELS[activity.status]}
                  </span>
                </div>
                <div className="chat-first-agent-activity__actions">
                  {onWatch ? (
                    <button
                      type="button"
                      onClick={() => onWatch(activity)}
                      className="chat-first-agent-activity__action chat-first-agent-activity__action--primary"
                    >
                      <IconEye size={13} aria-hidden="true" />
                      Watch
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void copySessionId(activity.sessionId)}
                    className="chat-first-agent-activity__action"
                    aria-label={`Copy session ID for ${activity.title}`}
                    title={copied ? "Session ID copied" : "Copy session ID"}
                  >
                    <IconCopy size={13} aria-hidden="true" />
                    {copied ? "Copied" : "ID"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
