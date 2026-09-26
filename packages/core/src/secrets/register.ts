/**
 * In-process registry of required / optional secrets.
 *
 * Templates call `registerRequiredSecret()` at module load time — typically
 * from a server plugin. The secrets HTTP routes and the sidebar settings UI
 * read from this registry on every request so overrides and late-registered
 * secrets are picked up without a restart.
 */

export type SecretScope = "user" | "workspace" | "org";
export type SecretKind = "api-key" | "oauth";

export interface ValidatorResult {
  ok: boolean;
  error?: string;
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
  /** Env var name & settings key — e.g. "OPENAI_API_KEY". */
  key: string;
  /** Human-readable label shown in the sidebar. */
  label: string;
  /** Short description shown below the label. */
  description?: string;
  /** URL where the user can obtain the key or connect the account. */
  docsUrl?: string;
  /** Whether the secret is per-user or shared across a workspace/org. */
  scope: SecretScope;
  /** UI affordance: "api-key" renders an input; "oauth" renders Connect. */
  kind: SecretKind;
  /** When true, an onboarding step is auto-injected for this secret. */
  required?: boolean;
  /**
   * Optional health check. Receives the plain-text value, returns `true` or
   * `{ ok: true }` on success. Returning `{ ok: false, error }` surfaces the
   * error to the UI. Never log the value from inside the validator.
   */
  validator?: SecretValidator;
  /**
   * For `kind: "oauth"` — the oauth-tokens provider id (e.g. "google") that
   * backs this registration. Used to surface OAuth status in the unified UI.
   */
  oauthProvider?: string;
  /**
   * For `kind: "oauth"` — URL the Connect button should point at. Typically
   * the framework's `/_agent-native/google/auth-url` or similar.
   */
  oauthConnectUrl?: string;
  /** What this app uses the key for. Framework uses merge in at read time. */
  usedFor?: SecretUsage[];
  /** Set when another Settings surface owns the key's lifecycle. */
  managedBy?: SecretManagedBy;
}

// Pin the registry to globalThis so templates that load `@agent-native/core`
// via more than one ESM graph (e.g. dev-mode Vite + Nitro, symlinked
// node_modules, dist/ vs src/) share a single registry. Without this, a
// template's `register-secrets.ts` side-effect module may populate one
// registry instance while the /_agent-native/secrets route reads from
// another — net effect: the UI sees an empty list.
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

/**
 * Register (or override) a required secret.
 *
 * Subsequent registrations with the same `key` replace the previous
 * definition — later plugins can override framework defaults.
 */
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

  // Auto-inject an onboarding step for required secrets. Done via dynamic
  // import to avoid a load-order cycle between register and the onboarding
  // registry during module bootstrap.
  if (secret.required) {
    // Lazy import — resolved synchronously in practice because the module is
    // already loaded once any route handler runs, but tolerate async.
    import("./onboarding.js")
      .then((mod) => mod.maybeRegisterSecretOnboardingStep(secret))
      .catch(() => {
        // Onboarding is optional — never let it block registration.
      });
  }
}

/** Return all registered secrets in registration order. */
export function listRequiredSecrets(): RegisteredSecret[] {
  return Array.from(registry.values());
}

/** Look up a single registered secret by key. */
export function getRequiredSecret(key: string): RegisteredSecret | undefined {
  return registry.get(key);
}

/** Test helper — clears the registry between runs. */
export function __resetSecretsRegistry(): void {
  registry.clear();
  extraUsage.clear();
}
