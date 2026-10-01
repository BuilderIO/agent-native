import { getAgentAppModelDefaultForCurrentRequest } from "../../agent/app-model-defaults.js";
import { CHATGPT_SUBSCRIPTION_ENGINE_NAME } from "../../agent/chatgpt-subscription-contract.js";
import {
  readDefaultAgentEngineSettingDetailed,
  resolveDefaultAgentEngineAuthority,
} from "../../agent/default-agent-engine.js";
import { listChatGPTSubscriptionModels } from "../../agent/engine/chatgpt-subscription-engine.js";
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
import {
  applyProviderModelSelection,
  providerForEngineName,
  resolveEffectiveProviderModelSelection,
  type EffectiveProviderModelSelection,
  type ProviderModelSelectionProvider,
} from "../../agent/provider-model-selection.js";
import type { ActionTool } from "../../agent/types.js";
import { getAppConfig } from "../../app-config/index.js";
import { CHATGPT_SUBSCRIPTION_LAB } from "../../labs/core-labs.js";
import { getUserLabEnabled } from "../../labs/store.js";
import {
  prefetchSecrets,
  readProviderCredentialRejections,
  resolveSecretDetailed,
  type ProviderCredentialRejection,
} from "../../server/credential-provider.js";
import { getRequestUserEmail } from "../../server/request-context.js";

export const tool: ActionTool = {
  description:
    'List all available AI agent engines (Anthropic, OpenAI, Gemini, Groq, etc.), the currently selected engine, and whether the caller can change the organization default (canUpdateDefault). supportedModels is what the model picker shows: the models checked for that provider (modelSelection.state "selected") or its recommendedModels. credentialRejected marks an engine whose saved key its provider rejected; chats with it stop until the key is replaced. Use this to check what engines are available before calling manage-agent-engine with action="set".',
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

  const availableEngines = listAgentEngines();
  const requestEmail = getRequestUserEmail();
  const chatGPTLabEnabled =
    requestEmail &&
    availableEngines.some(
      (entry) => entry.name === CHATGPT_SUBSCRIPTION_ENGINE_NAME,
    )
      ? await getUserLabEnabled(requestEmail, CHATGPT_SUBSCRIPTION_LAB)
      : false;
  const registeredEngines = availableEngines.filter(
    (entry) =>
      entry.name !== CHATGPT_SUBSCRIPTION_ENGINE_NAME || chatGPTLabEnabled,
  );
  const chatGPTEntry = registeredEngines.find(
    (entry) => entry.name === CHATGPT_SUBSCRIPTION_ENGINE_NAME,
  );
  let chatGPTCatalog:
    | Awaited<ReturnType<typeof listChatGPTSubscriptionModels>>
    | undefined;
  let chatGPTCatalogError: string | undefined;
  if (
    chatGPTEntry &&
    requestEmail &&
    (await isStoredEngineUsableForRequest(
      { engine: chatGPTEntry.name },
      chatGPTEntry,
    ))
  ) {
    try {
      chatGPTCatalog = await listChatGPTSubscriptionModels(requestEmail);
    } catch (error) {
      chatGPTCatalogError =
        error instanceof Error ? error.message : String(error);
    }
  }
  const withChatGPTModels = <T extends (typeof registeredEngines)[number]>(
    entry: T,
  ): T =>
    entry.name === CHATGPT_SUBSCRIPTION_ENGINE_NAME && chatGPTCatalog
      ? ({
          ...entry,
          defaultModel: chatGPTCatalog.models[0] ?? "",
          supportedModels: chatGPTCatalog.models,
          modelDisplayNames: chatGPTCatalog.modelDisplayNames,
        } as T)
      : entry;
  const engines = registeredEngines.map(withChatGPTModels);
  const engineFor = (name: string) => {
    const entry =
      engines.find((candidate) => candidate.name === name) ??
      getAgentEngineEntry(name);
    return entry ? withChatGPTModels(entry) : undefined;
  };
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
  const selections = new Map<
    ProviderModelSelectionProvider,
    Promise<EffectiveProviderModelSelection>
  >();
  const selectionFor = (
    engineName: string,
  ): Promise<EffectiveProviderModelSelection> | null => {
    const provider = providerForEngineName(engineName);
    if (!provider) return null;
    let pending = selections.get(provider);
    if (!pending) {
      pending = resolveEffectiveProviderModelSelection(provider);
      selections.set(provider, pending);
    }
    return pending;
  };
  const [defaultSetting, defaultAuthority] = await Promise.all([
    readDefaultAgentEngineSettingDetailed(),
    resolveDefaultAgentEngineAuthority(),
  ]);
  const current = defaultSetting.value
    ? (defaultSetting.value as { engine?: string; model?: string })
    : null;

  const storedEntry =
    typeof current?.engine === "string" ? engineFor(current.engine) : undefined;
  const storedUsable =
    !!storedEntry &&
    (await isStoredEngineUsableForRequest(current, storedEntry));
  const appDefault = await getAgentAppModelDefaultForCurrentRequest(args.appId);
  const appDefaultEntry =
    typeof appDefault?.engine === "string"
      ? engineFor(appDefault.engine)
      : undefined;
  const appDefaultUsable =
    !!appDefault &&
    !!appDefaultEntry &&
    (await isStoredEngineUsableForRequest(appDefault, appDefaultEntry));
  const detectedFromUser = await detectEngineFromUserSecrets();
  const configuredEngine = getAppConfig().agent.engine;
  const envEntry = configuredEngine ? engineFor(configuredEngine) : undefined;
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
  const acceptsCustomModels = currentEntry
    ? await resolveEngineAcceptsCustomModels(currentEntry)
    : false;
  const preserveCustomModels = currentEntry
    ? await resolveEnginePreservesCustomModels(currentEntry)
    : false;
  // Mirrors the runtime: an engine default nobody picked yields to the first
  // checked model once it's unchecked.
  const currentSelection =
    currentEntry && !currentModelCandidate
      ? await selectionFor(currentEntry.name)
      : null;
  const checkedDefault =
    currentSelection?.state === "selected" &&
    currentEntry &&
    !currentSelection.models.includes(currentEntry.defaultModel)
      ? currentSelection.models[0]
      : undefined;
  const currentModel =
    currentEntry && !envUnavailable
      ? normalizeModelForEngine(
          currentEntry,
          currentModelCandidate ?? checkedDefault ?? currentEntry.defaultModel,
          { acceptsCustomModels, preserveCustomModels },
        )
      : undefined;
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
      if (e.name === CHATGPT_SUBSCRIPTION_ENGINE_NAME && chatGPTCatalogError) {
        configuredError = chatGPTCatalogError;
      }
      // Builder's credentials carry their own markers and reconnect flow.
      const rejectionStates =
        e.name === "builder" || !isAgentEnginePackageInstalled(e)
          ? []
          : e.requiredEnvVars.map((key) => keyRejections.get(key));
      const rejection = rejectionStates.find((state) => !!state);
      const modelSelection = isAgentEnginePackageInstalled(e)
        ? await selectionFor(e.name)
        : null;
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
        supportedModels:
          e.name === CHATGPT_SUBSCRIPTION_ENGINE_NAME
            ? (chatGPTCatalog?.models ?? [])
            : applyProviderModelSelection(e.supportedModels, modelSelection),
        ...(e.name === CHATGPT_SUBSCRIPTION_ENGINE_NAME && chatGPTCatalog
          ? { modelDisplayNames: chatGPTCatalog.modelDisplayNames }
          : {}),
        recommendedModels:
          e.name === CHATGPT_SUBSCRIPTION_ENGINE_NAME
            ? (chatGPTCatalog?.models ?? [])
            : e.supportedModels,
        ...(modelSelection
          ? {
              modelSelection:
                modelSelection.state === "unreadable"
                  ? { state: modelSelection.state, error: modelSelection.error }
                  : {
                      state: modelSelection.state,
                      scope: modelSelection.scope,
                    },
            }
          : {}),
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
