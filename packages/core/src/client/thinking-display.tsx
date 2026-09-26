
import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";

import {
  DEFAULT_THINKING_DISPLAY,
  parseThinkingDisplay,
  type ThinkingDisplay,
} from "../shared/thinking-display.js";

export const THINKING_DISPLAY_STORAGE_KEY = "agent-native:thinking-display";

const THINKING_DISPLAY_CHANGE_EVENT = "agent-native:thinking-display-change";

export function getBrowserThinkingDisplay(): ThinkingDisplay {
  if (typeof window === "undefined") return DEFAULT_THINKING_DISPLAY;
  try {
    return (
      parseThinkingDisplay(
        window.localStorage.getItem(THINKING_DISPLAY_STORAGE_KEY),
      ) ?? DEFAULT_THINKING_DISPLAY
    );
    // A blocked or unavailable localStorage means "no stored preference",
    // which is exactly the default. Nothing downstream can act on the
    // difference, and throwing would break the whole chat header.
    // coercion-ok: absent and unreadable are the same answer for this key.
  } catch {
    return DEFAULT_THINKING_DISPLAY;
  }
}

export function setBrowserThinkingDisplay(mode: ThinkingDisplay): void {
  if (typeof window === "undefined") return;
  try {
    if (mode === DEFAULT_THINKING_DISPLAY) {
      window.localStorage.removeItem(THINKING_DISPLAY_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THINKING_DISPLAY_STORAGE_KEY, mode);
    }
    // A failed write leaves the in-memory listeners correct for this tab,
    // which is the whole visible effect of the change.
    // coercion-ok: an unwritable localStorage is not a preference failure.
  } catch {
    // Intentionally empty: the change event below still updates this tab.
  }
  window.dispatchEvent(new Event(THINKING_DISPLAY_CHANGE_EVENT));
}

export function subscribeToBrowserThinkingDisplay(
  callback: () => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onStorage = (event: StorageEvent) => {
    if (event.key === THINKING_DISPLAY_STORAGE_KEY || event.key === null) {
      callback();
    }
  };
  const onChange = () => callback();

  window.addEventListener("storage", onStorage);
  window.addEventListener(THINKING_DISPLAY_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(THINKING_DISPLAY_CHANGE_EVENT, onChange);
  };
}

const ThinkingDisplayContext = createContext<ThinkingDisplay | undefined>(
  undefined,
);

export function ThinkingDisplayProvider({
  value,
  children,
}: {
  value?: ThinkingDisplay;
  children: ReactNode;
}) {
  const inherited = useContext(ThinkingDisplayContext);
  return (
    <ThinkingDisplayContext.Provider value={value ?? inherited}>
      {children}
    </ThinkingDisplayContext.Provider>
  );
}

export function useThinkingDisplay(): ThinkingDisplay {
  const pinned = useContext(ThinkingDisplayContext);
  const stored = useSyncExternalStore(
    subscribeToBrowserThinkingDisplay,
    getBrowserThinkingDisplay,
    () => DEFAULT_THINKING_DISPLAY,
  );
  return pinned ?? stored;
}

export function useThinkingDisplayControl(): {
  mode: ThinkingDisplay;
  setMode: (mode: ThinkingDisplay) => void;
  pinned: boolean;
} {
  const pinned = useContext(ThinkingDisplayContext);
  const mode = useThinkingDisplay();
  const setMode = useCallback((next: ThinkingDisplay) => {
    setBrowserThinkingDisplay(next);
  }, []);
  return { mode, setMode, pinned: pinned !== undefined };
}
