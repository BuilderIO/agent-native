/**
 * manage-agent-engine — unified tool for listing, setting, and testing agent engines.
 *
 * Consolidates the former list-agent-engines, set-agent-engine, and test-agent-engine
 * tools into a single tool with an `action` discriminator.
 */

import type { ActionTool } from "../../agent/types.js";
import { run as runList } from "./list-agent-engines.js";
import { run as runSet } from "./set-agent-engine.js";
import { run as runTest } from "./test-agent-engine.js";

export const tool: ActionTool = {
  description:
    'Manage AI agent engines: list available engines, set the active engine/model, or test an engine. Pass action="list" to see options, action="set" to change, action="test" to verify connectivity.',
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "set", "test"],
        description:
          '"list" — show available engines and current selection. "set" — change the active engine/model. "test" — send a trivial prompt to verify connectivity.',
      },
      engine: {
        type: "string",
        description:
          'Engine name (e.g. "anthropic", "ai-sdk:openai", "ai-sdk:google"). Required for "set", optional for "test" (defaults to "anthropic").',
      },
      model: {
        type: "string",
        description:
          "Model ID (e.g. 'claude-sonnet-4-6', 'gpt-4o'). Optional for \"set\" and \"test\"; defaults to the engine's default model.",
      },
    },
    required: ["action"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const { action } = args;

  switch (action) {
    case "list":
      return runList();
    case "set":
      return runSet(args);
    case "test":
      return runTest(args);
    default:
      return JSON.stringify({
        error: `Unknown action "${action}". Must be one of: list, set, test.`,
      });
  }
}
