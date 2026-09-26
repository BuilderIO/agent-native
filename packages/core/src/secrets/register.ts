
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
}

const REGISTRY_KEY = Symbol.for("@agent-native/core/secrets.registry");
interface GlobalWithRegistry {
  [REGISTRY_KEY]?: Map<string, RegisteredSecret>;
}
const registry: Map<string, RegisteredSecret> = ((
  globalThis as unknown as GlobalWithRegistry
)[REGISTRY_KEY] ??= new Map());

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
}
