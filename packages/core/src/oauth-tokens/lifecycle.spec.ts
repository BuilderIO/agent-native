import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: new Map<
    string,
    {
      tokens: Record<string, unknown>;
      owner: string;
      revision: number;
      legacyRevision: number;
      storageVersion: string;
    }
  >(),
  settings: new Map<string, Record<string, unknown>>(),
  revision: 1,
  mutationTail: Promise.resolve(),
}));

function rowKey(provider: string, accountId: string): string {
  return `${provider}:${accountId}`;
}

vi.mock("./store.js", () => ({
  saveOAuthTokens: vi.fn(
    async (
      provider: string,
      accountId: string,
      tokens: Record<string, unknown>,
      owner: string,
    ) => {
      const revision = state.revision++;
      state.rows.set(rowKey(provider, accountId), {
        tokens,
        owner,
        revision,
        legacyRevision: revision,
        storageVersion: `storage-${revision}`,
      });
    },
  ),
  getOAuthTokenSnapshot: vi.fn(
    async (provider: string, accountId: string, owner: string) => {
      const row = state.rows.get(rowKey(provider, accountId));
      return row?.owner === owner ? structuredClone(row) : null;
    },
  ),
  getOAuthTokenSnapshotForUserOwner: vi.fn(
    async (provider: string, accountId: string, owner: string) => {
      const row = state.rows.get(rowKey(provider, accountId));
      return row?.owner.toLowerCase() === owner.toLowerCase() &&
        row.owner.toLowerCase().startsWith("user:")
        ? structuredClone(row)
        : null;
    },
  ),
  replaceOAuthTokensIfRevision: vi.fn(
    async (
      provider: string,
      accountId: string,
      owner: string,
      expectedRevision: number,
      expectedLegacyRevision: number,
      expectedStorageVersion: string,
      tokens: Record<string, unknown>,
    ) => {
      const key = rowKey(provider, accountId);
      const row = state.rows.get(key);
      if (
        row?.owner !== owner ||
        row.revision !== expectedRevision ||
        row.legacyRevision !== expectedLegacyRevision ||
        row.storageVersion !== expectedStorageVersion
      ) {
        return false;
      }
      const revision = state.revision++;
      state.rows.set(key, {
        tokens,
        owner,
        revision,
        legacyRevision: revision,
        storageVersion: `storage-${revision}`,
      });
      return true;
    },
  ),
  deleteOAuthTokensIfRevision: vi.fn(
    async (
      provider: string,
      accountId: string,
      owner: string,
      expectedRevision: number,
      expectedLegacyRevision: number,
      expectedStorageVersion: string,
    ) => {
      const key = rowKey(provider, accountId);
      const row = state.rows.get(key);
      if (
        row?.owner !== owner ||
        row.revision !== expectedRevision ||
        row.legacyRevision !== expectedLegacyRevision ||
        row.storageVersion !== expectedStorageVersion
      ) {
        return false;
      }
      state.rows.delete(key);
      return true;
    },
  ),
}));

vi.mock("../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/store.js")>()),
  mutateSetting: vi.fn(
    async (
      key: string,
      updater: (
        current: Record<string, unknown> | null,
      ) => Record<string, unknown> | Promise<Record<string, unknown>>,
    ) => {
      const previous = state.mutationTail;
      let release!: () => void;
      state.mutationTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        const next = await updater(state.settings.get(key) ?? null);
        state.settings.set(key, structuredClone(next));
        return structuredClone(next);
      } finally {
        release();
      }
    },
  ),
}));

import {
  readOAuthCredentialState,
  resolveOAuthCredentialAccess,
  resolveOAuthTokenBundleAccess,
  markOAuthReconnectRequired,
  revokeOAuthCredential,
  saveOAuthCredential,
  type OAuthCredential,
  type OAuthCredentialIdentity,
} from "./lifecycle.js";
import { replaceOAuthTokensIfRevision } from "./store.js";

const identity: OAuthCredentialIdentity = {
  provider: "builder",
  accountId: "managed-ai",
  resource: "https://api.builder.io",
  owner: { scope: "user", id: "Alice@Example.com" },
};

function credential(
  options: {
    access?: string;
    refresh?: string;
    expiresAt?: number;
  } = {},
): OAuthCredential {
  return {
    tokens: {
      access_token: options.access ?? "<ACCESS_TOKEN>",
      ...(options.refresh === undefined
        ? { refresh_token: "<REFRESH_TOKEN>" }
        : options.refresh
          ? { refresh_token: options.refresh }
          : {}),
    },
    tokenExpiresAt: options.expiresAt ?? Date.now() + 3_600_000,
  };
}

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

beforeEach(() => {
  state.rows.clear();
  state.settings.clear();
  state.revision = 1;
  state.mutationTail = Promise.resolve();
  vi.clearAllMocks();
});

describe("OAuth credential lifecycle", () => {
  it("coalesces concurrent flat token refreshes and persists the rotated bundle", async () => {
    const sigmaIdentity: OAuthCredentialIdentity = {
      provider: "sigma",
      accountId: "sigma-account",
      resource: "provider-api",
      owner: { scope: "user", id: "Alice@Example.com" },
    };
    state.rows.set(rowKey("sigma", "sigma-account"), {
      tokens: {
        access_token: "expired-access-token",
        refresh_token: "old-refresh-token",
        expiry_date: Date.now() - 1_000,
      },
      owner: "Alice@Example.com",
      revision: 4,
      legacyRevision: 4,
      storageVersion: "sigma-storage-4",
    });

    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let refreshStarted!: () => void;
    const refreshStartedPromise = new Promise<void>((resolve) => {
      refreshStarted = resolve;
    });
    let waiterStarted!: () => void;
    const waiterStartedPromise = new Promise<void>((resolve) => {
      waiterStarted = resolve;
    });
    let nextHolder = 0;
    const dependencies = {
      holderId: () => `sigma-refresh-holder-${nextHolder++}`,
      sleep: async () => {
        waiterStarted();
        await new Promise((resolve) => setTimeout(resolve, 1));
      },
    };
    const refresh = vi.fn(async (tokens: Record<string, unknown>) => {
      refreshStarted();
      await refreshGate;
      return {
        ...tokens,
        access_token: "fresh-access-token",
        refresh_token: "rotated-refresh-token",
        expiry_date: Date.now() + 3_600_000,
      };
    });
    const options = {
      storageOwner: "Alice@Example.com",
      shouldRefresh: (tokens: Record<string, unknown>, now: number) =>
        typeof tokens.expiry_date === "number" &&
        tokens.expiry_date <= now + 60_000,
      refresh,
      leaseMs: 3_000,
      waitMs: 1,
      maxWaitMs: 2_000,
      dependencies,
    };

    const first = resolveOAuthTokenBundleAccess(sigmaIdentity, options);
    await refreshStartedPromise;
    const second = resolveOAuthTokenBundleAccess(sigmaIdentity, options);
    await waiterStartedPromise;
    expect(refresh).toHaveBeenCalledOnce();
    releaseRefresh();

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ access_token: "fresh-access-token" }),
      expect.objectContaining({ access_token: "fresh-access-token" }),
    ]);
    expect(refresh).toHaveBeenCalledOnce();
    expect(
      state.rows.get(rowKey("sigma", "sigma-account"))?.tokens,
    ).toMatchObject({
      access_token: "fresh-access-token",
      refresh_token: "rotated-refresh-token",
    });
  });

  it("returns a newer stored bundle instead of overwriting it after refresh", async () => {
    const sigmaIdentity: OAuthCredentialIdentity = {
      provider: "sigma",
      accountId: "sigma-account",
      resource: "provider-api",
      owner: { scope: "user", id: "alice@example.com" },
    };
    state.rows.set(rowKey("sigma", "sigma-account"), {
      tokens: {
        access_token: "expired-access-token",
        refresh_token: "old-refresh-token",
        expiry_date: Date.now() - 1_000,
      },
      owner: "alice@example.com",
      revision: 4,
      legacyRevision: 4,
      storageVersion: "sigma-storage-4",
    });

    const result = await resolveOAuthTokenBundleAccess(sigmaIdentity, {
      storageOwner: "alice@example.com",
      shouldRefresh: (tokens: Record<string, unknown>, now: number) =>
        typeof tokens.expiry_date === "number" &&
        tokens.expiry_date <= now + 60_000,
      refresh: async () => {
        state.rows.set(rowKey("sigma", "sigma-account"), {
          tokens: {
            access_token: "newer-authorization-token",
            expiry_date: Date.now() + 3_600_000,
          },
          owner: "alice@example.com",
          revision: 50,
          legacyRevision: 50,
          storageVersion: "sigma-storage-50",
        });
        return {
          access_token: "stale-refresh-token",
          refresh_token: "stale-rotated-refresh-token",
          expiry_date: Date.now() + 3_600_000,
        };
      },
    });

    expect(result.access_token).toBe("newer-authorization-token");
    expect(replaceOAuthTokensIfRevision).not.toHaveBeenCalled();
  });

  it("binds custody to provider, resource, and normalized owner", async () => {
    await saveOAuthCredential(identity, credential());

    await expect(readOAuthCredentialState(identity)).resolves.toMatchObject({
      kind: "connected",
      credential: {
        oauthLifecycle: {
          version: 1,
          provider: "builder",
          resource: "https://api.builder.io",
          owner: "user:alice@example.com",
        },
      },
    });
    await expect(
      readOAuthCredentialState({
        ...identity,
        resource: "https://mcp.builder.io/mcp/fusion",
      }),
    ).resolves.toEqual({ kind: "missing" });
    await expect(
      readOAuthCredentialState({
        ...identity,
        owner: { scope: "user", id: "bob@example.com" },
      }),
    ).resolves.toEqual({ kind: "missing" });
  });

  it("marks a stored credential reconnect_required without a refresh", async () => {
    await saveOAuthCredential(identity, credential());

    await expect(markOAuthReconnectRequired(identity)).resolves.toBe(true);
    await expect(readOAuthCredentialState(identity)).resolves.toMatchObject({
      kind: "reconnect_required",
    });
  });

  it("reports nothing to mark when no credential is stored", async () => {
    await expect(markOAuthReconnectRequired(identity)).resolves.toBe(false);
    await expect(readOAuthCredentialState(identity)).resolves.toEqual({
      kind: "missing",
    });
  });

  it("reads and deletes legacy user credentials stored under mixed-case ownership", async () => {
    const legacyIdentity: OAuthCredentialIdentity = {
      provider: "mcp",
      accountId: "mcp_oauth:test",
      resource: "https://mcp.example.com/mcp",
      owner: { scope: "user", id: "alice@example.com" },
    };
    state.rows.set(rowKey("mcp", "mcp_oauth:test"), {
      tokens: credential(),
      owner: "user:Alice@Example.com",
      revision: 1,
      legacyRevision: 1,
      storageVersion: "legacy-storage",
    });

    await expect(
      readOAuthCredentialState(legacyIdentity, {
        allowLegacy: true,
        legacyAccountKey: true,
      }),
    ).resolves.toMatchObject({ kind: "connected" });
    await expect(
      revokeOAuthCredential(legacyIdentity, {
        allowLegacy: true,
        legacyAccountKey: true,
      }),
    ).resolves.toEqual({ remote: "unsupported", local: "deleted" });
    expect(state.rows.size).toBe(0);
  });

  it("removes credentials stored under the former ChatGPT identity", async () => {
    const legacyAlice: OAuthCredentialIdentity = {
      provider: "openai-codex",
      accountId: "user:alice@example.com",
      resource: "https://chatgpt.com/backend-api/codex/responses",
      owner: { scope: "user", id: "alice@example.com" },
    };
    const legacyBob: OAuthCredentialIdentity = {
      ...legacyAlice,
      accountId: "user:bob@example.com",
      owner: { scope: "user", id: "bob@example.com" },
    };
    await saveOAuthCredential(legacyAlice, credential());
    await saveOAuthCredential(legacyBob, credential());

    await expect(revokeOAuthCredential(legacyAlice)).resolves.toEqual({
      remote: "unsupported",
      local: "deleted",
    });
    await expect(readOAuthCredentialState(legacyAlice)).resolves.toEqual({
      kind: "missing",
    });
    await expect(readOAuthCredentialState(legacyBob)).resolves.toMatchObject({
      kind: "connected",
    });
  });

  it("keeps credentials for two resources with the same provider and account independently retrievable", async () => {
    const fusionIdentity = {
      ...identity,
      resource: "https://api.builder.io/mcp/fusion",
    };
    await saveOAuthCredential(
      identity,
      credential({ access: "<MANAGED_AI_TOKEN>" }),
    );
    await saveOAuthCredential(
      fusionIdentity,
      credential({ access: "<FUSION_TOKEN>" }),
    );

    await expect(readOAuthCredentialState(identity)).resolves.toMatchObject({
      kind: "connected",
      credential: { tokens: { access_token: "<MANAGED_AI_TOKEN>" } },
    });
    await expect(
      readOAuthCredentialState(fusionIdentity),
    ).resolves.toMatchObject({
      kind: "connected",
      credential: { tokens: { access_token: "<FUSION_TOKEN>" } },
    });
    expect(state.rows.size).toBe(2);
  });

  it("distinguishes missing, malformed, expired, and reconnect-required custody", async () => {
    await expect(readOAuthCredentialState(identity)).resolves.toEqual({
      kind: "missing",
    });

    await saveOAuthCredential(identity, credential());
    const malformedRow = [...state.rows.values()][0];
    malformedRow.tokens = { tokens: {} };
    await expect(readOAuthCredentialState(identity)).resolves.toMatchObject({
      kind: "malformed",
    });

    await saveOAuthCredential(
      identity,
      credential({ expiresAt: Date.now() - 1 }),
    );
    await expect(readOAuthCredentialState(identity)).resolves.toMatchObject({
      kind: "expired",
    });

    const row = [...state.rows.values()][0];
    row.tokens = {
      ...row.tokens,
      oauthLifecycle: {
        ...(row.tokens.oauthLifecycle as Record<string, unknown>),
        reconnectReason: "refresh_failed",
      },
    };
    await expect(readOAuthCredentialState(identity)).resolves.toMatchObject({
      kind: "reconnect_required",
    });
  });

  it("redeems one rotating refresh token and makes concurrent waiters reload the winner", async () => {
    await saveOAuthCredential(
      identity,
      credential({ expiresAt: Date.now() - 1 }),
    );
    let finishRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const refresh = vi.fn(async ({ credential: current }) => {
      await refreshGate;
      return {
        ...current,
        tokens: {
          ...current.tokens,
          access_token: "<ROTATED_ACCESS_TOKEN>",
          refresh_token: "<ROTATED_REFRESH_TOKEN>",
        },
        tokenExpiresAt: Date.now() + 3_600_000,
      };
    });
    const options = {
      refresh,
      waitMs: 1,
      maxWaitMs: 1_000,
      dependencies: {
        sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
      },
    };

    const first = resolveOAuthCredentialAccess(identity, options);
    await Promise.resolve();
    const second = resolveOAuthCredentialAccess(identity, options);
    await new Promise((resolve) => setTimeout(resolve, 5));
    finishRefresh();

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ accessToken: "<ROTATED_ACCESS_TOKEN>" }),
      expect.objectContaining({ accessToken: "<ROTATED_ACCESS_TOKEN>" }),
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("renews the lease while a slow rotating refresh is in flight", async () => {
    vi.useFakeTimers();
    try {
      await saveOAuthCredential(
        identity,
        credential({ expiresAt: Date.now() - 1 }),
      );
      let finishRefresh!: () => void;
      const refreshGate = new Promise<void>((resolve) => {
        finishRefresh = resolve;
      });
      const refresh = vi.fn(async ({ credential: current }) => {
        await refreshGate;
        return {
          ...current,
          tokens: {
            ...current.tokens,
            access_token: "<SLOW_ROTATED_ACCESS_TOKEN>",
            refresh_token: "<SLOW_ROTATED_REFRESH_TOKEN>",
          },
          tokenExpiresAt: Date.now() + 3_600_000,
        };
      });
      const options = {
        refresh,
        leaseMs: 12,
        waitMs: 1,
        maxWaitMs: 1_000,
      };

      const first = resolveOAuthCredentialAccess(identity, options);
      for (
        let attempts = 0;
        attempts < 10 && !refresh.mock.calls.length;
        attempts++
      ) {
        await Promise.resolve();
      }
      expect(refresh).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(20);
      const second = resolveOAuthCredentialAccess(identity, options);
      await vi.advanceTimersByTimeAsync(2);
      finishRefresh();
      await vi.advanceTimersByTimeAsync(4);

      await expect(Promise.all([first, second])).resolves.toEqual([
        expect.objectContaining({ accessToken: "<SLOW_ROTATED_ACCESS_TOKEN>" }),
        expect.objectContaining({ accessToken: "<SLOW_ROTATED_ACCESS_TOKEN>" }),
      ]);
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not steal an active revisionless lease during a rolling deployment", async () => {
    await saveOAuthCredential(
      identity,
      credential({ expiresAt: Date.now() - 1 }),
    );
    let finishFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const firstRefresh = vi.fn(async ({ credential: current }) => {
      await firstGate;
      return current;
    });
    const first = resolveOAuthCredentialAccess(identity, {
      refresh: firstRefresh,
      leaseMs: 60_000,
      waitMs: 1,
      maxWaitMs: 1_000,
      dependencies: { holderId: () => "first-holder" },
    });
    await vi.waitFor(() => expect(firstRefresh).toHaveBeenCalledTimes(1));
    const key = [...state.settings.keys()][0]!;
    state.settings.set(key, {
      holder: "legacy-holder",
      expiresAt: Date.now() + 60_000,
    });
    const competingRefresh = vi.fn(async () => credential());
    const competing = resolveOAuthCredentialAccess(identity, {
      refresh: competingRefresh,
      waitMs: 1,
      maxWaitMs: 5,
      dependencies: { holderId: () => "competing-holder" },
    });
    await expect(competing).resolves.toMatchObject({
      accessToken: null,
      state: { kind: "expired" },
    });
    expect(competingRefresh).not.toHaveBeenCalled();

    state.settings.set(key, {
      holder: "legacy-holder",
      expiresAt: Date.now() - 1,
    });
    await expect(
      resolveOAuthCredentialAccess(identity, {
        refresh: competingRefresh,
        waitMs: 1,
        maxWaitMs: 5,
        dependencies: { holderId: () => "post-expiry-holder" },
      }),
    ).resolves.toMatchObject({
      accessToken: "<ACCESS_TOKEN>",
      state: { kind: "connected" },
    });
    expect(competingRefresh).toHaveBeenCalledTimes(1);

    await saveOAuthCredential(
      identity,
      credential({ access: "<NEW_AUTHORIZATION>" }),
    );
    finishFirst();
    await expect(first).resolves.toMatchObject({
      accessToken: "<NEW_AUTHORIZATION>",
    });
  });

  it("does not overwrite an active foreign lease from a newer revision", async () => {
    await saveOAuthCredential(
      identity,
      credential({ expiresAt: Date.now() - 1 }),
    );
    let finishStale!: () => void;
    const staleGate = new Promise<void>((resolve) => {
      finishStale = resolve;
    });
    const staleRefresh = vi.fn(async ({ credential: current }) => {
      await staleGate;
      return current;
    });
    const stale = resolveOAuthCredentialAccess(identity, {
      refresh: staleRefresh,
      leaseMs: 60_000,
      waitMs: 1,
      maxWaitMs: 1_000,
      dependencies: { holderId: () => "stale-holder" },
    });
    await vi.waitFor(() => expect(staleRefresh).toHaveBeenCalledTimes(1));

    await saveOAuthCredential(
      identity,
      credential({ expiresAt: Date.now() - 1 }),
    );
    const newerRevision = [...state.rows.values()][0]!.revision;
    const key = [...state.settings.keys()][0]!;
    state.settings.set(key, {
      holder: "newer-holder",
      revision: newerRevision,
      expiresAt: Date.now() + 60_000,
    });
    const competingRefresh = vi.fn(async () => credential());
    const competing = resolveOAuthCredentialAccess(identity, {
      refresh: competingRefresh,
      waitMs: 1,
      maxWaitMs: 1_000,
      dependencies: { holderId: () => "competing-holder" },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(competingRefresh).not.toHaveBeenCalled();

    await saveOAuthCredential(
      identity,
      credential({ access: "<LATEST_AUTHORIZATION>" }),
    );
    finishStale();
    await expect(Promise.all([stale, competing])).resolves.toEqual([
      expect.objectContaining({ accessToken: "<LATEST_AUTHORIZATION>" }),
      expect.objectContaining({ accessToken: "<LATEST_AUTHORIZATION>" }),
    ]);
    expect(competingRefresh).not.toHaveBeenCalled();
  });

  it.each(["active", "abandoned"] as const)(
    "handles lease loss after a successful redemption with an %s winning lease",
    async (winningLease) => {
      // The lease protocol uses this clock; real CPU delays cannot expire it.
      // Heartbeat scheduling is exercised separately by the renewal test.
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      try {
        const clock = { now: Date.now() };
        await saveOAuthCredential(
          identity,
          credential({ expiresAt: clock.now - 1 }),
        );
        const staleEntered = barrier();
        const staleRefreshGate = barrier();
        const winnerEntered = barrier();
        const winningRefreshGate = barrier();
        const staleWaiting = barrier();
        const resumeStale = barrier();
        const staleRefresh = vi.fn(async ({ credential: current }) => {
          staleEntered.release();
          await staleRefreshGate.promise;
          return {
            ...current,
            tokens: {
              ...current.tokens,
              access_token: "<STALE_ACCESS_TOKEN>",
              refresh_token: "<STALE_REFRESH_TOKEN>",
            },
            tokenExpiresAt: clock.now + 3_600_000,
          };
        });
        const winningRefresh = vi.fn(async ({ credential: current }) => {
          winnerEntered.release();
          await winningRefreshGate.promise;
          return {
            ...current,
            tokens: {
              ...current.tokens,
              access_token: "<WINNING_ACCESS_TOKEN>",
              refresh_token: "<WINNING_REFRESH_TOKEN>",
            },
            tokenExpiresAt: clock.now + 3_600_000,
          };
        });

        const stale = resolveOAuthCredentialAccess(identity, {
          refresh: staleRefresh,
          leaseMs: 12,
          waitMs: 1,
          maxWaitMs: 1_000,
          dependencies: {
            holderId: () => "stale-holder",
            now: () => clock.now,
            sleep: async () => {
              staleWaiting.release();
              await resumeStale.promise;
            },
          },
        });
        await staleEntered.promise;
        const key = [...state.settings.keys()][0];
        const leasedRevision = [...state.rows.values()][0]!.revision;
        state.settings.set(key, {
          holder: "winning-holder",
          revision: leasedRevision,
          expiresAt: clock.now + 10_000,
        });
        const winner = resolveOAuthCredentialAccess(identity, {
          refresh: winningRefresh,
          leaseMs: 12,
          waitMs: 1,
          maxWaitMs: 1_000,
          dependencies: {
            holderId: () => "winning-holder",
            now: () => clock.now,
          },
        });
        await winnerEntered.promise;
        expect(state.settings.get(key)).toEqual({
          holder: "winning-holder",
          revision: leasedRevision,
          expiresAt: clock.now + 12,
        });
        if (winningLease === "abandoned") clock.now += 13;
        staleRefreshGate.release();
        await staleWaiting.promise;
        await expect(
          readOAuthCredentialState(identity, { now: clock.now }),
        ).resolves.toMatchObject({
          kind: "expired",
          revision: leasedRevision,
          credential: {
            tokens: {
              access_token: "<ACCESS_TOKEN>",
              refresh_token: "<REFRESH_TOKEN>",
            },
          },
        });

        if (winningLease === "abandoned") {
          resumeStale.release();
          await expect(stale).resolves.toMatchObject({
            accessToken: null,
            state: { kind: "reconnect_required" },
          });
          winningRefreshGate.release();
          await expect(winner).resolves.toMatchObject({
            accessToken: null,
            state: { kind: "reconnect_required" },
          });
          await expect(
            readOAuthCredentialState(identity, { now: clock.now }),
          ).resolves.toMatchObject({
            kind: "reconnect_required",
            revision: leasedRevision + 1,
            credential: {
              tokens: {
                access_token: "<ACCESS_TOKEN>",
                refresh_token: "<REFRESH_TOKEN>",
              },
              oauthLifecycle: { reconnectReason: "refresh_failed" },
            },
          });
        } else {
          winningRefreshGate.release();
          await expect(winner).resolves.toMatchObject({
            accessToken: "<WINNING_ACCESS_TOKEN>",
          });
          resumeStale.release();

          await expect(Promise.all([stale, winner])).resolves.toEqual([
            expect.objectContaining({ accessToken: "<WINNING_ACCESS_TOKEN>" }),
            expect.objectContaining({ accessToken: "<WINNING_ACCESS_TOKEN>" }),
          ]);
          await expect(
            readOAuthCredentialState(identity),
          ).resolves.toMatchObject({
            kind: "connected",
            revision: leasedRevision + 1,
            credential: {
              tokens: { refresh_token: "<WINNING_REFRESH_TOKEN>" },
            },
          });
        }
        expect(staleRefresh).toHaveBeenCalledTimes(1);
        expect(winningRefresh).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("reloads the winning rotation instead of marking reconnect after lease loss", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const clock = { now: Date.now() };
      await saveOAuthCredential(
        identity,
        credential({ expiresAt: clock.now - 1 }),
      );
      const refreshEntered = barrier();
      const rejectRefresh = barrier();
      const staleWaiting = barrier();
      const resumeStale = barrier();
      const refresh = vi.fn(async () => {
        refreshEntered.release();
        await rejectRefresh.promise;
        throw new Error("rotating token already used");
      });

      const pending = resolveOAuthCredentialAccess(identity, {
        refresh,
        leaseMs: 12,
        waitMs: 1,
        maxWaitMs: 1_000,
        dependencies: {
          now: () => clock.now,
          sleep: async () => {
            staleWaiting.release();
            await resumeStale.promise;
          },
        },
      });
      await refreshEntered.promise;
      const key = [...state.settings.keys()][0];
      const leasedRevision = [...state.rows.values()][0]!.revision;
      state.settings.set(key, {
        holder: "competing-process",
        revision: leasedRevision,
        expiresAt: clock.now + 10_000,
      });
      clock.now += 13;
      rejectRefresh.release();
      await staleWaiting.promise;
      await expect(
        readOAuthCredentialState(identity, { now: clock.now }),
      ).resolves.toMatchObject({ kind: "expired", revision: leasedRevision });
      await saveOAuthCredential(
        identity,
        credential({
          access: "<WINNING_ACCESS_TOKEN>",
          refresh: "<WINNING_REFRESH_TOKEN>",
        }),
      );
      resumeStale.release();

      await expect(pending).resolves.toMatchObject({
        accessToken: "<WINNING_ACCESS_TOKEN>",
        state: { kind: "connected" },
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      await expect(readOAuthCredentialState(identity)).resolves.toMatchObject({
        kind: "connected",
        credential: { tokens: { refresh_token: "<WINNING_REFRESH_TOKEN>" } },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("never redeems a rotating refresh token again after its lease expires in flight", async () => {
    await saveOAuthCredential(
      identity,
      credential({ expiresAt: Date.now() - 1 }),
    );
    let finishRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const refresh = vi.fn(async ({ credential: current }) => {
      await refreshGate;
      return {
        ...current,
        tokens: {
          ...current.tokens,
          access_token: "<ROTATED_ACCESS_TOKEN>",
          refresh_token: "<ROTATED_REFRESH_TOKEN>",
        },
        tokenExpiresAt: Date.now() + 3_600_000,
      };
    });
    const first = resolveOAuthCredentialAccess(identity, {
      refresh,
      leaseMs: 60_000,
      waitMs: 1,
      maxWaitMs: 1_000,
      dependencies: { holderId: () => "first-holder" },
    });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const key = [...state.settings.keys()][0]!;
    const leased = state.settings.get(key)!;
    state.settings.set(key, { ...leased, expiresAt: Date.now() - 1 });

    const second = resolveOAuthCredentialAccess(identity, {
      refresh,
      leaseMs: 60_000,
      waitMs: 1,
      maxWaitMs: 1_000,
      dependencies: { holderId: () => "second-holder" },
    });
    await expect(second).resolves.toMatchObject({
      accessToken: null,
      state: { kind: "reconnect_required" },
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    finishRefresh();
    await expect(first).resolves.toMatchObject({
      accessToken: null,
      state: { kind: "reconnect_required" },
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("force-refreshes a refused token that has no stated expiry", async () => {
    await saveOAuthCredential(identity, {
      tokens: {
        access_token: "<REFUSED_ACCESS_TOKEN>",
        refresh_token: "<REFRESH_TOKEN>",
      },
    });
    const refresh = vi.fn(async ({ credential: current }) => ({
      ...current,
      tokens: { ...current.tokens, access_token: "<FRESH_ACCESS_TOKEN>" },
      tokenExpiresAt: Date.now() + 3_600_000,
    }));

    await expect(
      resolveOAuthCredentialAccess(identity, { refresh }),
    ).resolves.toMatchObject({ accessToken: "<REFUSED_ACCESS_TOKEN>" });
    expect(refresh).not.toHaveBeenCalled();

    await expect(
      resolveOAuthCredentialAccess(identity, { refresh, forceRefresh: true }),
    ).resolves.toMatchObject({ accessToken: "<FRESH_ACCESS_TOKEN>" });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("hands back the same token when a forced refresh has no refresh token", async () => {
    await saveOAuthCredential(identity, credential({ refresh: "" }));
    const refresh = vi.fn();

    await expect(
      resolveOAuthCredentialAccess(identity, { refresh, forceRefresh: true }),
    ).resolves.toMatchObject({ accessToken: "<ACCESS_TOKEN>" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("marks an expired credential for reconnect after refresh fails", async () => {
    await saveOAuthCredential(
      identity,
      credential({ expiresAt: Date.now() - 1 }),
    );

    await expect(
      resolveOAuthCredentialAccess(identity, {
        refresh: async () => {
          throw new Error("refresh token rejected");
        },
      }),
    ).resolves.toMatchObject({
      accessToken: null,
      state: { kind: "reconnect_required" },
    });
  });

  it("keeps expired credentials retryable after transient refresh failures", async () => {
    await saveOAuthCredential(
      identity,
      credential({ expiresAt: Date.now() - 1 }),
    );

    await expect(
      resolveOAuthCredentialAccess(identity, {
        refresh: async () => {
          throw new Error("temporary provider failure");
        },
        shouldMarkReconnectRequiredOnRefreshFailure: () => false,
      }),
    ).resolves.toMatchObject({
      accessToken: null,
      state: { kind: "expired" },
    });

    await expect(
      resolveOAuthCredentialAccess(identity, {
        refresh: async ({ credential: current }) => ({
          ...current,
          tokens: {
            ...current.tokens,
            access_token: "<RETRIED_ACCESS_TOKEN>",
          },
          tokenExpiresAt: Date.now() + 3_600_000,
        }),
      }),
    ).resolves.toMatchObject({
      accessToken: "<RETRIED_ACCESS_TOKEN>",
      state: { kind: "connected" },
    });
  });

  it("attempts remote revocation, deletes local custody, and reports failure honestly", async () => {
    await saveOAuthCredential(identity, credential());

    await expect(
      revokeOAuthCredential(identity, {
        revoke: async () => {
          throw new Error("provider unavailable");
        },
      }),
    ).resolves.toEqual({ remote: "failed", local: "deleted" });
    await expect(readOAuthCredentialState(identity)).resolves.toEqual({
      kind: "missing",
    });
  });

  it("does not delete a newer authorization that lands during revocation", async () => {
    await saveOAuthCredential(identity, credential());
    let finishRevocation!: () => void;
    const revocationGate = new Promise<void>((resolve) => {
      finishRevocation = resolve;
    });
    const revocation = revokeOAuthCredential(identity, {
      revoke: async () => {
        await revocationGate;
        return "succeeded";
      },
    });
    await Promise.resolve();
    await saveOAuthCredential(
      identity,
      credential({ access: "<NEW_AUTHORIZATION>" }),
    );
    finishRevocation();

    await expect(revocation).resolves.toEqual({
      remote: "succeeded",
      local: "replaced",
    });
    await expect(readOAuthCredentialState(identity)).resolves.toMatchObject({
      kind: "connected",
      credential: { tokens: { access_token: "<NEW_AUTHORIZATION>" } },
    });
  });
});
