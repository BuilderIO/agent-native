import type { AgentEngine } from "./types.js";

/**
 * Who pays for, and whose rate limits govern, an engine's model calls:
 * Builder's gateway, the deployment's own provider key, or a key the customer
 * connected (user, org, or workspace scoped).
 */
export type EngineCredentialOwner = "builder" | "deployment" | "customer";

const owners = new WeakMap<object, EngineCredentialOwner>();

export function tagEngineCredentialOwner(
  engine: AgentEngine,
  owner: EngineCredentialOwner | undefined,
): void {
  if (owner) owners.set(engine, owner);
}

export function getEngineCredentialOwner(
  engine: unknown,
): EngineCredentialOwner | undefined {
  return engine && typeof engine === "object" ? owners.get(engine) : undefined;
}
