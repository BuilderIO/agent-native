import type { AgentEngine } from "./types.js";

/**
 * Who pays for, and whose rate limits govern, an engine's model calls:
 * Builder's gateway, the deployment's own provider key, or a key the customer
 * connected (user, org, or workspace scoped).
 */
export type EngineCredentialOwner = "builder" | "deployment" | "customer";
export type EngineLlmConnectionSource = "app_secrets" | "settings" | "env";

const owners = new WeakMap<object, EngineCredentialOwner | undefined>();
const llmConnectionSources = new WeakMap<
  object,
  EngineLlmConnectionSource | undefined
>();

export function tagEngineCredentialOwner(
  engine: AgentEngine,
  owner: EngineCredentialOwner | undefined,
): void {
  owners.set(engine, owner);
}

export function tagEngineLlmConnectionSource(
  engine: AgentEngine,
  source: EngineLlmConnectionSource | undefined,
): void {
  llmConnectionSources.set(engine, source);
}

export function getEngineCredentialOwner(
  engine: unknown,
): EngineCredentialOwner | undefined {
  return engine && typeof engine === "object" ? owners.get(engine) : undefined;
}

export function getEngineLlmConnectionSource(
  engine: unknown,
): EngineLlmConnectionSource | undefined {
  return engine && typeof engine === "object"
    ? llmConnectionSources.get(engine)
    : undefined;
}
