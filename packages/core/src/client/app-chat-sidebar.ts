import { useEffect, useState } from "react";

import { getFramePostMessageTargetOrigin } from "./frame.js";

export const APP_CHAT_SIDEBAR_STATE_EVENT = "agent-native:per-app-chat-state";
export const APP_CHAT_SIDEBAR_STATE_MESSAGE = "agentNative.perAppChatState";
export const APP_CHAT_SIDEBAR_STATE_REQUEST_MESSAGE =
  "agentNative.perAppChatStateRequest";

export type AppChatSidebarCommand = "toggle" | "open" | "close";
export interface AppChatSidebarCommandOptions {
  focus?: boolean;
}

interface AppChatDesktopBridge {
  chat?: Partial<
    Record<
      AppChatSidebarCommand,
      (options?: AppChatSidebarCommandOptions) => void
    >
  >;
}

export interface AppChatSidebarState {
  open: boolean;
  hosted: boolean;
}

export function buildAppChatSidebarStateMessage(open: boolean): {
  type: typeof APP_CHAT_SIDEBAR_STATE_MESSAGE;
  data: AppChatSidebarState;
} {
  return {
    type: APP_CHAT_SIDEBAR_STATE_MESSAGE,
    data: { open, hosted: true },
  };
}

export function buildAppChatSidebarStateRequest(): {
  type: typeof APP_CHAT_SIDEBAR_STATE_REQUEST_MESSAGE;
} {
  return { type: APP_CHAT_SIDEBAR_STATE_REQUEST_MESSAGE };
}

export function isPerAppChatStorageKey(
  storageKey: string | undefined,
): boolean {
  return (
    storageKey === "desktop-app-chat" || storageKey === "dispatch-app-chat"
  );
}

function readDesktopChatBridge(): AppChatDesktopBridge["chat"] | null {
  if (typeof window === "undefined") return null;
  const bridge = (
    window as Window & { agentNativeDesktop?: AppChatDesktopBridge }
  ).agentNativeDesktop;
  return bridge?.chat ?? null;
}

function readInitialPerAppChatState(): AppChatSidebarState {
  return {
    open: false,
    hosted: readDesktopChatBridge() !== null,
  };
}

export function requestPerAppChatCommand(
  command: AppChatSidebarCommand,
  options?: AppChatSidebarCommandOptions,
): boolean {
  if (typeof window === "undefined") return false;

  const desktopCommand = readDesktopChatBridge()?.[command];
  if (desktopCommand) {
    desktopCommand(options);
    return true;
  }

  if (window.parent === window) return false;

  const data =
    command === "toggle"
      ? options?.focus
        ? { focus: true }
        : undefined
      : {
          open: command === "open",
          ...(options?.focus ? { focus: true } : {}),
        };
  window.parent.postMessage(
    {
      type: "agentNative.toggleSidebar",
      ...(data ? { data } : {}),
    },
    getFramePostMessageTargetOrigin() ?? "*",
  );
  return true;
}

export function usePerAppChatState(enabled = true): AppChatSidebarState {
  const [state, setState] = useState<AppChatSidebarState>(() =>
    enabled ? readInitialPerAppChatState() : { open: false, hosted: false },
  );

  useEffect(() => {
    if (!enabled) return;

    const applyState = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const next = value as Partial<AppChatSidebarState>;
      if (typeof next.open !== "boolean") return;
      setState({
        open: next.open,
        hosted: next.hosted !== false,
      });
    };
    const handleCustomEvent = (event: Event) => {
      applyState((event as CustomEvent<AppChatSidebarState>).detail);
    };
    const handleMessage = (event: MessageEvent) => {
      if (window.parent === window || event.source !== window.parent) return;
      if (event.data?.type !== APP_CHAT_SIDEBAR_STATE_MESSAGE) return;
      applyState(event.data.data);
    };

    window.addEventListener(APP_CHAT_SIDEBAR_STATE_EVENT, handleCustomEvent);
    window.addEventListener("message", handleMessage);
    if (window.parent !== window) {
      window.parent.postMessage(buildAppChatSidebarStateRequest(), "*");
    }

    return () => {
      window.removeEventListener(
        APP_CHAT_SIDEBAR_STATE_EVENT,
        handleCustomEvent,
      );
      window.removeEventListener("message", handleMessage);
    };
  }, [enabled]);

  return state;
}

export function usePerAppChatOpen(): boolean {
  return usePerAppChatState().open;
}
