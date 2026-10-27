import type {
  ChatThreadListRow,
  ChatThreadSummary,
} from "@agent-native/core/client/agent-chat";
import type { ChatHistoryItem } from "@agent-native/toolkit/chat-history/ChatHistoryList";
import { createElement } from "react";

import { ChatOwnerAvatar } from "./ChatOwnerAvatar.js";

export interface OwnDraftRow {
  id: string;
  title?: string;
  preview?: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  persisted?: boolean;
}

export interface OwnDraftRowsOptions {
  threads: readonly ChatThreadSummary[];
  isNewThread: (id: string) => boolean;
  observedThreadStarts?: ReadonlyMap<string, number>;
  activeId?: string | null;
}

export function ownDraftRows({
  threads,
  isNewThread,
  observedThreadStarts,
  activeId,
}: OwnDraftRowsOptions): OwnDraftRow[] {
  const rows: OwnDraftRow[] = [];
  const known = new Set(threads.map((thread) => thread.id));
  for (const thread of threads) {
    if (thread.archivedAt != null) continue;
    const metadataAbsent =
      thread.ownerEmail === undefined &&
      thread.accessBasis === undefined &&
      thread.visibility === undefined;
    const owned = thread.accessBasis === "owner" && !!thread.ownerEmail;
    if (!owned && !(metadataAbsent && isNewThread(thread.id))) continue;
    if (
      thread.messageCount <= 0 &&
      !observedThreadStarts?.has(thread.id) &&
      thread.id !== activeId
    )
      continue;
    rows.push({
      id: thread.id,
      title: thread.title,
      preview: thread.preview,
      messageCount: thread.messageCount,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      persisted: owned,
    });
  }
  for (const [id, startedAt] of observedThreadStarts ?? []) {
    if (known.has(id) || !isNewThread(id)) continue;
    rows.push({
      id,
      title: "",
      messageCount: 0,
      createdAt: startedAt,
      updatedAt: startedAt,
      persisted: false,
    });
  }
  return rows;
}

export interface ChatThreadHistoryItemOptions {
  t: (key: string, options?: Record<string, unknown>) => string;
  activeId?: string | null;
  locale?: string;
  now?: number;
}

function threadAge(updatedAt: number, locale: string, now: number): string {
  const minutes = Math.floor(Math.max(0, now - updatedAt) / 60_000);
  const relative = new Intl.RelativeTimeFormat(locale, {
    style: "narrow",
    numeric: "auto",
  });
  if (minutes < 60) return relative.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return relative.format(-hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 7) return relative.format(-days, "day");
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(updatedAt);
}

export function chatThreadToHistoryItem(
  row: ChatThreadListRow,
  {
    t,
    activeId,
    locale = "en-US",
    now = Date.now(),
  }: ChatThreadHistoryItemOptions,
): ChatHistoryItem {
  const title = row.title || row.preview || t("agentChat.history.untitledChat");
  const shared = row.accessBasis !== "owner";
  return {
    id: row.id,
    title,
    titleText: title,
    timestamp:
      row.id === activeId ? undefined : threadAge(row.updatedAt, locale, now),
    accessBasis: row.accessBasis,
    pinned: row.pinnedAt != null,
    ...(shared
      ? {
          ownerAvatar: createElement(ChatOwnerAvatar, {
            email: row.ownerEmail,
            label: t("agentChat.history.ownedBy", { name: row.ownerEmail }),
          }),
          ownerLabel: row.ownerEmail,
          accessLabel: t(
            row.accessBasis === "direct"
              ? "agentChat.history.accessDirect"
              : "agentChat.history.accessOrganization",
          ),
          readOnly: true,
        }
      : {}),
  };
}

export function ownDraftToHistoryItem(
  row: OwnDraftRow,
  options: ChatThreadHistoryItemOptions,
): ChatHistoryItem {
  const title =
    row.title || row.preview || options.t("agentChat.history.untitledChat");
  return {
    id: row.id,
    title,
    titleText: title,
    accessBasis: "owner",
    hideActions: row.persisted !== true,
    timestamp:
      row.id === options.activeId
        ? undefined
        : threadAge(
            row.updatedAt,
            options.locale ?? "en-US",
            options.now ?? Date.now(),
          ),
    pinned: false,
  };
}
