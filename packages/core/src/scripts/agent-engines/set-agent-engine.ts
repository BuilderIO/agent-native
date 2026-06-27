/**
 * set-agent-engine — validates and writes agent engine selection to settings.
 */

import {
  listAgentEngines,
  getAgentEngineEntry,
  isAgentEnginePackageInstalled,
  isStoredEngineUsableForRequest,
  normalizeModelForEngine,
  registerBuiltinEngines,
} from "../../agent/engine/index.js";
import type { ActionTool } from "../../agent/types.js";
import { putSetting } from "../../settings/index.js";

export const tool: ActionTool = {
  description:
    'Set the active AI agent engine and model. Changes take effect on the next conversation. Use manage-agent-engine with action="list" first to see available options.',
  parameters: {
    type: "object",
    properties: {
      engine: {
        type: "string",
        description:
          'Engine name (e.g. "anthropic", "ai-sdk:openai", "ai-sdk:google"). Use manage-agent-engine with action="list" to see all options.',
      },
      model: {
        type: "string",
        description:
          "Model ID to use with this engine (e.g. 'gpt-5.5', 'claude-sonnet-4-6'). Defaults to the engine's default model if omitted.",
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

  if (!isAgentEnginePackageInstalled(entry)) {
    return `Error: Engine "${engineName}" requires optional packages that are not installed in this app. Run: pnpm add ${entry.installPackage}`;
  }

  const resolvedModel = model ?? entry.defaultModel;
  if (
    entry.name === "builder" &&
    normalizeModelForEngine(entry, resolvedModel) !== resolvedModel
  ) {
    return `Error: Model "${resolvedModel}" is not supported by Builder. Choose one of: ${entry.supportedModels.join(", ")}`;
  }

  // supportedModels is a suggestion list, not an allowlist — accept any
  // string for BYO/custom engines (OpenRouter / Ollama / previews) and flag
  // uncurated saves. Builder is an enumerated gateway and is checked above.
  const modelIsCurated =
    entry.supportedModels.length === 0 ||
    entry.supportedModels.includes(resolvedModel);

  const usable = await isStoredEngineUsableForRequest(
    { engine: engineName },
    entry,
  );
  if (!usable) {
    const missingEnvVars = entry.requiredEnvVars.join(", ");
    return `Warning: Engine "${engineName}" requires the following credentials which are not configured for this request: ${missingEnvVars}. The engine will fail at runtime without them.`;
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
