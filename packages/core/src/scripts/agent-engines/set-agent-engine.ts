/**
 * set-agent-engine — validates and writes the default model (the
 * `agent-engine` setting) for the caller's organization.
 */

import { ActionContractError, type ActionRunContext } from "../../action.js";
import {
  normalizeAgentAppModelDefaultAppId,
  readAgentAppModelDefaultSettings,
} from "../../agent/app-model-defaults.js";
import { CHATGPT_SUBSCRIPTION_ENGINE_NAME } from "../../agent/chatgpt-subscription-contract.js";
import {
  recordDefaultAgentEngineRefusal,
  readDefaultAgentEngineSettingDetailed,
  resolveDefaultAgentEngineAuthority,
  writeDefaultAgentEngineSelection,
  type DefaultAgentEngineChangeMeta,
  type DefaultAgentEngineContext,
} from "../../agent/default-agent-engine.js";
import {
  resolveAgentEngineStatus,
  type AgentEngineStatusResult,
} from "../../agent/engine-status.js";
import { listChatGPTSubscriptionModels } from "../../agent/engine/chatgpt-subscription-engine.js";
import {
  listAgentEngines,
  detectEngineFromEnv,
  detectEngineFromUserSecrets,
  getAgentEngineEntry,
  isAgentEnginePackageInstalled,
  isStoredEngineUsableForRequest,
  normalizeModelForEngine,
  resolveEngineAcceptsCustomModels,
  resolveEnginePreservesCustomModels,
  registerBuiltinEngines,
} from "../../agent/engine/index.js";
import type { ActionTool } from "../../agent/types.js";
import { getAppConfig } from "../../app-config/index.js";
import { CHATGPT_SUBSCRIPTION_LAB } from "../../labs/core-labs.js";
import { getUserLabEnabled } from "../../labs/store.js";
import { defaultModelMessagesForUser } from "../../localization/default-model-messages.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../../server/request-context.js";

export const tool: ActionTool = {
  description:
    'Set only the organization\'s default AI engine and model (or a no-organization user\'s personal default). Preserve every app override and explicit chat/automation model. For an app default, use manage-agent-engine with action="set-app-default"; inheritance requires action="reset-app-default". If the user\'s requested scope is ambiguous, clarify organization/personal versus app before changing anything. The result separates the saved default from the current app\'s effective model. Only organization owners and admins can change it. Use manage-agent-engine with action="list" first to see options and canUpdateDefault.',
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
          "Model ID to use with this engine (e.g. 'gpt-6.1-sol', 'claude-sonnet-5-5'). Defaults to the engine's default model if omitted.",
      },
    },
    required: ["engine"],
  },
};

export const DEFAULT_MODEL_ADMIN_REQUIRED_ERROR_CODE =
  "default_model_admin_required";

export type SelectDefaultAgentEngineResult =
  | {
      status: "selected";
      engine: string;
      model: string;
      requestedModel: string;
      label: string;
      scope: "org" | "user";
      appId?: string;
      effective: Pick<
        AgentEngineStatusResult,
        "configured" | "engine" | "model"
      > & {
        source?:
          | "configuration"
          | "app-default"
          | "org"
          | "user"
          | "legacy"
          | "app_secrets"
          | "env";
      };
    }
  | { status: "refused"; message: string }
  | { status: "invalid"; message: string }
  | { status: "missing-credentials"; message: string }
  | { status: "unavailable"; message: string };

export async function resolveDefaultModelEffective(
  ctx: DefaultAgentEngineContext,
  appId: string | null,
  planned: {
    sharedDefault?: { engine: string; model: string };
    appDefault?: { engine: string; model: string } | null;
  } = {},
): Promise<
  Extract<SelectDefaultAgentEngineResult, { status: "selected" }>["effective"]
> {
  const credentialIdentity = ctx.userEmail
    ? { userEmail: ctx.userEmail, orgId: ctx.orgId }
    : undefined;
  const shared: { source: "org" | "user" | "legacy" | "none" } = {
    source: ctx.orgId ? "org" : "user",
  };
  const status = await resolveAgentEngineStatus({
    lookupEntry: getAgentEngineEntry,
    readStoredEngine: async () => {
      if (planned.sharedDefault) return planned.sharedDefault;
      const stored = await readDefaultAgentEngineSettingDetailed(ctx);
      shared.source = stored.source;
      return stored.value;
    },
    readAppDefault: async () => {
      if (planned.appDefault !== undefined) return planned.appDefault;
      if (!appId) return null;
      const stored = await readAgentAppModelDefaultSettings(ctx, appId);
      return stored.engine && stored.model
        ? { engine: stored.engine, model: stored.model }
        : null;
    },
    readOpenAiBaseUrlConfigured: () => false,
    isStoredEngineUsable: (stored, entry) =>
      isStoredEngineUsableForRequest(stored, entry, { credentialIdentity }),
    detectFromUserSecrets: () =>
      detectEngineFromUserSecrets(credentialIdentity),
    detectFromEnv: detectEngineFromEnv,
  });
  return {
    configured: status.configured,
    engine: status.engine,
    model: status.model,
    source:
      status.selectionSource === "shared-default"
        ? shared.source === "none"
          ? undefined
          : shared.source
        : status.selectionSource,
  };
}

export function effectiveConfigurationMessage(
  effective: Extract<
    SelectDefaultAgentEngineResult,
    { status: "selected" }
  >["effective"],
  messages: { configurationOverride: string; configurationUnavailable: string },
): string {
  if (effective.source !== "configuration") return "";
  return (
    " " +
    (effective.configured
      ? messages.configurationOverride
          .replace("{{model}}", effective.model!)
          .replace("{{engine}}", effective.engine!)
      : messages.configurationUnavailable)
  );
}

/**
 * Validate an engine/model pair and save it as the default for the caller's
 * scope. Shared by the `set` action and the provider-key save route so both
 * apply the same role check, validation, and audit record.
 */
export async function selectDefaultAgentEngine(
  input: { engine?: string; model?: string; appId?: string },
  meta: DefaultAgentEngineChangeMeta,
  ctx: DefaultAgentEngineContext = {
    userEmail: getRequestUserEmail(),
    orgId: getRequestOrgId(),
  },
): Promise<SelectDefaultAgentEngineResult> {
  registerBuiltinEngines();

  const engineName = input.engine?.trim();
  if (!engineName)
    return { status: "invalid", message: "--engine is required" };

  const authority = await resolveDefaultAgentEngineAuthority(ctx);
  if (!authority.allowed) {
    await recordDefaultAgentEngineRefusal(ctx, authority, "set", meta, {
      engine: engineName,
      ...(input.model ? { model: input.model } : {}),
    });
    return { status: "refused", message: authority.message };
  }
  if (
    engineName === CHATGPT_SUBSCRIPTION_ENGINE_NAME &&
    authority.scope === "org"
  ) {
    return {
      status: "invalid",
      message:
        "ChatGPT plan access is personal and cannot be selected as an organization default.",
    };
  }

  const entry = getAgentEngineEntry(engineName);
  if (!entry) {
    const available = listAgentEngines()
      .map((e) => e.name)
      .join(", ");
    return {
      status: "invalid",
      message: `Engine "${engineName}" not found. Available engines: ${available}`,
    };
  }

  if (!isAgentEnginePackageInstalled(entry)) {
    return {
      status: "invalid",
      message: `Engine "${engineName}" requires optional packages that are not installed in this app. Run: pnpm add ${entry.installPackage}`,
    };
  }

  const chatGPTEmail =
    entry.name === CHATGPT_SUBSCRIPTION_ENGINE_NAME
      ? (ctx.userEmail ?? getRequestUserEmail())
      : undefined;
  if (entry.name === CHATGPT_SUBSCRIPTION_ENGINE_NAME) {
    if (!chatGPTEmail) {
      return {
        status: "missing-credentials",
        message: "A signed-in user is required to use ChatGPT plan access.",
      };
    }
    if (!(await getUserLabEnabled(chatGPTEmail, CHATGPT_SUBSCRIPTION_LAB))) {
      return {
        status: "unavailable",
        message:
          "Enable ChatGPT plan access in Settings → Labs before selecting this engine.",
      };
    }
  }

  const credentialEmail = chatGPTEmail ?? ctx.userEmail;
  const credentialIdentity = credentialEmail
    ? { userEmail: credentialEmail }
    : undefined;
  const needsCredentialIdentity =
    entry.name === "builder" || entry.name === CHATGPT_SUBSCRIPTION_ENGINE_NAME;
  const usable =
    credentialIdentity && needsCredentialIdentity
      ? await isStoredEngineUsableForRequest({ engine: engineName }, entry, {
          credentialIdentity,
        })
      : await isStoredEngineUsableForRequest({ engine: engineName }, entry);
  if (!usable) {
    return {
      status: "missing-credentials",
      message:
        engineName === CHATGPT_SUBSCRIPTION_ENGINE_NAME
          ? "Connect a ChatGPT account with direct model access before selecting this engine."
          : `Engine "${engineName}" requires the following credentials which are not configured for this request: ${entry.requiredEnvVars.join(", ")}. The engine will fail at runtime without them.`,
    };
  }

  let requestedModel = input.model?.trim() || entry.defaultModel;
  if (engineName === CHATGPT_SUBSCRIPTION_ENGINE_NAME) {
    try {
      const catalog = await listChatGPTSubscriptionModels(chatGPTEmail!);
      if (!requestedModel) requestedModel = catalog.models[0] ?? "";
      if (!requestedModel || !catalog.models.includes(requestedModel)) {
        return {
          status: "invalid",
          message:
            "Choose a visible model from the selected ChatGPT account's model list.",
        };
      }
    } catch (error) {
      return {
        status: "unavailable",
        message:
          error instanceof Error
            ? error.message
            : "Unable to load the ChatGPT account's model list.",
      };
    }
  }
  const acceptsCustomModels = await resolveEngineAcceptsCustomModels(entry);
  const preserveCustomModels = await resolveEnginePreservesCustomModels(entry);
  const resolvedModel = normalizeModelForEngine(entry, requestedModel, {
    acceptsCustomModels,
    preserveCustomModels,
  });

  const config = getAppConfig();
  const appIdInput =
    input.appId ?? config.app.id ?? config.app.template ?? config.app.slug;
  const appId = normalizeAgentAppModelDefaultAppId(appIdInput);
  if (appIdInput && !appId) {
    return { status: "invalid", message: "A valid appId is required." };
  }

  const effective = await resolveDefaultModelEffective(ctx, appId, {
    sharedDefault: { engine: engineName, model: resolvedModel },
  });

  await writeDefaultAgentEngineSelection(
    authority,
    { engine: engineName, model: resolvedModel },
    meta,
  );
  return {
    status: "selected",
    engine: engineName,
    model: resolvedModel,
    requestedModel,
    label: entry.label,
    scope: authority.scope,
    effective,
    ...(appId ? { appId } : {}),
  };
}

export async function run(
  args: Record<string, string>,
  context?: ActionRunContext,
): Promise<string> {
  const messages = await defaultModelMessagesForUser(getRequestUserEmail());
  const result = await selectDefaultAgentEngine(
    { ...args, appId: context?.appId ?? args.appId },
    {
      actionName: context?.actionName ?? "manage-agent-engine",
      caller: context?.caller,
      threadId: context?.threadId,
      turnId: context?.turnId,
      runId: context?.runId,
    },
  );

  if (result.status === "refused") {
    throw new ActionContractError(result.message, {
      errorCode: DEFAULT_MODEL_ADMIN_REQUIRED_ERROR_CODE,
      statusCode: 403,
    });
  }
  if (result.status === "invalid") return `Error: ${result.message}`;
  if (result.status === "missing-credentials") {
    return `Warning: ${result.message}`;
  }
  if (result.status === "unavailable") {
    return `Error: ${result.message}`;
  }

  return JSON.stringify({
    ok: true,
    engine: result.engine,
    model: result.model,
    requestedModel: result.requestedModel,
    scope: result.scope,
    requestedScope: result.scope,
    appId: result.appId,
    appDefaultReset: false,
    preservedOverrides: ["app-models", "chat-models", "automation-models"],
    effective: result.effective,
    message:
      (result.scope === "org"
        ? messages.organizationSelected
        : messages.userSelected
      )
        .replace("{{model}}", result.model)
        .replace("{{engine}}", result.label) +
      (result.effective.source === "configuration"
        ? effectiveConfigurationMessage(result.effective, messages)
        : result.appId && result.effective.source === "app-default"
          ? " " +
            messages.appOverridePreserved
              .replace("{{appId}}", result.appId)
              .replace("{{model}}", result.effective.model!)
              .replace("{{engine}}", result.effective.engine!)
          : ""),
  });
}
