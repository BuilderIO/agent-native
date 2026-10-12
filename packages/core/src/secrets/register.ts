export type SecretScope = "user" | "workspace" | "org";
export type SecretKind = "api-key" | "oauth";

export interface ValidatorResult {
  ok: boolean;
  error?: string;
  /** The check could not run (provider outage, rate limit); the value may be fine. */
  retryable?: boolean;
}

export interface SecretValidator {
  (
    value: string,
  ): Promise<ValidatorResult | boolean> | ValidatorResult | boolean;
}

/**
 * One thing a secret powers, shown as "Used by {feature}" and in the
 * remove-impact list. Copy is English, like `label` and `description`.
 */
export interface SecretUsage {
  /** Workspace app id that uses the key. Omit when every app uses it. */
  appId?: string;
  /** What uses the key, e.g. "Image generation". */
  feature: string;
  /** What happens when the key is removed, e.g. "Stops until another provider is set up." */
  effectWhenRemoved: string;
}

/**
 * The Settings surface that creates and rotates a key. Managed keys are
 * listed read-only on API keys and can only be removed from their owner.
 */
export interface SecretManagedBy {
  /** Stable owner id; an owner surface passes it back to delete its own keys. */
  id: string;
  /** Owner name shown in "Used by {owner}". */
  owner: string;
  /**
   * Settings page path (`page` or `page/sub`, e.g. "integrations/builder").
   * Resolve it through the settings route helper; it is not a URL.
   */
  route: string;
}

export interface RegisteredSecret {
  key: string;
  label: string;
  description?: string;
  docsUrl?: string;
  scope: SecretScope;
  kind: SecretKind;
  required?: boolean;
  validator?: SecretValidator;
  oauthProvider?: string;
  oauthConnectUrl?: string;
  /** What this app uses the key for. Framework uses merge in at read time. */
  usedFor?: SecretUsage[];
  /** Set when another Settings surface owns the key's lifecycle. */
  managedBy?: SecretManagedBy;
}

const REGISTRY_KEY = Symbol.for("@agent-native/core/secrets.registry");
interface GlobalWithRegistry {
  [REGISTRY_KEY]?: Map<string, RegisteredSecret>;
}
const registry: Map<string, RegisteredSecret> = ((
  globalThis as unknown as GlobalWithRegistry
)[REGISTRY_KEY] ??= new Map());

const USAGE_KEY = Symbol.for("@agent-native/core/secrets.usage");
interface GlobalWithUsage {
  [USAGE_KEY]?: Map<string, SecretUsage[]>;
}
// Kept apart from the registry because a template's registration replaces the
// framework's for the same key, and the framework's uses (realtime voice on
// OPENAI_API_KEY, say) still apply in that app.
const extraUsage: Map<string, SecretUsage[]> = ((
  globalThis as unknown as GlobalWithUsage
)[USAGE_KEY] ??= new Map());

function usageId(usage: SecretUsage): string {
  return `${usage.appId ?? ""}\u0000${usage.feature}`;
}

/**
 * Record uses of a key that hold whichever registration wins, e.g. framework
 * services on a provider key a template also registers.
 */
export function registerSecretUsage(key: string, usage: SecretUsage[]): void {
  if (!key) throw new Error("registerSecretUsage: key is required");
  const existing = extraUsage.get(key) ?? [];
  const seen = new Set(existing.map(usageId));
  for (const entry of usage) {
    if (seen.has(usageId(entry))) continue;
    seen.add(usageId(entry));
    existing.push(entry);
  }
  extraUsage.set(key, existing);
}

/** Registered uses of a key: its registration's `usedFor`, then extra uses. */
export function getRegisteredSecretUsage(key: string): SecretUsage[] {
  const own = registry.get(key)?.usedFor ?? [];
  const seen = new Set(own.map(usageId));
  return [
    ...own,
    ...(extraUsage.get(key) ?? []).filter((entry) => !seen.has(usageId(entry))),
  ];
}

export function registerRequiredSecret(secret: RegisteredSecret): void {
  if (!secret || typeof secret.key !== "string" || !secret.key) {
    throw new Error("registerRequiredSecret: secret.key is required");
  }
  if (
    secret.scope !== "user" &&
    secret.scope !== "workspace" &&
    secret.scope !== "org"
  ) {
    throw new Error(
      `registerRequiredSecret: secret.scope must be "user", "workspace", or "org" (got "${String(secret.scope)}")`,
    );
  }
  if (secret.kind !== "api-key" && secret.kind !== "oauth") {
    throw new Error(
      `registerRequiredSecret: secret.kind must be "api-key" or "oauth" (got "${String(secret.kind)}")`,
    );
  }
  if (registry.has(secret.key) && process.env.DEBUG) {
    console.log(
      `[agent-native] Overriding registered secret "${secret.key}" with new registration.`,
    );
  }
  registry.set(secret.key, secret);

  if (secret.required) {
    import("./onboarding.js")
      .then((mod) => mod.maybeRegisterSecretOnboardingStep(secret))
      .catch(() => {
        // Onboarding is optional — never let it block registration.
      });
  }
}

export function listRequiredSecrets(): RegisteredSecret[] {
  return Array.from(registry.values());
}

export function getRequiredSecret(key: string): RegisteredSecret | undefined {
  return registry.get(key);
}

export function __resetSecretsRegistry(): void {
  registry.clear();
  extraUsage.clear();
}
