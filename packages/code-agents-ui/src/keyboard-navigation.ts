export type ChatFirstKeyboardNavigationDirection = -1 | 1;

export type ChatFirstKeyboardNavigationTarget =
  | { kind: "app"; id: string }
  | { kind: "chat"; id: string }
  | null;

export interface ChatFirstKeyboardShortcut {
  key: string;
  code?: string;
  shiftKey: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export interface ChatFirstKeyboardNavigation {
  appIds: readonly string[];
  activeAppId?: string;
  onSelectApp: (appId: string) => void;
  subscribe?: (
    listener: (shortcut: ChatFirstKeyboardShortcut) => void,
  ) => () => void;
}

export function getChatFirstNumericAppShortcut(
  appIds: readonly string[],
  key: string,
): string | null {
  if (!/^[1-9]$/.test(key)) return null;
  return appIds[Number(key) - 1] ?? null;
}

export function resolveChatFirstKeyboardNavigationTarget(input: {
  appIds: readonly string[];
  activeAppId?: string;
  chatIds: readonly string[];
  selectedChatId?: string | null;
  direction: ChatFirstKeyboardNavigationDirection;
}): ChatFirstKeyboardNavigationTarget {
  const { appIds, activeAppId, chatIds, selectedChatId, direction } = input;
  const activeAppIndex = activeAppId ? appIds.indexOf(activeAppId) : -1;

  if (activeAppIndex >= 0) {
    const nextAppId = appIds[activeAppIndex + direction];
    if (nextAppId) return { kind: "app", id: nextAppId };
    if (chatIds.length > 0) {
      return {
        kind: "chat",
        id: direction > 0 ? chatIds[0]! : chatIds[chatIds.length - 1]!,
      };
    }
    const wrappedAppId = appIds[direction > 0 ? 0 : appIds.length - 1];
    return wrappedAppId ? { kind: "app", id: wrappedAppId } : null;
  }

  const selectedChatIndex = selectedChatId
    ? chatIds.indexOf(selectedChatId)
    : -1;
  if (selectedChatIndex >= 0) {
    const nextChatId = chatIds[selectedChatIndex + direction];
    if (nextChatId) return { kind: "chat", id: nextChatId };
    if (appIds.length > 0) {
      const wrappedAppId = appIds[direction > 0 ? 0 : appIds.length - 1];
      return wrappedAppId ? { kind: "app", id: wrappedAppId } : null;
    }
    const wrappedChatId = chatIds[direction > 0 ? 0 : chatIds.length - 1];
    return wrappedChatId ? { kind: "chat", id: wrappedChatId } : null;
  }

  if (chatIds.length > 0) {
    return {
      kind: "chat",
      id: direction > 0 ? chatIds[0]! : chatIds[chatIds.length - 1]!,
    };
  }
  const firstAppId = appIds[direction > 0 ? 0 : appIds.length - 1];
  return firstAppId ? { kind: "app", id: firstAppId } : null;
}
