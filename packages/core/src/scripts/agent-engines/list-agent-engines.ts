/**
 * list-agent-engines — returns the registered engine registry and current selection.
 */

import { getAgentAppModelDefaultForCurrentRequest } from "../../agent/app-model-defaults.js";
import {
  readDefaultAgentEngineSettingDetailed,
  resolveDefaultAgentEngineAuthority,
} from "../../agent/default-agent-engine.js";
import {
  listAgentEngines,
  registerBuiltinEngines,
  detectEngineFromEnv,
  detectEngineFromUserSecrets,
  getAgentEngineEntry,
  isAgentEnginePackageInstalled,
  isStoredEngineUsableForRequest,
  normalizeModelForEngine,
  resolveEngineAcceptsCustomModels,
  resolveEnginePreservesCustomModels,
} from "../../agent/engine/index.js";
import type { ActionTool } from "../../agent/types.js";
import { getAppConfig } from "../../app-config/index.js";
import {
  prefetchSecrets,
  readProviderCredentialRejections,
  resolveSecretDetailed,
  type ProviderCredentialRejection,
} from "../../server/credential-provider.js";

export const tool: ActionTool = {
  description:
    'List all available AI agent engines (Anthropic, OpenAI, Gemini, Groq, etc.), the currently selected engine, and whether the caller can change the organization default (canUpdateDefault). credentialRejected marks an engine whose saved key its provider rejected; chats with it stop until the key is replaced. Use this to check what engines are available before calling manage-agent-engine with action="set".',
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
};

type KeyRejectionState = ProviderCredentialRejection | null | undefined;

/**
 * The provider's last rejection of each saved key: a rejection, `null` for
 * none, or `undefined` when the key or its marker couldn't be read.
 */
async function readSavedKeyRejections(
  keys: readonly string[],
): Promise<Map<string, KeyRejectionState>> {
  const result = new Map<string, KeyRejectionState>();
  const saved: Array<{ key: string; value: string }> = [];
  for (const key of keys) {
    const detail = await resolveSecretDetailed(key);
    if (detail.value && detail.source && detail.source !== "env") {
      saved.push({ key, value: detail.value });
    } else {
      // Deployment env keys aren't shown in Settings, so they aren't flagged.
      result.set(key, detail.lookupFailed && !detail.value ? undefined : null);
    }
  }
  try {
    const rejections = await readProviderCredentialRejections(saved);
    for (const { key } of saved) result.set(key, rejections.get(key) ?? null);
  } catch {
    for (const { key } of saved) result.set(key, undefined);
  }
  return result;
}

export async function run(args: Record<string, string> = {}): Promise<string> {
  registerBuiltinEngines();

  const engines = listAgentEngines();
  const providerKeys = [
    ...new Set(
      engines
        .filter(
          (entry) =>
            entry.name !== "builder" && isAgentEnginePackageInstalled(entry),
        )
        .flatMap((entry) => entry.requiredEnvVars),
    ),
  ];
  await prefetchSecrets(providerKeys);
  const keyRejections = await readSavedKeyRejections(providerKeys);
  const [defaultSetting, defaultAuthority] = await Promise.all([
    readDefaultAgentEngineSettingDetailed(),
    resolveDefaultAgentEngineAuthority(),
  ]);
  const current = defaultSetting.value
    ? (defaultSetting.value as { engine?: string; model?: string })
    : null;

  // Same priority chain resolveEngine uses after explicit request options:
  // AGENT_ENGINE → app default → stored (if usable) → user/Builder app_secrets
  // → env → anthropic. Gating stored/app defaults on the request-aware helper
  // keeps the picker in step with the runtime.
  const storedEntry =
    typeof current?.engine === "string"
      ? getAgentEngineEntry(current.engine)
      : undefined;
  const storedUsable =
    !!storedEntry &&
    (await isStoredEngineUsableForRequest(current, storedEntry));
  const appDefault = await getAgentAppModelDefaultForCurrentRequest(args.appId);
  const appDefaultEntry =
    typeof appDefault?.engine === "string"
      ? getAgentEngineEntry(appDefault.engine)
      : undefined;
  const appDefaultUsable =
    !!appDefault &&
    !!appDefaultEntry &&
    (await isStoredEngineUsableForRequest(appDefault, appDefaultEntry));
  const detectedFromUser = await detectEngineFromUserSecrets();
  const configuredEngine = getAppConfig().agent.engine;
  const envEntry = configuredEngine
    ? getAgentEngineEntry(configuredEngine)
    : undefined;
  const envUsable =
    !!envEntry &&
    (await isStoredEngineUsableForRequest({ engine: envEntry.name }, envEntry));
  const envUnavailable = !!envEntry && !envUsable;
  const detectedFromEnv = detectEngineFromEnv();
  const envSelectedEntry = envUsable ? envEntry : undefined;

  const currentEntry = envUnavailable
    ? undefined
    : (envSelectedEntry ??
      (appDefaultUsable ? appDefaultEntry : undefined) ??
      (storedUsable ? storedEntry : undefined) ??
      detectedFromUser ??
      detectedFromEnv ??
      getAgentEngineEntry("anthropic"));
  const currentModelCandidate =
    appDefaultUsable && currentEntry?.name === appDefault?.engine
      ? appDefault?.model
      : storedUsable && currentEntry?.name === current?.engine
        ? current?.model
        : undefined;
  // Resolve both gateway and provider model capabilities so a saved custom
  // model is reported as-is instead of being normalized to the engine default.
  const acceptsCustomModels = currentEntry
    ? await resolveEngineAcceptsCustomModels(currentEntry)
    : false;
  const preserveCustomModels = currentEntry
    ? await resolveEnginePreservesCustomModels(currentEntry)
    : false;
  const currentModel =
    currentEntry && !envUnavailable
      ? normalizeModelForEngine(
          currentEntry,
          currentModelCandidate ?? currentEntry.defaultModel,
          { acceptsCustomModels, preserveCustomModels },
        )
      : undefined;
  // Readiness has to be resolved here: `requiredEnvVars` alone cannot see
  // vault-stored keys or the deploy-injected Builder gateway lane, so a client
  // that re-derives it from env keys marks working engines unconfigured.
  const engineEntries = await Promise.all(
    engines.map(async (e) => {
      // Resolved per engine, not across the set: one provider whose credential
      // store is momentarily unreadable must not reject the whole listing. The
      // chat refresh catches that rejection and renders an empty catalog, so a
      // single unrelated provider would make every engine unselectable — the
      // exact symptom this readiness plumbing exists to fix.
      //
      // A read error is its own state, left as `configured: undefined` so the
      // client falls back to its env heuristic. Folding it into `false` would
      // claim the engine needs an API key when nobody actually knows.
      let configured: boolean | undefined;
      let configuredError: string | undefined;
      try {
        configured = await isStoredEngineUsableForRequest(
          { engine: e.name, model: e.defaultModel },
          e,
        );
      } catch (error) {
        configuredError =
          error instanceof Error ? error.message : String(error);
      }
      // Builder's credentials carry their own markers and reconnect flow.
      const rejectionStates =
        e.name === "builder" || !isAgentEnginePackageInstalled(e)
          ? []
          : e.requiredEnvVars.map((key) => keyRejections.get(key));
      const rejection = rejectionStates.find((state) => !!state);
      const credentialRejected = rejection
        ? true
        : rejectionStates.includes(undefined)
          ? undefined
          : false;
      return {
        name: e.name,
        label: e.label,
        description: e.description,
        defaultModel: e.defaultModel,
        supportedModels: e.supportedModels,
        acceptsCustomModels: await resolveEngineAcceptsCustomModels(e),
        preserveCustomModels: await resolveEnginePreservesCustomModels(e),
        capabilities: e.capabilities,
        requiredEnvVars: e.requiredEnvVars,
        installPackage: e.installPackage,
        packageInstalled: isAgentEnginePackageInstalled(e),
        configured,
        configuredError,
        // The provider rejected the saved key and it hasn't worked since.
        // `undefined` means it couldn't be checked, not that it works.
        credentialRejected,
        ...(rejection ? { credentialRejectedAt: rejection.at } : {}),
      };
    }),
  );
  const result = {
    engines: engineEntries,
    current:
      !currentEntry || envUnavailable
        ? null
        : {
            engine: currentEntry.name,
            model: currentModel,
          },
    canUpdateDefault: defaultAuthority.allowed,
    defaultSource: defaultSetting.source,
  };

  return JSON.stringify(result, null, 2);
}
