import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_MODEL } from "../agent/default-model.js";
import {
  DEFAULT_REASONING_EFFORT,
  getReasoningEffortOptionsForModel,
  resolveReasoningEffortSelection,
  type ReasoningEffort,
} from "../shared/reasoning-effort.js";
import {
  buildChatModelGroups,
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
export const CHAT_MODEL_SELECTION_CHANGED_EVENT =
  "agent-native:chat-model-selection-changed";

interface PersistedSelection {
  model?: string;
  engine?: string;
  effort?: ReasoningEffort;
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
    setIsLoading(true);
    Promise.all([
      callAction("manage-agent-engine" as any, { action: "list" } as any).catch(
        () => null,
      ),
      fetchEnvironmentStatus<Array<{ key: string; configured: boolean }>>(),
      fetchBuilderStatus<{ configured?: boolean }>(),
    ])
      .then(([enginesData, envResult, builderResult]) => {
        if (!enginesData?.engines) {
          // Without a catalog the picker keeps an unvalidated DEFAULT_MODEL,
          // which is indistinguishable from a real selection unless we say so.
          console.warn(
            "[agent-chat] no engine list; model picker is showing an unvalidated default",
          );
          return;
        }
        if (
          envResult.state !== "available" ||
          builderResult.state !== "available"
        ) {
          return;
        }
        const envKeys = envResult.value;
        const builderStatus = builderResult.value;
        const configuredKeys = new Set(
          envKeys.filter((k) => k.configured).map((k) => k.key),
        );
        const builderConnected = builderStatus?.configured === true;
        const currentEngineName: string | undefined =
          enginesData.current?.engine;
        const currentModel: string | undefined = enginesData.current?.model;

        const groups = buildChatModelGroups({
          engines: enginesData.engines,
          configuredKeys,
          builderConnected,
          currentEngineName,
          currentModel,
        });
        const nextDefaultModel = currentModel ?? DEFAULT_MODEL;
        setAvailableModels(groups);
        setDefaultModel(nextDefaultModel);

        const selection = selectionRef.current;

        // Default only to a CONFIGURED group, and to nothing when there is
        // none. `DEFAULT_MODEL` is a builder-gateway id that no group carries
        // unless Builder is connected, and unconfigured groups are kept in the
        // list for their connect affordance — so both `?? DEFAULT_MODEL` and
        // `?? groups[0]` yield a selection the app cannot route, which the
        // server silently replaces with its own default. An empty selection
        // hides the picker instead of showing a model that will not be used.
        const configuredGroups = groups.filter((g) => g.configured);
        const resolveRoutableSelection = () => {
          const group =
            configuredGroups.find((g) => g.models.includes(nextDefaultModel)) ??
            configuredGroups[0];
          if (!group) return null;
          const model =
            group.models.find((m) => m === nextDefaultModel) ?? group.models[0];
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
          return;
        }
        applyFallback(true);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [enabled, storageKey]);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }
    refreshEngines();
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
