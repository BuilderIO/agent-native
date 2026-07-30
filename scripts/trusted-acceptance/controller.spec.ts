import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  assertRedacted,
  executeTrustedAcceptance,
  reapTrustedAcceptanceLeases,
  settleBeforeCleanup,
  updateTrustedAcceptanceDirectoryScenario,
  validateTrustedAuthorityProfile,
  type TrustedAuthorityProfile,
} from "./controller.ts";

const tombstoneZip = Buffer.from("AQ==", "base64");
const tombstone = {
  sha256: createHash("sha256").update(tombstoneZip).digest("hex"),
  zipBase64: tombstoneZip.toString("base64"),
};
function profile(): TrustedAuthorityProfile {
  return {
    version: 1,
    workspace: "calendar-content",
    enabled: true,
    leasePrefix: "trusted-acceptance-",
    runtime: {
      maxInferenceUsd: 0.01,
      tombstone: { ...tombstone },
      members: [
        {
          id: "calendar",
          origin: "https://calendar.acceptance.example.test",
          neonProjectId: "project",
          neonDatabaseName: "main",
          neonRoleName: "owner",
          netlifyAccountId: "account",
          netlifySiteId: "site",
          needsInference: false,
        },
      ],
    },
    members: [
      {
        id: "calendar",
        origin: "https://calendar.acceptance.example.test",
        artifactDirectory: "calendar",
      },
    ],
  };
}
function providers() {
  return {
    neon: {
      async createBranch() {
        return "trusted-acceptance-branch";
      },
      async getConnectionUri() {
        return "postgresql://secret@example.test/db";
      },
      async deleteAndVerify() {
        return true;
      },
      async listByPrefixAndExpiry() {
        return [];
      },
    },
    openrouter: {
      async create() {
        return { plaintext: "sk-secret", hash: "opaque-hash" };
      },
      async disableByHash() {
        return true;
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
      async setRuntime() {},
      async removeRuntime() {
        return true;
      },
      async deployTombstoneAndVerify() {
        return { deployId: "tombstone" };
      },
      async readLeaseMarker() {
        return undefined;
      },
    },
  };
}

function directoryFixture() {
  return {
    origin: "https://directory.acceptance.example.test",
    netlifyAccountId: "directory-account",
    netlifySiteId: "directory-site",
    orgDomain: "agent-native.acceptance.invalid",
    members: [
      {
        id: "calendar",
        name: "Calendar",
        url: "https://calendar.acceptance.example.test",
        a2aUrl: "https://calendar.acceptance.example.test",
      },
    ],
    withdrawnMemberId: "calendar",
    artifactDirectory: "trusted-directory",
    artifactSha256: "b".repeat(64),
  };
}

describe("trusted acceptance controller", () => {
  it("keeps the protected controller and independent reaper main-pinned and fail-closed", () => {
    const workflow = readFileSync(
      ".github/workflows/trusted-acceptance.yml",
      "utf8",
    );
    const reaper = readFileSync(
      ".github/workflows/trusted-acceptance-reaper.yml",
      "utf8",
    );
    assert.match(workflow, /RUN_REF" != "refs\/heads\/main"/);
    assert.match(workflow, /environment: trusted-acceptance/);
    assert.match(
      workflow,
      /Verify every artifact provenance before credentials/,
    );
    assert.match(
      workflow,
      /Run trusted hosted OAuth, harness, deployment, and cleanup/,
    );
    assert.match(workflow, /run-hosted-acceptance\.ts/);
    assert.match(
      workflow,
      /Revoke one whole-workspace disposable lease after interruption/,
    );
    assert.match(workflow, /if: \$\{\{ always\(\) \}\}/);
    assert.match(workflow, /persist-credentials: false/);
    assert.match(reaper, /schedule:/);
    assert.match(reaper, /workflow_dispatch:/);
    assert.match(reaper, /cancel-in-progress: false/);
    assert.match(reaper, /controller\.ts reap/);
    assert.doesNotMatch(reaper, /pull_request|path: candidate/);
  });

  it("rejects profiles that could carry credentials or non-allowlisted resources", () => {
    const unsafe = profile() as TrustedAuthorityProfile & { apiToken?: string };
    unsafe.apiToken = "not-allowed";
    assert.match(
      validateTrustedAuthorityProfile(unsafe).join("\n"),
      /apiToken/,
    );
    const productionOrigin = profile();
    productionOrigin.members[0]!.origin =
      "https://calendar.production.example.test";
    assert.match(
      validateTrustedAuthorityProfile(productionOrigin).join("\n"),
      /unsafe acceptance origin/,
    );
    const mismatched = profile();
    mismatched.runtime.tombstone.sha256 = "a".repeat(64);
    assert.match(
      validateTrustedAuthorityProfile(mismatched).join("\n"),
      /does not match/,
    );
    assert.throws(
      () =>
        assertRedacted({ handle: "postgresql://user:pass@example.test/db" }),
      /secret material/,
    );
    const mismatchedOrigin = profile();
    mismatchedOrigin.runtime.members[0]!.origin =
      "https://other.acceptance.example.test";
    assert.match(
      validateTrustedAuthorityProfile(mismatchedOrigin).join("\n"),
      /origin must match/,
    );
    const unknown = profile() as TrustedAuthorityProfile & { note?: string };
    unknown.note = "surprise";
    assert.match(
      validateTrustedAuthorityProfile(unknown).join("\n"),
      /not allowed/,
    );
    const credentialValue = profile();
    credentialValue.runtime.members[0]!.neonProjectId =
      "sk-credential-looking-value";
    assert.match(
      validateTrustedAuthorityProfile(credentialValue).join("\n"),
      /credential-shaped/,
    );
    const fixture = profile();
    fixture.directoryFixture = directoryFixture();
    assert.deepEqual(validateTrustedAuthorityProfile(fixture), []);
    fixture.directoryFixture.netlifySiteId = "site";
    assert.match(
      validateTrustedAuthorityProfile(fixture).join("\n"),
      /duplicates an app Netlify site/,
    );
    const arbitraryTarget = profile();
    arbitraryTarget.directoryFixture = directoryFixture();
    arbitraryTarget.directoryFixture.members[0]!.url =
      "https://attacker.acceptance.example.test";
    assert.match(
      validateTrustedAuthorityProfile(arbitraryTarget).join("\n"),
      /exactly match a declared app origin/,
    );
  });

  it("exposes an in-process controller seam that changes only the fixed directory scenario", async () => {
    const trusted = profile();
    trusted.directoryFixture = directoryFixture();
    const lease = {
      id: "a".repeat(24),
      createdAt: "2026-07-26T00:00:00.000Z",
      expiresAt: "2026-07-26T01:00:00.000Z",
      state: "active" as const,
      members: [
        { memberId: "calendar", netlifySiteId: "site", runtimeOwned: true },
      ],
      directoryFixture: {
        netlifySiteId: "directory-site",
        runtimeOwned: true,
        scenario: "stable" as const,
      },
      journal: [],
      verification: {
        inferenceDisabled: false,
        runtimeVariablesAbsent: false,
        tombstoneActive: false,
        branchesDeleted: false,
      },
    };
    const writes: Array<Record<string, string>> = [];
    const injected = providers();
    injected.netlify.setRuntime = async (_account, site, values) => {
      assert.equal(site, "directory-site");
      writes.push(values);
    };
    const result = await updateTrustedAcceptanceDirectoryScenario(
      trusted,
      lease,
      injected,
      () => new Date("2026-07-26T00:00:00.000Z"),
      { async save() {} },
    );
    assert.equal(result.directoryFixture?.scenario, "withdraw-member");
    assert.deepEqual(writes, [
      { AGENT_NATIVE_ACCEPTANCE_DIRECTORY_SCENARIO: "withdraw-member" },
    ]);
  });

  it("persists only redacted journals and receipts after every authority mutation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trusted-acceptance-"));
    const journalFile = join(dir, "lease.json");
    const receiptFile = join(dir, "receipt.json");
    const receipt = await executeTrustedAcceptance(profile(), {
      providers: providers(),
      journalFile,
      receiptFile,
      ttlMs: 60_000,
      expectedAssertionIds: ["stable", "withdrawn"],
      async deployArtifact() {},
      async runStableHarness() {
        return [{ assertionId: "stable", status: "passed" }];
      },
      async runWithdrawalHarness() {
        return [{ assertionId: "withdrawn", status: "passed" }];
      },
      now: () => new Date("2026-07-26T00:00:00.000Z"),
    });
    assert.equal(receipt.result, "passed");
    const output = `${await readFile(journalFile, "utf8")}${await readFile(receiptFile, "utf8")}`;
    assert(!output.includes("postgresql://secret"));
    assert(!output.includes("sk-secret"));
    assert.equal(receipt.lease?.state, "revoked");
    assert.equal(receipt.lease?.members[0]?.tombstoneDeployId, "tombstone");
  });

  it("cannot pass cleanup without a directory fixture tombstone receipt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trusted-acceptance-directory-"));
    const trusted = profile();
    trusted.directoryFixture = directoryFixture();
    const injected = providers();
    injected.netlify.deployTombstoneAndVerify = async (siteId) =>
      siteId === "directory-site"
        ? { deployId: "" }
        : { deployId: "member-tombstone" };
    await assert.rejects(
      executeTrustedAcceptance(trusted, {
        providers: injected,
        journalFile: join(dir, "lease.json"),
        receiptFile: join(dir, "receipt.json"),
        ttlMs: 60_000,
        expectedAssertionIds: ["stable", "withdrawn"],
        async deployArtifact() {},
        async deployDirectoryArtifact() {},
        async runStableHarness() {
          return [{ assertionId: "stable", status: "passed" }];
        },
        async runWithdrawalHarness() {
          return [{ assertionId: "withdrawn", status: "passed" }];
        },
      }),
      /cleanup verification failed/,
    );
  });

  it("cannot pass a controller receipt with missing harness evidence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trusted-acceptance-empty-"));
    const receipt = await executeTrustedAcceptance(profile(), {
      providers: providers(),
      journalFile: join(dir, "lease.json"),
      receiptFile: join(dir, "receipt.json"),
      ttlMs: 60_000,
      expectedAssertionIds: ["required"],
      async deployArtifact() {},
      async runStableHarness() {
        return [];
      },
      async runWithdrawalHarness() {
        return [];
      },
    });
    assert.equal(receipt.result, "failed");
  });

  it("revokes the lease when the hosted harness exceeds its deadline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trusted-acceptance-timeout-"));
    const receiptFile = join(dir, "receipt.json");
    await assert.rejects(
      executeTrustedAcceptance(profile(), {
        providers: providers(),
        journalFile: join(dir, "lease.json"),
        receiptFile,
        ttlMs: 60_000,
        harnessTimeoutMs: 5,
        expectedAssertionIds: ["required"],
        async deployArtifact() {},
        async runStableHarness(_lease, signal) {
          return new Promise((_, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            }),
          );
        },
        async runWithdrawalHarness() {
          return [];
        },
      }),
      /timed out/,
    );
    const receipt = JSON.parse(await readFile(receiptFile, "utf8")) as {
      result: string;
      lease?: { state?: string };
    };
    assert.equal(receipt.result, "failed");
    assert.equal(receipt.lease?.state, "revoked");
  });

  it("writes a failed receipt when the post-cleanup probe exceeds its deadline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trusted-post-cleanup-timeout-"));
    const receiptFile = join(dir, "receipt.json");
    await assert.rejects(
      executeTrustedAcceptance(profile(), {
        providers: providers(),
        journalFile: join(dir, "lease.json"),
        receiptFile,
        ttlMs: 60_000,
        postCleanupTimeoutMs: 5,
        expectedAssertionIds: ["stable", "withdrawn", "post-cleanup"],
        async deployArtifact() {},
        async runStableHarness() {
          return [{ assertionId: "stable", status: "passed" }];
        },
        async runWithdrawalHarness() {
          return [{ assertionId: "withdrawn", status: "passed" }];
        },
        async runPostCleanupHarness(_lease, signal) {
          return new Promise((_, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            }),
          );
        },
      }),
      /timed out/,
    );
    const receipt = JSON.parse(await readFile(receiptFile, "utf8")) as {
      result: string;
      lease?: { state?: string };
    };
    assert.equal(receipt.result, "failed");
    assert.equal(receipt.lease?.state, "revoked");
  });

  it("settles an accepted late deploy before placing the cleanup tombstone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trusted-acceptance-barrier-"));
    const events: string[] = [];
    const runtimeProviders = providers();
    runtimeProviders.netlify.deployTombstoneAndVerify = async () => {
      events.push("tombstone");
      return { deployId: "tombstone" };
    };
    await assert.rejects(
      executeTrustedAcceptance(profile(), {
        providers: runtimeProviders,
        journalFile: join(dir, "lease.json"),
        receiptFile: join(dir, "receipt.json"),
        ttlMs: 60_000,
        harnessTimeoutMs: 5,
        expectedAssertionIds: ["required"],
        async deployArtifact() {},
        async runStableHarness() {
          return [];
        },
        async runWithdrawalHarness(_lease, signal) {
          const lateDeploy = new Promise<void>((resolve) =>
            setTimeout(() => {
              events.push("late-deploy-settled");
              resolve();
            }, 20),
          );
          await settleBeforeCleanup([lateDeploy], signal);
          return [];
        },
      }),
      /timed out/,
    );
    assert.deepEqual(events, ["late-deploy-settled", "tombstone"]);
  });

  it("reaps only deterministic acceptance leases through an injected discovery seam", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trusted-acceptance-"));
    const expired = {
      id: "trusted-acceptance-expired",
      createdAt: "2026-07-25T00:00:00.000Z",
      expiresAt: "2026-07-25T00:01:00.000Z",
      state: "active" as const,
      members: [
        { memberId: "calendar", netlifySiteId: "site", neonBranchId: "branch" },
      ],
      journal: [],
      verification: {
        inferenceDisabled: false,
        runtimeVariablesAbsent: false,
        tombstoneActive: false,
        branchesDeleted: false,
      },
    };
    const result = await reapTrustedAcceptanceLeases(profile(), {
      providers: providers(),
      journalFile: join(dir, "reaper.json"),
      discoverLeases: async (prefix) => {
        assert.equal(prefix, "trusted-acceptance-");
        return [expired];
      },
      now: () => new Date("2026-07-26T00:00:00.000Z"),
    });
    assert.equal(result[0]?.state, "revoked");
  });
});
