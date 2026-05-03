import { useCallback, useEffect, useState } from "react";
import { agentNativePath } from "./api-path.js";
import { DEFAULT_MODEL } from "../agent/default-model.js";
import {
  getReasoningEffortOptionsForModel,
  type ReasoningEffort,
} from "../shared/reasoning-effort.js";

export interface EngineModelGroup {
  engine: string;
  label: string;
  models: string[];
  configured: boolean;
}

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
}: Options = {}): UseChatModelsResult {
  const [availableModels, setAvailableModels] = useState<EngineModelGroup[]>(
    [],
  );
  const [defaultModel, setDefaultModel] = useState(DEFAULT_MODEL);

  const initialPersisted = readPersisted(storageKey);
  const [selectedModel, setSelectedModel] = useState<string>(
    initialPersisted.model ?? DEFAULT_MODEL,
  );
  const [selectedEngine, setSelectedEngine] = useState<string>(
    initialPersisted.engine ?? "",
  );
  const [selectedEffort, setSelectedEffort] = useState<ReasoningEffort>(
    initialPersisted.effort ?? "auto",
  );

  const onModelChange = useCallback(
    (model: string, engine: string) => {
      const effortOptions = getReasoningEffortOptionsForModel(model);
      setSelectedModel(model);
      setSelectedEngine(engine);
      setSelectedEffort((prevEffort) => {
        const next =
          prevEffort === "auto" || effortOptions.includes(prevEffort)
            ? prevEffort
            : "auto";
        writePersisted(storageKey, { model, engine, effort: next });
        return next;
      });
    },
    [storageKey],
  );

  const onEffortChange = useCallback(
    (effort: ReasoningEffort) => {
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
    Promise.all([
      fetch(agentNativePath("/_agent-native/actions/manage-agent-engine"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list" }),
      }).then((r) => (r.ok ? r.json() : null)),
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

        let groups: EngineModelGroup[];

        if (builderConnected) {
          const builderEngine = enginesData.engines.find(
            (e: any) => e.name === "builder",
          );
          const builderModels: string[] = builderEngine?.supportedModels ?? [];
          const claude = builderModels.filter((m: string) =>
            m.startsWith("claude-"),
          );
          const openai = builderModels.filter((m: string) =>
            m.startsWith("gpt-"),
          );
          const gemini = builderModels.filter((m: string) =>
            m.startsWith("gemini-"),
          );
          const other = builderModels.filter(
            (m: string) =>
              !m.startsWith("claude-") &&
              !m.startsWith("gpt-") &&
              !m.startsWith("gemini-"),
          );

          groups = [
            ...(claude.length
              ? [
                  {
                    engine: "builder",
                    label: "Claude",
                    models: claude,
                    configured: true,
                  },
                ]
              : []),
            ...(openai.length
              ? [
                  {
                    engine: "builder",
                    label: "OpenAI",
                    models: openai,
                    configured: true,
                  },
                ]
              : []),
            ...(gemini.length
              ? [
                  {
                    engine: "builder",
                    label: "Gemini",
                    models: gemini,
                    configured: true,
                  },
                ]
              : []),
            ...(other.length
              ? [
                  {
                    engine: "builder",
                    label: "More",
                    models: other,
                    configured: true,
                  },
                ]
              : []),
          ];

          if (currentModel && !builderModels.includes(currentModel)) {
            const firstGroup = groups[0];
            if (firstGroup) firstGroup.models.unshift(currentModel);
          }
        } else {
          const allowedEngines = new Set([
            "anthropic",
            "ai-sdk:openai",
            "ai-sdk:google",
          ]);
          groups = enginesData.engines
            .filter((e: any) => allowedEngines.has(e.name))
            .map((e: any) => {
              const models = [...e.supportedModels];
              if (
                e.name === currentEngineName &&
                currentModel &&
                !models.includes(currentModel)
              ) {
                models.unshift(currentModel);
              }
              return {
                engine: e.name,
                label: e.label,
                models,
                configured:
                  e.requiredEnvVars.length === 0 ||
                  e.requiredEnvVars.some((v: string) =>
                    configuredKeys.has(v),
                  ) ||
                  e.name === currentEngineName,
              };
            });
        }
        setAvailableModels(groups);
        setDefaultModel(currentModel ?? DEFAULT_MODEL);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshEngines();
  }, [refreshEngines]);

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
