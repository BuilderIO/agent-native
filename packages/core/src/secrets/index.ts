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
  registerSecretUsage,
  getRegisteredSecretUsage,
  __resetSecretsRegistry,
  type RegisteredSecret,
  type SecretUsage,
  type SecretManagedBy,
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
  VAULT_SYNC_DESCRIPTION_PREFIX,
  type SecretRef,
  type WriteSecretArgs,
  type ReadSecretResult,
  type SecretMeta,
} from "./storage.js";

export { APP_SECRETS_CREATE_SQL, appSecrets } from "./schema.js";

// AES-256-GCM helpers for column-level encryption of per-row secret values
// (e.g. a per-record share password) that don't fit the keyed app_secrets /
// credentials stores. These use the app-local key, unlike the workspace-shared
// app_secrets storage layer.
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
  createSecretUsageHandler,
  type SecretStatusPayload,
  type AdHocSecretPayload,
} from "./routes.js";

export {
  resolveKeyReferences,
  validateUrlAllowlist,
  getKeyAllowlist,
  type ResolveKeyReferencesResult,
} from "./substitution.js";

export {
  describeSecretUsage,
  previewSecretRemoval,
  ALL_APPS,
  type PreviewSecretRemovalInput,
  type SecretRemovalPreview,
  type SecretRemovalEffect,
  type SecretRemovalEffectCode,
  type SharedKeyFallback,
  type OtherWorkspaceApps,
} from "./usage.js";

export {
  resolveSecretManagedBy,
  SECRET_MANAGERS,
  S3_STORAGE_SECRET_KEYS,
  type SecretManagerId,
} from "./managed-keys.js";

export { maybeRegisterSecretOnboardingStep } from "./onboarding.js";
