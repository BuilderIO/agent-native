/**
 * What each key powers, and what stops or switches when it is removed.
 *
 * `describeSecretUsage` is static metadata for list payloads. The removal
 * preview adds request-time facts: which engine is the default, what it would
 * fall back to, and whether a shared key takes over a removed personal one.
 */

import { PROVIDER_ENV_META } from "../agent/engine/provider-env-vars.js";
import {
  AGENT_PROVIDER_CATALOG,
  providerIdForEngine,
  type AgentProviderOption,
} from "../client/agent-provider-catalog.js";
import { getRequestOrgId } from "../server/request-context.js";
import { managedSecretUsage, resolveSecretManagedBy } from "./managed-keys.js";
import {
  getRegisteredSecretUsage,
  getRequiredSecret,
  type SecretManagedBy,
  type SecretScope,
  type SecretUsage,
} from "./register.js";
import { VAULT_SYNC_DESCRIPTION_PREFIX } from "./storage.js";

/** App id used in effects that apply to every app. */
export const ALL_APPS = "all";

function providerForKey(key: string): AgentProviderOption | undefined {
  const providerId = Object.entries(PROVIDER_ENV_META).find(
    ([, meta]) => meta.envVar === key,
  )?.[0];
  return providerId
    ? AGENT_PROVIDER_CATALOG.find((option) => option.id === providerId)
    : undefined;
}

function modelsLeavePickerEffect(provider: AgentProviderOption): string {
  return `${provider.label} models leave the model picker.`;
}

/**
 * Everything known to use `key` in this app: the agent's models for a
 * provider key, then registered uses, then uses implied by a managed key's
 * owner. Empty means no known consumer, not a failed lookup.
 */
export function describeSecretUsage(key: string): SecretUsage[] {
  const provider = providerForKey(key);
  return [
    ...(provider
      ? [
          {
            feature: "Agent",
            effectWhenRemoved: modelsLeavePickerEffect(provider),
          },
        ]
      : []),
    ...serviceUsage(key),
  ];
}

function serviceUsage(key: string): SecretUsage[] {
  return [...getRegisteredSecretUsage(key), ...managedSecretUsage(key)];
}

export type SecretRemovalEffectCode =
  | "models-leave-picker"
  | "default-model-switches"
  | "default-model-stops"
  | "shared-key-takes-over";

export interface SecretRemovalEffect {
  /** Workspace app id, or `"all"` when every app is affected. */
  app: string;
  feature: string;
  /** English sentence for the "What happens" list. */
  effect: string;
  /** Set on derived effects so a UI can render localized copy from `params`. */
  code?: SecretRemovalEffectCode;
  params?: Record<string, string>;
  /** Models that leave the picker, for `models-leave-picker`. */
  models?: readonly string[];
}

export type SharedKeyFallback =
  | { status: "none" }
  | { status: "shared"; source: "org" | "workspace" | "vault" }
  /** The credential store could not be read, so the fallback is not known. */
  | { status: "unknown"; error: string };

export type OtherWorkspaceApps =
  /** Not part of a workspace; no other app reads these saved keys. */
  | { status: "standalone" }
  /** Other apps in the workspace. Their features are not known here. */
  | { status: "listed"; apps: { id: string; name: string }[] }
  | { status: "unavailable"; error: string };

export interface SecretRemovalPreview {
  key: string;
  label?: string;
  registered: boolean;
  /** The stored row the removal targets. */
  scope: SecretScope;
  /** Who loses the key: only the caller, or everyone in the organization. */
  affects: "only-you" | "organization";
  /** Set when the key can only be removed from its owner surface. */
  managedBy?: SecretManagedBy;
  /** For a personal key: a shared key that keeps things working after removal. */
  fallback: SharedKeyFallback;
  effects: SecretRemovalEffect[];
  otherApps: OtherWorkspaceApps;
}

export interface PreviewSecretRemovalInput {
  key: string;
  /** Defaults to the registered scope, or `user` for ad-hoc keys. */
  scope?: SecretScope;
  /** The app asking, used for the app's own default model. */
  appId?: string;
}

const FALLBACK_LABEL: Record<"org" | "workspace" | "vault", string> = {
  org: "organization",
  workspace: "workspace",
  vault: "Vault",
};

async function resolveSharedFallback(key: string): Promise<SharedKeyFallback> {
  const { resolveSecretDetailed } =
    await import("../server/credential-provider.js");
  const shared = await resolveSecretDetailed(key, { skipUserScope: true });
  if (!shared.value || !shared.source || shared.source === "env") {
    return shared.lookupFailed
      ? { status: "unknown", error: "Could not read the credential store" }
      : { status: "none" };
  }
  if (shared.source !== "org" && shared.source !== "workspace") {
    return { status: "none" };
  }
  const { readAppSecretMeta } = await import("./storage.js");
  const meta = shared.scopeId
    ? await readAppSecretMeta({
        key,
        scope: shared.source,
        scopeId: shared.scopeId,
      })
    : null;
  return {
    status: "shared",
    source: meta?.description?.startsWith(VAULT_SYNC_DESCRIPTION_PREFIX)
      ? "vault"
      : shared.source,
  };
}

function engineDisplayLabel(entry: { name: string; label: string }): string {
  if (entry.name === "builder") return "Builder.io";
  const providerId = providerIdForEngine(entry.name);
  const option = providerId
    ? AGENT_PROVIDER_CATALOG.find((item) => item.id === providerId)
    : undefined;
  return option?.label ?? entry.label;
}

/**
 * The default-model effect of removing a provider key, found the way
 * `resolveEngine` falls back: the configured engine if it survives, else the
 * first engine whose credentials still resolve.
 */
async function defaultModelEffect(
  key: string,
  appId: string | undefined,
): Promise<SecretRemovalEffect | null> {
  const engine = await import("../agent/engine/index.js");
  const { getAppConfig } = await import("../app-config/index.js");
  const { resolveHasCompleteBuilderConnection, resolveSecret } =
    await import("../server/credential-provider.js");
  engine.registerBuiltinEngines();

  const needsKey = (entry: { requiredEnvVars: string[] }) =>
    entry.requiredEnvVars.includes(key);
  const configuredName = await engine.getConfiguredEngineNameForRequest({
    appId,
  });
  const current = configuredName
    ? engine.getAgentEngineEntry(configuredName)
    : await engine.detectEngineFromUserSecrets();
  if (!current || !needsKey(current)) return null;

  const entries = engine.listAgentEngines();
  const ordered = getAppConfig().agent.preferBringYourOwnKey
    ? [
        ...entries.filter((entry) => entry.name !== "builder"),
        ...entries.filter((entry) => entry.name === "builder"),
      ]
    : entries;
  for (const entry of ordered) {
    if (needsKey(entry) || !engine.isAgentEnginePackageInstalled(entry)) {
      continue;
    }
    if (entry.name === "builder") {
      if (await resolveHasCompleteBuilderConnection()) {
        return defaultSwitchesTo(entry);
      }
      continue;
    }
    if (entry.requiredEnvVars.length === 0) continue;
    let usable = true;
    for (const envVar of entry.requiredEnvVars) {
      if (!(await resolveSecret(envVar))) {
        usable = false;
        break;
      }
    }
    if (usable) return defaultSwitchesTo(entry);
  }
  return {
    app: ALL_APPS,
    feature: "Agent",
    effect: "Chats stop until another provider is set up.",
    code: "default-model-stops",
  };
}

function defaultSwitchesTo(entry: {
  name: string;
  label: string;
}): SecretRemovalEffect {
  const next = engineDisplayLabel(entry);
  return {
    app: ALL_APPS,
    feature: "Agent",
    effect: `The default model switches to ${next}.`,
    code: "default-model-switches",
    params: { next },
  };
}

async function listOtherWorkspaceApps(): Promise<OtherWorkspaceApps> {
  try {
    const { loadWorkspaceAppsManifest } =
      await import("../server/agent-discovery.js");
    const { getAppConfig } = await import("../app-config/index.js");
    const apps = await loadWorkspaceAppsManifest(true);
    if (!apps) return { status: "standalone" };
    const self = getAppConfig().app;
    const selfIds = new Set(
      [self.workspaceId, self.id, self.slug, self.template].filter(
        (id): id is string => !!id,
      ),
    );
    return {
      status: "listed",
      apps: apps
        .filter((app) => !selfIds.has(app.id))
        .map((app) => ({ id: app.id, name: app.name })),
    };
  } catch (error) {
    return {
      status: "unavailable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * What stops working, per app and feature, if the caller removes `key` at
 * `scope`. Runs as the request user; never reads or returns a secret value.
 */
export async function previewSecretRemoval(
  input: PreviewSecretRemovalInput,
): Promise<SecretRemovalPreview> {
  const { key } = input;
  const registered = getRequiredSecret(key);
  const scope: SecretScope = input.scope ?? registered?.scope ?? "user";
  const affects =
    scope === "user" || (scope === "workspace" && !getRequestOrgId())
      ? "only-you"
      : "organization";

  const [fallback, otherApps] = await Promise.all([
    scope === "user"
      ? resolveSharedFallback(key)
      : Promise.resolve<SharedKeyFallback>({ status: "none" }),
    listOtherWorkspaceApps(),
  ]);

  let effects: SecretRemovalEffect[];
  if (fallback.status === "shared") {
    const source = FALLBACK_LABEL[fallback.source];
    effects = describeSecretUsage(key).map((entry) => ({
      app: entry.appId ?? ALL_APPS,
      feature: entry.feature,
      effect: `Keeps working with the ${source} key.`,
      code: "shared-key-takes-over",
      params: { source: fallback.source },
    }));
  } else {
    effects = [];
    const provider = providerForKey(key);
    if (provider) {
      effects.push({
        app: ALL_APPS,
        feature: "Agent",
        effect: modelsLeavePickerEffect(provider),
        code: "models-leave-picker",
        params: { provider: provider.label },
        models: provider.supportedModels,
      });
      const defaultEffect = await defaultModelEffect(key, input.appId);
      if (defaultEffect) effects.push(defaultEffect);
    }
    for (const entry of serviceUsage(key)) {
      effects.push({
        app: entry.appId ?? ALL_APPS,
        feature: entry.feature,
        effect: entry.effectWhenRemoved,
      });
    }
  }

  const managedBy = resolveSecretManagedBy(key);
  return {
    key,
    ...(registered ? { label: registered.label } : {}),
    registered: !!registered,
    scope,
    affects,
    ...(managedBy ? { managedBy } : {}),
    fallback,
    effects,
    otherApps,
  };
}
