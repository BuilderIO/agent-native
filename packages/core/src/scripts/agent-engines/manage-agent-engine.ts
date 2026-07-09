/**
 * manage-agent-engine — unified tool for listing, setting, and testing agent engines.
 *
 * Consolidates the former list-agent-engines, set-agent-engine, and test-agent-engine
 * tools into a single tool with an `action` discriminator.
 */

import {
  canUpdateAgentAppModelDefaultSettings,
  normalizeAgentAppModelDefaultAppId,
  readAgentAppModelDefaultSettings,
  resetAgentAppModelDefaultSettings,
  writeAgentAppModelDefaultSettings,
} from "../../agent/app-model-defaults.js";
import {
  getAgentEngineEntry,
  isAgentEnginePackageInstalled,
  normalizeModelForEngine,
  registerBuiltinEngines,
} from "../../agent/engine/index.js";
import type { ActionTool } from "../../agent/types.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../../server/request-context.js";
import { run as runList } from "./list-agent-engines.js";
import { run as runSet } from "./set-agent-engine.js";
import { run as runTest } from "./test-agent-engine.js";

export const tool: ActionTool = {
  description:
    'Manage AI agent engines: list available engines, set the active global engine/model, test an engine, or manage the current app/template default model. Pass action="list" to see options, action="set" to change the global default, action="test" to verify connectivity, action="get-app-default" to inspect this app default, action="set-app-default" to set this app default, or action="reset-app-default" to clear it.',
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "list",
          "set",
          "test",
          "get-app-default",
          "set-app-default",
          "reset-app-default",
        ],
        description:
          '"list" — show available engines and current global selection. "set" — change the active global engine/model. "test" — send a trivial prompt to verify connectivity. "get-app-default" — show this app/template default. "set-app-default" — set this app/template default. "reset-app-default" — clear this app/template default.',
      },
      engine: {
        type: "string",
        description:
          'Engine name (e.g. "builder", "anthropic", "ai-sdk:openai", "ai-sdk:google"). Required for "set" and "set-app-default", optional for "test" (defaults to "anthropic").',
      },
      model: {
        type: "string",
        description:
          "Model ID (e.g. 'gpt-5.5', 'claude-sonnet-5', 'gemini-3-1-pro'). Required for \"set-app-default\"; optional for \"set\" and \"test\" where it defaults to the engine's default model.",
      },
      baseUrl: {
        type: "string",
        description:
          'Optional OpenAI-compatible endpoint URL for action="test" with engine="ai-sdk:openai". Saved endpoint settings are used when omitted.',
      },
      appId: {
        type: "string",
        description:
          "App/template id whose default model should be managed. Defaults to the current app.",
      },
    },
    required: ["action"],
  },
};

function currentContext(): { userEmail?: string; orgId?: string | null } {
  try {
    return {
      userEmail: getRequestUserEmail(),
      orgId: getRequestOrgId(),
    };
  } catch {
    return {};
  }
}

function resolveAppId(args: Record<string, string>): string | null {
  return normalizeAgentAppModelDefaultAppId(args.appId);
}

async function runGetAppDefault(args: Record<string, string>): Promise<string> {
  const appId = resolveAppId(args);
  if (!appId) return "Error: appId is required";
  const ctx = currentContext();
  const settings = await readAgentAppModelDefaultSettings(ctx, appId);
  const canUpdate = await canUpdateAgentAppModelDefaultSettings(
    ctx.userEmail,
    ctx.orgId,
  );
  return JSON.stringify({ ok: true, ...settings, canUpdate }, null, 2);
}

async function runSetAppDefault(args: Record<string, string>): Promise<string> {
  registerBuiltinEngines();
  const appId = resolveAppId(args);
  if (!appId) return "Error: appId is required";

  const engine = args.engine?.trim();
  const model = args.model?.trim();
  if (!engine) return "Error: engine is required";
  if (!model) return "Error: model is required";

  const entry = getAgentEngineEntry(engine);
  if (!entry) return `Error: Unknown engine "${engine}"`;
  if (!isAgentEnginePackageInstalled(entry)) {
    return `Error: Engine "${engine}" requires optional packages that are not installed in this app. Run: pnpm add ${entry.installPackage}`;
  }
  const normalizedModel = normalizeModelForEngine(entry, model);

  const ctx = currentContext();
  const canUpdate = await canUpdateAgentAppModelDefaultSettings(
    ctx.userEmail,
    ctx.orgId,
  );
  if (!canUpdate) {
    return ctx.orgId
      ? "Error: Only organization owners and admins can change app model defaults."
      : "Error: Authentication required to change app model defaults.";
  }

  const settings = await writeAgentAppModelDefaultSettings(ctx, appId, {
    engine,
    model: normalizedModel,
    updatedBy: ctx.userEmail,
  });
  const normalizedNote =
    normalizedModel === model
      ? ""
      : ` Requested model "${model}" is no longer supported, so "${normalizedModel}" was saved instead.`;
  return JSON.stringify(
    {
      ok: true,
      ...settings,
      message: `Default model for ${appId} set to ${normalizedModel} via ${entry.label}.${normalizedNote}`,
    },
    null,
    2,
  );
}

async function runResetAppDefault(
  args: Record<string, string>,
): Promise<string> {
  const appId = resolveAppId(args);
  if (!appId) return "Error: appId is required";
  const ctx = currentContext();
  const canUpdate = await canUpdateAgentAppModelDefaultSettings(
    ctx.userEmail,
    ctx.orgId,
  );
  if (!canUpdate) {
    return ctx.orgId
      ? "Error: Only organization owners and admins can reset app model defaults."
      : "Error: Authentication required to reset app model defaults.";
  }
  const settings = await resetAgentAppModelDefaultSettings(ctx, appId);
  return JSON.stringify(
    {
      ok: true,
      ...settings,
      message: `Default model for ${appId} reset to the global LLM default.`,
    },
    null,
    2,
  );
}

export async function run(args: Record<string, string>): Promise<string> {
  const { action } = args;

  switch (action) {
    case "list":
      return runList(args);
    case "set":
      return runSet(args);
    case "test":
      return runTest(args);
    case "get-app-default":
      return runGetAppDefault(args);
    case "set-app-default":
      return runSetAppDefault(args);
    case "reset-app-default":
      return runResetAppDefault(args);
    default:
      return JSON.stringify({
        error: `Unknown action "${action}". Must be one of: list, set, test, get-app-default, set-app-default, reset-app-default.`,
      });
  }
}
