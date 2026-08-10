import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: new Map<
    string,
    {
      tokens: Record<string, unknown>;
      owner: string;
      revision: number;
    }
  >(),
  settings: new Map<string, Record<string, unknown>>(),
  revision: 1,
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
      state.rows.set(rowKey(provider, accountId), {
        tokens,
        owner,
        revision: state.revision++,
      });
    },
  ),
  getOAuthTokenSnapshot: vi.fn(
    async (provider: string, accountId: string, owner: string) => {
      const row = state.rows.get(rowKey(provider, accountId));
      return row?.owner === owner ? structuredClone(row) : null;
    },
  ),
  replaceOAuthTokensIfRevision: vi.fn(
    async (
      provider: string,
      accountId: string,
      owner: string,
      expectedRevision: number,
      tokens: Record<string, unknown>,
    ) => {
      const key = rowKey(provider, accountId);
      const row = state.rows.get(key);
      if (row?.owner !== owner || row.revision !== expectedRevision) {
        return false;
      }
      state.rows.set(key, {
        tokens,
        owner,
        revision: state.revision++,
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
    ) => {
      const key = rowKey(provider, accountId);
      const row = state.rows.get(key);
      if (row?.owner !== owner || row.revision !== expectedRevision) {
        return false;
      }
      state.rows.delete(key);
      return true;
    },
  ),
}));

vi.mock("../settings/store.js", () => ({
  mutateSetting: vi.fn(
    async (
      key: string,
      updater: (
        current: Record<string, unknown> | null,
      ) => Record<string, unknown> | Promise<Record<string, unknown>>,
    ) => {
      const next = await updater(state.settings.get(key) ?? null);
      state.settings.set(key, structuredClone(next));
      return structuredClone(next);
    },
  ),
}));

import {
  readOAuthCredentialState,
  resolveOAuthCredentialAccess,
  revokeOAuthCredential,
  saveOAuthCredential,
  type OAuthCredential,
  type OAuthCredentialIdentity,
} from "./lifecycle.js";

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

beforeEach(() => {
  state.rows.clear();
  state.settings.clear();
  state.revision = 1;
  vi.clearAllMocks();
});

describe("OAuth credential lifecycle", () => {
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
    await saveOAuthCredential(
      identity,
      credential({ expiresAt: Date.now() - 1 }),
    );
    const refresh = vi.fn(async ({ credential: current }) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
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
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = resolveOAuthCredentialAccess(identity, options);

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ accessToken: "<SLOW_ROTATED_ACCESS_TOKEN>" }),
      expect.objectContaining({ accessToken: "<SLOW_ROTATED_ACCESS_TOKEN>" }),
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
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
      accessToken: null,
      state: { kind: "reconnect_required" },
    });
    expect(competingRefresh).not.toHaveBeenCalled();

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

  it("reloads the winning rotation when a successful redeemer loses its lease", async () => {
    await saveOAuthCredential(
      identity,
      credential({ expiresAt: Date.now() - 1 }),
    );
    let finishStaleRefresh!: () => void;
    const staleRefreshGate = new Promise<void>((resolve) => {
      finishStaleRefresh = resolve;
    });
    let finishWinningRefresh!: () => void;
    const winningRefreshGate = new Promise<void>((resolve) => {
      finishWinningRefresh = resolve;
    });
    const staleRefresh = vi.fn(async ({ credential: current }) => {
      await staleRefreshGate;
      return {
        ...current,
        tokens: {
          ...current.tokens,
          access_token: "<STALE_ACCESS_TOKEN>",
          refresh_token: "<STALE_REFRESH_TOKEN>",
        },
        tokenExpiresAt: Date.now() + 3_600_000,
      };
    });
    const winningRefresh = vi.fn(async ({ credential: current }) => {
      await winningRefreshGate;
      return {
        ...current,
        tokens: {
          ...current.tokens,
          access_token: "<WINNING_ACCESS_TOKEN>",
          refresh_token: "<WINNING_REFRESH_TOKEN>",
        },
        tokenExpiresAt: Date.now() + 3_600_000,
      };
    });

    const stale = resolveOAuthCredentialAccess(identity, {
      refresh: staleRefresh,
      leaseMs: 12,
      waitMs: 1,
      maxWaitMs: 1_000,
      dependencies: { holderId: () => "stale-holder" },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const key = [...state.settings.keys()][0];
    const leasedRevision = [...state.rows.values()][0]!.revision;
    state.settings.set(key, {
      holder: "winning-holder",
      revision: leasedRevision,
      expiresAt: Date.now() + 10_000,
    });
    const winner = resolveOAuthCredentialAccess(identity, {
      refresh: winningRefresh,
      leaseMs: 12,
      waitMs: 1,
      maxWaitMs: 1_000,
      dependencies: { holderId: () => "winning-holder" },
    });
    await vi.waitFor(() => expect(winningRefresh).toHaveBeenCalledTimes(1));
    finishStaleRefresh();
    await new Promise((resolve) => setTimeout(resolve, 2));
    finishWinningRefresh();

    await expect(Promise.all([stale, winner])).resolves.toEqual([
      expect.objectContaining({ accessToken: "<WINNING_ACCESS_TOKEN>" }),
      expect.objectContaining({ accessToken: "<WINNING_ACCESS_TOKEN>" }),
    ]);
    expect(staleRefresh).toHaveBeenCalledTimes(1);
    expect(winningRefresh).toHaveBeenCalledTimes(1);
    await expect(readOAuthCredentialState(identity)).resolves.toMatchObject({
      kind: "connected",
      credential: {
        tokens: { refresh_token: "<WINNING_REFRESH_TOKEN>" },
      },
    });
  });

  it("reloads the winning rotation instead of marking reconnect after lease loss", async () => {
    await saveOAuthCredential(
      identity,
      credential({ expiresAt: Date.now() - 1 }),
    );
    let rejectRefresh!: () => void;
    const refreshGate = new Promise<never>((_resolve, reject) => {
      rejectRefresh = () => reject(new Error("rotating token already used"));
    });

    const pending = resolveOAuthCredentialAccess(identity, {
      refresh: async () => refreshGate,
      leaseMs: 12,
      waitMs: 1,
      maxWaitMs: 1_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const key = [...state.settings.keys()][0];
    const leasedRevision = [...state.rows.values()][0]!.revision;
    state.settings.set(key, {
      holder: "competing-process",
      revision: leasedRevision,
      expiresAt: Date.now() + 10_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    rejectRefresh();
    await new Promise((resolve) => setTimeout(resolve, 2));
    await saveOAuthCredential(
      identity,
      credential({
        access: "<WINNING_ACCESS_TOKEN>",
        refresh: "<WINNING_REFRESH_TOKEN>",
      }),
    );

    await expect(pending).resolves.toMatchObject({
      accessToken: "<WINNING_ACCESS_TOKEN>",
      state: { kind: "connected" },
    });
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
