/**
 * Framework secrets registry.
 *
 * Lets templates declaratively register required API keys / credentials so
 * they appear in the sidebar settings UI and the onboarding checklist, and
 * so actions can read them by a stable key.
 *
 * See `.agents/skills/secrets/SKILL.md` for usage.
 */

export {
  registerRequiredSecret,
  listRequiredSecrets,
  getRequiredSecret,
  __resetSecretsRegistry,
  type RegisteredSecret,
  type SecretScope,
  type SecretKind,
  type SecretValidator,
  type ValidatorResult,
} from "./register.js";

export {
  writeAppSecret,
  readAppSecret,
  readAppSecretMeta,
  deleteAppSecret,
  getAppSecretMeta,
  listAppSecretsForScope,
  last4,
  type SecretRef,
  type WriteSecretArgs,
  type ReadSecretResult,
  type SecretMeta,
} from "./storage.js";

export { APP_SECRETS_CREATE_SQL, appSecrets } from "./schema.js";

// AES-256-GCM helpers for column-level encryption of per-row secret values
// (e.g. a per-record share password) that don't fit the keyed app_secrets /
// credentials stores. Same key story as the vault.
export {
  encryptSecretValue,
  decryptSecretValue,
  isEncryptedSecretValue,
} from "./crypto.js";

export {
  createListSecretsHandler,
  createWriteSecretHandler,
  createTestSecretHandler,
  createAdHocSecretHandler,
  type SecretStatusPayload,
  type AdHocSecretPayload,
} from "./routes.js";

export {
  resolveKeyReferences,
  validateUrlAllowlist,
  getKeyAllowlist,
  type ResolveKeyReferencesResult,
} from "./substitution.js";

export { maybeRegisterSecretOnboardingStep } from "./onboarding.js";
