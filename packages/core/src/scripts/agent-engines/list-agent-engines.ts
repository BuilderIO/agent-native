/**
 * list-agent-engines — returns the registered engine registry and current selection.
 */

import type { ActionTool } from "../../agent/types.js";
import {
  listAgentEngines,
  registerBuiltinEngines,
  detectEngineFromEnv,
  detectEngineFromUserSecrets,
  getAgentEngineEntry,
  isStoredEngineUsableForRequest,
} from "../../agent/engine/index.js";
import { DEFAULT_MODEL } from "../../agent/default-model.js";
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

export async function run(): Promise<string> {
  registerBuiltinEngines();

  const engines = listAgentEngines();
  const currentSetting = await getSetting("agent-engine");
  const current = currentSetting
    ? (currentSetting as { engine?: string; model?: string })
    : null;

  // Same priority chain resolveEngine uses after explicit request options:
  // AGENT_ENGINE → Builder app_secrets → stored (if usable) → user BYOK
  // app_secrets → env → anthropic. Gating stored on the request-aware helper
  // keeps the picker in step with the runtime.
  const storedEntry =
    typeof current?.engine === "string"
      ? getAgentEngineEntry(current.engine)
      : undefined;
  const storedUsable =
    !!storedEntry &&
    (await isStoredEngineUsableForRequest(current, storedEntry));
  const detectedFromUser = await detectEngineFromUserSecrets();

  const currentEntry =
    (process.env.AGENT_ENGINE
      ? getAgentEngineEntry(process.env.AGENT_ENGINE)
      : undefined) ??
    (detectedFromUser?.name === "builder" ? detectedFromUser : undefined) ??
    (storedUsable ? storedEntry : undefined) ??
    detectedFromUser ??
    detectEngineFromEnv() ??
    undefined;
  const currentModel =
    storedUsable && currentEntry?.name === current?.engine
      ? current?.model
      : undefined;
  const currentEngineName = currentEntry?.name ?? "anthropic";

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
    })),
    current: {
      engine: currentEngineName,
      model: currentModel ?? currentEntry?.defaultModel ?? DEFAULT_MODEL,
    },
  };

  return JSON.stringify(result, null, 2);
}
