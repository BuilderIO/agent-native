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
  deleteAppSecret,
  getAppSecretMeta,
  last4,
  type SecretRef,
  type WriteSecretArgs,
  type ReadSecretResult,
} from "./storage.js";

export { APP_SECRETS_CREATE_SQL, appSecrets } from "./schema.js";

export {
  createListSecretsHandler,
  createWriteSecretHandler,
  createTestSecretHandler,
  type SecretStatusPayload,
} from "./routes.js";

export { maybeRegisterSecretOnboardingStep } from "./onboarding.js";
