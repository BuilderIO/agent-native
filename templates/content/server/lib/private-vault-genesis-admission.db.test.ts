import { rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ancV1Hash,
  ancV1HexToBytes,
  ancV1SigningKeypairFromSeed,
  createEndpointRequestProof,
  decodeAncV1GenesisAccountAdmissionCandidate,
  decodeAncV1GenesisAccountAdmissionChallenge,
  decodeAncV1GenesisAccountAdmissionReceipt,
  decodeAncV1GenesisAuthorization,
  decodeAncV1GenesisBootstrapTranscript,
  decodeSignedControlLogEntry,
  encodeAncV1GenesisAccountAdmissionCandidate,
  encodeAncV1GenesisAccountAdmissionChallenge,
  encodeAncV1GenesisAccountAdmissionRequest,
  encodeAncV1GenesisBootstrapTranscript,
} from "@agent-native/core/e2ee";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrivateVaultGenesisAccountScope } from "./private-vault-genesis-account-scope.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `private-vault-genesis-admission-${process.pid}-${Date.now()}.sqlite`,
);
const NOW = new Date("2026-07-18T12:00:00.000Z");
const OWNER_SCOPE: PrivateVaultGenesisAccountScope = {
  subjectId: "stable-user-1",
  ownerEmail: "genesis-owner@example.test",
  orgId: "org-genesis-admission",
  role: "member",
  accountId: `account:${"a".repeat(64)}`,
  workspaceId: `workspace:${"b".repeat(64)}`,
};

let getDb: (typeof import("../db/index.js"))["getDb"];
let dbExec: ReturnType<(typeof import("@agent-native/core/db"))["getDbExec"]>;
let schema: typeof import("../db/schema.js");
let issueChallenge: (typeof import("./private-vault-genesis-admission.js"))["issuePrivateVaultGenesisChallenge"];
let admitGenesis: (typeof import("./private-vault-genesis-admission.js"))["admitPrivateVaultGenesis"];
let deleteExpiredChallenges: (typeof import("./private-vault-genesis-admission.js"))["deleteExpiredPrivateVaultGenesisChallenges"];
let resolveGenesisScope: (typeof import("./private-vault-genesis-account-scope.js"))["resolvePrivateVaultGenesisAccountScope"];
let resolveStableVaultScope: (typeof import("./private-vault-genesis-account-scope.js"))["resolvePrivateVaultScopeForStableIdentity"];

async function seedAuthority(scope: PrivateVaultGenesisAccountScope) {
  await dbExec.execute({
    sql: `INSERT INTO "user" (id, email) VALUES (?, ?)
          ON CONFLICT(id) DO UPDATE SET email = excluded.email`,
    args: [scope.subjectId, scope.ownerEmail],
  });
  await dbExec.execute({
    sql: `INSERT INTO org_members (id, org_id, email, role, joined_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET org_id = excluded.org_id,
            email = excluded.email, role = excluded.role`,
    args: [
      `membership:${scope.subjectId}:${scope.orgId}`,
      scope.orgId,
      scope.ownerEmail,
      scope.role,
      Date.now(),
    ],
  });
}

async function fixtureCandidate() {
  const fixtureUrl = new URL(
    "../../../../packages/core/src/e2ee/fixtures/anc-v1-native-genesis-authorization-vectors.json",
    import.meta.url,
  );
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as {
    positiveCases: Array<{
      bootstrapTranscriptHex: string;
      recoveryConfirmationHex: string;
      authorizationHex: string;
    }>;
  };
  const exact = fixture.positiveCases[0]!;
  return encodeAncV1GenesisAccountAdmissionCandidate({
    suite: "anc/v1",
    version: 1,
    type: "genesis-account-admission-candidate",
    bootstrapTranscript: ancV1HexToBytes(exact.bootstrapTranscriptHex),
    recoveryConfirmation: ancV1HexToBytes(exact.recoveryConfirmationHex),
    authorization: ancV1HexToBytes(exact.authorizationHex),
  });
}

async function endpointSigningPrivateKey() {
  const seed = await ancV1Hash(
    "recovery",
    new TextEncoder().encode(
      "agent-native synthetic genesis authorization vector endpoint signing",
    ),
  );
  return (await ancV1SigningKeypairFromSeed(seed)).privateKey;
}

async function admissionRequest(input: {
  scope?: PrivateVaultGenesisAccountScope;
  candidate?: Uint8Array;
  now?: Date;
  signingPrivateKey?: Uint8Array;
  nonce?: string;
}) {
  const scope = input.scope ?? OWNER_SCOPE;
  const candidate = input.candidate ?? (await fixtureCandidate());
  const now = input.now ?? NOW;
  const challenge = await issueChallenge({ scope, candidate, now });
  const body = encodeAncV1GenesisAccountAdmissionRequest({
    suite: "anc/v1",
    version: 1,
    type: "genesis-account-admission-request",
    candidate,
    challenge,
  });
  const bootstrap = decodeAncV1GenesisBootstrapTranscript(
    decodeAncV1GenesisAccountAdmissionCandidate(candidate).bootstrapTranscript,
  );
  const proof = await createEndpointRequestProof({
    vaultId: Buffer.from(bootstrap.vaultId).toString("hex"),
    endpointId: Buffer.from(bootstrap.endpointId).toString("hex"),
    method: "POST",
    path: "/api/private-vault/genesis/admit",
    body,
    issuedAt: now.toISOString(),
    nonce: input.nonce ?? "88".repeat(16),
    signingPrivateKey:
      input.signingPrivateKey ?? (await endpointSigningPrivateKey()),
  });
  return { scope, candidate, challenge, body, proof, now };
}

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  process.env.CONTENT_PRIVATE_VAULT_GENESIS_CHALLENGE_SECRET = "c0".repeat(32);
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  dbExec = (await import("@agent-native/core/db")).getDbExec();
  await (await import("../plugins/db.js")).default(undefined as never);
  await dbExec.execute({
    sql: `CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL
    )`,
  });
  await dbExec.execute({
    sql: `CREATE TABLE IF NOT EXISTS org_members (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      joined_at INTEGER NOT NULL
    )`,
  });
  const admission = await import("./private-vault-genesis-admission.js");
  issueChallenge = admission.issuePrivateVaultGenesisChallenge;
  admitGenesis = admission.admitPrivateVaultGenesis;
  deleteExpiredChallenges =
    admission.deleteExpiredPrivateVaultGenesisChallenges;
  const scope = await import("./private-vault-genesis-account-scope.js");
  resolveGenesisScope = scope.resolvePrivateVaultGenesisAccountScope;
  resolveStableVaultScope = scope.resolvePrivateVaultScopeForStableIdentity;
}, 60_000);

beforeEach(async () => {
  await getDb().delete(schema.contentEncryptedVaultGenesisAdmissions);
  await getDb().delete(schema.contentEncryptedVaultGenesisChallenges);
  await getDb().delete(schema.contentEncryptedVaults);
  await dbExec.execute({ sql: `DELETE FROM org_members` });
  await dbExec.execute({ sql: `DELETE FROM "user"` });
  await seedAuthority(OWNER_SCOPE);
});

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

describe("Private Vault account-authorized genesis admission", () => {
  it("atomically consumes one challenge and returns a byte-stable scoped receipt", async () => {
    const request = await admissionRequest({});
    const receipts = await Promise.all(
      Array.from({ length: 8 }, () => admitGenesis(request)),
    );
    for (const receipt of receipts) {
      expect(Buffer.from(receipt).equals(Buffer.from(receipts[0]!))).toBe(true);
    }
    const decoded = decodeAncV1GenesisAccountAdmissionReceipt(receipts[0]!);
    expect(decoded).toMatchObject({
      accountId: OWNER_SCOPE.accountId,
      workspaceId: OWNER_SCOPE.workspaceId,
    });
    const [challenge] = await getDb()
      .select()
      .from(schema.contentEncryptedVaultGenesisChallenges);
    expect(challenge?.consumedAt).not.toBeNull();
    expect(challenge?.challengeHash).toMatch(/^[0-9a-f]{64}$/);

    const [vault] = await getDb().select().from(schema.contentEncryptedVaults);
    const [admission] = await getDb()
      .select()
      .from(schema.contentEncryptedVaultGenesisAdmissions);
    expect(vault).toMatchObject({
      ownerEmail: OWNER_SCOPE.ownerEmail,
      orgId: OWNER_SCOPE.orgId,
      accountId: OWNER_SCOPE.accountId,
      workspaceId: OWNER_SCOPE.workspaceId,
    });
    expect(admission).toMatchObject({
      candidateHash: decoded.candidateHash,
      bootstrapTranscriptHash: decoded.bootstrapTranscriptHash,
    });
  });

  it("rejects attacker-first public-artifact claims without consuming the candidate", async () => {
    const attackerScope = {
      ...OWNER_SCOPE,
      ownerEmail: "attacker@example.test",
      orgId: "org-attacker",
      accountId: `account:${"c".repeat(64)}`,
      workspaceId: `workspace:${"d".repeat(64)}`,
    };
    const wrongKey = (
      await ancV1SigningKeypairFromSeed(new Uint8Array(32).fill(0x99))
    ).privateKey;
    const stolenPublicCandidate = await fixtureCandidate();
    const attacker = await admissionRequest({
      scope: attackerScope,
      candidate: stolenPublicCandidate,
      signingPrivateKey: wrongKey,
    });
    await expect(admitGenesis(attacker)).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(
      await getDb().select().from(schema.contentEncryptedVaults),
    ).toHaveLength(0);

    const owner = await admissionRequest({ candidate: stolenPublicCandidate });
    await expect(admitGenesis(owner)).resolves.toBeInstanceOf(Uint8Array);
  });

  it("rejects wrong active organization and challenge scope substitution", async () => {
    const request = await admissionRequest({});
    await expect(
      admitGenesis({
        ...request,
        scope: {
          ...OWNER_SCOPE,
          orgId: "org-wrong",
          workspaceId: `workspace:${"e".repeat(64)}`,
        },
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });

    const decoded = decodeAncV1GenesisAccountAdmissionChallenge(
      request.challenge,
    );
    const substitutedChallenge = encodeAncV1GenesisAccountAdmissionChallenge({
      ...decoded,
      workspaceId: `workspace:${"f".repeat(64)}`,
    });
    const substitutedBody = encodeAncV1GenesisAccountAdmissionRequest({
      suite: "anc/v1",
      version: 1,
      type: "genesis-account-admission-request",
      candidate: request.candidate,
      challenge: substitutedChallenge,
    });
    await expect(
      admitGenesis({ ...request, body: substitutedBody }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("preserves logical scope when email changes between challenge and admission", async () => {
    const request = await admissionRequest({});
    const renamedScope = {
      ...OWNER_SCOPE,
      ownerEmail: "renamed@example.test",
    };
    await seedAuthority(renamedScope);
    const receipt = await admitGenesis({
      ...request,
      scope: renamedScope,
    });
    expect(decodeAncV1GenesisAccountAdmissionReceipt(receipt)).toMatchObject({
      accountId: OWNER_SCOPE.accountId,
      workspaceId: OWNER_SCOPE.workspaceId,
    });
    const [vault] = await getDb().select().from(schema.contentEncryptedVaults);
    expect(vault?.ownerEmail).toBe("renamed@example.test");

    const renamedAgainScope = {
      ...OWNER_SCOPE,
      ownerEmail: "renamed-again@example.test",
    };
    await seedAuthority(renamedAgainScope);
    const retried = await admissionRequest({ scope: renamedAgainScope });
    await expect(admitGenesis(retried)).resolves.toEqual(receipt);
  });

  it("rejects expiry before endpoint proof or immutable writes", async () => {
    const request = await admissionRequest({});
    await expect(
      admitGenesis({
        ...request,
        now: new Date(NOW.getTime() + 5 * 60 * 1000),
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(
      await getDb().select().from(schema.contentEncryptedVaults),
    ).toHaveLength(0);
    await expect(
      deleteExpiredChallenges(
        new Date(NOW.getTime() + 5 * 60 * 1000).toISOString(),
      ),
    ).resolves.toBe(1);
    expect(
      await getDb()
        .select()
        .from(schema.contentEncryptedVaultGenesisChallenges),
    ).toHaveLength(0);
  });

  it("rejects all bootstrap identity substitutions before issuing a challenge", async () => {
    const original = await fixtureCandidate();
    for (const field of [
      "endpointSigningPublicKey",
      "endpointKeyAgreementPublicKey",
      "enrollmentRef",
    ] as const) {
      const candidate = decodeAncV1GenesisAccountAdmissionCandidate(original);
      const bootstrap = decodeAncV1GenesisBootstrapTranscript(
        candidate.bootstrapTranscript,
      );
      bootstrap[field][0] ^= 1;
      const substituted = encodeAncV1GenesisAccountAdmissionCandidate({
        ...candidate,
        bootstrapTranscript: encodeAncV1GenesisBootstrapTranscript(bootstrap),
      });
      await expect(
        issueChallenge({
          scope: OWNER_SCOPE,
          candidate: substituted,
          now: NOW,
        }),
      ).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(
      await getDb()
        .select()
        .from(schema.contentEncryptedVaultGenesisChallenges),
    ).toHaveLength(0);
  });

  it("rejects a second account after the rightful immutable admission", async () => {
    const owner = await admissionRequest({});
    await admitGenesis(owner);
    const candidate = await fixtureCandidate();
    const otherScope = {
      ...OWNER_SCOPE,
      subjectId: "stable-user-2",
      ownerEmail: "other@example.test",
      orgId: "org-other",
      accountId: `account:${"1".repeat(64)}`,
      workspaceId: `workspace:${"2".repeat(64)}`,
    };
    await seedAuthority(otherScope);
    const other = await admissionRequest({ scope: otherScope, candidate });
    await expect(admitGenesis(other)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("permits only one vault trust root per stable account and workspace", async () => {
    const owner = await admissionRequest({});
    await admitGenesis(owner);
    await expect(
      getDb()
        .insert(schema.contentEncryptedVaults)
        .values({
          vaultId: "99".repeat(16),
          ownerEmail: "renamed@example.test",
          orgId: OWNER_SCOPE.orgId,
          accountId: OWNER_SCOPE.accountId,
          workspaceId: OWNER_SCOPE.workspaceId,
          vaultState: "active",
        }),
    ).rejects.toThrow();
  });

  it("resolves an admitted vault by stable subject while rejecting an email reassignment", async () => {
    const admittedScope = await resolveGenesisScope({
      userId: OWNER_SCOPE.subjectId,
      email: OWNER_SCOPE.ownerEmail,
      orgId: OWNER_SCOPE.orgId,
    });
    expect(admittedScope).not.toBeNull();
    const owner = await admissionRequest({ scope: admittedScope! });
    const receipt = decodeAncV1GenesisAccountAdmissionReceipt(
      await admitGenesis(owner),
    );

    const renamedEmail = "renamed-stable-owner@example.test";
    await seedAuthority({ ...admittedScope!, ownerEmail: renamedEmail });
    await expect(
      resolveStableVaultScope({
        userId: OWNER_SCOPE.subjectId,
        email: renamedEmail,
        orgId: OWNER_SCOPE.orgId,
        vaultId: receipt.vaultId,
      }),
    ).resolves.toMatchObject({
      ownerEmail: OWNER_SCOPE.ownerEmail,
      orgId: OWNER_SCOPE.orgId,
    });

    await seedAuthority({
      ...admittedScope!,
      subjectId: "stable-user-2",
      ownerEmail: OWNER_SCOPE.ownerEmail,
    });
    await expect(
      resolveStableVaultScope({
        userId: "stable-user-2",
        email: OWNER_SCOPE.ownerEmail,
        orgId: OWNER_SCOPE.orgId,
        vaultId: receipt.vaultId,
      }),
    ).resolves.toBeNull();
  });

  it("keeps the admitted signed tuple aligned with the frozen candidate", async () => {
    const request = await admissionRequest({});
    const receipt = decodeAncV1GenesisAccountAdmissionReceipt(
      await admitGenesis(request),
    );
    const candidate = decodeAncV1GenesisAccountAdmissionCandidate(
      request.candidate,
    );
    const bootstrap = decodeAncV1GenesisBootstrapTranscript(
      candidate.bootstrapTranscript,
    );
    const authorization = decodeAncV1GenesisAuthorization(
      candidate.authorization,
      { expectedVaultId: bootstrap.vaultId },
    );
    const entry = decodeSignedControlLogEntry(
      authorization.signedGenesisCommit,
    );
    expect(receipt).toMatchObject({
      vaultId: entry.vaultId,
      controlEntryId: entry.envelopeId,
      signerEndpointId: entry.signerEndpointId,
    });
    const rows = await getDb()
      .select()
      .from(schema.contentEncryptedVaultGenesisAdmissions)
      .where(
        eq(
          schema.contentEncryptedVaultGenesisAdmissions.vaultId,
          entry.vaultId,
        ),
      );
    expect(rows).toHaveLength(1);
  });
});
