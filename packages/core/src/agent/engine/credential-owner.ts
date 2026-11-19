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
const credentialOrgs = new WeakMap<object, string | undefined>();

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

/**
 * The organization whose stored key the engine calls with, when one does. A
 * personal automation run can use its org's key, and its usage is charged there.
 */
export function tagEngineCredentialOrg(
  engine: AgentEngine,
  orgId: string | undefined,
): void {
  credentialOrgs.set(engine, orgId);
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

export function getEngineCredentialOrgId(engine: unknown): string | undefined {
  return engine && typeof engine === "object"
    ? credentialOrgs.get(engine)
    : undefined;
}

/**
 * The org an automation run's usage is saved under: the run's own, or for a
 * personal run, its creator's org when that org's key paid, so the org's
 * owners and admins see it. A key from any other org, such as the
 * deployment's designated vault, puts nothing in that org's usage.
 */
export function automationUsageOrgId(
  engine: unknown,
  runOrgId: string | undefined,
  providerKeyOrgId: string | undefined,
): string | undefined {
  if (runOrgId !== undefined) return runOrgId;
  const paidByOrgId = getEngineCredentialOrgId(engine);
  return paidByOrgId === providerKeyOrgId ? paidByOrgId : undefined;
}
