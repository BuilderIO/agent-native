import type { ActionRunContext } from "../../action.js";
import {
  canUpdateAgentAppModelDefaultSettings,
  normalizeAgentAppModelDefaultAppId,
  readAgentAppModelDefaultSettings,
  resetAgentAppModelDefaultSettings,
  writeAgentAppModelDefaultSettings,
} from "../../agent/app-model-defaults.js";
import { CHATGPT_SUBSCRIPTION_ENGINE_NAME } from "../../agent/chatgpt-subscription-contract.js";
import { listChatGPTSubscriptionModels } from "../../agent/engine/chatgpt-subscription-engine.js";
import {
  getAgentEngineEntry,
  isAgentEnginePackageInstalled,
  normalizeModelForEngine,
  resolveEngineAcceptsCustomModels,
  resolveEnginePreservesCustomModels,
  registerBuiltinEngines,
} from "../../agent/engine/index.js";
import type { ActionTool } from "../../agent/types.js";
import { defaultModelMessagesForUser } from "../../localization/default-model-messages.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../../server/request-context.js";
import { run as runList } from "./list-agent-engines.js";
import {
  run as runSet,
  resolveDefaultModelEffective,
  effectiveConfigurationMessage,
} from "./set-agent-engine.js";
import { run as runTest } from "./test-agent-engine.js";

export const tool: ActionTool = {
  description:
    'Manage AI engines and scoped defaults. Clarify organization/personal versus app when the user says "change my default" without a scope. action="set" changes only the organization default (owners/admins) or a no-organization user\'s personal default, preserving ALL app overrides. action="set-app-default" changes only the named app default, preserving explicit chat/automation models. Only an explicit request to inherit uses action="reset-app-default". action="list" shows available options, effective selection and canUpdateDefault; action="get-app-default" inspects the app default; action="test" checks connectivity.',
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
          '"list" — show available engines, the current selection, and whether you can change the organization default. "set" — change the organization default engine/model (owners and admins only). "test" — send a trivial prompt to verify connectivity. "get-app-default" — show this app/template default. "set-app-default" — set this app/template default. "reset-app-default" — clear this app/template default.',
      },
      engine: {
        type: "string",
        description:
          'Engine name (e.g. "builder", "anthropic", "ai-sdk:openai", "ai-sdk:google"). Required for "set" and "set-app-default", optional for "test" (defaults to "anthropic").',
      },
      model: {
        type: "string",
        description:
          "Model ID (e.g. 'gpt-5.6-sol', 'claude-sonnet-5-5', 'gemini-3-1-pro'). Required for \"set-app-default\"; optional for \"set\" and \"test\" where it defaults to the engine's default model.",
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

  const ctx = currentContext();
  if (engine === CHATGPT_SUBSCRIPTION_ENGINE_NAME) {
    if (ctx.orgId) {
      return "Error: ChatGPT plan access is personal and cannot be selected as an organization default.";
    }
    const email = ctx.userEmail;
    if (!email) return "Error: Sign in before selecting ChatGPT plan access.";
    try {
      const catalog = await listChatGPTSubscriptionModels(email);
      if (!catalog.models.includes(model)) {
        return "Error: Choose a visible model from the selected ChatGPT account's model list.";
      }
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : "Unable to load the ChatGPT account's model list."}`;
    }
  }

  const entry = getAgentEngineEntry(engine);
  if (!entry) return `Error: Unknown engine "${engine}"`;
  if (!isAgentEnginePackageInstalled(entry)) {
    return `Error: Engine "${engine}" requires optional packages that are not installed in this app. Run: pnpm add ${entry.installPackage}`;
  }
  const acceptsCustomModels = await resolveEngineAcceptsCustomModels(entry);
  const preserveCustomModels = await resolveEnginePreservesCustomModels(entry);
  const normalizedModel = normalizeModelForEngine(entry, model, {
    acceptsCustomModels,
    preserveCustomModels,
  });

  const canUpdate = await canUpdateAgentAppModelDefaultSettings(
    ctx.userEmail,
    ctx.orgId,
  );
  if (!canUpdate) {
    return ctx.orgId
      ? "Error: Only organization owners and admins can change app model defaults."
      : "Error: Authentication required to change app model defaults.";
  }

  const effective = await resolveDefaultModelEffective(ctx, appId, {
    appDefault: { engine, model: normalizedModel },
  });
  const messages = await defaultModelMessagesForUser(ctx.userEmail);
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
      requestedScope: "app",
      ...settings,
      effective,
      preservedOverrides: ["chat-models", "automation-models"],
      message:
        `Default model for ${appId} set to ${normalizedModel} via ${entry.label}.${normalizedNote}` +
        effectiveConfigurationMessage(effective, messages),
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
  registerBuiltinEngines();
  const effective = await resolveDefaultModelEffective(ctx, appId, {
    appDefault: null,
  });
  const messages = await defaultModelMessagesForUser(ctx.userEmail);
  const settings = await resetAgentAppModelDefaultSettings(ctx, appId);
  return JSON.stringify(
    {
      ok: true,
      requestedScope: "app",
      ...settings,
      effective,
      preservedOverrides: ["chat-models", "automation-models"],
      message:
        `Default model for ${appId} reset to the global LLM default.` +
        effectiveConfigurationMessage(effective, messages),
    },
    null,
    2,
  );
}

export async function run(
  args: Record<string, string>,
  context?: ActionRunContext,
): Promise<string> {
  const { action } = args;

  switch (action) {
    case "list":
      return runList(args);
    case "set":
      return runSet(args, context);
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
