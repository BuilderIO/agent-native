import type { ChatMessage, MobileChatScope, MobileChatVersion } from "./types";

type HistoryActions = {
  list: string;
  restore: string;
  listArgs: (
    scope: MobileChatScope,
    threadId: string,
  ) => Record<string, string | number | boolean>;
  restoreArgs: (
    scope: MobileChatScope,
    versionId: string,
  ) => Record<string, unknown>;
};

const HISTORY_ACTIONS: Record<string, HistoryActions> = {
  deck: {
    list: "list-deck-versions",
    restore: "restore-deck-version",
    listArgs: (scope, threadId) => ({ deckId: scope.id, limit: 100, threadId }),
    restoreArgs: (scope, versionId) => ({ deckId: scope.id, versionId }),
  },
  design: {
    list: "list-design-versions",
    restore: "restore-design-version",
    listArgs: (scope, threadId) => ({
      designId: scope.id,
      limit: 100,
      threadId,
    }),
    restoreArgs: (scope, versionId) => ({ designId: scope.id, versionId }),
  },
  document: {
    list: "list-document-versions",
    restore: "restore-document-version",
    listArgs: (scope, threadId) => ({
      documentId: scope.id,
      includeContent: false,
      limit: 100,
      threadId,
    }),
    restoreArgs: (scope, versionId) => ({ documentId: scope.id, versionId }),
  },
  plan: {
    list: "list-plan-versions",
    restore: "restore-plan-version",
    listArgs: (scope) => ({ planId: scope.id, limit: 100 }),
    restoreArgs: (scope, versionId) => ({ planId: scope.id, versionId }),
  },
  dashboard: {
    list: "list-dashboard-revisions",
    restore: "restore-dashboard-revision",
    listArgs: (scope) => ({ dashboardId: scope.id }),
    restoreArgs: (scope, versionId) => ({
      dashboardId: scope.id,
      revisionId: versionId,
    }),
  },
  analysis: {
    list: "list-analysis-revisions",
    restore: "restore-analysis-revision",
    listArgs: (scope) => ({ analysisId: scope.id }),
    restoreArgs: (scope, versionId) => ({
      analysisId: scope.id,
      revisionId: versionId,
    }),
  },
  "crm-dashboard": {
    list: "list-crm-dashboard-revisions",
    restore: "restore-crm-dashboard-revision",
    listArgs: (scope) => ({ id: scope.id }),
    restoreArgs: (scope, versionId) => ({
      id: scope.id,
      revisionId: versionId,
    }),
  },
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function mobileChatScope(value: unknown): MobileChatScope | null {
  const metadata = record(value);
  const custom = record(metadata?.custom);
  const scope = record(
    metadata?.chatScope ?? metadata?.scope ?? custom?.chatScope,
  );
  if (typeof scope?.type !== "string" || typeof scope.id !== "string") {
    return null;
  }
  return { type: scope.type, id: scope.id };
}

export function messageChatScope(message: ChatMessage): MobileChatScope | null {
  return mobileChatScope(message.metadata);
}

export function messageRunId(message: ChatMessage): string | null {
  const metadata = record(message.metadata);
  const custom = record(metadata?.custom);
  const value = metadata?.runId ?? custom?.runId;
  return typeof value === "string" ? value : null;
}

export function messageHasCompletedSideEffect(message: ChatMessage): boolean {
  if (message.metadata?.completedSideEffect === true) return true;
  return message.parts.some(
    (part) => part.type === "tool-call" && part.completedSideEffect === true,
  );
}

export function canShowMobileVersionHistory(message: ChatMessage): boolean {
  return (
    message.role === "assistant" &&
    messageHasCompletedSideEffect(message) &&
    Boolean(
      messageChatScope(message) &&
      HISTORY_ACTIONS[messageChatScope(message)!.type],
    )
  );
}

export function mobileVersionHistoryListRequest(
  scope: MobileChatScope,
  threadId: string,
): { action: string; args: Record<string, string | number | boolean> } | null {
  const config = HISTORY_ACTIONS[scope.type];
  return config
    ? { action: config.list, args: config.listArgs(scope, threadId) }
    : null;
}

export function mobileVersionHistoryRestoreRequest(
  scope: MobileChatScope,
  versionId: string,
): { action: string; args: Record<string, unknown> } | null {
  const config = HISTORY_ACTIONS[scope.type];
  return config
    ? { action: config.restore, args: config.restoreArgs(scope, versionId) }
    : null;
}

export function normalizeMobileChatVersions(
  value: unknown,
): MobileChatVersion[] {
  const root = record(value);
  const rows = Array.isArray(value)
    ? value
    : Array.isArray(root?.versions)
      ? root.versions
      : Array.isArray(root?.revisions)
        ? root.revisions
        : [];
  return rows
    .flatMap((row) => {
      const version = record(row);
      if (typeof version?.id !== "string") return [];
      const date = version.createdAt;
      const createdAtTimestamp =
        typeof date === "string" || typeof date === "number"
          ? Date.parse(String(date))
          : Number.NaN;
      if (!Number.isFinite(createdAtTimestamp)) return [];
      const createdAt = new Date(createdAtTimestamp).toISOString();
      const context = record(version.chatContext);
      const label =
        [version.label, version.changeLabel, version.title, version.name]
          .find(
            (item): item is string =>
              typeof item === "string" && Boolean(item.trim()),
          )
          ?.trim() ?? "Saved version";
      return [
        {
          id: version.id,
          label,
          createdAt,
          editable: version.editable !== false,
          isBeginning: context?.phase === "start",
        },
      ];
    })
    .sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
    );
}
