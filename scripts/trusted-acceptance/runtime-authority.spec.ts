import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  discoverExpiredLeases,
  DisposableRuntimeAuthority,
  NeonBranches,
  NetlifyRuntime,
  OpenRouterKeys,
  type RuntimeLease,
  type RuntimeProviders,
  type TrustedRuntimeConfig,
} from "./runtime-authority.ts";

const sha256 = "a".repeat(64);
const fixedNow = () => new Date("2026-07-26T12:00:00.000Z");

function config(
  overrides: Partial<TrustedRuntimeConfig> = {},
): TrustedRuntimeConfig {
  return {
    maxInferenceUsd: 0.01,
    tombstone: { sha256, zip: new Uint8Array([1, 2, 3]) },
    members: [
      {
        id: "content",
        origin: "https://content.acceptance.example.test",
        neonProjectId: "declared-neon-project",
        neonDatabaseName: "declared-database",
        neonRoleName: "declared-role",
        netlifyAccountId: "declared-netlify-account",
        netlifySiteId: "declared-netlify-site",
        needsInference: true,
      },
    ],
    ...overrides,
  };
}

function providers(
  log: string[],
  options: { failSet?: boolean; verified?: boolean } = {},
): RuntimeProviders {
  return {
    neon: {
      async createBranch(projectId) {
        log.push(`neon:create:${projectId}`);
        return "branch-handle";
      },
      async getConnectionUri(projectId) {
        log.push(`neon:connection:${projectId}`);
        return "postgres://transient-value";
      },
      async deleteAndVerify(projectId, branchId) {
        log.push(`neon:delete:${projectId}:${branchId}`);
        return options.verified ?? true;
      },
      async listByPrefixAndExpiry() {
        return [];
      },
    },
    netlify: {
      async assertSiteReady() {},
      async ownsLease() {
        return true;
      },
      async setRuntime(_accountId, siteId) {
        log.push(`netlify:set:${siteId}`);
        if (options.failSet) throw new Error("injected set failure");
      },
      async removeRuntime(_accountId, siteId) {
        log.push(`netlify:remove:${siteId}`);
        return options.verified ?? true;
      },
      async deployTombstoneAndVerify(siteId) {
        log.push(`netlify:tombstone:${siteId}`);
        return (options.verified ?? true)
          ? { deployId: `deploy-${siteId}` }
          : undefined;
      },
      async readLeaseMarker() {
        return undefined;
      },
    },
    openrouter: {
      async create(leaseId, memberId, expiresAt, maxUsd) {
        log.push(
          `openrouter:create:${leaseId}:${memberId}:${expiresAt}:${maxUsd}`,
        );
        return {
          plaintext: "injected-transient-inference-value",
          hash: "opaque-key-hash",
        };
      },
      async disableByHash(hash) {
        log.push(`openrouter:disable:${hash}`);
        return options.verified ?? true;
      },
      async listByPrefixAndExpiry() {
        return [];
      },
    },
  };
}

describe("disposable runtime authority", () => {
  it("issues transient per-app credentials while retaining only redacted lease handles", async () => {
    const log: string[] = [];
    const authority = new DisposableRuntimeAuthority(
      config(),
      providers(log),
      fixedNow,
    );
    const issued = await authority.acquire(60_000);

    assert.equal(issued.lease.state, "active");
    assert.equal(issued.lease.members[0]?.neonBranchId, "branch-handle");
    assert.equal(issued.lease.members[0]?.inferenceKeyHash, "opaque-key-hash");
    assert.equal(issued.lease.members[0]?.tombstoneDeployId, undefined);
    assert.equal(issued.secrets.memberSecrets.content?.a2aSecret.length, 43);
    const serialized = JSON.stringify(issued.lease);
    assert.equal(serialized.includes("postgres://transient-value"), false);
    assert.equal(
      serialized.includes("injected-transient-inference-value"),
      false,
    );
    assert.equal(
      serialized.includes(
        issued.secrets.memberSecrets.content!.betterAuthSecret,
      ),
      false,
    );
    assert.deepEqual(
      log.slice(0, 4).map((entry) => entry.split(":")[0]),
      ["neon", "neon", "openrouter", "netlify"],
    );
  });

  it("installs the acceptance-only email bypass only after lease ownership and records redacted signing provenance", async () => {
    const log: string[] = [];
    const fake = providers(log);
    fake.netlify.assertSiteReady = async (_accountId, _siteId, _origin, keys) =>
      log.push(`ready:${keys.join(",")}`);
    fake.netlify.setRuntime = async (_accountId, _siteId, values) =>
      log.push(`set:${Object.keys(values).sort().join(",")}`);
    fake.netlify.ownsLease = async () => {
      log.push("owns-lease");
      return true;
    };
    let removedKeys: readonly string[] = [];
    fake.netlify.removeRuntime = async (_accountId, _siteId, keys) => {
      removedKeys = keys;
      return true;
    };

    const authority = new DisposableRuntimeAuthority(config(), fake, fixedNow);
    const issued = await authority.acquire(60_000);
    const secret = issued.secrets.memberSecrets.content!.betterAuthSecret;
    const provenance = issued.lease.members[0]?.authSigningAuthority;

    assert.equal(log[0]?.includes("AUTH_SKIP_EMAIL_VERIFICATION"), true);
    assert.equal(
      log.indexOf("set:AGENT_NATIVE_ACCEPTANCE_LEASE_MARKER") <
        log.indexOf("owns-lease"),
      true,
    );
    assert.equal(
      log.lastIndexOf("owns-lease") <
        log.indexOf(
          "set:A2A_SECRET,AGENT_ENGINE,AUTH_SKIP_EMAIL_VERIFICATION,BETTER_AUTH_SECRET,DATABASE_URL,MCP_OAUTH_ACCESS_TOKEN_TTL,OPENROUTER_API_KEY",
        ),
      true,
    );
    assert.deepEqual(provenance, {
      algorithm: "sha256",
      generatedAt: fixedNow().toISOString(),
      sha256: createHash("sha256").update(secret).digest("hex"),
      scope: "per-run",
    });
    assert.equal(JSON.stringify(issued.lease).includes(secret), false);

    await authority.revoke(issued.lease);
    assert.equal(removedKeys.includes("AUTH_SKIP_EMAIL_VERIFICATION"), true);
    assert.equal(removedKeys.includes("MCP_OAUTH_ACCESS_TOKEN_TTL"), true);
  });

  it("keeps a directory fixture controller-owned and only permits its fixed withdrawal transition", async () => {
    const log: string[] = [];
    const fake = providers(log);
    let ownsLease = true;
    const runtimeWrites: Array<Record<string, string>> = [];
    const memberWrites: Array<Record<string, string>> = [];
    fake.netlify.setRuntime = async (_accountId, siteId, values) => {
      if (siteId === "directory-site") runtimeWrites.push(values);
      else memberWrites.push(values);
    };
    fake.netlify.ownsLease = async () => ownsLease;
    let removedKeys: readonly string[] = [];
    fake.netlify.removeRuntime = async (_accountId, siteId, keys) => {
      if (siteId === "directory-site") removedKeys = keys;
      return true;
    };
    const authority = new DisposableRuntimeAuthority(
      config({
        directoryFixture: {
          origin: "https://directory.acceptance.example.test",
          netlifyAccountId: "directory-account",
          netlifySiteId: "directory-site",
          orgDomain: "acceptance.example.test",
          withdrawnMemberId: "content",
          members: [
            {
              id: "content",
              name: "Content",
              url: "https://content.acceptance.example.test",
              a2aUrl: "https://content.acceptance.example.test",
            },
          ],
        },
      }),
      fake,
      fixedNow,
    );
    const issued = await authority.acquire(60_000);
    assert.deepEqual(issued.lease.directoryFixture, {
      netlifySiteId: "directory-site",
      runtimeOwned: true,
      runtimeWriteAttempted: true,
      scenario: "stable",
    });
    assert.deepEqual(Object.keys(runtimeWrites[0]!).sort(), [
      "AGENT_NATIVE_ACCEPTANCE_LEASE_MARKER",
    ]);
    assert.deepEqual(Object.keys(runtimeWrites[1]!).sort(), [
      "A2A_SECRET",
      "AGENT_NATIVE_ACCEPTANCE_DIRECTORY_JSON",
      "AGENT_NATIVE_ACCEPTANCE_DIRECTORY_SCENARIO",
    ]);
    assert.equal(
      memberWrites.some(
        (values) =>
          values.AGENT_NATIVE_ORG_DIRECTORY_URL ===
          "https://directory.acceptance.example.test",
      ),
      true,
    );
    assert.equal(JSON.stringify(issued.lease).includes("A2A_SECRET"), false);

    ownsLease = false;
    await assert.rejects(
      () => authority.updateDirectoryScenario(issued.lease, "withdraw-member"),
      /not owned/,
    );
    ownsLease = true;
    await authority.updateDirectoryScenario(issued.lease, "withdraw-member");
    assert.equal(issued.lease.directoryFixture?.scenario, "withdraw-member");
    await assert.rejects(
      () => authority.updateDirectoryScenario(issued.lease, "withdraw-member"),
      /not allowlisted/,
    );
    await authority.revoke(issued.lease);
    assert.deepEqual(removedKeys, [
      "AGENT_NATIVE_ACCEPTANCE_LEASE_MARKER",
      "A2A_SECRET",
      "AGENT_NATIVE_ACCEPTANCE_DIRECTORY_JSON",
      "AGENT_NATIVE_ACCEPTANCE_DIRECTORY_SCENARIO",
    ]);
    assert.equal(
      issued.lease.directoryFixture?.tombstoneDeployId,
      "deploy-directory-site",
    );
  });

  it("reconstructs an expired controller-owned directory fixture for reaper cleanup", async () => {
    const log: string[] = [];
    const fake = providers(log);
    fake.netlify.readLeaseMarker = async (_accountId, siteId) =>
      siteId === "directory-site"
        ? {
            leaseId: "a".repeat(24),
            expiresAt: "2026-07-26T11:00:00.000Z",
          }
        : undefined;
    let removedKeys: readonly string[] = [];
    fake.netlify.removeRuntime = async (_accountId, siteId, keys) => {
      if (siteId === "directory-site") removedKeys = keys;
      return true;
    };
    const configured = config({
      directoryFixture: {
        origin: "https://directory.acceptance.example.test",
        netlifyAccountId: "directory-account",
        netlifySiteId: "directory-site",
        orgDomain: "acceptance.example.test",
        withdrawnMemberId: "content",
        members: [
          {
            id: "content",
            name: "Content",
            url: "https://content.acceptance.example.test",
            a2aUrl: "https://content.acceptance.example.test",
          },
        ],
      },
    });
    const authority = new DisposableRuntimeAuthority(
      configured,
      fake,
      fixedNow,
    );
    const [discovered] = await discoverExpiredLeases(
      configured,
      fake,
      fixedNow(),
    );
    assert.equal(discovered?.directoryFixture?.runtimeOwned, true);
    const [reaped] = await authority.reapExpired([discovered!]);
    assert.equal(reaped?.state, "revoked");
    assert.equal(
      removedKeys.includes("AGENT_NATIVE_ACCEPTANCE_DIRECTORY_JSON"),
      true,
    );
  });

  it("persists a failed directory ownership verification for retryable cleanup", async () => {
    const log: string[] = [];
    const fake = providers(log);
    const authority = new DisposableRuntimeAuthority(
      config({
        directoryFixture: {
          origin: "https://directory.acceptance.example.test",
          netlifyAccountId: "directory-account",
          netlifySiteId: "directory-site",
          orgDomain: "acceptance.example.test",
          withdrawnMemberId: "content",
          members: [
            {
              id: "content",
              name: "Content",
              url: "https://content.acceptance.example.test",
              a2aUrl: "https://content.acceptance.example.test",
            },
          ],
        },
      }),
      fake,
      fixedNow,
    );
    const { lease } = await authority.acquire(60_000);
    fake.netlify.ownsLease = async (_accountId, siteId) => {
      if (siteId === "directory-site")
        throw new Error("transient directory ownership read failure");
      return true;
    };
    await authority.revoke(lease);
    assert.equal(lease.state, "revoking");
    assert.equal(
      lease.journal.some(
        ({ operation, outcome, handle }) =>
          operation === "verify-directory-lease-owner" &&
          outcome === "failed" &&
          handle === "directory-site",
      ),
      true,
    );
    assert.equal(log.includes("netlify:remove:directory-site"), false);
    assert.equal(log.includes("netlify:tombstone:directory-site"), false);
  });

  it("journals partial acquire and compensates through the same revoke path", async () => {
    const log: string[] = [];
    const authority = new DisposableRuntimeAuthority(
      config(),
      (() => {
        const fake = providers(log, { failSet: true });
        fake.netlify.ownsLease = async () => false;
        return fake;
      })(),
      fixedNow,
    );
    await assert.rejects(authority.acquire(60_000), /injected set failure/);
    assert.equal(log.includes("openrouter:disable:opaque-key-hash"), true);
    assert.equal(
      log.includes("neon:delete:declared-neon-project:branch-handle"),
      true,
    );
    assert.equal(
      log.some((entry) => entry.startsWith("netlify:remove")),
      false,
    );
  });

  it("compensates an ambiguous Netlify write when its exact marker committed", async () => {
    const log: string[] = [];
    const fake = providers(log);
    fake.netlify.setRuntime = async (_accountId, siteId) => {
      log.push(`netlify:set:${siteId}:committed`);
      throw new Error("response lost after commit");
    };
    fake.netlify.ownsLease = async () => true;
    const authority = new DisposableRuntimeAuthority(config(), fake, fixedNow);
    await assert.rejects(
      authority.acquire(60_000),
      /response lost after commit/,
    );
    assert.equal(log.includes("netlify:remove:declared-netlify-site"), true);
    assert.equal(log.includes("netlify:tombstone:declared-netlify-site"), true);
  });

  it("continues independent cleanup when one Netlify ownership read fails", async () => {
    const log: string[] = [];
    const twoMembers = config({
      members: [
        config().members[0]!,
        {
          ...config().members[0]!,
          id: "calendar",
          neonProjectId: "declared-neon-project-2",
          netlifySiteId: "declared-netlify-site-2",
          needsInference: false,
        },
      ],
    });
    const fake = providers(log);
    const authority = new DisposableRuntimeAuthority(
      twoMembers,
      fake,
      fixedNow,
    );
    const { lease } = await authority.acquire(60_000);
    fake.netlify.ownsLease = async (_accountId, siteId) => {
      if (siteId === "declared-netlify-site")
        throw new Error("transient ownership read failure");
      return true;
    };
    await authority.revoke(lease);
    assert.equal(lease.state, "revoking");
    assert.equal(
      log.includes("neon:delete:declared-neon-project:branch-handle"),
      true,
    );
    assert.equal(
      log.includes("neon:delete:declared-neon-project-2:branch-handle"),
      true,
    );
    assert.equal(log.includes("netlify:remove:declared-netlify-site-2"), true);
    assert.equal(log.includes("netlify:remove:declared-netlify-site"), false);
    assert.equal(
      log.includes("netlify:tombstone:declared-netlify-site"),
      false,
    );
  });

  it("never deletes site state when a competing marker wins the ownership race", async () => {
    const log: string[] = [];
    const fake = providers(log);
    fake.netlify.setRuntime = async () => {
      throw new Error("competing marker");
    };
    fake.netlify.ownsLease = async () => false;
    const authority = new DisposableRuntimeAuthority(config(), fake, fixedNow);
    await assert.rejects(authority.acquire(60_000), /competing marker/);
    assert.equal(
      log.some((entry) => entry.startsWith("netlify:remove")),
      false,
    );
    assert.equal(
      log.some((entry) => entry.startsWith("netlify:tombstone")),
      false,
    );

    const owned = providers(log);
    const ownedAuthority = new DisposableRuntimeAuthority(
      config(),
      owned,
      fixedNow,
    );
    const { lease } = await ownedAuthority.acquire(60_000);
    owned.netlify.ownsLease = async () => false;
    const beforeRevoke = log.length;
    await ownedAuthority.revoke(lease);
    assert.equal(lease.state, "revoking");
    assert.equal(
      log
        .slice(beforeRevoke)
        .some((entry) => entry.startsWith("netlify:remove")),
      false,
    );
  });

  it("compensates a persisted Neon branch when connection URI lookup fails", async () => {
    const log: string[] = [];
    const fake = providers(log);
    fake.neon.getConnectionUri = async () => {
      log.push("neon:connection:failed");
      throw new Error("injected connection failure");
    };
    const authority = new DisposableRuntimeAuthority(config(), fake, fixedNow);
    await assert.rejects(
      authority.acquire(60_000),
      /injected connection failure/,
    );
    assert.equal(
      log.includes("neon:delete:declared-neon-project:branch-handle"),
      true,
    );
  });

  it("makes revoke idempotent and reaches revoked only after every cleanup verification", async () => {
    const log: string[] = [];
    const authority = new DisposableRuntimeAuthority(
      config(),
      providers(log),
      fixedNow,
    );
    const { lease } = await authority.acquire(60_000);
    await authority.revoke(lease);
    assert.equal(lease.state, "revoked");
    assert.equal(
      lease.members[0]?.tombstoneDeployId,
      "deploy-declared-netlify-site",
    );
    const callCount = log.length;
    await authority.revoke(lease);
    assert.equal(log.length, callCount);

    const gated = new DisposableRuntimeAuthority(
      config(),
      providers([], { verified: false }),
      fixedNow,
    );
    const blockedLease = await gated.acquire(60_000);
    await gated.revoke(blockedLease.lease);
    assert.equal(blockedLease.lease.state, "revoking");
    assert.equal(blockedLease.lease.verification.tombstoneActive, false);
  });

  it("reaps deterministic expired records and leaves late revoked work alone", async () => {
    const log: string[] = [];
    const fake = providers(log);
    let removedKeys: readonly string[] = [];
    fake.netlify.removeRuntime = async (_accountId, _siteId, keys) => {
      removedKeys = keys;
      return true;
    };
    const authority = new DisposableRuntimeAuthority(config(), fake, fixedNow);
    const lease: RuntimeLease = {
      id: "expired-lease",
      createdAt: "2026-07-26T10:00:00.000Z",
      expiresAt: "2026-07-26T11:00:00.000Z",
      state: "active",
      members: [
        {
          memberId: "content",
          netlifySiteId: "declared-netlify-site",
          runtimeOwned: true,
          neonBranchId: "branch-handle",
          inferenceKeyHash: "opaque-key-hash",
        },
      ],
      journal: [],
      verification: {
        inferenceDisabled: false,
        runtimeVariablesAbsent: false,
        tombstoneActive: false,
        branchesDeleted: false,
      },
    };
    const alreadyRevoked = {
      ...lease,
      id: "already-revoked",
      state: "revoked" as const,
    };
    const result = await authority.reapExpired([lease, alreadyRevoked]);
    assert.equal(result[0]?.state, "revoked");
    assert.equal(result[1], alreadyRevoked);
    assert.equal(
      log.filter((entry) => entry.startsWith("neon:delete")).length,
      1,
    );
    assert.equal(removedKeys.includes("AUTH_SKIP_EMAIL_VERIFICATION"), true);
  });

  it("reconstructs an expired multi-member lease from declared provider inventory and reaps it", async () => {
    const log: string[] = [];
    const twoMembers = config({
      members: [
        config().members[0]!,
        {
          id: "calendar",
          origin: "https://calendar.acceptance.example.test",
          neonProjectId: "declared-neon-project-2",
          neonDatabaseName: "declared-database-2",
          neonRoleName: "declared-role-2",
          netlifyAccountId: "declared-netlify-account",
          netlifySiteId: "declared-netlify-site-2",
          needsInference: false,
        },
      ],
    });
    const fake = providers(log);
    fake.neon.listByPrefixAndExpiry = async (projectId) => [
      {
        leaseId: "a".repeat(24),
        branchId: `branch-${projectId}`,
        expiresAt: "2026-07-26T11:00:00.000Z",
      },
    ];
    fake.openrouter.listByPrefixAndExpiry = async () => [
      {
        leaseId: "a".repeat(24),
        memberId: "content",
        hash: "opaque-key-hash",
        expiresAt: "2026-07-26T11:00:30.000Z",
      },
    ];
    const discovered = await discoverExpiredLeases(
      twoMembers,
      fake,
      fixedNow(),
    );
    assert.deepEqual(discovered[0]?.members, [
      {
        memberId: "content",
        netlifySiteId: "declared-netlify-site",
        runtimeOwned: false,
        neonBranchId: "branch-declared-neon-project",
        inferenceKeyHash: "opaque-key-hash",
      },
      {
        memberId: "calendar",
        netlifySiteId: "declared-netlify-site-2",
        runtimeOwned: false,
        neonBranchId: "branch-declared-neon-project-2",
      },
    ]);
    const authority = new DisposableRuntimeAuthority(
      twoMembers,
      fake,
      fixedNow,
    );
    const reaped = await authority.reapExpired(discovered);
    assert.equal(reaped[0]?.state, "revoked");
    assert.equal(
      log.includes(
        "neon:delete:declared-neon-project:branch-declared-neon-project",
      ),
      true,
    );
  });

  it("reconstructs inference keys by declared member identity", async () => {
    const log: string[] = [];
    const twoInferenceMembers = config({
      members: [
        config().members[0]!,
        {
          ...config().members[0]!,
          id: "calendar",
          neonProjectId: "declared-neon-project-2",
          netlifySiteId: "declared-netlify-site-2",
        },
      ],
    });
    const fake = providers(log);
    fake.openrouter.listByPrefixAndExpiry = async () => [
      {
        leaseId: "8".repeat(24),
        memberId: "calendar",
        hash: "a-sorts-first-but-belongs-to-calendar",
        expiresAt: "2026-07-26T11:00:00.000Z",
      },
      {
        leaseId: "8".repeat(24),
        memberId: "content",
        hash: "z-sorts-last-but-belongs-to-content",
        expiresAt: "2026-07-26T11:00:00.000Z",
      },
    ];
    const [lease] = await discoverExpiredLeases(
      twoInferenceMembers,
      fake,
      fixedNow(),
    );
    assert.equal(
      lease?.members[0]?.inferenceKeyHash,
      "z-sorts-last-but-belongs-to-content",
    );
    assert.equal(
      lease?.members[1]?.inferenceKeyHash,
      "a-sorts-first-but-belongs-to-calendar",
    );
    await new DisposableRuntimeAuthority(
      twoInferenceMembers,
      fake,
      fixedNow,
    ).reapExpired([lease!]);
    assert.deepEqual(
      log.filter((entry) => entry.startsWith("openrouter:disable:")).sort(),
      [
        "openrouter:disable:a-sorts-first-but-belongs-to-calendar",
        "openrouter:disable:z-sorts-last-but-belongs-to-content",
      ],
    );
  });

  it("excludes active provider resources from discovery", async () => {
    const fake = providers([]);
    fake.neon.listByPrefixAndExpiry = async () => [
      {
        leaseId: "b".repeat(24),
        branchId: "active-branch",
        expiresAt: "2026-07-26T13:00:00.000Z",
      },
    ];
    fake.openrouter.listByPrefixAndExpiry = async () => [
      {
        leaseId: "b".repeat(24),
        memberId: "content",
        hash: "active-key",
        expiresAt: "2026-07-26T13:00:00.000Z",
      },
    ];
    assert.deepEqual(
      await discoverExpiredLeases(config(), fake, fixedNow()),
      [],
    );
  });

  it("fails closed for malformed handles and undeclared inference", async () => {
    const malformed = providers([]);
    malformed.neon.listByPrefixAndExpiry = async () => [
      {
        leaseId: "not-a-controller-lease",
        branchId: "branch",
        expiresAt: "2026-07-26T11:00:00.000Z",
      },
    ];
    await assert.rejects(
      discoverExpiredLeases(config(), malformed, fixedNow()),
      /invalid trusted acceptance lease id/,
    );

    const undeclaredInference = providers([]);
    undeclaredInference.neon.listByPrefixAndExpiry = async () => [
      {
        leaseId: "f".repeat(24),
        branchId: "branch",
        expiresAt: "2026-07-26T11:00:00.000Z",
      },
    ];
    undeclaredInference.openrouter.listByPrefixAndExpiry = async () => [
      {
        leaseId: "f".repeat(24),
        memberId: "content",
        hash: "unexpected-key",
        expiresAt: "2026-07-26T11:00:00.000Z",
      },
    ];
    await assert.rejects(
      discoverExpiredLeases(
        config({
          members: [{ ...config().members[0]!, needsInference: false }],
        }),
        undeclaredInference,
        fixedNow(),
      ),
      /invalid trusted acceptance lease member/,
    );
  });

  it("reconstructs partial expired leases so stranded resources remain reapable", async () => {
    const missingMember = providers([]);
    missingMember.neon.listByPrefixAndExpiry = async (projectId) =>
      projectId === "declared-neon-project"
        ? [
            {
              leaseId: "1".repeat(24),
              branchId: "content-branch",
              expiresAt: "2026-07-26T11:00:00.000Z",
            },
          ]
        : [];
    missingMember.openrouter.listByPrefixAndExpiry = async () => [
      {
        leaseId: "1".repeat(24),
        memberId: "content",
        hash: "opaque-key-hash",
        expiresAt: "2026-07-26T11:00:00.000Z",
      },
    ];
    const discovered = await discoverExpiredLeases(
      config({
        members: [
          config().members[0]!,
          {
            id: "calendar",
            origin: "https://calendar.acceptance.example.test",
            neonProjectId: "declared-neon-project-2",
            neonDatabaseName: "declared-database-2",
            neonRoleName: "declared-role-2",
            netlifyAccountId: "declared-netlify-account",
            netlifySiteId: "declared-netlify-site-2",
            needsInference: false,
          },
        ],
      }),
      missingMember,
      fixedNow(),
    );
    assert.equal(discovered[0]?.members[0]?.neonBranchId, "content-branch");
    assert.equal(discovered[0]?.members[1]?.neonBranchId, undefined);

    const orphanKey = providers([]);
    orphanKey.openrouter.listByPrefixAndExpiry = async () => [
      {
        leaseId: "d".repeat(24),
        memberId: "content",
        hash: "orphan-key",
        expiresAt: "2026-07-26T11:00:00.000Z",
      },
    ];
    assert.equal(
      (await discoverExpiredLeases(config(), orphanKey, fixedNow()))[0]
        ?.members[0]?.inferenceKeyHash,
      "orphan-key",
    );
  });

  it("never deletes site state for a markerless branch-only recovery", async () => {
    const log: string[] = [];
    const fake = providers(log);
    fake.neon.listByPrefixAndExpiry = async () => [
      {
        leaseId: "9".repeat(24),
        branchId: "branch-only",
        expiresAt: "2026-07-26T11:00:00.000Z",
      },
    ];
    const discovered = await discoverExpiredLeases(config(), fake, fixedNow());
    assert.equal(discovered[0]?.members[0]?.runtimeOwned, false);
    const authority = new DisposableRuntimeAuthority(config(), fake, fixedNow);
    await authority.reapExpired(discovered);
    assert.equal(
      log.some((entry) => entry.startsWith("netlify:")),
      false,
    );
    assert.equal(
      log.includes("neon:delete:declared-neon-project:branch-only"),
      true,
    );
  });

  it("discovers a stranded lease from Netlify markers and protects a newer active owner", async () => {
    const markerOnly = providers([]);
    markerOnly.netlify.readLeaseMarker = async () => ({
      leaseId: "2".repeat(24),
      expiresAt: "2026-07-26T11:00:00.000Z",
    });
    const discovered = await discoverExpiredLeases(
      config(),
      markerOnly,
      fixedNow(),
    );
    assert.equal(discovered[0]?.id, "2".repeat(24));
    assert.equal(discovered[0]?.members[0]?.neonBranchId, undefined);

    const conflicting = providers([]);
    conflicting.neon.listByPrefixAndExpiry = async () => [
      {
        leaseId: "3".repeat(24),
        branchId: "expired-branch",
        expiresAt: "2026-07-26T11:00:00.000Z",
      },
    ];
    conflicting.netlify.readLeaseMarker = async () => ({
      leaseId: "4".repeat(24),
      expiresAt: "2026-07-26T13:00:00.000Z",
    });
    await assert.rejects(
      discoverExpiredLeases(config(), conflicting, fixedNow()),
      /active lease owns the workspace/,
    );
  });

  for (const [name, prepare, message] of [
    [
      "duplicate branches",
      (fake: RuntimeProviders) => {
        fake.neon.listByPrefixAndExpiry = async () => [
          {
            leaseId: "c".repeat(24),
            branchId: "one",
            expiresAt: "2026-07-26T11:00:00.000Z",
          },
          {
            leaseId: "c".repeat(24),
            branchId: "two",
            expiresAt: "2026-07-26T11:00:00.000Z",
          },
        ];
      },
      /duplicate branches/,
    ],
    [
      "inconsistent expiries",
      (fake: RuntimeProviders) => {
        fake.neon.listByPrefixAndExpiry = async () => [
          {
            leaseId: "e".repeat(24),
            branchId: "expired-branch",
            expiresAt: "2026-07-26T11:00:00.000Z",
          },
        ];
        fake.openrouter.listByPrefixAndExpiry = async () => [
          {
            leaseId: "e".repeat(24),
            memberId: "content",
            hash: "expired-key",
            expiresAt: "2026-07-26T11:02:00.000Z",
          },
        ];
      },
      /inconsistent provider expiries/,
    ],
  ] as const) {
    it(`fails closed for ${name}`, async () => {
      const fake = providers([]);
      prepare(fake);
      await assert.rejects(
        discoverExpiredLeases(config(), fake, fixedNow()),
        message,
      );
    });
  }

  it("rejects non-allowlisted candidate configuration before any provider work", () => {
    assert.throws(
      () =>
        new DisposableRuntimeAuthority(
          config({ maxInferenceUsd: 2 }),
          providers([]),
          fixedNow,
        ),
      /tiny USD cap/,
    );
    assert.throws(
      () =>
        new DisposableRuntimeAuthority(
          config({
            members: [
              {
                id: "content",
                origin: "https://content.acceptance.example.test",
                neonProjectId: "",
                neonDatabaseName: "declared-database",
                neonRoleName: "declared-role",
                netlifyAccountId: "declared-netlify-account",
                netlifySiteId: "declared-netlify-site",
                needsInference: false,
              },
            ],
          }),
          providers([]),
          fixedNow,
        ),
      /invalid or duplicate/,
    );
    assert.throws(
      () =>
        new DisposableRuntimeAuthority(
          config({
            members: [
              config().members[0]!,
              {
                ...config().members[0]!,
                id: "calendar",
                netlifySiteId: "another-site",
              },
            ],
          }),
          providers([]),
          fixedNow,
        ),
      /invalid or duplicate/,
    );
  });

  it("uses the fixed Neon endpoint and only declared project ids", async () => {
    const requests: string[] = [];
    const fetch = async (input: string) => {
      requests.push(input);
      return new Response(
        JSON.stringify(
          input.includes("connection_uri")
            ? { uri: "postgres://transient-value" }
            : { branch: { id: "branch-handle" } },
        ),
        { status: 200 },
      );
    };
    const neon = new NeonBranches(fetch, "injected-management-token");
    const branchId = await neon.createBranch(
      "declared-neon-project",
      "lease",
      "2026-07-26T13:00:00.000Z",
    );
    await neon.getConnectionUri(
      "declared-neon-project",
      "declared-database",
      "declared-role",
      branchId,
    );
    assert.equal(
      requests[0],
      "https://console.neon.tech/api/v2/projects/declared-neon-project/branches",
    );
  });

  it("reads every bounded Neon cursor page and rejects cursor cycles", async () => {
    const requests: string[] = [];
    const neon = new NeonBranches(async (input) => {
      requests.push(input);
      if (input.includes("cursor=page-2"))
        return Response.json({
          branches: [
            {
              id: "page-two-branch",
              name: `trusted-acceptance-${"7".repeat(24)}`,
              expires_at: "2026-07-26T11:00:00.000Z",
            },
          ],
          pagination: {},
        });
      return Response.json({ branches: [], pagination: { next: "page-2" } });
    }, "injected-management-token");
    assert.deepEqual(
      await neon.listByPrefixAndExpiry("declared-neon-project"),
      [
        {
          leaseId: "7".repeat(24),
          branchId: "page-two-branch",
          expiresAt: "2026-07-26T11:00:00.000Z",
        },
      ],
    );
    assert.equal(requests.length, 2);
    assert.match(requests[1]!, /cursor=page-2/);

    const cycling = new NeonBranches(
      async () => Response.json({ branches: [], pagination: { next: "same" } }),
      "injected-management-token",
    );
    await assert.rejects(
      cycling.listByPrefixAndExpiry("declared-neon-project"),
      /repeated pagination cursor/,
    );
  });

  it("reads every bounded OpenRouter offset page", async () => {
    const requests: string[] = [];
    const keys = new OpenRouterKeys(async (input) => {
      requests.push(input);
      const offset = new URL(input).searchParams.get("offset");
      if (offset === "100")
        return Response.json({
          data: [
            {
              name: `trusted-acceptance-${"6".repeat(24)}-content`,
              hash: "page-two-key",
              expires_at: "2026-07-26T11:00:00.000Z",
            },
          ],
        });
      return Response.json({
        data: Array.from({ length: 100 }, (_, index) => ({
          name: `unrelated-key-${index}`,
        })),
      });
    }, "injected-management-token");
    assert.deepEqual(await keys.listByPrefixAndExpiry(), [
      {
        leaseId: "6".repeat(24),
        memberId: "content",
        hash: "page-two-key",
        expiresAt: "2026-07-26T11:00:00.000Z",
      },
    ]);
    assert.equal(requests.length, 2);
    assert.equal(new URL(requests[0]!).searchParams.get("offset"), "0");
    assert.equal(new URL(requests[1]!).searchParams.get("offset"), "100");
    assert.equal(
      new URL(requests[0]!).searchParams.get("include_disabled"),
      "true",
    );

    let boundedRequests = 0;
    const bounded = new OpenRouterKeys(async () => {
      boundedRequests += 1;
      return Response.json({
        data: Array.from({ length: 100 }, (_, index) => ({
          name: `unrelated-key-${index}`,
        })),
      });
    }, "injected-management-token");
    await assert.rejects(bounded.listByPrefixAndExpiry(), /bounded page limit/);
    assert.equal(boundedRequests, 100);
  });

  it("persists redacted events in order using the injected clock", async () => {
    const saved: RuntimeLease[] = [];
    const authority = new DisposableRuntimeAuthority(
      config(),
      providers([]),
      fixedNow,
      {
        async save(lease) {
          saved.push(JSON.parse(JSON.stringify(lease)));
        },
      },
    );
    await authority.acquire(60_000);
    assert.equal(saved[0]?.state, "acquiring");
    assert.equal(saved[1]?.journal[0]?.phase, "before");
    assert.equal(saved[1]?.journal[0]?.at, "2026-07-26T12:00:00.000Z");
    assert.equal(
      JSON.stringify(saved).includes("postgres://transient-value"),
      false,
    );
  });

  it("records distinct opaque tombstone deploy receipts per member", async () => {
    const twoMembers = config({
      members: [
        config().members[0]!,
        {
          id: "calendar",
          origin: "https://calendar.acceptance.example.test",
          neonProjectId: "declared-neon-project-2",
          neonDatabaseName: "declared-database",
          neonRoleName: "declared-role",
          netlifyAccountId: "declared-netlify-account",
          netlifySiteId: "declared-netlify-site-2",
          needsInference: false,
        },
      ],
    });
    const authority = new DisposableRuntimeAuthority(
      twoMembers,
      providers([]),
      fixedNow,
    );
    const { lease } = await authority.acquire(60_000);
    await authority.revoke(lease);
    assert.deepEqual(
      lease.members.map((member) => member.tombstoneDeployId),
      ["deploy-declared-netlify-site", "deploy-declared-netlify-site-2"],
    );
  });

  it("uses documented OpenRouter and Netlify request shapes", async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const fetch = async (input: string, init?: RequestInit) => {
      requests.push({ input, init });
      if (init?.method === "POST")
        return new Response(
          JSON.stringify({
            key: "injected-transient-inference-value",
            data: { hash: "opaque-key-hash" },
          }),
          { status: 200 },
        );
      if (init?.method === "PATCH") return new Response("", { status: 200 });
      return new Response(
        JSON.stringify({ data: { hash: "opaque-key-hash", disabled: true } }),
        { status: 200 },
      );
    };
    const keys = new OpenRouterKeys(fetch, "injected-management-token");
    await keys.create("lease-id", "content", "2026-07-26T13:00:00.000Z", 0.01);
    await keys.disableByHash("opaque-key-hash");
    assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
      name: "trusted-acceptance-lease-id-content",
      limit: 0.01,
      limit_reset: null,
      expires_at: "2026-07-26T13:00:00.000Z",
    });
    assert.equal(requests[1]?.init?.method, "PATCH");

    const netlifyRequests: Array<{ input: string; init?: RequestInit }> = [];
    const netlify = new NetlifyRuntime(async (input, init) => {
      netlifyRequests.push({ input, init });
      if (init?.method === "POST")
        return new Response(JSON.stringify({ id: "opaque-deploy-id" }), {
          status: 200,
        });
      if (input.includes("/deploys/"))
        return new Response(JSON.stringify({ state: "ready" }), {
          status: 200,
        });
      return new Response(
        JSON.stringify({ published_deploy: { id: "opaque-deploy-id" } }),
        { status: 200 },
      );
    }, "injected-management-token");
    const receipt = await netlify.deployTombstoneAndVerify(
      "declared-netlify-site",
      config().tombstone,
    );
    assert.deepEqual(receipt, { deployId: "opaque-deploy-id" });
    assert.equal(
      netlifyRequests[0]?.init?.headers &&
        new Headers(netlifyRequests[0].init.headers).get("content-type"),
      "application/zip",
    );
  });

  it("uses account-scoped Netlify environment APIs and readable lease markers", async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    let markerPresent = false;
    const netlify = new NetlifyRuntime(async (input, init) => {
      requests.push({ input, init });
      if (init?.method === "POST") {
        markerPresent = true;
        return new Response("[]", { status: 201 });
      }
      if (init?.method === "DELETE") {
        markerPresent = false;
        return new Response(null, { status: 204 });
      }
      if (markerPresent)
        return new Response(
          JSON.stringify({
            values: [
              {
                context: "production",
                value: JSON.stringify({
                  leaseId: "a".repeat(24),
                  expiresAt: "2026-07-26T13:00:00.000Z",
                }),
              },
            ],
          }),
          { status: 200 },
        );
      return new Response("", { status: 404 });
    }, "injected-management-token");
    await netlify.setRuntime("account", "site", {
      AGENT_NATIVE_ACCEPTANCE_LEASE_MARKER: JSON.stringify({
        leaseId: "a".repeat(24),
        expiresAt: "2026-07-26T13:00:00.000Z",
      }),
    });
    assert.equal(
      requests[0]?.input,
      `https://api.netlify.com/api/v1/accounts/account/env/AGENT_NATIVE_ACCEPTANCE_LEASE_MARKER?site_id=site`,
    );
    assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), [
      {
        key: "AGENT_NATIVE_ACCEPTANCE_LEASE_MARKER",
        scopes: ["functions", "runtime"],
        values: [
          {
            value: JSON.stringify({
              leaseId: "a".repeat(24),
              expiresAt: "2026-07-26T13:00:00.000Z",
            }),
            context: "production",
          },
        ],
        is_secret: false,
      },
    ]);
    assert.deepEqual(await netlify.readLeaseMarker("account", "site"), {
      leaseId: "a".repeat(24),
      expiresAt: "2026-07-26T13:00:00.000Z",
    });
    await netlify.removeRuntime("account", "site", [
      "AGENT_NATIVE_ACCEPTANCE_LEASE_MARKER",
    ]);
    assert.equal(requests.at(-1)?.init?.method, undefined);
  });

  it("refuses to overwrite pre-existing acceptance runtime variables", async () => {
    const netlify = new NetlifyRuntime(
      async () => Response.json({ values: [{ context: "all" }] }),
      "injected-management-token",
    );
    await assert.rejects(
      netlify.setRuntime("account", "site", {
        DATABASE_URL: "postgres://disposable",
      }),
      /refusing to overwrite/,
    );
  });

  it("updates an existing acceptance runtime variable through the per-key endpoint", async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const netlify = new NetlifyRuntime(async (input, init) => {
      requests.push({ input, init });
      return init?.method === "PUT"
        ? new Response(null, { status: 200 })
        : Response.json({ values: [{ context: "production" }] });
    }, "injected-management-token");
    await netlify.setRuntime(
      "account",
      "site",
      { AGENT_NATIVE_ACCEPTANCE_DIRECTORY_SCENARIO: "withdraw-member" },
      true,
    );
    assert.equal(requests[1]?.init?.method, "PUT");
    assert.equal(
      requests[1]?.input,
      "https://api.netlify.com/api/v1/accounts/account/env/AGENT_NATIVE_ACCEPTANCE_DIRECTORY_SCENARIO?site_id=site",
    );
    assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
      key: "AGENT_NATIVE_ACCEPTANCE_DIRECTORY_SCENARIO",
      scopes: ["functions", "runtime"],
      values: [{ value: "withdraw-member", context: "production" }],
      is_secret: true,
    });
  });

  it("settles every parallel runtime deletion before reporting a failure", async () => {
    let releaseDelayed: (() => void) | undefined;
    const delayed = new Promise<void>((resolve) => {
      releaseDelayed = resolve;
    });
    const netlify = new NetlifyRuntime(async (input, init) => {
      if (init?.method !== "DELETE") return new Response(null, { status: 404 });
      if (input.includes("FIRST_KEY"))
        throw new Error("injected deletion failure");
      await delayed;
      return new Response(null, { status: 204 });
    }, "injected-management-token");
    const removal = netlify.removeRuntime("account", "site", [
      "FIRST_KEY",
      "DELAYED_KEY",
    ]);
    let settled = false;
    void removal
      .finally(() => {
        settled = true;
      })
      .catch(() => undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    releaseDelayed?.();
    await assert.rejects(removal, /injected deletion failure/);
    assert.equal(settled, true);
  });

  it("binds the declared acceptance origin to the exact Netlify site before mutation", async () => {
    const netlify = new NetlifyRuntime(async (input) => {
      if (input.endsWith("/sites/site"))
        return Response.json({
          id: "site",
          ssl_url: "https://content.acceptance.example.test",
        });
      return new Response(null, { status: 404 });
    }, "injected-management-token");
    await netlify.assertSiteReady(
      "account",
      "site",
      "https://content.acceptance.example.test",
      ["DATABASE_URL"],
    );
    await assert.rejects(
      netlify.assertSiteReady(
        "account",
        "site",
        "https://other.acceptance.example.test",
        ["DATABASE_URL"],
      ),
      /does not match/,
    );
  });
});
