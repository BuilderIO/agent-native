/**
 * list-agent-engines — returns the registered engine registry and current selection.
 */

import type { ActionTool } from "../../agent/types.js";
import {
  listAgentEngines,
  registerBuiltinEngines,
  detectEngineFromEnv,
} from "../../agent/engine/index.js";
import { getSetting } from "../../settings/index.js";

export const tool: ActionTool = {
  description:
    "List all available AI agent engines (Anthropic, OpenAI, Gemini, Groq, etc.) and the currently selected engine. Use this to check what engines are available before calling set-agent-engine.",
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

  // Resolve current engine in the same priority resolveEngine uses:
  // settings → AGENT_ENGINE env → auto-detect → anthropic default. Validate
  // against the registry so a stale `AGENT_ENGINE=local-openai` from a
  // pre-migration template doesn't poison the Settings picker.
  const explicit = current?.engine ?? process.env.AGENT_ENGINE;
  const explicitEntry =
    explicit != null ? engines.find((e) => e.name === explicit) : undefined;
  const currentEntry = explicitEntry ?? detectEngineFromEnv() ?? undefined;
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
        current?.model ??
        currentEntry?.defaultModel ??
        "claude-haiku-4-5-20251001",
    },
  };

  return JSON.stringify(result, null, 2);
}
