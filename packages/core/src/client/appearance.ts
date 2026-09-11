import { useQuery } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

import { agentNativePath } from "./api-path.js";
import { useChangeVersion } from "./use-change-version.js";

export const APPEARANCE_PRESETS = [
  { id: "default", label: "Default", swatch: "hsl(220 10% 30%)" },
  { id: "warm", label: "Warm", swatch: "hsl(25 65% 55%)" },
  { id: "ocean", label: "Ocean", swatch: "hsl(205 70% 55%)" },
  { id: "forest", label: "Forest", swatch: "hsl(145 55% 45%)" },
  { id: "rose", label: "Rose", swatch: "hsl(345 60% 55%)" },
  { id: "slate", label: "Slate", swatch: "hsl(215 25% 45%)" },
] as const;

export type AppearancePresetId = (typeof APPEARANCE_PRESETS)[number]["id"];

const STORAGE_KEY = "appearance";
const VALID_NON_DEFAULT: Set<string> = new Set(
  APPEARANCE_PRESETS.filter((p) => p.id !== "default").map((p) => p.id),
);
const CHANGE_EVENT = "agent-native:appearance-change";

function isValidPreset(
  value: string | null | undefined,
): value is AppearancePresetId {
  return (
    value === "default" ||
    (typeof value === "string" && VALID_NON_DEFAULT.has(value))
  );
}

function safeWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

function readStoredAppearance(): AppearancePresetId {
  const w = safeWindow();
  if (!w) return "default";
  try {
    const stored = w.localStorage.getItem(STORAGE_KEY);
    if (isValidPreset(stored) && stored !== "default") return stored;
  } catch {
    // localStorage unavailable
  }
  return "default";
}

export function getStoredAppearance(): AppearancePresetId {
  return readStoredAppearance();
}

export function applyAppearance(preset: AppearancePresetId): void {
  const w = safeWindow();
  if (!w) return;
  const root = w.document.documentElement;
  if (preset === "default" || !VALID_NON_DEFAULT.has(preset)) {
    root.removeAttribute("data-appearance");
    try {
      w.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage unavailable
    }
  } else {
    root.setAttribute("data-appearance", preset);
    try {
      w.localStorage.setItem(STORAGE_KEY, preset);
    } catch {
      // localStorage unavailable
    }
  }
  try {
    w.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // CustomEvent unsupported in this environment
  }
}

function subscribe(onChange: () => void): () => void {
  const w = safeWindow();
  if (!w) return () => {};
  const handler = () => onChange();
  w.addEventListener("storage", handler);
  w.addEventListener(CHANGE_EVENT, handler);
  return () => {
    w.removeEventListener("storage", handler);
    w.removeEventListener(CHANGE_EVENT, handler);
  };
}

export function useAppearance(): AppearancePresetId {
  return useSyncExternalStore(
    subscribe,
    () => readStoredAppearance(),
    () => "default",
  );
}

/**
 * Reads `application_state.appearance` and applies the server-side preset on
 * the client. The shared DB-sync transport advances the key-specific version
 * after a write, so this performs one initial read and then only refetches when
 * appearance actually changes.
 *
 * The agent's `change-appearance` action writes to `application_state.appearance`
 * server-side; this hook surfaces that write into the DOM `data-appearance`
 * attribute and localStorage so the user sees the change immediately and the
 * choice persists across reloads.
 */
export function useAppearanceSync(): void {
  const appearanceVersion = useChangeVersion("app-state:appearance");
  const { data } = useQuery({
    queryKey: ["agent-native", "appearance", appearanceVersion],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/application-state/appearance"),
        { credentials: "include" },
      );
      if (!res.ok) return null;
      return (await res.json()) as { preset?: string } | null;
    },
    staleTime: Infinity,
  });
  const serverPreset = data?.preset;
  useEffect(() => {
    if (!serverPreset || !isValidPreset(serverPreset)) return;
    const current = readStoredAppearance();
    if (current !== serverPreset) applyAppearance(serverPreset);
  }, [serverPreset]);
}
