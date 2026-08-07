import { createHash, randomUUID } from "node:crypto";

import { mutateSetting } from "../settings/store.js";
import {
  deleteOAuthTokensIfRevision,
  getOAuthTokenSnapshot,
  replaceOAuthTokensIfRevision,
  saveOAuthTokens,
} from "./store.js";

const DEFAULT_EXPIRY_SKEW_MS = 60_000;
const DEFAULT_LEASE_MS = 15_000;
const DEFAULT_WAIT_MS = 50;
const DEFAULT_MAX_WAIT_MS = 20_000;
const LIFECYCLE_VERSION = 1;

export interface OAuthCredentialOwner {
  scope: "user" | "org";
  id: string;
}

export interface OAuthCredentialIdentity {
  provider: string;
  accountId: string;
  resource: string;
  owner: OAuthCredentialOwner;
}

export interface OAuthCredentialTokens {
  access_token: string;
  refresh_token?: string;
  [key: string]: unknown;
}

interface OAuthLifecycleMetadata {
  version: 1;
  provider: string;
  resource: string;
  owner: string;
  reconnectReason?: "refresh_failed";
}

export interface OAuthCredential {
  tokens: OAuthCredentialTokens;
  tokenExpiresAt?: number;
  oauthLifecycle?: OAuthLifecycleMetadata;
  [key: string]: unknown;
}

interface CredentialSnapshot<T extends OAuthCredential> {
  credential: T;
  revision: number;
}

export type OAuthCredentialState<T extends OAuthCredential = OAuthCredential> =
  | { kind: "missing" }
  | { kind: "malformed"; revision: number }
  | ({
      kind: "connected" | "expired" | "reconnect_required";
    } & CredentialSnapshot<T>);

export interface OAuthCredentialAccessResult<
  T extends OAuthCredential = OAuthCredential,
> {
  state: OAuthCredentialState<T>;
  accessToken: string | null;
}

export interface OAuthRefreshContext<T extends OAuthCredential> {
  identity: OAuthCredentialIdentity;
  credential: T;
}

export interface OAuthRevocationResult {
  remote: "succeeded" | "failed" | "unsupported" | "not_attempted";
  local: "deleted" | "missing" | "replaced";
}

interface LifecycleDependencies {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  holderId: () => string;
}

const defaultDependencies: LifecycleDependencies = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  holderId: () => randomUUID(),
};

function ownerKey(owner: OAuthCredentialOwner): string {
  const id = owner.id.trim();
  if (!id) throw new Error("OAuth credential owner is required.");
  return `${owner.scope}:${owner.scope === "user" ? id.toLowerCase() : id}`;
}

function assertIdentity(identity: OAuthCredentialIdentity): void {
  if (!identity.provider.trim()) throw new Error("OAuth provider is required.");
  if (!identity.accountId.trim()) {
    throw new Error("OAuth account id is required.");
  }
  if (!identity.resource.trim()) throw new Error("OAuth resource is required.");
  ownerKey(identity.owner);
}

function lifecycleMetadata(
  identity: OAuthCredentialIdentity,
  reconnectReason?: OAuthLifecycleMetadata["reconnectReason"],
): OAuthLifecycleMetadata {
  return {
    version: LIFECYCLE_VERSION,
    provider: identity.provider,
    resource: identity.resource,
    owner: ownerKey(identity.owner),
    ...(reconnectReason ? { reconnectReason } : {}),
  };
}

function withLifecycle<T extends OAuthCredential>(
  identity: OAuthCredentialIdentity,
  credential: T,
  reconnectReason?: OAuthLifecycleMetadata["reconnectReason"],
): T {
  return {
    ...credential,
    oauthLifecycle: lifecycleMetadata(identity, reconnectReason),
  };
}

function metadataMatches(
  identity: OAuthCredentialIdentity,
  metadata: OAuthLifecycleMetadata | undefined,
): boolean {
  return Boolean(
    metadata &&
    metadata.version === LIFECYCLE_VERSION &&
    metadata.provider === identity.provider &&
    metadata.resource === identity.resource &&
    metadata.owner === ownerKey(identity.owner),
  );
}

function leaseKey(identity: OAuthCredentialIdentity): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        identity.provider,
        identity.accountId,
        identity.resource,
        ownerKey(identity.owner),
      ]),
    )
    .digest("hex");
  return `oauth-refresh-lease:${digest}`;
}

function storageAccountId(
  identity: OAuthCredentialIdentity,
  legacyAccountKey = false,
): string {
  if (legacyAccountKey) return identity.accountId;
  const resourceHash = createHash("sha256")
    .update(identity.resource)
    .digest("hex");
  return `${identity.accountId}:resource:${resourceHash}`;
}

async function acquireLease(
  identity: OAuthCredentialIdentity,
  holder: string,
  leaseMs: number,
  now: number,
): Promise<boolean> {
  const next = await mutateSetting(leaseKey(identity), (current) => {
    const currentHolder =
      typeof current?.holder === "string" ? current.holder : "";
    const expiresAt =
      typeof current?.expiresAt === "number" ? current.expiresAt : 0;
    if (currentHolder && currentHolder !== holder && expiresAt > now) {
      return current!;
    }
    return { holder, expiresAt: now + leaseMs };
  });
  return next.holder === holder;
}

async function releaseLease(
  identity: OAuthCredentialIdentity,
  holder: string,
): Promise<void> {
  await mutateSetting(leaseKey(identity), (current) =>
    current?.holder === holder ? { holder: "", expiresAt: 0 } : (current ?? {}),
  ).catch(() => undefined);
}

function startLeaseHeartbeat(
  identity: OAuthCredentialIdentity,
  holder: string,
  leaseMs: number,
  dependencies: LifecycleDependencies,
): () => Promise<void> {
  let renewal: Promise<void> | undefined;
  const timer = setInterval(
    () => {
      if (renewal) return;
      renewal = acquireLease(identity, holder, leaseMs, dependencies.now())
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          renewal = undefined;
        });
    },
    Math.max(1, Math.floor(leaseMs / 3)),
  );
  timer.unref?.();
  return async () => {
    clearInterval(timer);
    await renewal;
  };
}

export async function saveOAuthCredential<T extends OAuthCredential>(
  identity: OAuthCredentialIdentity,
  credential: T,
  options: { legacyAccountKey?: boolean } = {},
): Promise<void> {
  assertIdentity(identity);
  await saveOAuthTokens(
    identity.provider,
    storageAccountId(identity, options.legacyAccountKey),
    withLifecycle(identity, credential),
    ownerKey(identity.owner),
  );
}

export async function readOAuthCredentialState<
  T extends OAuthCredential = OAuthCredential,
>(
  identity: OAuthCredentialIdentity,
  options: {
    allowLegacy?: boolean;
    legacyAccountKey?: boolean;
    now?: number;
    validateCredential?: (credential: T) => boolean;
  } = {},
): Promise<OAuthCredentialState<T>> {
  assertIdentity(identity);
  const stored = await getOAuthTokenSnapshot(
    identity.provider,
    storageAccountId(identity, options.legacyAccountKey),
    ownerKey(identity.owner),
  );
  if (!stored) return { kind: "missing" };
  const parsed = stored.tokens as Partial<T>;
  if (
    !parsed.tokens ||
    typeof parsed.tokens.access_token !== "string" ||
    (!options.allowLegacy &&
      !metadataMatches(identity, parsed.oauthLifecycle)) ||
    (parsed.oauthLifecycle && !metadataMatches(identity, parsed.oauthLifecycle))
  ) {
    return { kind: "malformed", revision: stored.revision };
  }
  const credential = parsed as T;
  if (options.validateCredential && !options.validateCredential(credential)) {
    return { kind: "malformed", revision: stored.revision };
  }
  if (credential.oauthLifecycle?.reconnectReason) {
    return {
      kind: "reconnect_required",
      credential,
      revision: stored.revision,
    };
  }
  const now = options.now ?? Date.now();
  if (
    typeof credential.tokenExpiresAt === "number" &&
    credential.tokenExpiresAt <= now
  ) {
    return { kind: "expired", credential, revision: stored.revision };
  }
  return { kind: "connected", credential, revision: stored.revision };
}

async function markReconnectRequired<T extends OAuthCredential>(
  identity: OAuthCredentialIdentity,
  snapshot: CredentialSnapshot<T>,
  legacyAccountKey: boolean,
): Promise<void> {
  await replaceOAuthTokensIfRevision(
    identity.provider,
    storageAccountId(identity, legacyAccountKey),
    ownerKey(identity.owner),
    snapshot.revision,
    withLifecycle(identity, snapshot.credential, "refresh_failed"),
  );
}

export async function resolveOAuthCredentialAccess<
  T extends OAuthCredential = OAuthCredential,
>(
  identity: OAuthCredentialIdentity,
  options: {
    refresh: (context: OAuthRefreshContext<T>) => Promise<T>;
    allowLegacy?: boolean;
    legacyAccountKey?: boolean;
    validateCredential?: (credential: T) => boolean;
    expirySkewMs?: number;
    leaseMs?: number;
    waitMs?: number;
    maxWaitMs?: number;
    dependencies?: Partial<LifecycleDependencies>;
  },
): Promise<OAuthCredentialAccessResult<T>> {
  assertIdentity(identity);
  const dependencies = { ...defaultDependencies, ...options.dependencies };
  const expirySkewMs = options.expirySkewMs ?? DEFAULT_EXPIRY_SKEW_MS;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const startedAt = dependencies.now();
  let state = await readOAuthCredentialState<T>(identity, {
    allowLegacy: options.allowLegacy,
    legacyAccountKey: options.legacyAccountKey,
    now: startedAt,
    validateCredential: options.validateCredential,
  });
  if (
    state.kind === "connected" &&
    (typeof state.credential.tokenExpiresAt !== "number" ||
      state.credential.tokenExpiresAt - startedAt > expirySkewMs)
  ) {
    return { state, accessToken: state.credential.tokens.access_token };
  }
  if (
    state.kind === "missing" ||
    state.kind === "malformed" ||
    state.kind === "reconnect_required"
  ) {
    return { state, accessToken: null };
  }
  if (!state.credential.tokens.refresh_token) {
    return {
      state,
      accessToken:
        state.kind === "connected"
          ? state.credential.tokens.access_token
          : null,
    };
  }

  const baselineRevision = state.revision;
  const holder = dependencies.holderId();
  while (dependencies.now() - startedAt <= maxWaitMs) {
    const acquired = await acquireLease(
      identity,
      holder,
      leaseMs,
      dependencies.now(),
    );
    if (!acquired) {
      await dependencies.sleep(waitMs);
      state = await readOAuthCredentialState<T>(identity, {
        allowLegacy: options.allowLegacy,
        legacyAccountKey: options.legacyAccountKey,
        now: dependencies.now(),
        validateCredential: options.validateCredential,
      });
      if (
        state.kind === "connected" &&
        (state.revision !== baselineRevision ||
          typeof state.credential.tokenExpiresAt !== "number" ||
          state.credential.tokenExpiresAt - dependencies.now() > expirySkewMs)
      ) {
        return { state, accessToken: state.credential.tokens.access_token };
      }
      if (
        state.kind === "missing" ||
        state.kind === "malformed" ||
        state.kind === "reconnect_required"
      ) {
        return { state, accessToken: null };
      }
      continue;
    }

    try {
      state = await readOAuthCredentialState<T>(identity, {
        allowLegacy: options.allowLegacy,
        legacyAccountKey: options.legacyAccountKey,
        now: dependencies.now(),
        validateCredential: options.validateCredential,
      });
      if (
        state.kind === "missing" ||
        state.kind === "malformed" ||
        state.kind === "reconnect_required"
      ) {
        return { state, accessToken: null };
      }
      if (
        state.kind === "connected" &&
        (typeof state.credential.tokenExpiresAt !== "number" ||
          state.credential.tokenExpiresAt - dependencies.now() > expirySkewMs)
      ) {
        return {
          state,
          accessToken: state.credential.tokens.access_token,
        };
      }
      try {
        const stopHeartbeat = startLeaseHeartbeat(
          identity,
          holder,
          leaseMs,
          dependencies,
        );
        const refreshed = withLifecycle(
          identity,
          await options
            .refresh({ identity, credential: state.credential })
            .finally(stopHeartbeat),
        );
        const stillOwnsLease = await acquireLease(
          identity,
          holder,
          leaseMs,
          dependencies.now(),
        );
        if (!stillOwnsLease) {
          await dependencies.sleep(waitMs);
          continue;
        }
        const saved = await replaceOAuthTokensIfRevision(
          identity.provider,
          storageAccountId(identity, options.legacyAccountKey),
          ownerKey(identity.owner),
          state.revision,
          refreshed,
        );
        const latest = await readOAuthCredentialState<T>(identity, {
          allowLegacy: options.allowLegacy,
          legacyAccountKey: options.legacyAccountKey,
          now: dependencies.now(),
          validateCredential: options.validateCredential,
        });
        if (!saved && latest.kind === "connected") {
          return {
            state: latest,
            accessToken: latest.credential.tokens.access_token,
          };
        }
        return {
          state: latest,
          accessToken:
            latest.kind === "connected"
              ? latest.credential.tokens.access_token
              : null,
        };
      } catch {
        const stillOwnsLease = await acquireLease(
          identity,
          holder,
          leaseMs,
          dependencies.now(),
        );
        if (!stillOwnsLease) {
          await dependencies.sleep(waitMs);
          continue;
        }
        const latest = await readOAuthCredentialState<T>(identity, {
          allowLegacy: options.allowLegacy,
          legacyAccountKey: options.legacyAccountKey,
          now: dependencies.now(),
          validateCredential: options.validateCredential,
        });
        if (latest.kind === "connected") {
          return {
            state: latest,
            accessToken: latest.credential.tokens.access_token,
          };
        }
        if (latest.kind === "expired") {
          await markReconnectRequired(
            identity,
            latest,
            options.legacyAccountKey === true,
          );
          const reconnect = await readOAuthCredentialState<T>(identity, {
            allowLegacy: options.allowLegacy,
            legacyAccountKey: options.legacyAccountKey,
            now: dependencies.now(),
            validateCredential: options.validateCredential,
          });
          return { state: reconnect, accessToken: null };
        }
        return { state: latest, accessToken: null };
      }
    } finally {
      await releaseLease(identity, holder);
    }
  }

  state = await readOAuthCredentialState<T>(identity, {
    allowLegacy: options.allowLegacy,
    legacyAccountKey: options.legacyAccountKey,
    now: dependencies.now(),
    validateCredential: options.validateCredential,
  });
  return {
    state,
    accessToken:
      state.kind === "connected" ? state.credential.tokens.access_token : null,
  };
}

export async function revokeOAuthCredential<T extends OAuthCredential>(
  identity: OAuthCredentialIdentity,
  options: {
    revoke?: (
      context: OAuthRefreshContext<T>,
    ) => Promise<"succeeded" | "unsupported">;
    allowLegacy?: boolean;
    legacyAccountKey?: boolean;
    validateCredential?: (credential: T) => boolean;
  } = {},
): Promise<OAuthRevocationResult> {
  const state = await readOAuthCredentialState<T>(identity, {
    allowLegacy: options.allowLegacy,
    legacyAccountKey: options.legacyAccountKey,
    validateCredential: options.validateCredential,
  });
  if (state.kind === "missing") {
    return { remote: "not_attempted", local: "missing" };
  }
  let remote: OAuthRevocationResult["remote"] = options.revoke
    ? "failed"
    : "unsupported";
  if (options.revoke && state.kind !== "malformed") {
    try {
      remote = await options.revoke({
        identity,
        credential: state.credential,
      });
    } catch {
      remote = "failed";
    }
  } else if (state.kind === "malformed") {
    remote = "not_attempted";
  }
  const deleted = await deleteOAuthTokensIfRevision(
    identity.provider,
    storageAccountId(identity, options.legacyAccountKey),
    ownerKey(identity.owner),
    state.revision,
  );
  return { remote, local: deleted ? "deleted" : "replaced" };
}
