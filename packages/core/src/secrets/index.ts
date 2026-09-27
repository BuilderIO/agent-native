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

export {
  GEMINI_API_KEY,
  LEGACY_GEMINI_API_KEY,
  canonicalSecretKey,
  secretKeyNames,
} from "./key-aliases.js";
