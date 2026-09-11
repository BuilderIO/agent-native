import {
  getBrowserTabId,
  readClientAppState,
  setClientAppState,
  useChangeVersion,
} from "@agent-native/core/client/hooks";
import { useCallback, useEffect, useState } from "react";

export const CREATIVE_CONTEXT_STATE_KEY = "creative-context";

export type CreativeContextMode = "auto" | "off";

export interface CreativeContextApplicationState {
  contextMode: CreativeContextMode;
  selectedContextId?: string | null;
  currentPackId?: string | null;
  pinnedPackId?: string | null;
}

export const DEFAULT_CREATIVE_CONTEXT_STATE: CreativeContextApplicationState = {
  contextMode: "auto",
  selectedContextId: null,
  currentPackId: null,
  pinnedPackId: null,
};

function normalizePackId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeCreativeContextState(
  value: unknown,
): CreativeContextApplicationState {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_CREATIVE_CONTEXT_STATE };
  }
  const record = value as Record<string, unknown>;
  const contextMode: CreativeContextMode =
    record.contextMode === "off" ? "off" : "auto";
  if (contextMode === "off") {
    return {
      contextMode,
      selectedContextId: null,
      currentPackId: null,
      pinnedPackId: null,
    };
  }
  return {
    contextMode,
    selectedContextId: normalizePackId(record.selectedContextId),
    currentPackId: normalizePackId(record.currentPackId),
    pinnedPackId: normalizePackId(record.pinnedPackId),
  };
}

export async function readCreativeContextState(options?: {
  signal?: AbortSignal;
}): Promise<CreativeContextApplicationState> {
  const value = await readClientAppState<CreativeContextApplicationState>(
    CREATIVE_CONTEXT_STATE_KEY,
    options,
  );
  return normalizeCreativeContextState(value);
}

export async function setCreativeContextState(
  value: CreativeContextApplicationState,
): Promise<CreativeContextApplicationState> {
  const normalized = normalizeCreativeContextState(value);
  await setClientAppState(CREATIVE_CONTEXT_STATE_KEY, normalized, {
    requestSource: getBrowserTabId(),
  });
  return normalized;
}

export async function setCreativeContextMode(
  mode: CreativeContextMode,
  current?: CreativeContextApplicationState,
): Promise<CreativeContextApplicationState> {
  const state = current ?? (await readCreativeContextState());
  return setCreativeContextState(
    mode === "off"
      ? {
          contextMode: "off",
          selectedContextId: null,
          currentPackId: null,
          pinnedPackId: null,
        }
      : {
          ...state,
          contextMode: "auto",
          selectedContextId: null,
          pinnedPackId: null,
        },
  );
}

export async function setPinnedCreativeContextPack(
  packId: string | null,
  current?: CreativeContextApplicationState,
): Promise<CreativeContextApplicationState> {
  const state = current ?? (await readCreativeContextState());
  return setCreativeContextState({
    ...state,
    contextMode: "auto",
    selectedContextId: null,
    pinnedPackId: normalizePackId(packId),
  });
}

export async function setSelectedCreativeContext(
  contextId: string | null,
  current?: CreativeContextApplicationState,
): Promise<CreativeContextApplicationState> {
  const state = current ?? (await readCreativeContextState());
  return setCreativeContextState({
    ...state,
    contextMode: "auto",
    selectedContextId: normalizePackId(contextId),
    pinnedPackId: null,
  });
}

export function useCreativeContextState() {
  const appStateVersion = useChangeVersion("app-state");
  const [state, setState] = useState<CreativeContextApplicationState>(
    DEFAULT_CREATIVE_CONTEXT_STATE,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    readCreativeContextState({ signal: controller.signal })
      .then((next) => {
        setState(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [appStateVersion]);

  const save = useCallback(async (next: CreativeContextApplicationState) => {
    const saved = await setCreativeContextState(next);
    setState(saved);
    setError(null);
    return saved;
  }, []);

  return { state, setState: save, isLoading, error };
}
