/**
 * set-agent-engine — validates and writes the default model (the
 * `agent-engine` setting) for the caller's organization.
 */

import { ActionContractError, type ActionRunContext } from "../../action.js";
import {
  recordDefaultAgentEngineRefusal,
  resolveDefaultAgentEngineAuthority,
  writeDefaultAgentEngineSelection,
  type DefaultAgentEngineChangeMeta,
  type DefaultAgentEngineContext,
} from "../../agent/default-agent-engine.js";
import {
  listAgentEngines,
  getAgentEngineEntry,
  isAgentEnginePackageInstalled,
  isStoredEngineUsableForRequest,
  normalizeModelForEngine,
  resolveEngineAcceptsCustomModels,
  resolveEnginePreservesCustomModels,
  registerBuiltinEngines,
} from "../../agent/engine/index.js";
import type { ActionTool } from "../../agent/types.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../../server/request-context.js";

export const tool: ActionTool = {
  description:
    'Set the organization\'s default AI engine and model. Only organization owners and admins can change it; a user with no organization sets their own. Changes take effect on the next conversation. Use manage-agent-engine with action="list" first to see available options and whether you can change the default (canUpdateDefault).',
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
          "Model ID to use with this engine (e.g. 'gpt-5.6-sol', 'claude-sonnet-5'). Defaults to the engine's default model if omitted.",
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
    }
  | { status: "refused"; message: string }
  | { status: "invalid"; message: string }
  | { status: "missing-credentials"; message: string };

/**
 * Validate an engine/model pair and save it as the default for the caller's
 * scope. Shared by the `set` action and the provider-key save route so both
 * apply the same role check, validation, and audit record.
 */
export async function selectDefaultAgentEngine(
  input: { engine?: string; model?: string },
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

  const requestedModel = input.model?.trim() || entry.defaultModel;
  // A static registry entry cannot carry runtime endpoint state, so resolve
  // both gateway and provider model capabilities before saving the selection.
  const acceptsCustomModels = await resolveEngineAcceptsCustomModels(entry);
  const preserveCustomModels = await resolveEnginePreservesCustomModels(entry);
  const resolvedModel = normalizeModelForEngine(entry, requestedModel, {
    acceptsCustomModels,
    preserveCustomModels,
  });

  const usable = await isStoredEngineUsableForRequest(
    { engine: engineName },
    entry,
  );
  if (!usable) {
    const missingEnvVars = entry.requiredEnvVars.join(", ");
    return {
      status: "missing-credentials",
      message: `Engine "${engineName}" requires the following credentials which are not configured for this request: ${missingEnvVars}. The engine will fail at runtime without them.`,
    };
  }

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
  };
}

export async function run(
  args: Record<string, string>,
  context?: ActionRunContext,
): Promise<string> {
  const result = await selectDefaultAgentEngine(args, {
    actionName: context?.actionName ?? "manage-agent-engine",
    caller: context?.caller,
    threadId: context?.threadId,
    turnId: context?.turnId,
    runId: context?.runId,
  });

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

  const normalizedNote =
    result.model === result.requestedModel
      ? ""
      : ` Requested model "${result.requestedModel}" is no longer supported, so "${result.model}" was saved instead.`;

  return JSON.stringify({
    ok: true,
    engine: result.engine,
    model: result.model,
    message: `Default model set to ${result.label} with model ${result.model}. Takes effect on the next conversation.${normalizedNote}`,
  });
}
