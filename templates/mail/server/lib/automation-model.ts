import {
  isResolvedEngineUsableForRequest,
  registerBuiltinEngines,
  resolveEngine,
} from "@agent-native/core/agent/engine";
import { runWithRequestContext } from "@agent-native/core/server";
import { getSetting } from "@agent-native/core/settings";

export interface AutomationModelSettings {
  engine?: string;
  model?: string;
}

export const DEFAULT_AUTOMATION_ENGINE = "builder";
export const DEFAULT_AUTOMATION_MODEL = "gpt-5-6-luna";

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

/**
 * Prefer Luna for background text classification when a Luna-capable provider
 * is actually configured. An app's explicit automation setting always wins;
 * this is only the no-override default.
 */
export async function resolveDefaultAutomationModel(
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
    return {
      engine: agentEngine.engine,
      model,
    };
  }

  // Leave engine selection to resolveEngine so a configured non-Luna provider
  // remains usable when none of the preferred Luna engines is connected.
  return {};
}

export async function resolveAutomationModelSettings(
  ownerEmail: string,
  settings: AutomationModelSettings | null | undefined,
): Promise<AutomationModelSettings> {
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
