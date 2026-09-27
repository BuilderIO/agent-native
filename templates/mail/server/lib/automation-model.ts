import {
  isResolvedEngineUsableForRequest,
  registerBuiltinEngines,
  resolveEngine,
} from "@agent-native/core/agent/engine";
import {
  getJevContextCredentials,
  isJevEnabled,
  readDeployCredentialEnv,
  runWithRequestContext,
} from "@agent-native/core/server";
import { getSetting } from "@agent-native/core/settings";

export interface AutomationModelSettings {
  engine?: string;
  model?: string;
}

export const DEFAULT_AUTOMATION_ENGINE = "builder";
export const DEFAULT_AUTOMATION_MODEL = "gpt-5-6-luna";
export const TYPESAFE_AUTOMATION_ENGINE = "typesafe";
export const TYPESAFE_AUTOMATION_MODEL = "jev-latest";

const CHEAP_MODEL_CANDIDATES: AutomationModelSettings[] = [
  { engine: DEFAULT_AUTOMATION_ENGINE, model: DEFAULT_AUTOMATION_MODEL },
  { engine: "ai-sdk:openai", model: "gpt-5.6-luna" },
  { engine: "ai-sdk:openrouter", model: "openai/gpt-5.6-luna" },
];

function isUnavailableEngineError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /No LLM provider is connected|Connect an LLM provider|missing_credentials|not configured|not installed|unknown agent engine|engine .* unavailable/i.test(
    message,
  );
}

async function canResolveEngine(
  ownerEmail: string,
  engineName: string,
): Promise<boolean> {
  try {
    registerBuiltinEngines();
    return runWithRequestContext({ userEmail: ownerEmail }, async () => {
      const engine = await resolveEngine({ engineOption: engineName });
      return isResolvedEngineUsableForRequest(engine);
    });
  } catch (error) {
    if (isUnavailableEngineError(error)) return false;
    throw error;
  }
}

async function resolveEngineDefaultModel(
  ownerEmail: string,
  engineName: string,
): Promise<string> {
  registerBuiltinEngines();
  return runWithRequestContext({ userEmail: ownerEmail }, async () => {
    const engine = await resolveEngine({ engineOption: engineName });
    return engine.defaultModel;
  });
}

export async function resolveDefaultAutomationModel(
  ownerEmail: string,
): Promise<AutomationModelSettings> {
  const jevAvailability = await runWithRequestContext(
    { userEmail: ownerEmail },
    async () => {
      try {
        return {
          status: "checked" as const,
          enabled: await isJevEnabled(
            await getJevContextCredentials(ownerEmail),
          ),
        };
      } catch (error) {
        return { status: "error" as const, error };
      }
    },
  );
  if (jevAvailability.status === "error") {
    console.warn(
      "[automation-model] Jev availability check failed; using the configured model.",
      jevAvailability.error,
    );
  }
  if (jevAvailability.status === "checked" && jevAvailability.enabled) {
    return {
      engine: TYPESAFE_AUTOMATION_ENGINE,
      model: TYPESAFE_AUTOMATION_MODEL,
    };
  }
  if (readDeployCredentialEnv("TYPESAFE_API_KEY")?.trim()) {
    return {
      engine: TYPESAFE_AUTOMATION_ENGINE,
      model: TYPESAFE_AUTOMATION_MODEL,
    };
  }

  for (const candidate of CHEAP_MODEL_CANDIDATES) {
    if (
      candidate.engine &&
      (await canResolveEngine(ownerEmail, candidate.engine))
    ) {
      return candidate;
    }
  }

  const agentEngine = (await getSetting("agent-engine")) as {
    engine?: string;
    model?: string;
  } | null;
  if (agentEngine?.engine || agentEngine?.model) {
    const model =
      agentEngine.model ??
      (agentEngine.engine
        ? await resolveEngineDefaultModel(ownerEmail, agentEngine.engine)
        : undefined);
    return {
      engine: agentEngine.engine,
      model,
    };
  }

  return {};
}

export async function resolveTextAutomationModelSettings(
  ownerEmail: string,
): Promise<AutomationModelSettings> {
  for (const candidate of CHEAP_MODEL_CANDIDATES) {
    if (
      candidate.engine &&
      (await canResolveEngine(ownerEmail, candidate.engine))
    ) {
      return candidate;
    }
  }

  const agentEngine = (await getSetting("agent-engine")) as {
    engine?: string;
    model?: string;
  } | null;
  if (agentEngine?.engine || agentEngine?.model) {
    const model =
      agentEngine.model ??
      (agentEngine.engine
        ? await resolveEngineDefaultModel(ownerEmail, agentEngine.engine)
        : undefined);
    return { engine: agentEngine.engine, model };
  }

  return {};
}

export async function resolveAutomationModelSettings(
  ownerEmail: string,
  settings: AutomationModelSettings | null | undefined,
): Promise<AutomationModelSettings> {
  if (settings?.engine && settings.model) return settings;

  const defaults = await resolveDefaultAutomationModel(ownerEmail);
  if (!settings?.engine && !settings?.model) return defaults;

  return {
    engine: settings.engine ?? defaults.engine,
    model:
      settings.model ??
      (settings.engine
        ? await resolveEngineDefaultModel(ownerEmail, settings.engine)
        : defaults.model),
  };
}
