/**
 * Which models each provider shows in the model picker.
 *
 * A selection is stored at the same scope as the provider's key: a personal
 * key's models are the member's own, an organization key's models belong to
 * the organization and only owners and admins change them. No stored row means
 * the provider's recommended models (`model-config.ts`).
 *
 * A selection only narrows what the picker and the default-model select offer.
 * A chat already pinned to an unchecked model keeps running on it.
 */

import {
  AGENT_PROVIDER_CATALOG,
  type AgentProviderId,
} from "../client/agent-provider-catalog.js";
import { getOrgRoleForEmail } from "../mcp/actions/service-token-access.js";
import { canManageOrg } from "../org/permissions.js";
import {
  resolveBuilderCredentialsDetailed,
  resolveSecretDetailed,
} from "../server/credential-provider.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import {
  deleteOrgSetting,
  deleteUserSetting,
  getOrgSetting,
  getUserSetting,
  putOrgSetting,
  putUserSetting,
} from "../settings/index.js";
import { OLLAMA_BASE_URL_ENV_VAR } from "./engine/openai-compatible-endpoint.js";
import { PROVIDER_ENV_META } from "./engine/provider-env-vars.js";
import { BUILDER_MODEL_CONFIG } from "./model-config.js";

export const PROVIDER_MODEL_SELECTION_KEY_PREFIX = "agent-provider-models";

/** Audit target type for selection changes and refused attempts. */
export const PROVIDER_MODEL_SELECTION_AUDIT_TARGET_TYPE = "provider-models";

export type ProviderModelSelectionProvider = AgentProviderId | "builder";
export type ProviderModelSelectionScope = "user" | "org";

export const PROVIDER_MODEL_SELECTION_PROVIDERS: readonly ProviderModelSelectionProvider[] =
  ["builder", ...AGENT_PROVIDER_CATALOG.map((option) => option.id)];

export const MAX_SELECTED_MODELS = 500;
const MAX_MODEL_ID_LENGTH = 256;

export interface ProviderModelSelectionContext {
  userEmail?: string | null;
  orgId?: string | null;
}

/** One scope's stored row. `models: null` means nothing is stored there. */
export interface ProviderModelSelectionRow {
  provider: ProviderModelSelectionProvider;
  scope: ProviderModelSelectionScope;
  models: string[] | null;
  updatedAt?: number;
  updatedBy?: string;
}

/**
 * The selection that applies to the current request. `default` shows the
 * recommended models; `unreadable` is a store failure, never an empty choice.
 */
export type EffectiveProviderModelSelection =
  | {
      state: "default";
      provider: ProviderModelSelectionProvider;
      scope: ProviderModelSelectionScope;
    }
  | {
      state: "selected";
      provider: ProviderModelSelectionProvider;
      scope: ProviderModelSelectionScope;
      models: string[];
    }
  | {
      state: "unreadable";
      provider: ProviderModelSelectionProvider;
      error: string;
    };

/** A request the selection store refuses before touching anything. */
export class ProviderModelSelectionError extends Error {
  readonly statusCode: 400 | 401 | 403;
  constructor(message: string, statusCode: 400 | 401 | 403) {
    super(message);
    this.name = "ProviderModelSelectionError";
    this.statusCode = statusCode;
  }
}

export function isProviderModelSelectionProvider(
  value: unknown,
): value is ProviderModelSelectionProvider {
  return (
    typeof value === "string" &&
    (PROVIDER_MODEL_SELECTION_PROVIDERS as readonly string[]).includes(value)
  );
}

export function providerModelSelectionSettingsKey(
  provider: ProviderModelSelectionProvider,
): string {
  return `${PROVIDER_MODEL_SELECTION_KEY_PREFIX}:${provider}`;
}

/**
 * The provider whose selection governs an engine. `anthropic` and
 * `ai-sdk:anthropic` share one key, so they share one selection. Engines with
 * no provider key (a ChatGPT subscription, a custom engine) have none.
 */
export function providerForEngineName(
  engineName: string,
): ProviderModelSelectionProvider | null {
  if (engineName === "builder") return "builder";
  if (engineName === "anthropic") return "anthropic";
  const aiSdk = engineName.startsWith("ai-sdk:")
    ? engineName.slice("ai-sdk:".length)
    : null;
  return aiSdk && isProviderModelSelectionProvider(aiSdk) ? aiSdk : null;
}

/** What an unset selection shows. */
export function recommendedProviderModels(
  provider: ProviderModelSelectionProvider,
): readonly string[] {
  if (provider === "builder") return BUILDER_MODEL_CONFIG.supportedModels;
  return (
    AGENT_PROVIDER_CATALOG.find((option) => option.id === provider)
      ?.supportedModels ?? []
  );
}

function providerCredentialEnvVar(
  provider: AgentProviderId,
): string | undefined {
  if (provider === "ollama") return OLLAMA_BASE_URL_ENV_VAR;
  return PROVIDER_ENV_META[provider]?.envVar;
}

/**
 * Trim, drop empties, and de-duplicate, keeping the caller's order. Builder
 * only routes its own catalog, so ids outside it are refused rather than
 * stored as choices the gateway would silently swap for its default.
 */
export function normalizeSelectedModels(
  provider: ProviderModelSelectionProvider,
  models: readonly unknown[],
): string[] {
  if (models.length > MAX_SELECTED_MODELS) {
    throw new ProviderModelSelectionError(
      `Select at most ${MAX_SELECTED_MODELS} models.`,
      400,
    );
  }
  const seen = new Set<string>();
  for (const raw of models) {
    if (typeof raw !== "string") {
      throw new ProviderModelSelectionError("Model ids must be strings.", 400);
    }
    const id = raw.trim();
    if (!id) continue;
    if (id.length > MAX_MODEL_ID_LENGTH || /[\s\p{Cc}]/u.test(id)) {
      throw new ProviderModelSelectionError(`Invalid model id: ${id}`, 400);
    }
    seen.add(id);
  }
  const normalized = [...seen];
  if (provider === "builder") {
    const catalog = new Set<string>(BUILDER_MODEL_CONFIG.supportedModels);
    const unknown = normalized.filter((id) => !catalog.has(id));
    if (unknown.length > 0) {
      throw new ProviderModelSelectionError(
        `Builder.io doesn't offer ${unknown.join(", ")}.`,
        400,
      );
    }
  }
  return normalized;
}

function parseRow(
  provider: ProviderModelSelectionProvider,
  scope: ProviderModelSelectionScope,
  stored: Record<string, unknown> | null,
): ProviderModelSelectionRow {
  if (!stored || !Array.isArray(stored.models)) {
    return { provider, scope, models: null };
  }
  const models = stored.models.filter(
    (model): model is string => typeof model === "string" && !!model.trim(),
  );
  return {
    provider,
    scope,
    models:
      provider === "builder"
        ? models.filter((model) =>
            (
              BUILDER_MODEL_CONFIG.supportedModels as readonly string[]
            ).includes(model),
          )
        : models,
    ...(typeof stored.updatedAt === "number" &&
    Number.isFinite(stored.updatedAt)
      ? { updatedAt: stored.updatedAt }
      : {}),
    ...(typeof stored.updatedBy === "string"
      ? { updatedBy: stored.updatedBy }
      : {}),
  };
}

function scopeIdFor(
  ctx: ProviderModelSelectionContext,
  scope: ProviderModelSelectionScope,
): string {
  if (scope === "org") {
    if (!ctx.orgId) {
      throw new ProviderModelSelectionError(
        "Organization scope needs an active organization.",
        400,
      );
    }
    return ctx.orgId;
  }
  if (!ctx.userEmail) {
    throw new ProviderModelSelectionError("Authentication required.", 401);
  }
  return ctx.userEmail;
}

/** Read one scope's row. Throws when the store can't be read. */
export async function readProviderModelSelection(
  ctx: ProviderModelSelectionContext,
  provider: ProviderModelSelectionProvider,
  scope: ProviderModelSelectionScope,
): Promise<ProviderModelSelectionRow> {
  const scopeId = scopeIdFor(ctx, scope);
  const key = providerModelSelectionSettingsKey(provider);
  const stored =
    scope === "org"
      ? await getOrgSetting(scopeId, key)
      : await getUserSetting(scopeId, key);
  return parseRow(provider, scope, stored);
}

/**
 * Whether the caller may change `scope`'s selection. Personal selections are
 * always the caller's own; organization ones need an owner or admin.
 */
export async function assertMayWriteProviderModelSelection(
  ctx: ProviderModelSelectionContext,
  scope: ProviderModelSelectionScope,
): Promise<void> {
  if (!ctx.userEmail) {
    throw new ProviderModelSelectionError("Authentication required.", 401);
  }
  if (scope !== "org") return;
  const orgId = scopeIdFor(ctx, "org");
  if (!canManageOrg(await getOrgRoleForEmail(orgId, ctx.userEmail))) {
    throw new ProviderModelSelectionError(
      "Only organization owners and admins can choose organization provider models.",
      403,
    );
  }
}

export async function writeProviderModelSelection(
  ctx: ProviderModelSelectionContext,
  provider: ProviderModelSelectionProvider,
  scope: ProviderModelSelectionScope,
  models: readonly unknown[],
): Promise<ProviderModelSelectionRow> {
  await assertMayWriteProviderModelSelection(ctx, scope);
  const normalized = normalizeSelectedModels(provider, models);
  const scopeId = scopeIdFor(ctx, scope);
  const key = providerModelSelectionSettingsKey(provider);
  const value: Record<string, unknown> = {
    models: normalized,
    updatedAt: Date.now(),
    ...(ctx.userEmail ? { updatedBy: ctx.userEmail } : {}),
  };
  if (scope === "org") await putOrgSetting(scopeId, key, value);
  else await putUserSetting(scopeId, key, value);
  return readProviderModelSelection(ctx, provider, scope);
}

/** Forget a scope's selection so it shows the recommended models again. */
export async function resetProviderModelSelection(
  ctx: ProviderModelSelectionContext,
  provider: ProviderModelSelectionProvider,
  scope: ProviderModelSelectionScope,
): Promise<ProviderModelSelectionRow> {
  await assertMayWriteProviderModelSelection(ctx, scope);
  const scopeId = scopeIdFor(ctx, scope);
  const key = providerModelSelectionSettingsKey(provider);
  if (scope === "org") await deleteOrgSetting(scopeId, key);
  else await deleteUserSetting(scopeId, key);
  return readProviderModelSelection(ctx, provider, scope);
}

function currentContext(): ProviderModelSelectionContext {
  return {
    userEmail: getRequestUserEmail() ?? null,
    orgId: getRequestOrgId() ?? null,
  };
}

/**
 * The scope whose selection applies to this request: the member's own when
 * their personal key (or personal Builder.io connection) is the one in effect,
 * otherwise the organization's. Without an organization everything is
 * personal. Throws when the credential store can't be read.
 */
export async function resolveProviderModelSelectionScope(
  provider: ProviderModelSelectionProvider,
  ctx: ProviderModelSelectionContext = currentContext(),
): Promise<ProviderModelSelectionScope> {
  if (!ctx.orgId) return "user";
  if (provider === "builder") {
    const builder = await resolveBuilderCredentialsDetailed();
    if (builder.lookupFailed && !builder.source) {
      throw new Error("Could not read the Builder.io connection.");
    }
    return builder.source === "user" ? "user" : "org";
  }
  const envVar = providerCredentialEnvVar(provider);
  if (!envVar) return "org";
  const detail = await resolveSecretDetailed(envVar);
  if (detail.lookupFailed && !detail.value) {
    throw new Error("Could not read the credential store.");
  }
  return detail.source === "user" ? "user" : "org";
}

/** The selection the current request's picker shows for `provider`. */
export async function resolveEffectiveProviderModelSelection(
  provider: ProviderModelSelectionProvider,
  ctx: ProviderModelSelectionContext = currentContext(),
): Promise<EffectiveProviderModelSelection> {
  try {
    const scope = await resolveProviderModelSelectionScope(provider, ctx);
    if (scope === "user" && !ctx.userEmail) {
      return { state: "default", provider, scope };
    }
    return selectionFromRow(
      await readProviderModelSelection(ctx, provider, scope),
    );
  } catch (error) {
    return {
      state: "unreadable",
      provider,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * One scope's selection, for a surface that is fixed to a scope (the
 * organization's default-model select offers organization models only).
 */
export async function resolveProviderModelSelectionAtScope(
  provider: ProviderModelSelectionProvider,
  scope: ProviderModelSelectionScope,
  ctx: ProviderModelSelectionContext,
): Promise<EffectiveProviderModelSelection> {
  try {
    return selectionFromRow(
      await readProviderModelSelection(ctx, provider, scope),
    );
  } catch (error) {
    return {
      state: "unreadable",
      provider,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function selectionFromRow(
  row: ProviderModelSelectionRow,
): EffectiveProviderModelSelection {
  return row.models === null
    ? { state: "default", provider: row.provider, scope: row.scope }
    : {
        state: "selected",
        provider: row.provider,
        scope: row.scope,
        models: row.models,
      };
}

/**
 * The models a picker offers for an engine: the selection when one is stored,
 * the engine's own catalog otherwise (including when the selection couldn't
 * be read, which `selection.state` reports).
 */
export function applyProviderModelSelection(
  catalog: readonly string[],
  selection: EffectiveProviderModelSelection | null,
): string[] {
  return selection?.state === "selected" ? [...selection.models] : [...catalog];
}

/**
 * The model to run when nothing picked one and the engine's default is no
 * longer checked: the first checked model. `undefined` keeps the engine
 * default, which is also what happens when the selection can't be read.
 */
export async function resolveUncheckedDefaultModelReplacement(engine: {
  name: string;
  defaultModel: string;
}): Promise<string | undefined> {
  const provider = providerForEngineName(engine.name);
  if (!provider) return undefined;
  const selection = await resolveEffectiveProviderModelSelection(provider);
  if (selection.state === "unreadable") {
    console.warn(
      `[agent-chat] provider model selection unreadable for ${provider}; keeping ${engine.defaultModel}: ${selection.error}`,
    );
    return undefined;
  }
  if (selection.state !== "selected") return undefined;
  if (selection.models.includes(engine.defaultModel)) return undefined;
  return selection.models[0];
}
