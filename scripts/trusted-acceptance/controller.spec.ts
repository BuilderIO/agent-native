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
    assert.match(workflow, /Acquire one whole-workspace disposable lease/);
    assert.match(workflow, /Revoke one whole-workspace disposable lease/);
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
