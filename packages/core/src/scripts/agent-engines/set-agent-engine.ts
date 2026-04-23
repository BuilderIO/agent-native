/**
 * set-agent-engine — validates and writes agent engine selection to settings.
 */

import type { ActionTool } from "../../agent/types.js";
import {
  listAgentEngines,
  getAgentEngineEntry,
  registerBuiltinEngines,
} from "../../agent/engine/index.js";
import { putSetting } from "../../settings/index.js";

export const tool: ActionTool = {
  description:
    "Set the active AI agent engine and model. Changes take effect on the next conversation. Use list-agent-engines first to see available options.",
  parameters: {
    type: "object",
    properties: {
      engine: {
        type: "string",
        description:
          'Engine name (e.g. "anthropic", "ai-sdk:openai", "ai-sdk:google"). Use list-agent-engines to see all options.',
      },
      model: {
        type: "string",
        description:
          "Model ID to use with this engine (e.g. 'claude-sonnet-4-6', 'gpt-4o'). Defaults to the engine's default model if omitted.",
      },
    },
    required: ["engine"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  registerBuiltinEngines();

  const { engine: engineName, model } = args;

  if (!engineName) return "Error: --engine is required";

  const entry = getAgentEngineEntry(engineName);
  if (!entry) {
    const available = listAgentEngines()
      .map((e) => e.name)
      .join(", ");
    return `Error: Engine "${engineName}" not found. Available engines: ${available}`;
  }

  const resolvedModel = model ?? entry.defaultModel;

  // supportedModels is a suggestion list, not an allowlist — accept any
  // string (OpenRouter / Ollama / previews) and flag uncurated saves.
  const modelIsCurated =
    entry.supportedModels.length === 0 ||
    entry.supportedModels.includes(resolvedModel);

  const missingEnvVars = entry.requiredEnvVars.filter((v) => !process.env[v]);
  if (missingEnvVars.length > 0) {
    return `Warning: Engine "${engineName}" requires the following environment variables which are not set: ${missingEnvVars.join(", ")}. The engine will fail at runtime without them.`;
  }

  await putSetting("agent-engine", {
    engine: engineName,
    model: resolvedModel,
  });

  const customNote = modelIsCurated
    ? ""
    : ` (model "${resolvedModel}" isn't in the curated list for ${entry.label}; saved as a custom model — verify it's a real ID for this provider)`;

  return JSON.stringify({
    ok: true,
    engine: engineName,
    model: resolvedModel,
    message: `Agent engine set to ${entry.label} with model ${resolvedModel}. Takes effect on the next conversation.${customNote}`,
  });
}
