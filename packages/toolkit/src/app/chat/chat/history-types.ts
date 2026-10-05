import type {
  AssistantChatHistoryDate,
  AssistantChatHistoryVersion,
} from "@agent-native/core/client/agent-chat";

export interface AssistantChatHistoryContext {
  threadId?: string;
  runId?: string;
  turnId?: string;
}

export interface AssistantChatHistoryScope {
  type: string;
  id: string;
}

export interface AssistantChatHistoryMessage {
  id: string;
  createdAt: AssistantChatHistoryDate;
  scope?: AssistantChatHistoryScope;
  parentId?: string;
  turnStartedAt?: AssistantChatHistoryDate;
  turnEndedAt?: AssistantChatHistoryDate;
  runId?: string;
  turnId?: string;
  hasCompletedSideEffect: boolean;
}

export interface AssistantChatHistoryConfig<
  TListResult = unknown,
  TVersion extends AssistantChatHistoryVersion = AssistantChatHistoryVersion,
  TRestoreResult = unknown,
> {
  /** Flush host editor writes before an agent turn starts. */
  beforeStart?: () => void | Promise<void>;
  list: {
    action: string;
    args?:
      | Record<string, unknown>
      | ((threadId?: string) => Record<string, unknown>);
    getVersions: (result: TListResult) => readonly TVersion[] | null;
  };
  restore: {
    action: string;
    args: (
      version: TVersion,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>;
    beforeRestore?: () => void | Promise<void>;
    onRestored?: (
      result: TRestoreResult,
      version: TVersion,
    ) => void | Promise<void>;
  };
  createVersion?: {
    action: string;
    args:
      | Record<string, unknown>
      | ((message: AssistantChatHistoryMessage) => Record<string, unknown>);
  };
  isEditable?: (version: TVersion) => boolean;
  scope?: AssistantChatHistoryScope;
  matchVersion?: (
    version: TVersion,
    message: AssistantChatHistoryMessage,
  ) => boolean;
}

export interface AssistantChatHistoryContextValue {
  beginningVersion: AssistantChatHistoryVersion | null;
  isRestoring: boolean;
  findVersion: (
    message: AssistantChatHistoryMessage,
  ) => AssistantChatHistoryVersion | null;
  restoreVersion: (version: AssistantChatHistoryVersion) => Promise<void>;
}
