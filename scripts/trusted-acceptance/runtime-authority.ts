import { randomBytes } from "node:crypto";

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

export type TrustedRuntimeConfig = {
  members: readonly RuntimeMember[];
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
    runtimeOwned?: boolean;
    inferenceKeyHash?: string;
    tombstoneDeployId?: string;
  }>;
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
    const body = await json(
      await this.fetch(
        `${NEON_API}/projects/${encodeURIComponent(projectId)}/branches`,
        { headers: { authorization: `Bearer ${this.token}` } },
      ),
    );
    return ((body.branches ?? []) as Array<Record<string, unknown>>).flatMap(
      (branch) => {
        if (typeof branch.name !== "string") return [];
        if (!branch.name.startsWith("trusted-acceptance-")) return [];
        const match = /^trusted-acceptance-([a-f0-9]{24})$/.exec(branch.name);
        if (
          !match ||
          typeof branch.id !== "string" ||
          typeof branch.expires_at !== "string"
        ) {
          throw new Error(
            "Neon returned a malformed trusted acceptance branch",
          );
        }
        return [
          {
            leaseId: match[1]!,
            branchId: branch.id,
            expiresAt: branch.expires_at,
          },
        ];
      },
    );
  }
}

export class OpenRouterKeys {
  constructor(
    private readonly fetch: FetchLike,
    private readonly token: string,
  ) {}

  async create(
    leaseId: string,
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
          name: `trusted-acceptance-${leaseId}`,
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
    Array<{ leaseId: string; hash: string; expiresAt: string }>
  > {
    const body = await json(
      await this.fetch(`${OPENROUTER_API}/keys`, {
        headers: { authorization: `Bearer ${this.token}` },
      }),
    );
    return ((body.data ?? []) as Array<Record<string, unknown>>).flatMap(
      (item) => {
        if (typeof item.name !== "string") return [];
        if (!item.name.startsWith("trusted-acceptance-")) return [];
        const match = /^trusted-acceptance-([a-f0-9]{24})$/.exec(item.name);
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
            hash: item.hash,
            expiresAt: item.expires_at,
          },
        ];
      },
    );
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
      if (existing.ok)
        throw new Error(
          `Netlify runtime variable ${key} already exists; refusing to overwrite acceptance-site state`,
        );
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
          values: [{ value, context: "all" }],
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
    for (const key of keys) {
      const response = await this.fetch(this.envUrl(accountId, siteId, key), {
        method: "DELETE",
        headers: { authorization: `Bearer ${this.token}` },
      });
      if (!response.ok && response.status !== 404)
        throw new Error(
          `Netlify runtime variable removal failed: ${response.status}`,
        );
    }
    for (const key of keys) {
      const verification = await this.fetch(
        this.envUrl(accountId, siteId, key),
        { headers: { authorization: `Bearer ${this.token}` } },
      );
      if (verification.status !== 404) return false;
    }
    return true;
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
      const value = values?.find((entry) => entry.context === "all")?.value;
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
type DiscoveredKey = { hash: string; expiresAt: string };
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

  const keysByLease = new Map<string, DiscoveredKey[]>();
  for (const key of await providers.openrouter.listByPrefixAndExpiry()) {
    if (!leaseIdPattern.test(key.leaseId) || !key.hash)
      throw new Error(
        "OpenRouter returned an invalid trusted acceptance lease id",
      );
    const keys = keysByLease.get(key.leaseId) ?? [];
    if (keys.some((entry) => entry.hash === key.hash))
      throw new Error("OpenRouter returned a duplicate trusted acceptance key");
    keys.push({ hash: key.hash, expiresAt: key.expiresAt });
    keysByLease.set(key.leaseId, keys);
  }

  const inferenceMembers = config.members.filter(
    (member) => member.needsInference,
  );
  const leaseIds = new Set([
    ...branchesByLease.keys(),
    ...markersByLease.keys(),
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

  return [...leaseIds].flatMap((id) => {
    const branches = branchesByLease.get(id) ?? [];
    const markers = markersByLease.get(id) ?? [];
    const keys = (keysByLease.get(id) ?? []).toSorted((left, right) =>
      left.hash.localeCompare(right.hash),
    );
    const expiries = [
      ...branches.map((branch) => parsedExpiry(branch.expiresAt, "Neon")),
      ...markers.map((marker) => parsedExpiry(marker.expiresAt, "Netlify")),
      ...keys.map((key) => parsedExpiry(key.expiresAt, "OpenRouter")),
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
    if (keys.length > inferenceMembers.length) {
      throw new Error(
        "trusted acceptance lease has undeclared inference handles",
      );
    }
    return [
      {
        id,
        createdAt: new Date(canonicalExpiry).toISOString(),
        expiresAt: new Date(canonicalExpiry).toISOString(),
        state: "active" as const,
        members: config.members.map((member) => {
          const branch = branchesByMember.get(member.id);
          const inferenceIndex = inferenceMembers.findIndex(
            (candidate) => candidate.id === member.id,
          );
          return {
            memberId: member.id,
            netlifySiteId: member.netlifySiteId,
            runtimeOwned: markerMembers.has(member.id),
            ...(branch ? { neonBranchId: branch.branchId } : {}),
            ...(inferenceIndex >= 0 && keys[inferenceIndex]
              ? { inferenceKeyHash: keys[inferenceIndex].hash }
              : {}),
          };
        }),
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
  "A2A_SECRET",
  "OPENROUTER_API_KEY",
  "AGENT_ENGINE",
  "AGENT_NATIVE_ACCEPTANCE_LEASE_MARKER",
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
        await this.record(lease, "before", "set-netlify-runtime", "pending");
        try {
          await this.providers.netlify.setRuntime(
            member.netlifyAccountId,
            member.netlifySiteId,
            {
              AGENT_NATIVE_ACCEPTANCE_LEASE_MARKER: JSON.stringify({
                leaseId: lease.id,
                expiresAt: lease.expiresAt,
              }),
              DATABASE_URL: memberSecrets.databaseUrl,
              BETTER_AUTH_SECRET: memberSecrets.betterAuthSecret,
              A2A_SECRET: a2aSecret,
              ...(memberSecrets.inferenceKey
                ? {
                    OPENROUTER_API_KEY: memberSecrets.inferenceKey,
                    AGENT_ENGINE: "ai-sdk:openrouter",
                  }
                : {}),
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
      if (durableMember.runtimeOwned) {
        const stillOwned = await this.providers.netlify.ownsLease(
          member.netlifyAccountId,
          member.netlifySiteId,
          lease.id,
          lease.expiresAt,
        );
        if (!stillOwned) {
          runtimeVariablesAbsent = false;
          tombstoneActive = false;
          await this.record(
            lease,
            "verification",
            "verify-netlify-lease-owner",
            "failed",
            member.netlifySiteId,
          );
        } else {
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
}
