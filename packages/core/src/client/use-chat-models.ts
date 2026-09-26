import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_MODEL } from "../agent/default-model.js";
import {
  DEFAULT_REASONING_EFFORT,
  getReasoningEffortOptionsForModel,
  resolveReasoningEffortSelection,
  type ReasoningEffort,
} from "../shared/reasoning-effort.js";
import { fetchOllamaModels } from "./agent-engine-key.js";
import {
  buildChatModelGroups,
  usesLiveOllamaModels,
  type ChatModelEngineEntry,
  type EngineModelGroup,
} from "./chat-model-groups.js";
import {
  fetchBuilderStatus,
  fetchEnvironmentStatus,
} from "./client-status-requests.js";
import { callAction } from "./use-action.js";

export type { EngineModelGroup } from "./chat-model-groups.js";

export interface UseChatModelsResult {
  availableModels: EngineModelGroup[];
  defaultModel: string;
  selectedModel: string;
  selectedEngine: string;
  selectedEffort: ReasoningEffort;
  isLoading: boolean;
  onModelChange: (model: string, engine: string) => void;
  onEffortChange: (effort: ReasoningEffort) => void;
  refreshEngines: () => void;
}

interface Options {
  /**
   * localStorage key used to persist the user's model + effort selection across
   * page loads. Pass `null` to disable persistence.
   */
  storageKey?: string | null;
  /**
   * Disable server-backed model discovery for hosts that provide their own
   * model list/state, such as Electron Code.
   */
  enabled?: boolean;
}

const DEFAULT_STORAGE_KEY = "agent-native:chat-models:selection";

/**
 * `useChatModels` takes the raw localStorage key while `MultiTabAssistantChat`
 * takes only the namespace suffix — a surface that hand-writes either one stops
 * sharing the selection with the chat it sits next to.
 */
export function chatModelSelectionStorageKey(
  namespace?: string | null,
): string {
  return namespace
    ? `${DEFAULT_STORAGE_KEY}:${namespace}`
    : DEFAULT_STORAGE_KEY;
}

export const CHAT_MODEL_SELECTION_CHANGED_EVENT =
  "agent-native:chat-model-selection-changed";
const MODEL_DISCOVERY_RETRY_DELAYS_MS = [250, 1_000] as const;

interface PersistedSelection {
  model?: string;
  engine?: string;
  effort?: ReasoningEffort;
}

interface EngineCatalog {
  engines: readonly ChatModelEngineEntry[];
  current?: { engine?: string; model?: string };
}

type EngineCatalogResult =
  | { state: "available"; value: EngineCatalog }
  | { state: "unavailable" };

async function fetchEngineCatalog(): Promise<EngineCatalogResult> {
  try {
    const result = (await callAction(
      "manage-agent-engine" as any,
      { action: "list" } as any,
    )) as unknown;
    if (
      !result ||
      typeof result !== "object" ||
      !("engines" in result) ||
      !Array.isArray(result.engines)
    ) {
      return { state: "unavailable" };
    }
    return { state: "available", value: result as EngineCatalog };
  } catch {
    return { state: "unavailable" };
  }
}

export type ChatModelCatalogLoad =
  | {
      state: "available";
      groups: EngineModelGroup[];
      /** The server's current model, or `DEFAULT_MODEL` when it names none. */
      defaultModel: string;
      /**
       * The catalog again with Ollama's installed models in place of its
       * static suggestions, or null when there is nothing to swap in (Ollama
       * isn't the current engine, its models are checked, or it is
       * unreachable). A separate call so the picker's first paint never waits
       * on a local network round trip.
       */
      loadLiveGroups: () => Promise<EngineModelGroup[] | null>;
    }
  | {
      state: "unavailable";
      /** The engine list itself failed, not just a readiness lookup. */
      enginesUnavailable: boolean;
    };

/**
 * Fetch the engine catalog and readiness, and build the model picker's groups.
 * The one source for every surface with a model picker (`useChatModels`,
 * `MultiTabAssistantChat`), so they can't disagree about what is offered.
 */
export async function loadChatModelCatalog(): Promise<ChatModelCatalogLoad> {
  const [engineResult, envResult, builderResult] = await Promise.all([
    fetchEngineCatalog(),
    fetchEnvironmentStatus<Array<{ key: string; configured: boolean }>>(),
    fetchBuilderStatus<{ configured?: boolean }>(),
  ]);
  if (
    engineResult.state !== "available" ||
    envResult.state !== "available" ||
    builderResult.state !== "available"
  ) {
    return {
      state: "unavailable",
      enginesUnavailable: engineResult.state !== "available",
    };
  }
  const enginesData = engineResult.value;
  const configuredKeys = new Set(
    envResult.value.filter((k) => k.configured).map((k) => k.key),
  );
  const builderConnected = builderResult.value?.configured === true;
  const currentEngineName = enginesData.current?.engine;
  const currentModel = enginesData.current?.model;
  const build = (engines: readonly ChatModelEngineEntry[]) =>
    buildChatModelGroups({
      engines,
      configuredKeys,
      builderConnected,
      currentEngineName,
      currentModel,
    });

  return {
    state: "available",
    groups: build(enginesData.engines),
    defaultModel: currentModel ?? DEFAULT_MODEL,
    loadLiveGroups: async () => {
      // Gated on Ollama actually being the current engine (not merely present
      // in the catalog, which it always is): every app registers it by
      // default, so an unconditional probe would 502 on every chat load for
      // the vast majority of setups that never touched Ollama.
      const ollama = enginesData.engines.find(
        (engine) => engine.name === "ai-sdk:ollama",
      );
      if (
        currentEngineName !== "ai-sdk:ollama" ||
        !ollama ||
        !usesLiveOllamaModels(ollama)
      ) {
        return null;
      }
      let liveModels: string[];
      try {
        liveModels = await fetchOllamaModels();
        // coercion-ok: an unreachable Ollama keeps the groups already rendered, which list its static suggestions.
      } catch {
        return null;
      }
      if (liveModels.length === 0) return null;
      return build(
        enginesData.engines.map((engine) =>
          engine === ollama
            ? { ...engine, supportedModels: liveModels }
            : engine,
        ),
      );
    },
  };
}

function readPersisted(key: string | null): PersistedSelection {
  if (!key || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as PersistedSelection) : {};
  } catch {
    return {};
  }
}

function writePersisted(key: string | null, value: PersistedSelection) {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    queueMicrotask(() => {
      window.dispatchEvent(
        new CustomEvent(CHAT_MODEL_SELECTION_CHANGED_EVENT, {
          detail: { key },
        }),
      );
    });
  } catch {}
}

/**
 * Fetches available engines/models from the agent server and exposes the same
 * model picker state that `MultiTabAssistantChat` wires up — for surfaces like
 * the Dispatch homepage hero composer that need an identical model picker
 * without mounting the full tabbed chat.
 */
export function useChatModels({
  storageKey = DEFAULT_STORAGE_KEY,
  enabled = true,
}: Options = {}): UseChatModelsResult {
  const [availableModels, setAvailableModels] = useState<EngineModelGroup[]>(
    [],
  );
  const [isLoading, setIsLoading] = useState(enabled);
  const [defaultModel, setDefaultModel] = useState<string>(DEFAULT_MODEL);

  const initialPersisted = readPersisted(storageKey);
  const hasExplicitSelectionRef = useRef(Boolean(initialPersisted.model));
  const [selectedModel, setSelectedModel] = useState<string>(
    initialPersisted.model ?? DEFAULT_MODEL,
  );
  const [selectedEngine, setSelectedEngine] = useState<string>(
    initialPersisted.engine ?? "",
  );
  const [selectedEffort, setSelectedEffort] = useState<ReasoningEffort>(
    resolveReasoningEffortSelection(
      initialPersisted.model ?? DEFAULT_MODEL,
      initialPersisted.effort,
    ),
  );
  const selectionRef = useRef({
    selectedModel,
    selectedEngine,
    selectedEffort,
  });
  const mountedRef = useRef(true);
  const refreshGenerationRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    selectionRef.current = {
      selectedModel,
      selectedEngine,
      selectedEffort,
    };
  }, [selectedEffort, selectedEngine, selectedModel]);

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;

    const syncPersistedSelection = (event?: Event) => {
      const detail = (event as CustomEvent<{ key?: string }> | undefined)
        ?.detail;
      if (detail?.key && detail.key !== storageKey) return;

      const next = readPersisted(storageKey);
      if (!next.model) return;

      hasExplicitSelectionRef.current = true;
      setSelectedModel(next.model);
      setSelectedEngine(next.engine ?? "");
      setSelectedEffort(
        resolveReasoningEffortSelection(next.model, next.effort),
      );
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === storageKey) syncPersistedSelection();
    };

    window.addEventListener(
      CHAT_MODEL_SELECTION_CHANGED_EVENT,
      syncPersistedSelection,
    );
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(
        CHAT_MODEL_SELECTION_CHANGED_EVENT,
        syncPersistedSelection,
      );
      window.removeEventListener("storage", handleStorage);
    };
  }, [storageKey]);

  const onModelChange = useCallback(
    (model: string, engine: string) => {
      hasExplicitSelectionRef.current = true;
      const effortOptions = getReasoningEffortOptionsForModel(model);
      setSelectedModel(model);
      setSelectedEngine(engine);
      setSelectedEffort((prevEffort) => {
        const next = effortOptions.includes(prevEffort)
          ? prevEffort
          : DEFAULT_REASONING_EFFORT;
        writePersisted(storageKey, { model, engine, effort: next });
        return next;
      });
    },
    [storageKey],
  );

  const onEffortChange = useCallback(
    (effort: ReasoningEffort) => {
      hasExplicitSelectionRef.current = true;
      setSelectedEffort(effort);
      writePersisted(storageKey, {
        model: selectedModel,
        engine: selectedEngine,
        effort,
      });
    },
    [selectedEngine, selectedModel, storageKey],
  );

  const refreshEngines = useCallback(() => {
    if (!enabled) return;

    refreshGenerationRef.current += 1;
    const refreshGeneration = refreshGenerationRef.current;
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setIsLoading(true);

    const isCurrentRefresh = () =>
      mountedRef.current && refreshGenerationRef.current === refreshGeneration;
    const finish = () => {
      if (isCurrentRefresh()) setIsLoading(false);
    };

    function scheduleRetry(attempt: number): boolean {
      const delay = MODEL_DISCOVERY_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isCurrentRefresh()) return false;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        load(attempt + 1);
      }, delay);
      return true;
    }

    function load(attempt: number): void {
      if (!isCurrentRefresh()) return;
      loadChatModelCatalog()
        .then((catalog) => {
          if (!isCurrentRefresh()) return;
          if (catalog.state !== "available") {
            if (scheduleRetry(attempt)) return;
            if (catalog.enginesUnavailable) {
              // Without a catalog the picker keeps an unvalidated DEFAULT_MODEL,
              // which is indistinguishable from a real selection unless we say so.
              console.warn(
                "[agent-chat] engine list unavailable; model picker is showing an unvalidated default",
              );
            }
            finish();
            return;
          }
          const { groups, defaultModel: nextDefaultModel } = catalog;
          setAvailableModels(groups);
          setDefaultModel(nextDefaultModel);

          void catalog.loadLiveGroups().then((liveGroups) => {
            if (liveGroups && isCurrentRefresh()) {
              setAvailableModels(liveGroups);
            }
          });

          const selection = selectionRef.current;

          // Default only to a CONFIGURED group, and to nothing when there is
          // none. `DEFAULT_MODEL` is a builder-gateway id that no group carries
          // unless Builder is connected, and unconfigured groups are kept in the
          // list for their connect affordance where that is useful — so both
          // `?? DEFAULT_MODEL` and `?? groups[0]` yield a selection the app
          // cannot route, which the server silently replaces with its own
          // default. An empty selection hides the picker instead of showing a
          // model that will not be used.
          const configuredGroups = groups.filter((g) => g.configured);
          const resolveRoutableSelection = () => {
            const group =
              configuredGroups.find((g) =>
                g.models.includes(nextDefaultModel),
              ) ?? configuredGroups[0];
            if (!group) return null;
            const model =
              group.models.find((m) => m === nextDefaultModel) ??
              group.models[0];
            if (!model) return null;
            return {
              model,
              engine: group.engine,
              effort: resolveReasoningEffortSelection(
                model,
                selection.selectedEffort,
              ),
            };
          };

          const applyFallback = (persist: boolean) => {
            const next = resolveRoutableSelection();
            setSelectedModel(next?.model ?? "");
            setSelectedEngine(next?.engine ?? "");
            if (next) {
              setSelectedEffort(next.effort);
              if (persist) writePersisted(storageKey, next);
            }
          };

          if (!hasExplicitSelectionRef.current) {
            applyFallback(false);
            finish();
            return;
          }

          const selectedGroup = groups.find(
            (group) =>
              group.models.includes(selection.selectedModel) &&
              (!selection.selectedEngine ||
                group.engine === selection.selectedEngine),
          );
          if (selectedGroup) {
            // Heal a selection stored without an engine (or with a stale one) so
            // later submits carry the pair the catalog resolved.
            if (selection.selectedEngine !== selectedGroup.engine) {
              setSelectedEngine(selectedGroup.engine);
            }
            finish();
            return;
          }
          applyFallback(true);
          finish();
        })
        .catch(() => {
          if (!isCurrentRefresh()) return;
          if (!scheduleRetry(attempt)) finish();
        });
    }

    load(0);
  }, [enabled, storageKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      refreshGenerationRef.current += 1;
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      refreshGenerationRef.current += 1;
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      setIsLoading(false);
      return;
    }
    refreshEngines();
    window.addEventListener("agent-engine:configured-changed", refreshEngines);
    return () =>
      window.removeEventListener(
        "agent-engine:configured-changed",
        refreshEngines,
      );
  }, [enabled, refreshEngines]);

  return {
    availableModels,
    defaultModel,
    selectedModel,
    selectedEngine,
    selectedEffort,
    isLoading,
    onModelChange,
    onEffortChange,
    refreshEngines,
  };
}
