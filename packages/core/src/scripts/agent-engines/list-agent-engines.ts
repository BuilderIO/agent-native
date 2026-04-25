/**
 * list-agent-engines — returns the registered engine registry and current selection.
 */

import type { ActionTool } from "../../agent/types.js";
import {
  listAgentEngines,
  registerBuiltinEngines,
  detectEngineFromEnv,
  getAgentEngineEntry,
  isStoredEngineUsable,
} from "../../agent/engine/index.js";
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

  // Same priority chain resolveEngine uses: stored (if usable) → AGENT_ENGINE
  // → detect → anthropic. Gating stored on isStoredEngineUsable keeps this
  // in step with /agent-engine/status.
  const storedEntry =
    typeof current?.engine === "string"
      ? getAgentEngineEntry(current.engine)
      : undefined;
  const storedUsable =
    !!storedEntry && isStoredEngineUsable(current, storedEntry);

  const currentEntry =
    (storedUsable ? storedEntry : undefined) ??
    (process.env.AGENT_ENGINE
      ? getAgentEngineEntry(process.env.AGENT_ENGINE)
      : undefined) ??
    detectEngineFromEnv() ??
    undefined;
  const currentModel = storedUsable ? current?.model : undefined;
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
      model:
        currentModel ??
        currentEntry?.defaultModel ??
        "claude-haiku-4-5-20251001",
    },
  };

  return JSON.stringify(result, null, 2);
}
