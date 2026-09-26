/**
 * Resolvers for credentials stored under more than one key name. The names,
 * and why they exist, are in `secrets/key-aliases.ts`.
 */

import { GEMINI_API_KEY, secretKeyNames } from "../secrets/key-aliases.js";
import {
  assertCredentialStoreReadable,
  readDeployCredentialEnv,
  resolveSecret,
  resolveSecretDetailed,
  type ResolvedSecretDetail,
} from "./credential-provider.js";

export {
  GEMINI_API_KEY,
  LEGACY_GEMINI_API_KEY,
  canonicalSecretKey,
  secretKeyNames,
} from "../secrets/key-aliases.js";

export interface ResolvedAliasedSecret extends ResolvedSecretDetail {
  /** The stored name that answered. Absent when nothing did. */
  key?: string;
}

/**
 * Lower answers first. Mirrors `resolveSecretDetailed`'s own walk (personal,
 * organization, organization workspace, solo workspace, deploy env) so a
 * personal row under either name still beats a shared row under the other.
 */
function precedence(detail: ResolvedSecretDetail): number {
  switch (detail.source) {
    case "user":
      return 0;
    case "org":
      return 1;
    case "workspace":
      return detail.scopeId?.startsWith("solo:") ? 3 : 2;
    case "env":
      return 4;
    default:
      return 5;
  }
}

/**
 * `resolveSecretDetailed` across every name of the credential. The best
 * scope wins regardless of name; at the same scope the canonical name wins.
 */
export async function resolveSecretWithAliasesDetailed(
  key: string,
  options: { skipUserScope?: boolean } = {},
): Promise<ResolvedAliasedSecret> {
  const names = secretKeyNames(key);
  if (names.length === 1) {
    const detail = await resolveSecretDetailed(key, options);
    return detail.value ? { ...detail, key } : detail;
  }
  // One name at a time so a personal row under the canonical name, the common
  // case once Settings writes it, answers without reading the older name.
  const details: { name: string; detail: ResolvedSecretDetail }[] = [];
  for (const name of names) {
    const detail = await resolveSecretDetailed(name, options);
    details.push({ name, detail });
    if (detail.value && precedence(detail) === 0) break;
  }
  const lookupFailed = details.some(({ detail }) => detail.lookupFailed);
  const cause = details.find(({ detail }) => detail.lookupFailed)?.detail.cause;
  let best: (typeof details)[number] | undefined;
  for (const entry of details) {
    if (!entry.detail.value) continue;
    if (!best || precedence(entry.detail) < precedence(best.detail)) {
      best = entry;
    }
  }
  if (!best) {
    return { value: null, lookupFailed, ...(lookupFailed ? { cause } : {}) };
  }
  return {
    ...best.detail,
    key: best.name,
    lookupFailed,
    ...(lookupFailed ? { cause } : {}),
  };
}

/**
 * `resolveSecret` across every name of the credential: the value, or null
 * when no name has one. Throws `CredentialStoreUnavailableError` when the
 * store could not be read, exactly like `resolveSecret`.
 */
export async function resolveSecretWithAliases(
  key: string,
): Promise<string | null> {
  if (secretKeyNames(key).length === 1) return resolveSecret(key);
  const resolved = await resolveSecretWithAliasesDetailed(key);
  if (resolved.value) return resolved.value;
  assertCredentialStoreReadable(resolved);
  return null;
}

/** The Gemini key under either name, or null. Throws when the store is unreadable. */
export function resolveGeminiApiKey(): Promise<string | null> {
  return resolveSecretWithAliases(GEMINI_API_KEY);
}

/** {@link resolveGeminiApiKey} with the source and the name that answered. */
export function resolveGeminiApiKeyDetailed(options?: {
  skipUserScope?: boolean;
}): Promise<ResolvedAliasedSecret> {
  return resolveSecretWithAliasesDetailed(GEMINI_API_KEY, options);
}

/** `readDeployCredentialEnv` across both Gemini names, canonical first. */
export function readGeminiDeployCredentialEnv(): string | undefined {
  for (const name of secretKeyNames(GEMINI_API_KEY)) {
    const value = readDeployCredentialEnv(name);
    if (value) return value;
  }
  return undefined;
}
