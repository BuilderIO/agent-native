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

export { maybeRegisterSecretOnboardingStep } from "./onboarding.js";
