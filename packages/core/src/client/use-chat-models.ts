import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_MODEL } from "../agent/default-model.js";
import {
  DEFAULT_REASONING_EFFORT,
  getReasoningEffortOptionsForModel,
  resolveReasoningEffortSelection,
  type ReasoningEffort,
} from "../shared/reasoning-effort.js";
import { agentNativePath } from "./api-path.js";
import {
  buildChatModelGroups,
  type EngineModelGroup,
} from "./chat-model-groups.js";
import { callAction } from "./use-action.js";

export type { EngineModelGroup } from "./chat-model-groups.js";

export interface UseChatModelsResult {
  availableModels: EngineModelGroup[];
  defaultModel: string;
  selectedModel: string;
  selectedEngine: string;
  selectedEffort: ReasoningEffort;
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
    Promise.all([
      callAction("manage-agent-engine" as any, { action: "list" } as any).catch(
        () => null,
      ),
      fetch(agentNativePath("/_agent-native/env-status"))
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch(agentNativePath("/_agent-native/builder/status"))
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([enginesData, envKeys, builderStatus]) => {
        if (!enginesData?.engines) return;
        const configuredKeys = new Set(
          (envKeys as Array<{ key: string; configured: boolean }>)
            .filter((k) => k.configured)
            .map((k) => k.key),
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
        if (!hasExplicitSelectionRef.current) {
          const defaultGroup =
            groups.find((group) => group.models.includes(nextDefaultModel)) ??
            groups[0];
          const nextModel =
            defaultGroup?.models.find((model) => model === nextDefaultModel) ??
            defaultGroup?.models[0] ??
            nextDefaultModel;
          const nextEngine = defaultGroup?.engine ?? "";
          const nextEffort = resolveReasoningEffortSelection(
            nextModel,
            selection.selectedEffort,
          );
          setSelectedModel(nextModel);
          setSelectedEngine(nextEngine);
          setSelectedEffort(nextEffort);
          return;
        }

        const selectedGroup = groups.find(
          (group) =>
            group.models.includes(selection.selectedModel) &&
            (!selection.selectedEngine ||
              group.engine === selection.selectedEngine),
        );
        if (!selectedGroup) {
          const defaultGroup =
            groups.find((group) => group.models.includes(nextDefaultModel)) ??
            groups[0];
          const nextModel =
            defaultGroup?.models.find((model) => model === nextDefaultModel) ??
            defaultGroup?.models[0] ??
            nextDefaultModel;
          const nextEngine = defaultGroup?.engine ?? "";
          const nextEffort = resolveReasoningEffortSelection(
            nextModel,
            selection.selectedEffort,
          );
          setSelectedModel(nextModel);
          setSelectedEngine(nextEngine);
          setSelectedEffort(nextEffort);
          writePersisted(storageKey, {
            model: nextModel,
            engine: nextEngine,
            effort: nextEffort,
          });
        }
      })
      .catch(() => {});
  }, [enabled, storageKey]);

  useEffect(() => {
    if (!enabled) return;
    refreshEngines();
  }, [enabled, refreshEngines]);

  return {
    availableModels,
    defaultModel,
    selectedModel,
    selectedEngine,
    selectedEffort,
    onModelChange,
    onEffortChange,
    refreshEngines,
  };
}
