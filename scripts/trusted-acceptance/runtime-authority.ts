import { createHash, randomBytes } from "node:crypto";

/**
 * Provider-neutral, disposable runtime authority for the disabled acceptance
 * pilot. This module has no ambient environment access and never calls a
 * provider until its injected FetchLike is invoked by acquire or revoke.
 */

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type TombstoneArtifact = { sha256: string; zip: Uint8Array };

export type RuntimeMember = {
  id: string;
  origin: string;
  neonProjectId: string;
  neonDatabaseName: string;
  neonRoleName: string;
  netlifyAccountId: string;
  netlifySiteId: string;
  needsInference: boolean;
};

/** A controller-owned directory is intentionally not a candidate runtime member. */
export type DirectoryFixtureRuntime = {
  origin: string;
  netlifyAccountId: string;
  netlifySiteId: string;
  orgDomain: string;
  members: readonly {
    id: string;
    name: string;
    url: string;
    a2aUrl: string;
    capabilities?: readonly string[];
  }[];
  withdrawnMemberId: string;
};

export type TrustedRuntimeConfig = {
  members: readonly RuntimeMember[];
  directoryFixture?: DirectoryFixtureRuntime;
  maxInferenceUsd: number;
  tombstone: TombstoneArtifact;
};

export type LeaseJournal = {
  at: string;
  phase: "before" | "after" | "compensated" | "verification";
  operation: string;
  handle?: string;
  outcome: "pending" | "ok" | "failed";
};

/** Production callers persist this redacted record after every state/event. */
export type LeaseJournalStore = { save(lease: RuntimeLease): Promise<void> };
const unitNoopJournalStore: LeaseJournalStore = { async save() {} };

/** Durable, safe-to-log record. Secret values must never be added here. */
export type RuntimeLease = {
  id: string;
  createdAt: string;
  expiresAt: string;
  state: "acquiring" | "active" | "revoking" | "revoked" | "failed";
  members: Array<{
    memberId: string;
    neonBranchId?: string;
    netlifySiteId: string;
    runtimeWriteAttempted?: boolean;
    runtimeOwned?: boolean;
    authSigningAuthority?: {
      algorithm: "sha256";
      generatedAt: string;
      sha256: string;
      scope: "per-run";
    };
    inferenceKeyHash?: string;
    tombstoneDeployId?: string;
  }>;
  directoryFixture?: {
    netlifySiteId: string;
    runtimeWriteAttempted?: boolean;
    runtimeOwned?: boolean;
    scenario: "stable" | "withdraw-member";
    tombstoneDeployId?: string;
  };
  journal: LeaseJournal[];
  verification: {
    inferenceDisabled: boolean;
    runtimeVariablesAbsent: boolean;
    tombstoneActive: boolean;
    branchesDeleted: boolean;
  };
};

/** Returned only to the trusted invoker; never persist or JSON serialize it. */
export type TransientLeaseSecrets = {
  memberSecrets: Record<
    string,
    {
      databaseUrl: string;
      betterAuthSecret: string;
      a2aSecret: string;
      inferenceKey?: string;
    }
  >;
};

export type AcquireResult = {
  lease: RuntimeLease;
  secrets: TransientLeaseSecrets;
};

const NEON_API = "https://console.neon.tech/api/v2";
const NETLIFY_API = "https://api.netlify.com/api/v1";
const OPENROUTER_API = "https://openrouter.ai/api/v1";

function isExactHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  } catch {
    return false;
  }
}

function checkedConfig(config: TrustedRuntimeConfig): void {
  if (
    !Number.isFinite(config.maxInferenceUsd) ||
    config.maxInferenceUsd <= 0 ||
    config.maxInferenceUsd > 1
  ) {
    throw new Error(
      "maxInferenceUsd must be a positive tiny USD cap (at most 1)",
    );
  }
  if (
    !config.tombstone.zip.byteLength ||
    !/^[a-f0-9]{64}$/i.test(config.tombstone.sha256)
  ) {
    throw new Error(
      "trusted tombstone must have a prebuilt ZIP and sha256 digest",
    );
  }
  const members = new Set<string>();
  const neonProjects = new Set<string>();
  const netlifySites = new Set<string>();
  for (const member of config.members) {
    if (
      !/^[a-z0-9][a-z0-9-]*$/.test(member.id) ||
      !member.neonProjectId ||
      !member.neonDatabaseName ||
      !member.neonRoleName ||
      !member.netlifyAccountId ||
      !member.netlifySiteId ||
      !isExactHttpsOrigin(member.origin) ||
      members.has(member.id) ||
      neonProjects.has(member.neonProjectId) ||
      netlifySites.has(member.netlifySiteId)
    ) {
      throw new Error(
        "trusted runtime config contains an invalid or duplicate declared member",
      );
    }
    members.add(member.id);
    neonProjects.add(member.neonProjectId);
    netlifySites.add(member.netlifySiteId);
  }
  const fixture = config.directoryFixture;
  if (!fixture) return;
  if (
    !fixture.netlifyAccountId ||
    !fixture.netlifySiteId ||
    !fixture.orgDomain ||
    !isExactHttpsOrigin(fixture.origin) ||
    netlifySites.has(fixture.netlifySiteId) ||
    fixture.members.length === 0 ||
    !fixture.members.some(({ id }) => id === fixture.withdrawnMemberId)
  ) {
    throw new Error(
      "trusted directory fixture config is incomplete or overlaps an app runtime",
    );
  }
}

async function json(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok)
    throw new Error(`provider request failed: ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

export class NeonBranches {
  constructor(
    private readonly fetch: FetchLike,
    private readonly token: string,
  ) {}

  async createBranch(
    projectId: string,
    leaseId: string,
    expiresAt: string,
  ): Promise<string> {
    const body = await json(
      await this.fetch(
        `${NEON_API}/projects/${encodeURIComponent(projectId)}/branches`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            branch: {
              name: `trusted-acceptance-${leaseId}`,
              expires_at: expiresAt,
            },
          }),
        },
      ),
    );
    const branch = body.branch as Record<string, unknown> | undefined;
    if (typeof branch?.id !== "string")
      throw new Error("Neon did not return a disposable branch handle");
    return branch.id;
  }

  async getConnectionUri(
    projectId: string,
    databaseName: string,
    roleName: string,
    branchId: string,
  ): Promise<string> {
    const query = new URLSearchParams({
      branch_id: branchId,
      database_name: databaseName,
      role_name: roleName,
      pooled: "true",
    });
    const connection = await json(
      await this.fetch(
        `${NEON_API}/projects/${encodeURIComponent(projectId)}/connection_uri?${query}`,
        { headers: { authorization: `Bearer ${this.token}` } },
      ),
    );
    if (typeof connection.uri !== "string")
      throw new Error("Neon did not return a disposable branch connection URI");
    return connection.uri;
  }

  async deleteAndVerify(projectId: string, branchId: string): Promise<boolean> {
    const deleted = await this.fetch(
      `${NEON_API}/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}`,
      { method: "DELETE", headers: { authorization: `Bearer ${this.token}` } },
    );
    if (!deleted.ok && deleted.status !== 404)
      throw new Error(`Neon branch delete failed: ${deleted.status}`);
    const verification = await this.fetch(
      `${NEON_API}/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}`,
      { headers: { authorization: `Bearer ${this.token}` } },
    );
    return verification.status === 404;
  }

  async listByPrefixAndExpiry(
    projectId: string,
  ): Promise<Array<{ leaseId: string; branchId: string; expiresAt: string }>> {
    const branches: Array<Record<string, unknown>> = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    let pageCount = 0;
    do {
      pageCount += 1;
      if (pageCount > 100)
        throw new Error(
          "Neon branch inventory exceeded the bounded page limit",
        );
      const query = new URLSearchParams({ limit: "100" });
      if (cursor) query.set("cursor", cursor);
      const body = await json(
        await this.fetch(
          `${NEON_API}/projects/${encodeURIComponent(projectId)}/branches?${query}`,
          { headers: { authorization: `Bearer ${this.token}` } },
        ),
      );
      if (!Array.isArray(body.branches))
        throw new Error("Neon returned a malformed branch inventory");
      branches.push(...(body.branches as Array<Record<string, unknown>>));
      const pagination = body.pagination as Record<string, unknown> | undefined;
      const next = pagination?.next;
      if (next !== undefined && typeof next !== "string")
        throw new Error("Neon returned a malformed pagination cursor");
      if (next && seenCursors.has(next))
        throw new Error("Neon returned a repeated pagination cursor");
      if (next) seenCursors.add(next);
      cursor = next || undefined;
    } while (cursor);
    return branches.flatMap((branch) => {
      if (typeof branch.name !== "string") return [];
      if (!branch.name.startsWith("trusted-acceptance-")) return [];
      const match = /^trusted-acceptance-([a-f0-9]{24})$/.exec(branch.name);
      if (
        !match ||
        typeof branch.id !== "string" ||
        typeof branch.expires_at !== "string"
      ) {
        throw new Error("Neon returned a malformed trusted acceptance branch");
      }
      return [
        {
          leaseId: match[1]!,
          branchId: branch.id,
          expiresAt: branch.expires_at,
        },
      ];
    });
  }
}

export class OpenRouterKeys {
  constructor(
    private readonly fetch: FetchLike,
    private readonly token: string,
  ) {}

  async create(
    leaseId: string,
    memberId: string,
    expiresAt: string,
    maxUsd: number,
  ): Promise<{ plaintext: string; hash: string }> {
    if (!expiresAt || !Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > 1)
      throw new Error(
        "OpenRouter keys require expiry and a positive tiny USD cap",
      );
    const body = await json(
      await this.fetch(`${OPENROUTER_API}/keys`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: `trusted-acceptance-${leaseId}-${memberId}`,
          limit: maxUsd,
          limit_reset: null,
          expires_at: expiresAt,
        }),
      }),
    );
    const data = body.data as Record<string, unknown> | undefined;
    if (typeof body.key !== "string" || typeof data?.hash !== "string")
      throw new Error(
        "OpenRouter did not return transient key material and an opaque hash",
      );
    return { plaintext: body.key, hash: data.hash };
  }

  async disableByHash(hash: string): Promise<boolean> {
    const disabled = await this.fetch(
      `${OPENROUTER_API}/keys/${encodeURIComponent(hash)}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ disabled: true }),
      },
    );
    if (!disabled.ok && disabled.status !== 404) return false;
    const verification = await this.fetch(
      `${OPENROUTER_API}/keys/${encodeURIComponent(hash)}`,
      { headers: { authorization: `Bearer ${this.token}` } },
    );
    if (verification.status === 404) return true;
    const body = await json(verification);
    const data = body.data as Record<string, unknown> | undefined;
    return data?.hash === hash && data.disabled === true;
  }

  async listByPrefixAndExpiry(): Promise<
    Array<{
      leaseId: string;
      memberId: string;
      hash: string;
      expiresAt: string;
    }>
  > {
    const pageSize = 100;
    const items: Array<Record<string, unknown>> = [];
    for (let page = 0; page < 100; page += 1) {
      const query = new URLSearchParams({
        include_disabled: "true",
        offset: String(page * pageSize),
      });
      const body = await json(
        await this.fetch(`${OPENROUTER_API}/keys?${query}`, {
          headers: { authorization: `Bearer ${this.token}` },
        }),
      );
      if (!Array.isArray(body.data))
        throw new Error("OpenRouter returned a malformed key inventory");
      const pageItems = body.data as Array<Record<string, unknown>>;
      items.push(...pageItems);
      if (pageItems.length < pageSize) break;
      if (page === 99)
        throw new Error(
          "OpenRouter key inventory exceeded the bounded page limit",
        );
    }
    return items.flatMap((item) => {
      if (typeof item.name !== "string") return [];
      if (!item.name.startsWith("trusted-acceptance-")) return [];
      const match =
        /^trusted-acceptance-([a-f0-9]{24})-([a-z0-9][a-z0-9-]*)$/.exec(
          item.name,
        );
      if (
        !match ||
        typeof item.hash !== "string" ||
        typeof item.expires_at !== "string"
      ) {
        throw new Error(
          "OpenRouter returned a malformed trusted acceptance key",
        );
      }
      return [
        {
          leaseId: match[1]!,
          memberId: match[2]!,
          hash: item.hash,
          expiresAt: item.expires_at,
        },
      ];
    });
  }
}

export class NetlifyRuntime {
  constructor(
    private readonly fetch: FetchLike,
    private readonly token: string,
  ) {}

  async assertSiteReady(
    accountId: string,
    siteId: string,
    origin: string,
    keys: readonly string[],
  ): Promise<void> {
    const site = await json(
      await this.fetch(`${NETLIFY_API}/sites/${encodeURIComponent(siteId)}`, {
        headers: { authorization: `Bearer ${this.token}` },
      }),
    );
    const origins = new Set(
      [site.ssl_url, site.url, site.custom_domain]
        .concat(Array.isArray(site.domain_aliases) ? site.domain_aliases : [])
        .filter((value): value is string => typeof value === "string")
        .map((value) => {
          try {
            return new URL(value.includes("://") ? value : `https://${value}`)
              .origin;
          } catch {
            return "";
          }
        }),
    );
    if (site.id !== siteId || !origins.has(origin))
      throw new Error(
        "Netlify site identity does not match the declared acceptance origin",
      );
    for (const key of keys) {
      const response = await this.fetch(this.envUrl(accountId, siteId, key), {
        headers: { authorization: `Bearer ${this.token}` },
      });
      if (response.ok)
        throw new Error(
          `Netlify runtime variable ${key} already exists; refusing to overwrite acceptance-site state`,
        );
      if (response.status !== 404)
        throw new Error(
          `Netlify runtime variable lookup failed: ${response.status}`,
        );
    }
  }

  async setRuntime(
    accountId: string,
    siteId: string,
    values: Record<string, string>,
    allowExisting = false,
  ): Promise<void> {
    const entries = Object.entries(values);
    for (const [key] of entries) {
      const itemUrl = this.envUrl(accountId, siteId, key);
      const existing = await this.fetch(itemUrl, {
        headers: { authorization: `Bearer ${this.token}` },
      });
      if (!existing.ok && existing.status !== 404)
        throw new Error(
          `Netlify runtime variable lookup failed: ${existing.status}`,
        );
      if (!existing.ok && allowExisting)
        throw new Error(
          `Netlify runtime variable ${key} does not exist; refusing acceptance-site update`,
        );
      if (existing.ok && !allowExisting)
        throw new Error(
          `Netlify runtime variable ${key} already exists; refusing to overwrite acceptance-site state`,
        );
    }
    if (allowExisting) {
      for (const [key, value] of entries) {
        const response = await this.fetch(this.envUrl(accountId, siteId, key), {
          method: "PUT",
          headers: {
            authorization: `Bearer ${this.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            key,
            scopes: ["functions", "runtime"],
            values: [{ value, context: "production" }],
            is_secret: key !== "AGENT_NATIVE_ACCEPTANCE_LEASE_MARKER",
          }),
        });
        if (!response.ok)
          throw new Error(
            `Netlify runtime variable update failed: ${response.status}`,
          );
      }
      return;
    }
    const response = await this.fetch(this.envUrl(accountId, siteId), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(
        entries.map(([key, value]) => ({
          key,
          scopes: ["functions", "runtime"],
          values: [{ value, context: "production" }],
          is_secret: key !== "AGENT_NATIVE_ACCEPTANCE_LEASE_MARKER",
        })),
      ),
    });
    if (!response.ok)
      throw new Error(
        `Netlify runtime variable update failed: ${response.status}`,
      );
  }

  async removeRuntime(
    accountId: string,
    siteId: string,
    keys: readonly string[],
  ): Promise<boolean> {
    const removals = await Promise.allSettled(
      keys.map((key) =>
        this.fetch(this.envUrl(accountId, siteId, key), {
          method: "DELETE",
          headers: { authorization: `Bearer ${this.token}` },
        }),
      ),
    );
    const rejectedRemoval = removals.find(
      (result) => result.status === "rejected",
    );
    if (rejectedRemoval?.status === "rejected") throw rejectedRemoval.reason;
    const failedRemoval = removals.find(
      (result) =>
        result.status === "fulfilled" &&
        !result.value.ok &&
        result.value.status !== 404,
    );
    if (failedRemoval?.status === "fulfilled")
      throw new Error(
        `Netlify runtime variable removal failed: ${failedRemoval.value.status}`,
      );
    const verification = await Promise.all(
      keys.map((key) =>
        this.fetch(this.envUrl(accountId, siteId, key), {
          headers: { authorization: `Bearer ${this.token}` },
        }),
      ),
    );
    return verification.every((response) => response.status === 404);
  }

  async readLeaseMarker(
    accountId: string,
    siteId: string,
  ): Promise<{ leaseId: string; expiresAt: string } | undefined> {
    const read = async (key: string): Promise<string | undefined> => {
      const response = await this.fetch(this.envUrl(accountId, siteId, key), {
        headers: { authorization: `Bearer ${this.token}` },
      });
      if (response.status === 404) return undefined;
      const body = await json(response);
      const values = body.values as Array<Record<string, unknown>> | undefined;
      const value = values?.find(
        (entry) => entry.context === "production",
      )?.value;
      if (typeof value !== "string")
        throw new Error("Netlify returned a malformed acceptance lease marker");
      return value;
    };
    const serialized = await read("AGENT_NATIVE_ACCEPTANCE_LEASE_MARKER");
    if (!serialized) return undefined;
    let marker: unknown;
    try {
      marker = JSON.parse(serialized);
    } catch {
      throw new Error("Netlify returned a malformed acceptance lease marker");
    }
    if (
      !marker ||
      typeof marker !== "object" ||
      typeof (marker as Record<string, unknown>).leaseId !== "string" ||
      typeof (marker as Record<string, unknown>).expiresAt !== "string"
    )
      throw new Error("Netlify returned a malformed acceptance lease marker");
    return marker as { leaseId: string; expiresAt: string };
  }

  async ownsLease(
    accountId: string,
    siteId: string,
    leaseId: string,
    expiresAt: string,
  ): Promise<boolean> {
    const marker = await this.readLeaseMarker(accountId, siteId);
    return marker?.leaseId === leaseId && marker.expiresAt === expiresAt;
  }

  private envUrl(accountId: string, siteId: string, key?: string): string {
    const suffix = key ? `/${encodeURIComponent(key)}` : "";
    return `${NETLIFY_API}/accounts/${encodeURIComponent(accountId)}/env${suffix}?site_id=${encodeURIComponent(siteId)}`;
  }

  async deployTombstoneAndVerify(
    siteId: string,
    artifact: TombstoneArtifact,
  ): Promise<{ deployId: string } | undefined> {
    const deploy = await json(
      await this.fetch(
        `${NETLIFY_API}/sites/${encodeURIComponent(siteId)}/deploys`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.token}`,
            "content-type": "application/zip",
          },
          body: artifact.zip,
        },
      ),
    );
    const deployId = deploy.id;
    if (typeof deployId !== "string")
      throw new Error("Netlify did not return a tombstone deploy handle");
    const deployed = await json(
      await this.fetch(
        `${NETLIFY_API}/deploys/${encodeURIComponent(deployId)}`,
        { headers: { authorization: `Bearer ${this.token}` } },
      ),
    );
    if (deployed.state !== "ready") return undefined;
    const active = await json(
      await this.fetch(`${NETLIFY_API}/sites/${encodeURIComponent(siteId)}`, {
        headers: { authorization: `Bearer ${this.token}` },
      }),
    );
    const published = active.published_deploy as
      | Record<string, unknown>
      | undefined;
    return published?.id === deployId ? { deployId } : undefined;
  }
}

export type RuntimeProviders = {
  neon: Pick<
    NeonBranches,
    | "createBranch"
    | "getConnectionUri"
    | "deleteAndVerify"
    | "listByPrefixAndExpiry"
  >;
  netlify: Pick<
    NetlifyRuntime,
    | "setRuntime"
    | "assertSiteReady"
    | "removeRuntime"
    | "readLeaseMarker"
    | "ownsLease"
    | "deployTombstoneAndVerify"
  >;
  openrouter: Pick<
    OpenRouterKeys,
    "create" | "disableByHash" | "listByPrefixAndExpiry"
  >;
};
type Clock = () => Date;
const leaseIdPattern = /^[a-f0-9]{24}$/;
const expiryToleranceMs = 60_000;

type DiscoveredBranch = {
  memberId: string;
  branchId: string;
  expiresAt: string;
};
type DiscoveredKey = {
  memberId: string;
  hash: string;
  expiresAt: string;
};
type DiscoveredMarker = { memberId: string; expiresAt: string };

function parsedExpiry(expiresAt: string, source: string): number {
  const timestamp = new Date(expiresAt).getTime();
  if (!Number.isFinite(timestamp))
    throw new Error(`${source} returned an invalid trusted acceptance expiry`);
  return timestamp;
}

/**
 * Reconstruct only expired leases from provider inventories. The config, not
 * Netlify variables or provider metadata, defines the allowed runtime members.
 */
export async function discoverExpiredLeases(
  config: TrustedRuntimeConfig,
  providers: Pick<RuntimeProviders, "neon" | "netlify" | "openrouter">,
  now: Date,
): Promise<RuntimeLease[]> {
  checkedConfig(config);
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs))
    throw new Error("discovery requires a valid clock");

  const branchesByLease = new Map<string, DiscoveredBranch[]>();
  const markersByLease = new Map<string, DiscoveredMarker[]>();
  const directoryMarkersByLease = new Map<string, { expiresAt: string }>();
  for (const member of config.members) {
    const branches = await providers.neon.listByPrefixAndExpiry(
      member.neonProjectId,
    );
    for (const branch of branches) {
      if (!leaseIdPattern.test(branch.leaseId) || !branch.branchId)
        throw new Error("Neon returned an invalid trusted acceptance lease id");
      const leaseBranches = branchesByLease.get(branch.leaseId) ?? [];
      if (
        leaseBranches.some(
          (entry) =>
            entry.memberId === member.id || entry.branchId === branch.branchId,
        )
      )
        throw new Error(
          "Neon returned duplicate branches for one lease member",
        );
      leaseBranches.push({ memberId: member.id, ...branch });
      branchesByLease.set(branch.leaseId, leaseBranches);
    }
    const marker = await providers.netlify.readLeaseMarker(
      member.netlifyAccountId,
      member.netlifySiteId,
    );
    if (marker) {
      if (!leaseIdPattern.test(marker.leaseId))
        throw new Error(
          "Netlify returned an invalid trusted acceptance lease id",
        );
      const leaseMarkers = markersByLease.get(marker.leaseId) ?? [];
      leaseMarkers.push({ memberId: member.id, expiresAt: marker.expiresAt });
      markersByLease.set(marker.leaseId, leaseMarkers);
    }
  }
  if (config.directoryFixture) {
    const fixture = config.directoryFixture;
    const marker = await providers.netlify.readLeaseMarker(
      fixture.netlifyAccountId,
      fixture.netlifySiteId,
    );
    if (marker) {
      if (!leaseIdPattern.test(marker.leaseId))
        throw new Error(
          "Netlify returned an invalid trusted directory fixture lease id",
        );
      if (directoryMarkersByLease.has(marker.leaseId))
        throw new Error(
          "Netlify returned duplicate trusted directory fixture lease markers",
        );
      directoryMarkersByLease.set(marker.leaseId, {
        expiresAt: marker.expiresAt,
      });
    }
  }

  const keysByLease = new Map<string, DiscoveredKey[]>();
  for (const key of await providers.openrouter.listByPrefixAndExpiry()) {
    if (
      !leaseIdPattern.test(key.leaseId) ||
      !key.hash ||
      !config.members.some(
        (member) => member.id === key.memberId && member.needsInference,
      )
    )
      throw new Error(
        "OpenRouter returned an invalid trusted acceptance lease member",
      );
    const keys = keysByLease.get(key.leaseId) ?? [];
    if (
      keys.some(
        (entry) => entry.hash === key.hash || entry.memberId === key.memberId,
      )
    )
      throw new Error("OpenRouter returned a duplicate trusted acceptance key");
    keys.push(key);
    keysByLease.set(key.leaseId, keys);
  }

  const leaseIds = new Set([
    ...branchesByLease.keys(),
    ...markersByLease.keys(),
    ...directoryMarkersByLease.keys(),
    ...keysByLease.keys(),
  ]);
  const activeMarkerLeases = new Set(
    [...markersByLease.entries()]
      .filter(([, markers]) =>
        markers.some(
          (marker) => parsedExpiry(marker.expiresAt, "Netlify") > nowMs,
        ),
      )
      .map(([leaseId]) => leaseId),
  );
  for (const [leaseId, marker] of directoryMarkersByLease) {
    if (parsedExpiry(marker.expiresAt, "Netlify") > nowMs)
      activeMarkerLeases.add(leaseId);
  }

  return [...leaseIds].flatMap((id) => {
    const branches = branchesByLease.get(id) ?? [];
    const markers = markersByLease.get(id) ?? [];
    const keys = keysByLease.get(id) ?? [];
    const directoryMarker = directoryMarkersByLease.get(id);
    const expiries = [
      ...branches.map((branch) => parsedExpiry(branch.expiresAt, "Neon")),
      ...markers.map((marker) => parsedExpiry(marker.expiresAt, "Netlify")),
      ...keys.map((key) => parsedExpiry(key.expiresAt, "OpenRouter")),
      ...(directoryMarker
        ? [parsedExpiry(directoryMarker.expiresAt, "Netlify")]
        : []),
    ];
    if (!expiries.length || expiries.every((expiry) => expiry > nowMs))
      return [];
    if (expiries.some((expiry) => expiry > nowMs))
      throw new Error(
        "trusted acceptance lease has inconsistent provider expiries",
      );
    if (activeMarkerLeases.size && !activeMarkerLeases.has(id))
      throw new Error(
        "an active lease owns the workspace while expired resources remain",
      );
    const branchesByMember = new Map(
      branches.map((branch) => [branch.memberId, branch]),
    );
    const markerMembers = new Set(markers.map(({ memberId }) => memberId));
    const canonicalExpiry = expiries[0]!;
    if (
      expiries.some(
        (expiry) => Math.abs(expiry - canonicalExpiry) > expiryToleranceMs,
      )
    )
      throw new Error(
        "trusted acceptance lease has inconsistent provider expiries",
      );
    const keysByMember = new Map(keys.map((key) => [key.memberId, key]));
    return [
      {
        id,
        createdAt: new Date(canonicalExpiry).toISOString(),
        expiresAt: new Date(canonicalExpiry).toISOString(),
        state: "active" as const,
        members: config.members.map((member) => {
          const branch = branchesByMember.get(member.id);
          const key = keysByMember.get(member.id);
          return {
            memberId: member.id,
            netlifySiteId: member.netlifySiteId,
            runtimeOwned: markerMembers.has(member.id),
            ...(branch ? { neonBranchId: branch.branchId } : {}),
            ...(key ? { inferenceKeyHash: key.hash } : {}),
          };
        }),
        ...(directoryMarker && config.directoryFixture
          ? {
              directoryFixture: {
                netlifySiteId: config.directoryFixture.netlifySiteId,
                runtimeOwned: true,
                scenario: "stable" as const,
              },
            }
          : {}),
        journal: [],
        verification: {
          inferenceDisabled: false,
          runtimeVariablesAbsent: false,
          tombstoneActive: false,
          branchesDeleted: false,
        },
      },
    ];
  });
}

const runtimeKeys = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "AUTH_SKIP_EMAIL_VERIFICATION",
  "MCP_OAUTH_ACCESS_TOKEN_TTL",
  "A2A_SECRET",
  "AGENT_NATIVE_ORG_DIRECTORY_URL",
  "OPENROUTER_API_KEY",
  "AGENT_ENGINE",
  "AGENT_NATIVE_ACCEPTANCE_LEASE_MARKER",
] as const;
const directoryRuntimeKeys = [
  "AGENT_NATIVE_ACCEPTANCE_LEASE_MARKER",
  "A2A_SECRET",
  "AGENT_NATIVE_ACCEPTANCE_DIRECTORY_JSON",
  "AGENT_NATIVE_ACCEPTANCE_DIRECTORY_SCENARIO",
] as const;
export class DisposableRuntimeAuthority {
  constructor(
    private readonly config: TrustedRuntimeConfig,
    private readonly providers: RuntimeProviders,
    private readonly now: Clock = () => new Date(),
    private readonly journalStore: LeaseJournalStore = unitNoopJournalStore,
  ) {
    checkedConfig(config);
  }

  async acquire(ttlMs: number): Promise<AcquireResult> {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0)
      throw new Error("lease ttl must be positive");
    const createdAt = this.now();
    const lease: RuntimeLease = {
      id: randomBytes(12).toString("hex"),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
      state: "acquiring",
      members: this.config.members.map((member) => ({
        memberId: member.id,
        netlifySiteId: member.netlifySiteId,
        runtimeOwned: false,
      })),
      ...(this.config.directoryFixture
        ? {
            directoryFixture: {
              netlifySiteId: this.config.directoryFixture.netlifySiteId,
              scenario: "stable" as const,
              runtimeOwned: false,
            },
          }
        : {}),
      journal: [],
      verification: {
        inferenceDisabled: false,
        runtimeVariablesAbsent: false,
        tombstoneActive: false,
        branchesDeleted: false,
      },
    };
    const secrets: TransientLeaseSecrets = { memberSecrets: {} };
    await this.journalStore.save(lease);
    try {
      for (const member of this.config.members)
        await this.providers.netlify.assertSiteReady(
          member.netlifyAccountId,
          member.netlifySiteId,
          member.origin,
          runtimeKeys,
        );
      if (this.config.directoryFixture) {
        const fixture = this.config.directoryFixture;
        await this.providers.netlify.assertSiteReady(
          fixture.netlifyAccountId,
          fixture.netlifySiteId,
          fixture.origin,
          directoryRuntimeKeys,
        );
      }
      const a2aSecret = randomBytes(32).toString("base64url");
      for (const [index, member] of this.config.members.entries()) {
        const durableMember = lease.members[index]!;
        await this.record(lease, "before", "create-neon-branch", "pending");
        let branchId: string;
        try {
          branchId = await this.providers.neon.createBranch(
            member.neonProjectId,
            lease.id,
            lease.expiresAt,
          );
        } catch (error) {
          await this.record(lease, "after", "create-neon-branch", "failed");
          throw error;
        }
        durableMember.neonBranchId = branchId;
        await this.record(lease, "after", "create-neon-branch", "ok", branchId);
        let databaseUrl: string;
        try {
          databaseUrl = await this.providers.neon.getConnectionUri(
            member.neonProjectId,
            member.neonDatabaseName,
            member.neonRoleName,
            branchId,
          );
        } catch (error) {
          await this.record(
            lease,
            "after",
            "get-neon-connection-uri",
            "failed",
            branchId,
          );
          throw error;
        }
        const memberSecrets = {
          databaseUrl,
          betterAuthSecret: randomBytes(32).toString("base64url"),
          a2aSecret,
        } as TransientLeaseSecrets["memberSecrets"][string];
        durableMember.authSigningAuthority = {
          algorithm: "sha256",
          generatedAt: this.now().toISOString(),
          sha256: createHash("sha256")
            .update(memberSecrets.betterAuthSecret)
            .digest("hex"),
          scope: "per-run",
        };
        await this.journalStore.save(lease);
        if (member.needsInference) {
          await this.record(
            lease,
            "before",
            "create-openrouter-key",
            "pending",
          );
          let key: { plaintext: string; hash: string };
          try {
            key = await this.providers.openrouter.create(
              lease.id,
              member.id,
              lease.expiresAt,
              this.config.maxInferenceUsd,
            );
          } catch (error) {
            await this.record(
              lease,
              "after",
              "create-openrouter-key",
              "failed",
            );
            throw error;
          }
          durableMember.inferenceKeyHash = key.hash;
          memberSecrets.inferenceKey = key.plaintext;
          await this.record(
            lease,
            "after",
            "create-openrouter-key",
            "ok",
            key.hash,
          );
        }
        await this.record(
          lease,
          "before",
          "set-netlify-lease-marker",
          "pending",
        );
        durableMember.runtimeWriteAttempted = true;
        await this.journalStore.save(lease);
        try {
          await this.providers.netlify.setRuntime(
            member.netlifyAccountId,
            member.netlifySiteId,
            {
              AGENT_NATIVE_ACCEPTANCE_LEASE_MARKER: JSON.stringify({
                leaseId: lease.id,
                expiresAt: lease.expiresAt,
              }),
            },
          );
          if (
            !(await this.providers.netlify.ownsLease(
              member.netlifyAccountId,
              member.netlifySiteId,
              lease.id,
              lease.expiresAt,
            ))
          )
            throw new Error(
              "Netlify did not retain the exact acceptance lease marker",
            );
          durableMember.runtimeOwned = true;
          await this.journalStore.save(lease);
        } catch (error) {
          await this.record(
            lease,
            "after",
            "set-netlify-lease-marker",
            "failed",
            member.netlifySiteId,
          );
          throw error;
        }
        await this.record(
          lease,
          "after",
          "set-netlify-lease-marker",
          "ok",
          member.netlifySiteId,
        );
        await this.record(lease, "before", "set-netlify-runtime", "pending");
        try {
          if (
            !(await this.providers.netlify.ownsLease(
              member.netlifyAccountId,
              member.netlifySiteId,
              lease.id,
              lease.expiresAt,
            ))
          )
            throw new Error(
              "Netlify lease ownership changed before acceptance runtime install",
            );
          await this.providers.netlify.setRuntime(
            member.netlifyAccountId,
            member.netlifySiteId,
            {
              DATABASE_URL: memberSecrets.databaseUrl,
              BETTER_AUTH_SECRET: memberSecrets.betterAuthSecret,
              AUTH_SKIP_EMAIL_VERIFICATION: "1",
              MCP_OAUTH_ACCESS_TOKEN_TTL: "5m",
              A2A_SECRET: a2aSecret,
              ...(this.config.directoryFixture
                ? {
                    AGENT_NATIVE_ORG_DIRECTORY_URL:
                      this.config.directoryFixture.origin,
                  }
                : {}),
              ...(memberSecrets.inferenceKey
                ? {
                    OPENROUTER_API_KEY: memberSecrets.inferenceKey,
                    AGENT_ENGINE: "ai-sdk:openrouter",
                  }
                : {}),
            },
          );
        } catch (error) {
          await this.record(
            lease,
            "after",
            "set-netlify-runtime",
            "failed",
            member.netlifySiteId,
          );
          throw error;
        }
        await this.record(
          lease,
          "after",
          "set-netlify-runtime",
          "ok",
          member.netlifySiteId,
        );
        secrets.memberSecrets[member.id] = memberSecrets;
      }
      if (this.config.directoryFixture && lease.directoryFixture) {
        const fixture = this.config.directoryFixture;
        const durableFixture = lease.directoryFixture;
        await this.record(
          lease,
          "before",
          "set-directory-lease-marker",
          "pending",
        );
        durableFixture.runtimeWriteAttempted = true;
        await this.journalStore.save(lease);
        await this.providers.netlify.setRuntime(
          fixture.netlifyAccountId,
          fixture.netlifySiteId,
          {
            AGENT_NATIVE_ACCEPTANCE_LEASE_MARKER: JSON.stringify({
              leaseId: lease.id,
              expiresAt: lease.expiresAt,
            }),
          },
        );
        if (
          !(await this.providers.netlify.ownsLease(
            fixture.netlifyAccountId,
            fixture.netlifySiteId,
            lease.id,
            lease.expiresAt,
          ))
        )
          throw new Error(
            "Netlify did not retain the exact directory fixture lease marker",
          );
        durableFixture.runtimeOwned = true;
        await this.record(
          lease,
          "after",
          "set-directory-lease-marker",
          "ok",
          fixture.netlifySiteId,
        );
        await this.record(lease, "before", "set-directory-runtime", "pending");
        if (
          !(await this.providers.netlify.ownsLease(
            fixture.netlifyAccountId,
            fixture.netlifySiteId,
            lease.id,
            lease.expiresAt,
          ))
        )
          throw new Error(
            "Netlify directory fixture lease ownership changed before runtime install",
          );
        await this.providers.netlify.setRuntime(
          fixture.netlifyAccountId,
          fixture.netlifySiteId,
          {
            A2A_SECRET: a2aSecret,
            AGENT_NATIVE_ACCEPTANCE_DIRECTORY_JSON: JSON.stringify({
              orgDomain: fixture.orgDomain,
              fixtureOrigin: fixture.origin,
              members: fixture.members,
              withdrawnMemberId: fixture.withdrawnMemberId,
            }),
            AGENT_NATIVE_ACCEPTANCE_DIRECTORY_SCENARIO: "stable",
          },
        );
        await this.record(
          lease,
          "after",
          "set-directory-runtime",
          "ok",
          fixture.netlifySiteId,
        );
      }
      await this.setState(lease, "active");
      return { lease, secrets };
    } catch (error) {
      await this.setState(lease, "failed");
      await this.revoke(lease);
      throw error;
    }
  }

  async revoke(lease: RuntimeLease): Promise<RuntimeLease> {
    if (lease.state === "revoked") return lease;
    await this.setState(lease, "revoking");
    let inferenceDisabled = true,
      runtimeVariablesAbsent = true,
      tombstoneActive = true,
      branchesDeleted = true;
    for (const [index, member] of this.config.members.entries()) {
      const durableMember = lease.members[index]!;
      if (durableMember.inferenceKeyHash) {
        const disabled = await this.cleanup(
          lease,
          "disable-openrouter-key",
          durableMember.inferenceKeyHash,
          () =>
            this.providers.openrouter.disableByHash(
              durableMember.inferenceKeyHash!,
            ),
        );
        inferenceDisabled &&= disabled;
      }
      if (durableMember.runtimeOwned || durableMember.runtimeWriteAttempted) {
        let stillOwned = false;
        let ownershipVerified = true;
        try {
          stillOwned = await this.providers.netlify.ownsLease(
            member.netlifyAccountId,
            member.netlifySiteId,
            lease.id,
            lease.expiresAt,
          );
        } catch {
          ownershipVerified = false;
          runtimeVariablesAbsent = false;
          tombstoneActive = false;
          await this.record(
            lease,
            "verification",
            "verify-netlify-lease-owner",
            "failed",
            member.netlifySiteId,
          );
        }
        if (stillOwned) {
          const absent = await this.cleanup(
            lease,
            "remove-netlify-runtime",
            member.netlifySiteId,
            () =>
              this.providers.netlify.removeRuntime(
                member.netlifyAccountId,
                member.netlifySiteId,
                runtimeKeys,
              ),
          );
          runtimeVariablesAbsent &&= absent;
          const tombstoned = await this.cleanup(
            lease,
            "deploy-netlify-tombstone",
            member.netlifySiteId,
            async () => {
              const receipt =
                await this.providers.netlify.deployTombstoneAndVerify(
                  member.netlifySiteId,
                  this.config.tombstone,
                );
              if (receipt) durableMember.tombstoneDeployId = receipt.deployId;
              return Boolean(receipt);
            },
          );
          tombstoneActive &&= tombstoned;
        } else if (ownershipVerified) {
          runtimeVariablesAbsent = false;
          tombstoneActive = false;
          await this.record(
            lease,
            "verification",
            "verify-netlify-lease-owner",
            "failed",
            member.netlifySiteId,
          );
        }
      }
      if (durableMember.neonBranchId) {
        const deleted = await this.cleanup(
          lease,
          "delete-neon-branch",
          durableMember.neonBranchId,
          () =>
            this.providers.neon.deleteAndVerify(
              member.neonProjectId,
              durableMember.neonBranchId!,
            ),
        );
        branchesDeleted &&= deleted;
      }
    }
    if (this.config.directoryFixture && lease.directoryFixture) {
      const fixture = this.config.directoryFixture;
      const durableFixture = lease.directoryFixture;
      if (durableFixture.runtimeOwned || durableFixture.runtimeWriteAttempted) {
        let stillOwned = false;
        let ownershipVerified = true;
        try {
          stillOwned = await this.providers.netlify.ownsLease(
            fixture.netlifyAccountId,
            fixture.netlifySiteId,
            lease.id,
            lease.expiresAt,
          );
        } catch {
          ownershipVerified = false;
          runtimeVariablesAbsent = false;
          tombstoneActive = false;
          await this.record(
            lease,
            "verification",
            "verify-directory-lease-owner",
            "failed",
            fixture.netlifySiteId,
          );
        }
        if (!stillOwned) {
          runtimeVariablesAbsent = false;
          tombstoneActive = false;
          if (ownershipVerified)
            await this.record(
              lease,
              "verification",
              "verify-directory-lease-owner",
              "failed",
              fixture.netlifySiteId,
            );
        } else {
          const absent = await this.cleanup(
            lease,
            "remove-directory-runtime",
            fixture.netlifySiteId,
            () =>
              this.providers.netlify.removeRuntime(
                fixture.netlifyAccountId,
                fixture.netlifySiteId,
                directoryRuntimeKeys,
              ),
          );
          runtimeVariablesAbsent &&= absent;
          const tombstoned = await this.cleanup(
            lease,
            "deploy-directory-tombstone",
            fixture.netlifySiteId,
            async () => {
              const receipt =
                await this.providers.netlify.deployTombstoneAndVerify(
                  fixture.netlifySiteId,
                  this.config.tombstone,
                );
              if (receipt) durableFixture.tombstoneDeployId = receipt.deployId;
              return Boolean(receipt);
            },
          );
          tombstoneActive &&= tombstoned;
        }
      }
    }
    lease.verification = {
      inferenceDisabled,
      runtimeVariablesAbsent,
      tombstoneActive,
      branchesDeleted,
    };
    await this.record(
      lease,
      "verification",
      "revoke-cleanup",
      inferenceDisabled &&
        runtimeVariablesAbsent &&
        tombstoneActive &&
        branchesDeleted
        ? "ok"
        : "failed",
    );
    if (
      inferenceDisabled &&
      runtimeVariablesAbsent &&
      tombstoneActive &&
      branchesDeleted
    )
      await this.setState(lease, "revoked");
    return lease;
  }

  private async cleanup(
    lease: RuntimeLease,
    operation: string,
    handle: string,
    action: () => Promise<boolean>,
  ): Promise<boolean> {
    await this.record(lease, "before", operation, "pending", handle);
    try {
      const verified = await action();
      await this.record(
        lease,
        "after",
        operation,
        verified ? "ok" : "failed",
        handle,
      );
      return verified;
    } catch {
      await this.record(lease, "after", operation, "failed", handle);
      return false;
    }
  }

  private async record(
    lease: RuntimeLease,
    phase: LeaseJournal["phase"],
    operation: string,
    outcome: LeaseJournal["outcome"],
    handle?: string,
  ): Promise<void> {
    lease.journal.push({
      at: this.now().toISOString(),
      phase,
      operation,
      outcome,
      handle,
    });
    await this.journalStore.save(lease);
  }

  private async setState(
    lease: RuntimeLease,
    state: RuntimeLease["state"],
  ): Promise<void> {
    lease.state = state;
    await this.journalStore.save(lease);
  }

  async reapExpired(leases: readonly RuntimeLease[]): Promise<RuntimeLease[]> {
    const now = this.now().getTime();
    const reaped: RuntimeLease[] = [];
    for (const lease of leases) {
      reaped.push(
        lease.state === "revoked" || new Date(lease.expiresAt).getTime() > now
          ? lease
          : await this.revoke(lease),
      );
    }
    return reaped;
  }

  async updateDirectoryScenario(
    lease: RuntimeLease,
    scenario: "withdraw-member",
  ): Promise<RuntimeLease> {
    const fixture = this.config.directoryFixture;
    const durableFixture = lease.directoryFixture;
    if (!fixture || !durableFixture)
      throw new Error(
        "trusted acceptance lease has no controller-owned directory fixture",
      );
    if (
      lease.state !== "active" ||
      durableFixture.scenario !== "stable" ||
      scenario !== "withdraw-member"
    )
      throw new Error(
        "directory fixture scenario transition is not allowlisted",
      );
    if (
      !durableFixture.runtimeOwned ||
      !(await this.providers.netlify.ownsLease(
        fixture.netlifyAccountId,
        fixture.netlifySiteId,
        lease.id,
        lease.expiresAt,
      ))
    )
      throw new Error(
        "Netlify directory fixture is not owned by the exact acceptance lease",
      );
    await this.record(
      lease,
      "before",
      "set-directory-withdraw-member",
      "pending",
      fixture.netlifySiteId,
    );
    await this.providers.netlify.setRuntime(
      fixture.netlifyAccountId,
      fixture.netlifySiteId,
      { AGENT_NATIVE_ACCEPTANCE_DIRECTORY_SCENARIO: scenario },
      true,
    );
    durableFixture.scenario = scenario;
    await this.record(
      lease,
      "after",
      "set-directory-withdraw-member",
      "ok",
      fixture.netlifySiteId,
    );
    return lease;
  }
}
