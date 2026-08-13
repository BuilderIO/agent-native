import { createHash, randomUUID } from "node:crypto";

import { mutateSetting } from "../settings/store.js";
import {
  deleteOAuthTokensIfRevision,
  getOAuthTokenSnapshot,
  getOAuthTokenSnapshotForUserOwner,
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
  legacyRevision: number;
}

interface StoredCredentialSnapshot<
  T extends OAuthCredential,
> extends CredentialSnapshot<T> {
  storageOwner: string;
  storageVersion: string;
}

export type OAuthCredentialState<T extends OAuthCredential = OAuthCredential> =
  | { kind: "missing" }
  | {
      kind: "malformed";
      revision: number;
      legacyRevision: number;
      reason: "structure" | "identity" | "validation";
    }
  | ({
      kind: "connected" | "expired" | "reconnect_required";
    } & CredentialSnapshot<T>);

type StoredOAuthCredentialState<T extends OAuthCredential = OAuthCredential> =
  | { kind: "missing" }
  | {
      kind: "malformed";
      revision: number;
      legacyRevision: number;
      storageOwner: string;
      storageVersion: string;
      reason: "structure" | "identity" | "validation";
    }
  | ({
      kind: "connected" | "expired" | "reconnect_required";
    } & StoredCredentialSnapshot<T>);

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

type LeaseAcquisition = "acquired" | "held" | "abandoned";

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

function legacyOwnerKey(owner: OAuthCredentialOwner): string {
  const id = owner.id.trim();
  if (!id) throw new Error("OAuth credential owner is required.");
  return `${owner.scope}:${id}`;
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
  revision: number,
  legacyCredential: boolean,
  leaseMs: number,
  now: number,
): Promise<LeaseAcquisition> {
  const next = await mutateSetting(leaseKey(identity), (current) => {
    const currentHolder =
      typeof current?.holder === "string" ? current.holder : "";
    const expiresAt =
      typeof current?.expiresAt === "number" ? current.expiresAt : 0;
    const currentRevision =
      typeof current?.revision === "number" ? current.revision : -1;
    if (currentHolder && currentHolder !== holder) {
      if (
        expiresAt > now ||
        // A crashed holder may already have redeemed this revision's rotating
        // refresh token. Treat an expired same-revision lease as abandoned so
        // the caller reconnects instead of risking a second redemption.
        currentRevision === revision ||
        (currentRevision === -1 && legacyCredential)
      ) {
        return current!;
      }
    }
    return { holder, revision, expiresAt: now + leaseMs };
  });
  if (next.holder === holder && next.revision === revision) return "acquired";
  if (
    (next.revision === revision || typeof next.revision !== "number") &&
    typeof next.expiresAt === "number" &&
    next.expiresAt <= now
  ) {
    return "abandoned";
  }
  return "held";
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
  revision: number,
  legacyCredential: boolean,
  leaseMs: number,
  dependencies: LifecycleDependencies,
): () => Promise<void> {
  let renewal: Promise<void> | undefined;
  const timer = setInterval(
    () => {
      if (renewal) return;
      renewal = acquireLease(
        identity,
        holder,
        revision,
        legacyCredential,
        leaseMs,
        dependencies.now(),
      )
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

async function readStoredOAuthCredentialState<
  T extends OAuthCredential = OAuthCredential,
>(
  identity: OAuthCredentialIdentity,
  options: {
    allowLegacy?: boolean;
    legacyAccountKey?: boolean;
    now?: number;
    validateCredential?: (credential: T) => boolean;
  } = {},
): Promise<StoredOAuthCredentialState<T>> {
  assertIdentity(identity);
  const accountId = storageAccountId(identity, options.legacyAccountKey);
  const canonicalOwner = ownerKey(identity.owner);
  let storageOwner = canonicalOwner;
  let stored = await getOAuthTokenSnapshot(
    identity.provider,
    accountId,
    storageOwner,
  );
  const legacyOwner = legacyOwnerKey(identity.owner);
  if (!stored && options.allowLegacy && legacyOwner !== canonicalOwner) {
    storageOwner = legacyOwner;
    stored = await getOAuthTokenSnapshot(
      identity.provider,
      accountId,
      storageOwner,
    );
  }
  if (!stored && options.allowLegacy && identity.owner.scope === "user") {
    stored = await getOAuthTokenSnapshotForUserOwner(
      identity.provider,
      accountId,
      canonicalOwner,
    );
    if (stored?.owner) storageOwner = stored.owner;
  }
  if (!stored) return { kind: "missing" };
  const parsed = stored.tokens as Partial<T>;
  if (!parsed.tokens || typeof parsed.tokens.access_token !== "string") {
    return {
      kind: "malformed",
      revision: stored.revision,
      legacyRevision: stored.legacyRevision,
      storageOwner,
      storageVersion: stored.storageVersion,
      reason: "structure",
    };
  }
  if (
    (!options.allowLegacy &&
      !metadataMatches(identity, parsed.oauthLifecycle)) ||
    (parsed.oauthLifecycle && !metadataMatches(identity, parsed.oauthLifecycle))
  ) {
    return {
      kind: "malformed",
      revision: stored.revision,
      legacyRevision: stored.legacyRevision,
      storageOwner,
      storageVersion: stored.storageVersion,
      reason: "identity",
    };
  }
  const credential = parsed as T;
  if (options.validateCredential && !options.validateCredential(credential)) {
    return {
      kind: "malformed",
      revision: stored.revision,
      legacyRevision: stored.legacyRevision,
      storageOwner,
      storageVersion: stored.storageVersion,
      reason: "validation",
    };
  }
  if (credential.oauthLifecycle?.reconnectReason) {
    return {
      kind: "reconnect_required",
      credential,
      revision: stored.revision,
      legacyRevision: stored.legacyRevision,
      storageOwner,
      storageVersion: stored.storageVersion,
    };
  }
  const now = options.now ?? Date.now();
  if (
    typeof credential.tokenExpiresAt === "number" &&
    credential.tokenExpiresAt <= now
  ) {
    return {
      kind: "expired",
      credential,
      revision: stored.revision,
      legacyRevision: stored.legacyRevision,
      storageOwner,
      storageVersion: stored.storageVersion,
    };
  }
  return {
    kind: "connected",
    credential,
    revision: stored.revision,
    legacyRevision: stored.legacyRevision,
    storageOwner,
    storageVersion: stored.storageVersion,
  };
}

function publicCredentialState<T extends OAuthCredential>(
  state: StoredOAuthCredentialState<T>,
): OAuthCredentialState<T> {
  if (state.kind === "missing") return state;
  if (state.kind === "malformed") {
    return {
      kind: state.kind,
      revision: state.revision,
      legacyRevision: state.legacyRevision,
      reason: state.reason,
    };
  }
  return {
    kind: state.kind,
    credential: state.credential,
    revision: state.revision,
    legacyRevision: state.legacyRevision,
  };
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
  return publicCredentialState(
    await readStoredOAuthCredentialState<T>(identity, options),
  );
}

async function markReconnectRequired<T extends OAuthCredential>(
  identity: OAuthCredentialIdentity,
  snapshot: StoredCredentialSnapshot<T>,
  legacyAccountKey: boolean,
): Promise<void> {
  await replaceOAuthTokensIfRevision(
    identity.provider,
    storageAccountId(identity, legacyAccountKey),
    snapshot.storageOwner,
    snapshot.revision,
    snapshot.legacyRevision,
    snapshot.storageVersion,
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
  let state = await readStoredOAuthCredentialState<T>(identity, {
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
    const lease = await acquireLease(
      identity,
      holder,
      state.revision,
      !state.credential.oauthLifecycle,
      leaseMs,
      dependencies.now(),
    );
    if (lease === "abandoned") {
      await markReconnectRequired(
        identity,
        state,
        options.legacyAccountKey === true,
      );
      const reconnect = await readStoredOAuthCredentialState<T>(identity, {
        allowLegacy: options.allowLegacy,
        legacyAccountKey: options.legacyAccountKey,
        now: dependencies.now(),
        validateCredential: options.validateCredential,
      });
      return {
        state: reconnect,
        accessToken:
          reconnect.kind === "connected"
            ? reconnect.credential.tokens.access_token
            : null,
      };
    }
    if (lease === "held") {
      await dependencies.sleep(waitMs);
      state = await readStoredOAuthCredentialState<T>(identity, {
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
      state = await readStoredOAuthCredentialState<T>(identity, {
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
          state.revision,
          !state.credential.oauthLifecycle,
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
          state.revision,
          !state.credential.oauthLifecycle,
          leaseMs,
          dependencies.now(),
        );
        if (stillOwnsLease !== "acquired") {
          await dependencies.sleep(waitMs);
          continue;
        }
        const saved = await replaceOAuthTokensIfRevision(
          identity.provider,
          storageAccountId(identity, options.legacyAccountKey),
          state.storageOwner,
          state.revision,
          state.legacyRevision,
          state.storageVersion,
          refreshed,
        );
        const latest = await readStoredOAuthCredentialState<T>(identity, {
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
          state.revision,
          !state.credential.oauthLifecycle,
          leaseMs,
          dependencies.now(),
        );
        if (stillOwnsLease !== "acquired") {
          await dependencies.sleep(waitMs);
          continue;
        }
        const latest = await readStoredOAuthCredentialState<T>(identity, {
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
          const reconnect = await readStoredOAuthCredentialState<T>(identity, {
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

  state = await readStoredOAuthCredentialState<T>(identity, {
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
  const state = await readStoredOAuthCredentialState<T>(identity, {
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
  if (state.kind === "malformed" && state.reason !== "structure") {
    return { remote, local: "replaced" };
  }
  const deleted = await deleteOAuthTokensIfRevision(
    identity.provider,
    storageAccountId(identity, options.legacyAccountKey),
    state.storageOwner,
    state.revision,
    state.legacyRevision,
    state.storageVersion,
  );
  return { remote, local: deleted ? "deleted" : "replaced" };
}
