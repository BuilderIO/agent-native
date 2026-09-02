/**
 * list-agent-engines — returns the registered engine registry and current selection.
 */

import { getAgentAppModelDefaultForCurrentRequest } from "../../agent/app-model-defaults.js";
import { DEFAULT_MODEL } from "../../agent/default-model.js";
import {
  listAgentEngines,
  registerBuiltinEngines,
  detectEngineFromEnv,
  detectEngineFromUserSecrets,
  getAgentEngineEntry,
  isAgentEnginePackageInstalled,
  isStoredEngineUsableForRequest,
  normalizeModelForEngine,
  resolveEnginePreservesCustomModels,
} from "../../agent/engine/index.js";
import type { ActionTool } from "../../agent/types.js";
import { getAppConfig } from "../../app-config/index.js";
import { prefetchSecrets } from "../../server/credential-provider.js";
import { getSetting } from "../../settings/index.js";

export const tool: ActionTool = {
  description:
    'List all available AI agent engines (Anthropic, OpenAI, Gemini, Groq, etc.) and the currently selected engine. Use this to check what engines are available before calling manage-agent-engine with action="set".',
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
};

export async function run(args: Record<string, string> = {}): Promise<string> {
  registerBuiltinEngines();

  const engines = listAgentEngines();
  await prefetchSecrets([
    ...new Set(
      engines
        .filter(
          (entry) =>
            entry.name !== "builder" && isAgentEnginePackageInstalled(entry),
        )
        .flatMap((entry) => entry.requiredEnvVars),
    ),
  ]);
  const currentSetting = await getSetting("agent-engine");
  const current = currentSetting
    ? (currentSetting as { engine?: string; model?: string })
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
      undefined);
  const currentModelCandidate =
    appDefaultUsable && currentEntry?.name === appDefault?.engine
      ? appDefault?.model
      : storedUsable && currentEntry?.name === current?.engine
        ? current?.model
        : undefined;
  const currentEngineName = currentEntry?.name ?? "anthropic";
  // Resolve the OpenAI-compatible-endpoint capability so a custom gateway model
  // is reported as-is instead of being normalized to the engine default — the
  // read-side counterpart of the same fix in set-/manage-agent-engine.
  const preserveCustomModels = currentEntry
    ? await resolveEnginePreservesCustomModels(currentEntry)
    : false;
  const currentModel =
    currentEntry && !envUnavailable
      ? normalizeModelForEngine(
          currentEntry,
          currentModelCandidate ?? currentEntry.defaultModel,
          { preserveCustomModels },
        )
      : (currentModelCandidate ?? DEFAULT_MODEL);
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
      return {
        name: e.name,
        label: e.label,
        description: e.description,
        defaultModel: e.defaultModel,
        supportedModels: e.supportedModels,
        capabilities: e.capabilities,
        requiredEnvVars: e.requiredEnvVars,
        installPackage: e.installPackage,
        packageInstalled: isAgentEnginePackageInstalled(e),
        configured,
        configuredError,
      };
    }),
  );
  const result = {
    engines: engineEntries,
    current: envUnavailable
      ? null
      : {
          engine: currentEngineName,
          model: currentModel,
        },
  };

  return JSON.stringify(result, null, 2);
}
