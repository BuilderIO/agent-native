import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ancV1BoxKeypairFromSeed,
  ancV1BytesToHex,
  ancV1SigningKeypairFromSeed,
  encodeAncV1EndpointEnrollmentOffer,
  type ControlLogState,
} from "@agent-native/core/e2ee";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `private-vault-enrollment-${process.pid}-${Date.now()}.sqlite`,
);
const NOW = new Date("2026-07-18T18:00:00.000Z");
const VAULT_ID = "11".repeat(16);
const OWNER_ID = "22".repeat(16);
const CANDIDATE_ID = "33".repeat(16);
const OWNER = "enrollment-owner@example.test";
const ORG = "org-enrollment";
const scope = { ownerEmail: OWNER, orgId: ORG, vaultId: VAULT_ID };

const loadVerifiedState = vi.fn<() => Promise<ControlLogState | null>>();
vi.mock("./private-vault-control-log-runtime.js", () => ({
  privateVaultControlLogService: {
    loadVerifiedState,
    append: vi.fn(),
  },
}));

let getDb: (typeof import("../db/index.js"))["getDb"];
let schema: typeof import("../db/schema.js");
let publishOffer: (typeof import("./private-vault-enrollment.js"))["publishPrivateVaultEnrollmentOffer"];
let readStatus: (typeof import("./private-vault-enrollment.js"))["readPrivateVaultEnrollmentStatus"];

function state(input?: { broker?: boolean }): ControlLogState {
  const owner = {
    endpointId: OWNER_ID,
    role: "endpoint" as const,
    unattended: false,
    signingPublicKey: "44".repeat(32),
    keyAgreementPublicKey: "55".repeat(32),
    enrollmentRef: "66".repeat(16),
  };
  const broker = {
    endpointId: "77".repeat(16),
    role: "broker" as const,
    unattended: true,
    signingPublicKey: "88".repeat(32),
    keyAgreementPublicKey: "99".repeat(32),
    enrollmentRef: "aa".repeat(16),
  };
  return {
    vaultId: VAULT_ID,
    sequence: 0,
    headHash: "bb".repeat(32),
    membershipHash: "cc".repeat(32),
    signedAt: NOW.toISOString(),
    epoch: 1,
    activeMembers: input?.broker ? [owner, broker] : [owner],
    removedEndpointIds: [],
    freshnessMode: "endpoint_witnessed",
    recoveryGeneration: 1,
    recoveryId: "dd".repeat(16),
    recoverySigningPublicKey: "ee".repeat(32),
    recoveryKeyAgreementPublicKey: "ef".repeat(32),
    recoveryWrapHash: "f0".repeat(32),
  };
}

async function offer(input?: { role?: "endpoint" | "broker" }) {
  const signing = await ancV1SigningKeypairFromSeed(new Uint8Array(32).fill(1));
  const agreement = await ancV1BoxKeypairFromSeed(new Uint8Array(32).fill(2));
  const role = input?.role ?? "broker";
  return encodeAncV1EndpointEnrollmentOffer({
    suite: "anc/v1",
    vaultId: Uint8Array.from(Buffer.from(VAULT_ID, "hex")),
    type: "enrollment-offer",
    createdAt: Math.floor(NOW.getTime() / 1000),
    envelopeId: new Uint8Array(16).fill(3),
    endpointId: Uint8Array.from(Buffer.from(CANDIDATE_ID, "hex")),
    ceremonyId: new Uint8Array(16).fill(4),
    membershipRole: role,
    unattended: role === "broker",
    signingPublicKey: signing.publicKey,
    keyAgreementPublicKey: agreement.publicKey,
    enrollmentNonce: new Uint8Array(32).fill(5),
    expiresAt: Math.floor(NOW.getTime() / 1000) + 600,
  });
}

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const db = await import("../db/index.js");
  getDb = db.getDb;
  schema = db.schema;
  await (await import("../plugins/db.js")).default(undefined as never);
  const enrollment = await import("./private-vault-enrollment.js");
  publishOffer = enrollment.publishPrivateVaultEnrollmentOffer;
  readStatus = enrollment.readPrivateVaultEnrollmentStatus;
}, 60_000);

beforeEach(async () => {
  await getDb().delete(schema.contentEncryptedVaultEnrollmentCeremonies);
  await getDb().delete(schema.contentEncryptedVaults);
  await getDb().insert(schema.contentEncryptedVaults).values({
    vaultId: VAULT_ID,
    ownerEmail: OWNER,
    orgId: ORG,
    accountId: "account:enrollment",
    workspaceId: "workspace:enrollment",
    vaultState: "active",
  });
  loadVerifiedState.mockReset();
  loadVerifiedState.mockResolvedValue(state());
});

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

describe("Private Vault enrollment rendezvous", () => {
  it("persists one canonical broker offer and returns byte-identical retries", async () => {
    const encoded = await offer();
    const first = await publishOffer({ scope, offer: encoded, now: NOW });
    const retry = await publishOffer({ scope, offer: encoded, now: NOW });

    expect(first.phase).toBe("offer");
    expect(first.challenge).toBeNull();
    expect(Buffer.from(first.offer).equals(Buffer.from(encoded))).toBe(true);
    expect(retry).toEqual(first);
    const [stored] = await getDb()
      .select()
      .from(schema.contentEncryptedVaultEnrollmentCeremonies);
    expect(stored).toMatchObject({
      vaultId: VAULT_ID,
      candidateEndpointId: CANDIDATE_ID,
      targetRole: "broker",
      phase: "offer",
    });
  });

  it("rejects noncanonical, expired, and second-broker offers", async () => {
    const encoded = await offer();
    await expect(
      publishOffer({ scope, offer: encoded.slice(0, -1), now: NOW }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      publishOffer({
        scope,
        offer: encoded,
        now: new Date(NOW.getTime() + 601_000),
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });

    loadVerifiedState.mockResolvedValue(state({ broker: true }));
    await expect(
      publishOffer({ scope, offer: encoded, now: NOW }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("stores only content-free canonical ceremony coordinates", async () => {
    const encoded = await offer({ role: "endpoint" });
    await publishOffer({ scope, offer: encoded, now: NOW });
    const [stored] = await getDb()
      .select()
      .from(schema.contentEncryptedVaultEnrollmentCeremonies);
    expect(stored.targetRole).toBe("endpoint");
    expect(stored.offerBytesBase64url).toBe(
      Buffer.from(encoded).toString("base64url"),
    );
    expect(JSON.stringify(stored)).not.toMatch(
      /privateKey|signingSeed|epochKey|recoverySecret|plaintext/i,
    );
    expect(ancV1BytesToHex(encoded).length).toBeGreaterThan(0);
  });

  it("refuses to return a tampered persisted transcript", async () => {
    const encoded = await offer();
    await publishOffer({ scope, offer: encoded, now: NOW });
    const [stored] = await getDb()
      .select()
      .from(schema.contentEncryptedVaultEnrollmentCeremonies);
    await getDb()
      .update(schema.contentEncryptedVaultEnrollmentCeremonies)
      .set({
        offerBytesBase64url: `${stored.offerBytesBase64url.slice(0, -1)}${stored.offerBytesBase64url.endsWith("A") ? "B" : "A"}`,
      })
      .where(
        eq(
          schema.contentEncryptedVaultEnrollmentCeremonies.offerHash,
          stored.offerHash,
        ),
      );

    await expect(
      readStatus({ scope, offerHash: stored.offerHash }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});
