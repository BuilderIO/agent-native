import {
  defineFeatureFlag,
  defineFeatureFlags,
} from "@agent-native/core/feature-flags";

export const CONTENT_PRIVATE_VAULT_ACCESS_FLAG = defineFeatureFlag({
  key: "content-private-vault-access",
  displayName: "Private Vault access",
  description:
    "Allow exact users or organizations to use an existing encrypted Content vault. Turning this off fails closed; it never falls back to plaintext Content.",
});

export const CONTENT_PRIVATE_VAULT_ENROLLMENT_FLAG = defineFeatureFlag({
  key: "content-private-vault-enrollment",
  displayName: "Private Vault enrollment",
  description:
    "Allow exact users or organizations to create a new encrypted vault or enroll another endpoint.",
});

export const CONTENT_PRIVATE_VAULT_MIGRATION_FLAG = defineFeatureFlag({
  key: "content-private-vault-migration",
  displayName: "Private Vault migration",
  description:
    "Allow exact users or organizations to begin an explicit legacy-plaintext migration ceremony.",
});

export const CONTENT_PRIVATE_VAULT_FEATURE_FLAGS = defineFeatureFlags([
  CONTENT_PRIVATE_VAULT_ACCESS_FLAG,
  CONTENT_PRIVATE_VAULT_ENROLLMENT_FLAG,
  CONTENT_PRIVATE_VAULT_MIGRATION_FLAG,
]);
