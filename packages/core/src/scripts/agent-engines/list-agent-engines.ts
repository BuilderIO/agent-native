/**
 * list-agent-engines — returns the registered engine registry and current selection.
 */

import type { ActionTool } from "../../agent/types.js";
import {
  listAgentEngines,
  registerBuiltinEngines,
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
      engine: current?.engine ?? process.env.AGENT_ENGINE ?? "anthropic",
      model:
        current?.model ??
        engines.find(
          (e) =>
            e.name ===
            (current?.engine ?? process.env.AGENT_ENGINE ?? "anthropic"),
        )?.defaultModel ??
        "claude-haiku-4-5-20251001",
    },
  };

  return JSON.stringify(result, null, 2);
}
