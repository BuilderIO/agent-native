/**
 * list-agent-engines — returns the registered engine registry and current selection.
 */

import { getAgentAppModelDefaultForCurrentRequest } from "../../agent/app-model-defaults.js";
import { DEFAULT_MODEL } from "../../agent/default-model.js";
import {
  listAgentEngines,
  registerBuiltinEngines,
  detectEngineFromEnv,
  detectEngineFromUserSecrets,
  getAgentEngineEntry,
  isAgentEnginePackageInstalled,
  isStoredEngineUsableForRequest,
  normalizeModelForEngine,
} from "../../agent/engine/index.js";
import type { ActionTool } from "../../agent/types.js";
import { resolveHostedDefaultModelExperiment } from "../../observability/hosted-model-experiment.js";
import { getRequestUserEmail } from "../../server/request-context.js";
import { getSetting } from "../../settings/index.js";

export const tool: ActionTool = {
  description:
    'List all available AI agent engines (Anthropic, OpenAI, Gemini, Groq, etc.) and the currently selected engine. Use this to check what engines are available before calling manage-agent-engine with action="set".',
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
};

export async function run(args: Record<string, string> = {}): Promise<string> {
  registerBuiltinEngines();

  const engines = listAgentEngines();
  const currentSetting = await getSetting("agent-engine");
  const current = currentSetting
    ? (currentSetting as { engine?: string; model?: string })
    : null;

  // Same priority chain resolveEngine uses after explicit request options:
  // AGENT_ENGINE → app default → stored (if usable) → user/Builder app_secrets
  // → env → anthropic. Gating stored/app defaults on the request-aware helper
  // keeps the picker in step with the runtime.
  const storedEntry =
    typeof current?.engine === "string"
      ? getAgentEngineEntry(current.engine)
      : undefined;
  const storedUsable =
    !!storedEntry &&
    (await isStoredEngineUsableForRequest(current, storedEntry));
  const appDefault = await getAgentAppModelDefaultForCurrentRequest(args.appId);
  const appDefaultEntry =
    typeof appDefault?.engine === "string"
      ? getAgentEngineEntry(appDefault.engine)
      : undefined;
  const appDefaultUsable =
    !!appDefault &&
    !!appDefaultEntry &&
    (await isStoredEngineUsableForRequest(appDefault, appDefaultEntry));
  const detectedFromUser = await detectEngineFromUserSecrets();
  const envEntry = process.env.AGENT_ENGINE
    ? getAgentEngineEntry(process.env.AGENT_ENGINE)
    : undefined;
  const envUsable =
    !!envEntry &&
    (await isStoredEngineUsableForRequest({ engine: envEntry.name }, envEntry));
  const envUnavailable = !!envEntry && !envUsable;
  const detectedFromEnv = detectEngineFromEnv();
  const envSelectedEntry = envUsable ? envEntry : undefined;

  const currentEntry = envUnavailable
    ? undefined
    : (envSelectedEntry ??
      (appDefaultUsable ? appDefaultEntry : undefined) ??
      (storedUsable ? storedEntry : undefined) ??
      detectedFromUser ??
      detectedFromEnv ??
      undefined);
  const currentModelCandidate =
    appDefaultUsable && currentEntry?.name === appDefault?.engine
      ? appDefault?.model
      : storedUsable && currentEntry?.name === current?.engine
        ? current?.model
        : undefined;
  const currentEngineName = currentEntry?.name ?? "anthropic";
  let currentModel =
    currentEntry && !envUnavailable
      ? normalizeModelForEngine(
          currentEntry,
          currentModelCandidate ?? currentEntry.defaultModel,
        )
      : (currentModelCandidate ?? DEFAULT_MODEL);
  const hostedExperiment =
    currentEntry && !currentModelCandidate
      ? resolveHostedDefaultModelExperiment({
          userId: getRequestUserEmail(),
          engineName: currentEntry.name,
          isDefaultModelSelection: true,
          supportedModels: currentEntry.supportedModels,
        })
      : null;
  if (hostedExperiment) currentModel = hostedExperiment.model;

  const result = {
    engines: engines.map((e) => ({
      name: e.name,
      label: e.label,
      description: e.description,
      defaultModel: e.defaultModel,
      supportedModels: e.supportedModels,
      capabilities: e.capabilities,
      requiredEnvVars: e.requiredEnvVars,
      installPackage: e.installPackage,
      packageInstalled: isAgentEnginePackageInstalled(e),
    })),
    current: envUnavailable
      ? null
      : {
          engine: currentEngineName,
          model: currentModel,
          ...(hostedExperiment
            ? {
                modelSelectionSource: "experiment",
                experimentAssignment: hostedExperiment.assignment,
              }
            : {}),
        },
  };

  return JSON.stringify(result, null, 2);
}
