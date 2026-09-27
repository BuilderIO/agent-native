import {
  IconCalendarEvent,
  IconCheck,
  IconFilter,
  IconMail,
  IconShare3,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";

import {
  normalizeActionChangeResult,
  type ActionChange,
} from "../../../action-ui.js";
import { readClientAppState } from "../../application-state.js";
import { compactOutlineButtonClassName } from "../../components/ui/button-classes.js";
import { useT } from "../../i18n.js";
import { cn } from "../../utils.js";
import type { ToolRendererProps } from "../tool-render-registry.js";
import { ActionCard } from "./ActionCard.js";

const kindIcons = {
  "email-draft": IconMail,
  email: IconMail,
  "scheduled-email": IconMail,
  "calendar-time-choice": IconCalendarEvent,
  "booking-link": IconCalendarEvent,
  "mail-rule": IconFilter,
  "gmail-filter": IconFilter,
  "mail-filter": IconFilter,
  "resource-share": IconShare3,
  "calendar-event": IconCalendarEvent,
} as const;

function formatResourceShareDetail(
  value: string,
  t: ReturnType<typeof useT>,
): string {
  const visibilityLabel: Record<string, string> = {
    private: "agentChat.share.private",
    org: "agentChat.share.organization",
    public: "agentChat.share.public",
  };
  const visibilityKey = visibilityLabel[value];
  if (visibilityKey) return t(visibilityKey);

  const [principal = "", role] = value.split(" · ", 2);
  const separator = principal.indexOf(":");
  if (separator < 0) return value;

  const type = principal.slice(0, separator);
  const id = principal.slice(separator + 1);
  const audience =
    type === "user"
      ? id
      : type === "group"
        ? t("agentChat.share.userGroup")
        : type === "org"
          ? t("agentChat.share.organization")
          : id;
  const roleKey =
    role && ["viewer", "commenter", "editor", "admin"].includes(role)
      ? `agentChat.share.${role}`
      : undefined;
  return [audience, roleKey ? t(roleKey) : role].filter(Boolean).join(" · ");
}

function safeActionUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("/")) {
    if (value.startsWith("//")) return undefined;
    try {
      const url = new URL(value, "https://agent-native.invalid");
      return url.origin === "https://agent-native.invalid"
        ? `${url.pathname}${url.search}${url.hash}`
        : undefined;
    } catch {
      // coercion-ok: malformed action links must be rejected before rendering.
      return undefined;
    }
  }
  if (!/^https:\/\//i.test(value)) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    // coercion-ok: malformed action links must be rejected before rendering.
    return undefined;
  }
}

function undoStateKey(widgetId: string | undefined): string | undefined {
  return widgetId && /^[A-Za-z0-9:_-]{1,200}$/.test(widgetId)
    ? `action-change-undo:${widgetId}`
    : undefined;
}

function formatScheduledDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

export function ActionCardSkeleton() {
  const t = useT();
  return (
    <div
      aria-label={t("agentChat.widget.loadingToolResult")}
      className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-sm"
    >
      <span className="size-9 shrink-0 animate-pulse rounded-md bg-muted" />
      <span className="min-w-0 flex-1 space-y-2">
        <span className="block h-3 w-2/3 animate-pulse rounded bg-muted" />
        <span className="block h-2.5 w-1/2 animate-pulse rounded bg-muted" />
      </span>
      <span className="h-5 w-14 shrink-0 animate-pulse rounded-full bg-muted" />
      <span className="h-8 w-16 shrink-0 animate-pulse rounded-md bg-muted" />
    </div>
  );
}

function ActionChangeCard({
  change,
  widgetId,
  grouped = false,
}: {
  change: ActionChange;
  widgetId?: string;
  grouped?: boolean;
}) {
  const t = useT();
  // Older clients persisted this marker before dispatching a result-provided
  // inverse action. Read it only to keep interrupted attempts visibly locked.
  const stateKey = change.undo ? undoStateKey(widgetId) : undefined;
  const [undoState, setUndoState] = useState<
    "checking" | "ready" | "undone" | "unknown"
  >(() => (stateKey ? "checking" : "ready"));
  const Icon = kindIcons[change.kind as keyof typeof kindIcons] ?? IconCheck;
  const status =
    undoState === "undone"
      ? t("agentChat.widget.actionStatus.undone")
      : change.kind === "calendar-time-choice"
        ? t("agentChat.widget.actionStatus.suggested")
        : change.kind === "email-draft" && change.verb === "created"
          ? t("agentChat.widget.actionStatus.draftReview")
          : t(`agentChat.widget.actionStatus.${change.verb}`);
  const href = safeActionUrl(change.url);
  const title =
    change.kind === "calendar-time-choice"
      ? t("agentChat.widget.actionBestSharedTime")
      : change.kind === "booking-link" && change.titleIsFallback
        ? t("agentChat.widget.actionBookingLink")
        : change.kind === "scheduled-email" && change.titleIsFallback
          ? t("agentChat.widget.actionScheduledEmail")
          : change.title;
  const detail =
    change.kind === "email-draft" && change.verb === "created"
      ? change.detail
        ? t("agentChat.widget.actionDraftSavedDetail", {
            recipient: change.detail,
          })
        : t("agentChat.widget.actionDraftSaved")
      : change.kind === "resource-share" && change.detail
        ? formatResourceShareDetail(change.detail, t)
        : change.detail;
  const formattedDetail =
    change.kind === "scheduled-email"
      ? formatScheduledDate(change.detail)
      : change.kind === "booking-link" &&
          change.detail &&
          /^\d+$/.test(change.detail)
        ? t("agentChat.widget.actionDurationMinutes", {
            count: Number(change.detail),
          })
        : detail;

  useEffect(() => {
    if (!stateKey) {
      setUndoState("ready");
      return;
    }
    let current = true;
    void readClientAppState<{ status?: string }>(stateKey)
      .then((stored) => {
        if (!current) return;
        setUndoState(
          stored?.status === "undone"
            ? "undone"
            : stored?.status === "pending" || stored?.status === "unknown"
              ? "unknown"
              : "ready",
        );
      })
      .catch(() => {
        if (current) setUndoState("unknown");
      });
    return () => {
      current = false;
    };
  }, [stateKey]);

  const action =
    stateKey && undoState === "unknown" ? (
      <button
        type="button"
        disabled
        className={compactOutlineButtonClassName}
        aria-live="polite"
      >
        {t("agentChat.widget.actionUndoUnknown")}
      </button>
    ) : href ? (
      <a
        href={href}
        target={href.startsWith("https://") ? "_blank" : undefined}
        rel={href.startsWith("https://") ? "noopener noreferrer" : undefined}
        className={cn(
          compactOutlineButtonClassName,
          "no-underline hover:no-underline",
        )}
      >
        {t(
          change.kind === "calendar-time-choice"
            ? "agentChat.widget.actionUseThisTime"
            : change.kind === "email-draft"
              ? "agentChat.widget.actionReview"
              : "agentChat.widget.actionOpen",
        )}
      </a>
    ) : null;

  return (
    <ActionCard
      icon={<Icon aria-hidden="true" className="size-4" />}
      title={title}
      detail={formattedDetail}
      status={status}
      action={action}
      className={
        grouped ? "rounded-none border-0 bg-transparent px-0 shadow-none" : ""
      }
    />
  );
}

export function RecordChangeWidget({ context }: ToolRendererProps) {
  const changes = (
    context.relatedResults ?? [
      { widgetId: context.widgetId ?? "", result: context.resultJson },
    ]
  )
    .map(({ widgetId, result }) => {
      const normalized = normalizeActionChangeResult(result);
      if (!normalized) return null;
      return {
        change: normalized.change,
        widgetId,
      };
    })
    .filter(
      (result): result is { change: ActionChange; widgetId: string } =>
        result !== null,
    );
  if (changes.length === 0 && context.isRunning) return <ActionCardSkeleton />;
  if (changes.length > 1) return <RecordChangeGroup changes={changes} />;
  return changes[0] ? <ActionChangeCard {...changes[0]} /> : null;
}

export function RecordChangeGroup({
  changes,
}: {
  changes: Array<{ change: ActionChange; widgetId: string }>;
}) {
  const t = useT();
  if (changes.length < 2) {
    return changes[0] ? <ActionChangeCard {...changes[0]} /> : null;
  }
  return (
    <div
      role="group"
      aria-label={t("agentChat.widget.actionChanges", {
        count: changes.length,
      })}
      className="overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm"
    >
      <p className="px-3 pt-3 text-xs font-medium text-muted-foreground">
        {t("agentChat.widget.actionChanges", { count: changes.length })}
      </p>
      <div className="divide-y divide-border px-3 pb-2">
        {changes.map(({ change, widgetId }, index) => (
          <ActionChangeCard
            key={`${widgetId}:${change.kind}:${index}`}
            change={change}
            widgetId={widgetId}
            grouped
          />
        ))}
      </div>
    </div>
  );
}
