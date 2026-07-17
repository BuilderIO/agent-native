import { describe, expect, it } from "vitest";

import {
  type AncV1CanonicalValue,
  ancV1BytesToHex,
  decodeAncV1Canonical,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  createSignedControlLogEntry,
  decodeSignedControlLogEntry,
  encodeSignedControlLogEntry,
  encodeUnsignedControlLogEntry,
  verifyAndReduceControlLogEntry,
} from "./control-log.js";
import {
  createAncV1GenesisAuthorizationVerifier,
  decodeAncV1GenesisAuthorization,
  decodeAncV1GenesisRecoveryConfirmation,
  encodeAncV1GenesisAuthorization,
  encodeAncV1GenesisRecoveryConfirmation,
  hashAncV1GenesisRecoveryConfirmation,
  signAncV1GenesisAuthorization,
  verifyAncV1GenesisAuthorization,
} from "./genesis-ceremony-codecs.js";
import {
  ancV1BoxKeypairFromSeed,
  ancV1Hash,
  ancV1SignDetached,
  ancV1SigningKeypairFromSeed,
} from "./portable-crypto.js";
import { E2EE_ENVELOPE_FIELDS, E2EE_SUITE_ID } from "./suite.js";

const p = (byte: number, length: number) => new Uint8Array(length).fill(byte);
const vaultId = p(0x01, 16);
const endpointId = p(0x02, 16);
const ceremonyId = p(0x03, 16);
const recoveryId = p(0x04, 16);
const authorizationId = p(0x05, 16);

async function fixture(
  timestamps: {
    confirmation: number;
    endpoint: number;
    entry: number;
    authorization: number;
  } = {
    confirmation: 1_721_111_120,
    endpoint: 1_721_111_120,
    entry: 1_721_111_125,
    authorization: 1_721_111_130,
  },
) {
  const endpointSigning = await ancV1SigningKeypairFromSeed(p(0x11, 32));
  const endpointAgreement = await ancV1BoxKeypairFromSeed(p(0x12, 32));
  const recoverySigning = await ancV1SigningKeypairFromSeed(p(0x21, 32));
  const recoveryAgreement = await ancV1BoxKeypairFromSeed(p(0x22, 32));
  const recoveryConfirmation = {
    suite: E2EE_SUITE_ID,
    vaultId,
    type: "genesis-recovery-confirmation" as const,
    ceremonyId,
    endpointId,
    recoveryId,
    recoverySigningPublicKey: recoverySigning.publicKey,
    recoveryKeyAgreementPublicKey: recoveryAgreement.publicKey,
    recoveryWrapHash: await ancV1Hash(
      "recovery",
      new TextEncoder().encode("synthetic signed recovery wrap"),
    ),
    confirmedAt: timestamps.confirmation,
    recoveryGeneration: 1 as const,
  };
  const encodedRecoveryConfirmation = new Uint8Array(
    encodeAncV1GenesisRecoveryConfirmation(recoveryConfirmation),
  );
  const recoveryConfirmationHash = await hashAncV1GenesisRecoveryConfirmation(
    encodedRecoveryConfirmation,
    vaultId,
  );
  const endpointUnsigned = new Map<number, AncV1CanonicalValue>([
    [E2EE_ENVELOPE_FIELDS.common.suite, E2EE_SUITE_ID],
    [E2EE_ENVELOPE_FIELDS.common.vaultId, vaultId],
    [E2EE_ENVELOPE_FIELDS.common.type, "endpoint"],
    [E2EE_ENVELOPE_FIELDS.common.createdAt, timestamps.endpoint],
    [E2EE_ENVELOPE_FIELDS.common.envelopeId, p(0x06, 16)],
    [E2EE_ENVELOPE_FIELDS.endpoint.endpointId, endpointId],
    [E2EE_ENVELOPE_FIELDS.endpoint.role, "desktop"],
    [E2EE_ENVELOPE_FIELDS.endpoint.unattended, false],
    [E2EE_ENVELOPE_FIELDS.endpoint.signingPublicKey, endpointSigning.publicKey],
    [
      E2EE_ENVELOPE_FIELDS.endpoint.keyAgreementPublicKey,
      endpointAgreement.publicKey,
    ],
    [E2EE_ENVELOPE_FIELDS.endpoint.addedByEndpointId, endpointId],
    [E2EE_ENVELOPE_FIELDS.endpoint.sasTranscriptHash, recoveryConfirmationHash],
  ]);
  const endpointEnvelope = new Uint8Array(
    encodeAncV1Canonical(
      new Map([
        ...endpointUnsigned,
        [
          E2EE_ENVELOPE_FIELDS.endpoint.signature,
          await ancV1SignDetached(
            "endpoint",
            encodeAncV1Canonical(endpointUnsigned),
            endpointSigning.privateKey,
          ),
        ],
      ]),
    ),
  );
  const member = {
    endpointId: ancV1BytesToHex(endpointId),
    role: "endpoint" as const,
    unattended: false,
    signingPublicKey: ancV1BytesToHex(endpointSigning.publicKey),
    keyAgreementPublicKey: ancV1BytesToHex(endpointAgreement.publicKey),
    enrollmentRef: ancV1BytesToHex(authorizationId),
  };
  const commit = {
    suite: E2EE_SUITE_ID,
    type: "membership_commit" as const,
    vaultId: ancV1BytesToHex(vaultId),
    ceremonyId: ancV1BytesToHex(ceremonyId),
    ceremonyKind: "first_device" as const,
    epoch: 1,
    previousMembershipHash: null,
    activeMembers: [member],
    removedEndpointIds: [],
    rotationCompleted: false,
    outstandingJobsResolved: false,
    recoverySnapshotHash: null,
    recoveryAuthorizationHash: null,
    recoveryGeneration: 1,
    recoveryId: ancV1BytesToHex(recoveryId),
    recoverySigningPublicKey: ancV1BytesToHex(recoverySigning.publicKey),
    recoveryKeyAgreementPublicKey: ancV1BytesToHex(recoveryAgreement.publicKey),
    recoveryWrapHash: ancV1BytesToHex(recoveryConfirmation.recoveryWrapHash),
  };
  const entry = await createSignedControlLogEntry({
    vaultId: commit.vaultId,
    createdAt: new Date(timestamps.entry * 1_000).toISOString(),
    envelopeId: ancV1BytesToHex(p(0x07, 16)),
    sequence: 0,
    previousHash: "00".repeat(32),
    innerEnvelope: commit,
    signerEndpointId: member.endpointId,
    signingPrivateKey: endpointSigning.privateKey,
  });
  const signedGenesisCommit = new Uint8Array(
    encodeSignedControlLogEntry(entry),
  );
  const authorization = await signAncV1GenesisAuthorization(
    {
      suite: E2EE_SUITE_ID,
      vaultId,
      type: "genesis-authorization",
      createdAt: timestamps.authorization,
      envelopeId: authorizationId,
      ceremonyId,
      endpointId,
      epoch: 1,
      endpointEnvelope,
      recoveryConfirmation: encodedRecoveryConfirmation,
      signedGenesisCommit,
    },
    endpointSigning.privateKey,
  );
  return {
    endpointSigning,
    recoveryConfirmation,
    encodedRecoveryConfirmation,
    endpointEnvelope,
    commit,
    entry,
    authorization,
    encodedAuthorization: new Uint8Array(
      encodeAncV1GenesisAuthorization(authorization),
    ),
  };
}

function mutate(
  encoded: Uint8Array,
  key: number,
  value: AncV1CanonicalValue,
): Uint8Array {
  const map = decodeAncV1Canonical(encoded) as Map<number, AncV1CanonicalValue>;
  map.set(key, value);
  return encodeAncV1Canonical(map);
}

describe("anc/v1 first-device genesis ceremony", () => {
  it("pins byte-stable confirmation and signed authorization vectors", async () => {
    const value = await fixture();
    expect(ancV1BytesToHex(value.encodedRecoveryConfirmation)).toBe(
      "ab0166616e632f763102500101010101010101010101010101010103781d67656e657369732d7265636f766572792d636f6e6669726d6174696f6e1901685003030303030303030303030303030303190169500202020202020202020202020202020219016a500404040404040404040404040404040419016b5820884b8857f4eaa1613c61504db34d4beaf346517a0e31de3cddd4d9b4201d9d0b19016c58209d8d78b9c9e6661e552f2f1af02095ee2f8743fa2e6183f41bb7077ef51b537919016d5820320cb2f26ae0debd3dbf4b43f0113f5a9146d90e8548fb445978d22301ca735319016e1a6696125019016f01",
    );
    expect(
      ancV1BytesToHex(
        await ancV1Hash("genesis-authorization", value.encodedAuthorization),
      ),
    ).toBe("541dbece7734ea3acccab57d6b7f14d09566801aa67f5b1c4c7d2487cfb2fbee");
    expect(ancV1BytesToHex(value.encodedAuthorization)).toBe(
      "ac0166616e632f7631025001010101010101010101010101010101037567656e657369732d617574686f72697a6174696f6e041a6696125a0550050505050505050505050505050505051901725003030303030303030303030303030303190173500202020202020202020202020202020219017401190175590118ad0166616e632f76310250010101010101010101010101010101010368656e64706f696e74041a669612500550060606060606060606060606060606060a50020202020202020202020202020202020b676465736b746f700cf40d5820d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c97787370e58207c147d7653a80bc7847911979c11487eac6f8ee7f74e6461f144b36b36afa76b0f500202020202020202020202020202020210582095ab2c7ace9a317a7471ddf0b4e5f73521f78aa21418c085f0dc419f854a2a64115840fa67e428c06d600d5d1877f324b438f60fd494a62823c3f573181ea12a66e32414e1218e52ee02ee8df0c29cae058d463b53ac1f9c053a918cd4c354bc4e870d19017658f2ab0166616e632f763102500101010101010101010101010101010103781d67656e657369732d7265636f766572792d636f6e6669726d6174696f6e1901685003030303030303030303030303030303190169500202020202020202020202020202020219016a500404040404040404040404040404040419016b5820884b8857f4eaa1613c61504db34d4beaf346517a0e31de3cddd4d9b4201d9d0b19016c58209d8d78b9c9e6661e552f2f1af02095ee2f8743fa2e6183f41bb7077ef51b537919016d5820320cb2f26ae0debd3dbf4b43f0113f5a9146d90e8548fb445978d22301ca735319016e1a6696125019016f011901775902b9aa0166616e632f7631027820303130313031303130313031303130313031303130313031303130313031303103696c6f672d656e747279047818323032342d30372d31365430363a32353a32352e3030305a0578203037303730373037303730373037303730373037303730373037303730373037186e00186f5820000000000000000000000000000000000000000000000000000000000000000018705901b0b20166616e632f7631027820303130313031303130313031303130313031303130313031303130313031303103716d656d626572736869705f636f6d6d6974188c78203033303330333033303330333033303330333033303330333033303330333033188d6c66697273745f646576696365188e01188ff6189081867820303230323032303230323032303230323032303230323032303230323032303268656e64706f696e74f45820d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c977873758207c147d7653a80bc7847911979c11487eac6f8ee7f74e6461f144b36b36afa76b782030353035303530353035303530353035303530353035303530353035303530351891801892f41893f41894f61895f6189b01189c78203034303430343034303430343034303430343034303430343034303430343034189d5820884b8857f4eaa1613c61504db34d4beaf346517a0e31de3cddd4d9b4201d9d0b189e58209d8d78b9c9e6661e552f2f1af02095ee2f8743fa2e6183f41bb7077ef51b5379189f5820320cb2f26ae0debd3dbf4b43f0113f5a9146d90e8548fb445978d22301ca735318717820303230323032303230323032303230323032303230323032303230323032303218725840b13f627580416f54bdf052931266f4a324138a5000ac11c4039e0d44db39fae7a6bf5dfc28141d87dab68257ff76b5138d4eff6340000314d84d9c54578e920819017858405ea13f8db0c31fe125076b0ed12ee6d081f1d5cb565bcfec3a117acdd2aa36894100402f821e5c896afbda484063eb044e93da4dceffa9ae6a1c6d2762993e00",
    );
    expect(
      decodeAncV1GenesisRecoveryConfirmation(
        value.encodedRecoveryConfirmation,
        { expectedVaultId: vaultId },
      ),
    ).toEqual(value.recoveryConfirmation);
    expect(
      decodeAncV1GenesisAuthorization(value.encodedAuthorization, {
        expectedVaultId: vaultId,
      }),
    ).toEqual(value.authorization);
  });

  it("is directly consumable by the genesis control-log reducer", async () => {
    const value = await fixture();
    const result = await verifyAndReduceControlLogEntry({
      current: null,
      entry: value.entry,
      verifyGenesisAuthorization: createAncV1GenesisAuthorizationVerifier(
        value.encodedAuthorization,
        value.encodedRecoveryConfirmation,
      ),
    });
    expect(result.state).toMatchObject({
      sequence: 0,
      epoch: 1,
      recoveryGeneration: 1,
      recoveryId: ancV1BytesToHex(recoveryId),
      activeMembers: value.commit.activeMembers,
    });
  });

  it("rejects wrong signer, recipient, replay, and recovery substitution", async () => {
    const value = await fixture();
    const wrongSigner = await ancV1SigningKeypairFromSeed(p(0x31, 32));
    const { signature: _signature, ...unsignedAuthorization } =
      value.authorization;
    const forgedAuthorization = await signAncV1GenesisAuthorization(
      unsignedAuthorization,
      wrongSigner.privateKey,
    );
    await expect(
      verifyAncV1GenesisAuthorization(
        encodeAncV1GenesisAuthorization(forgedAuthorization),
        value.encodedRecoveryConfirmation,
        { commit: value.commit, entry: value.entry },
      ),
    ).resolves.toBe(false);

    const wrongRecipient = mutate(
      value.encodedRecoveryConfirmation,
      E2EE_ENVELOPE_FIELDS.genesisRecoveryConfirmation.endpointId,
      p(0xfe, 16),
    );
    await expect(
      verifyAncV1GenesisAuthorization(
        value.encodedAuthorization,
        wrongRecipient,
        { commit: value.commit, entry: value.entry },
      ),
    ).resolves.toBe(false);

    const replayedEntry = {
      ...value.entry,
      envelopeId: ancV1BytesToHex(p(0x44, 16)),
    };
    await expect(
      verifyAncV1GenesisAuthorization(
        value.encodedAuthorization,
        value.encodedRecoveryConfirmation,
        { commit: value.commit, entry: replayedEntry },
      ),
    ).resolves.toBe(false);

    const substitutedRecovery = mutate(
      value.encodedRecoveryConfirmation,
      E2EE_ENVELOPE_FIELDS.genesisRecoveryConfirmation.recoveryWrapHash,
      p(0xee, 32),
    );
    await expect(
      verifyAncV1GenesisAuthorization(
        value.encodedAuthorization,
        substitutedRecovery,
        { commit: value.commit, entry: value.entry },
      ),
    ).resolves.toBe(false);
  });

  it("rejects unknown fields, malformed lengths, noncanonical IDs and epoch substitution", async () => {
    const value = await fixture();
    expect(() =>
      decodeAncV1GenesisAuthorization(
        mutate(value.encodedAuthorization, 999, p(1, 1)),
        { expectedVaultId: vaultId },
      ),
    ).toThrow(/unknown key/);
    expect(() =>
      decodeAncV1GenesisAuthorization(
        mutate(
          value.encodedAuthorization,
          E2EE_ENVELOPE_FIELDS.genesisAuthorization.endpointId,
          p(2, 15),
        ),
        { expectedVaultId: vaultId },
      ),
    ).toThrow(/16 bytes/);
    expect(() =>
      decodeAncV1GenesisAuthorization(
        mutate(
          value.encodedAuthorization,
          E2EE_ENVELOPE_FIELDS.genesisAuthorization.epoch,
          2,
        ),
        { expectedVaultId: vaultId },
      ),
    ).toThrow(/epoch/);

    const noncanonicalEntry = {
      ...value.entry,
      vaultId: "AA".repeat(16),
    };
    await expect(
      verifyAncV1GenesisAuthorization(
        value.encodedAuthorization,
        value.encodedRecoveryConfirmation,
        { commit: value.commit, entry: noncanonicalEntry },
      ),
    ).resolves.toBe(false);
    expect(
      decodeSignedControlLogEntry(value.authorization.signedGenesisCommit),
    ).toEqual(value.entry);
  });

  it("enforces the complete genesis timestamp order including equal boundaries", async () => {
    const equal = await fixture({
      confirmation: 1_721_111_130,
      endpoint: 1_721_111_130,
      entry: 1_721_111_130,
      authorization: 1_721_111_130,
    });
    await expect(
      verifyAncV1GenesisAuthorization(
        equal.encodedAuthorization,
        equal.encodedRecoveryConfirmation,
        { commit: equal.commit, entry: equal.entry },
      ),
    ).resolves.toBe(true);

    const regressions = [
      {
        confirmation: 1_721_111_131,
        endpoint: 1_721_111_130,
        entry: 1_721_111_132,
        authorization: 1_721_111_133,
      },
      {
        confirmation: 1_721_111_129,
        endpoint: 1_721_111_131,
        entry: 1_721_111_130,
        authorization: 1_721_111_133,
      },
      {
        confirmation: 1_721_111_129,
        endpoint: 1_721_111_130,
        entry: 1_721_111_132,
        authorization: 1_721_111_131,
      },
    ];
    for (const timestamps of regressions) {
      const value = await fixture(timestamps);
      await expect(
        verifyAncV1GenesisAuthorization(
          value.encodedAuthorization,
          value.encodedRecoveryConfirmation,
          { commit: value.commit, entry: value.entry },
        ),
      ).resolves.toBe(false);
    }
  });

  it("rejects invalid, noninteger, and unsafe timestamp forms", async () => {
    const value = await fixture();
    await expect(
      verifyAncV1GenesisAuthorization(
        value.encodedAuthorization,
        value.encodedRecoveryConfirmation,
        {
          commit: value.commit,
          entry: { ...value.entry, createdAt: "not-a-timestamp" },
        },
      ),
    ).resolves.toBe(false);
    expect(() =>
      encodeAncV1GenesisRecoveryConfirmation({
        ...value.recoveryConfirmation,
        confirmedAt: 1.5,
      }),
    ).toThrow(/safe integer/);
    const { signature: _signature, ...unsigned } = value.authorization;
    await expect(
      signAncV1GenesisAuthorization(
        { ...unsigned, createdAt: Number.MAX_SAFE_INTEGER + 1 },
        value.endpointSigning.privateKey,
      ),
    ).rejects.toThrow(/safe integer/);
    const endpoint = decodeAncV1Canonical(value.endpointEnvelope) as Map<
      number,
      AncV1CanonicalValue
    >;
    endpoint.set(E2EE_ENVELOPE_FIELDS.common.createdAt, 1.5);
    expect(() => encodeAncV1Canonical(endpoint)).toThrow(/safe integer/);
  });

  it("verifies the embedded log signature and outer/inner vault equality standalone", async () => {
    const value = await fixture();
    const tamperedEntry = {
      ...value.entry,
      signature: "ff".repeat(64),
    };
    const { signature: _signature, ...unsigned } = value.authorization;
    const tamperedAuthorization = await signAncV1GenesisAuthorization(
      {
        ...unsigned,
        signedGenesisCommit: encodeSignedControlLogEntry(tamperedEntry),
      },
      value.endpointSigning.privateKey,
    );
    await expect(
      verifyAncV1GenesisAuthorization(
        encodeAncV1GenesisAuthorization(tamperedAuthorization),
        value.encodedRecoveryConfirmation,
        { commit: value.commit, entry: tamperedEntry },
      ),
    ).resolves.toBe(false);

    const mismatchedCommit = {
      ...value.commit,
      vaultId: "aa".repeat(16),
    };
    const unsignedMismatchedEntry = {
      ...value.entry,
      innerEnvelope: mismatchedCommit,
      signature: undefined,
    };
    const { signature: _ignored, ...entryToSign } = unsignedMismatchedEntry;
    const mismatchedEntry = {
      ...entryToSign,
      signature: ancV1BytesToHex(
        await ancV1SignDetached(
          "log-entry",
          encodeUnsignedControlLogEntry(entryToSign),
          value.endpointSigning.privateKey,
        ),
      ),
    };
    const mismatchedAuthorization = await signAncV1GenesisAuthorization(
      {
        ...unsigned,
        signedGenesisCommit: encodeSignedControlLogEntry(mismatchedEntry),
      },
      value.endpointSigning.privateKey,
    );
    await expect(
      verifyAncV1GenesisAuthorization(
        encodeAncV1GenesisAuthorization(mismatchedAuthorization),
        value.encodedRecoveryConfirmation,
        { commit: mismatchedCommit, entry: mismatchedEntry },
      ),
    ).resolves.toBe(false);
  });

  it("copies decoded and verifier inputs before callers can mutate them", async () => {
    const value = await fixture();
    const authorizationSource = value.encodedAuthorization.slice();
    const confirmationSource = value.encodedRecoveryConfirmation.slice();
    const verifier = createAncV1GenesisAuthorizationVerifier(
      authorizationSource,
      confirmationSource,
    );
    const decoded = decodeAncV1GenesisAuthorization(authorizationSource, {
      expectedVaultId: vaultId,
    });
    authorizationSource.fill(0);
    confirmationSource.fill(0);
    expect(decoded.endpointId).toEqual(endpointId);
    await expect(
      verifier({ commit: value.commit, entry: value.entry }),
    ).resolves.toBe(true);
  });
});
