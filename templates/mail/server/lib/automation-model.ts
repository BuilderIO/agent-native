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
  { engine: "builder", model: "gpt-5-6-luna" },
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

  const agentEngine = (await getSetting("agent-engine").catch(() => null)) as {
    engine?: string;
    model?: string;
  } | null;
  if (agentEngine?.engine || agentEngine?.model) {
    return {
      engine: agentEngine.engine,
      model: agentEngine.model,
    };
  }

  return {
    engine: DEFAULT_AUTOMATION_ENGINE,
    model: DEFAULT_AUTOMATION_MODEL,
  };
}
