import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { ancV1BytesToHex, encodeAncV1Canonical } from "./canonical.js";
import {
  encodeAncV1CeremonyAbortStateCommitment,
  hashAncV1CeremonyAbortStateCommitment,
  verifyAncV1CeremonyAbortAuthorization,
} from "./ceremony-abort.js";
import {
  assertFreshControlLogHead,
  CONTROL_LOG_ZERO_HASH,
  type ControlLogMember,
  type ControlLogState,
  type ControlCeremonyAbort,
  type ControlGrantRevocation,
  type ControlMembershipCommit,
  controlMembershipCommitSchema,
  controlLogStateSchema,
  createSignedControlLogEntry,
  decodeControlLogInnerEnvelope,
  decodeSignedControlLogEntry,
  encodeControlLogInnerEnvelope,
  encodeSignedControlLogEntry,
  encodeUnsignedControlLogEntry,
  resolveControlLogEndpointAuthorization,
  verifyAndReduceControlLogEntry,
} from "./control-log.js";
import { ancV1SigningKeypairFromSeed } from "./portable-crypto.js";
import { e2eeDomainSeparationPrefix } from "./suite.js";

interface NativeSodium {
  crypto_sign_PUBLICKEYBYTES: number;
  crypto_sign_SECRETKEYBYTES: number;
  crypto_sign_BYTES: number;
  crypto_sign_seed_keypair(
    publicKey: Buffer,
    privateKey: Buffer,
    seed: Buffer,
  ): void;
  crypto_sign_verify_detached(
    signature: Buffer,
    message: Buffer,
    publicKey: Buffer,
  ): boolean;
  crypto_sign_detached(
    signature: Buffer,
    message: Buffer,
    privateKey: Buffer,
  ): void;
}

const require = createRequire(import.meta.url);
const sodium = require("sodium-native") as NativeSodium;
const at = "2026-07-17T01:00:00.000Z";
const hash = (byte: string) => byte.repeat(64);

async function identity(
  seedByte: number,
  endpointId: string,
  role: "endpoint" | "broker",
) {
  const seed = new Uint8Array(32).fill(seedByte);
  const pair = await ancV1SigningKeypairFromSeed(seed);
  const member: ControlLogMember = {
    endpointId,
    role,
    unattended: role === "broker",
    signingPublicKey: ancV1BytesToHex(pair.publicKey),
    keyAgreementPublicKey: ancV1BytesToHex(
      new Uint8Array(32).fill(seedByte + 40),
    ),
    enrollmentRef: `enrollment:${endpointId}`,
  };
  return { seed, pair, member };
}

function commit(
  patch: Partial<ControlMembershipCommit> &
    Pick<ControlMembershipCommit, "ceremonyKind" | "activeMembers">,
): ControlMembershipCommit {
  return {
    suite: "anc/v1",
    type: "membership_commit",
    vaultId: "vault:control-0001",
    ceremonyId: `ceremony:${patch.ceremonyKind}-0001`,
    epoch: 1,
    previousMembershipHash: null,
    removedEndpointIds: [],
    rotationCompleted: false,
    outstandingJobsResolved: false,
    recoverySnapshotHash: null,
    recoveryAuthorizationHash: null,
    recoveryGeneration: 1,
    recoveryId: "recovery:authority-0001",
    recoverySigningPublicKey: hash("c"),
    recoveryKeyAgreementPublicKey: hash("d"),
    recoveryWrapHash: hash("e"),
    ...patch,
  };
}

async function signed(input: {
  current: ControlLogState | null;
  inner:
    | ControlMembershipCommit
    | ControlCeremonyAbort
    | ControlGrantRevocation
    | {
        suite: "anc/v1";
        type: "continuity_checkpoint";
        vaultId: string;
        membershipHash: string;
      };
  signer: Awaited<ReturnType<typeof identity>>;
  createdAt?: string;
}) {
  return createSignedControlLogEntry({
    vaultId: "vault:control-0001",
    createdAt: input.createdAt ?? at,
    envelopeId: `log-entry:${(input.current?.sequence ?? -1) + 1}`,
    sequence: (input.current?.sequence ?? -1) + 1,
    previousHash: input.current?.headHash ?? CONTROL_LOG_ZERO_HASH,
    innerEnvelope: input.inner,
    signerEndpointId: input.signer.member.endpointId,
    signingPrivateKey: input.signer.pair.privateKey,
  });
}

async function genesis() {
  const owner = await identity(1, "endpoint:owner-0001", "endpoint");
  const entry = await signed({
    current: null,
    signer: owner,
    inner: commit({
      ceremonyKind: "first_device",
      activeMembers: [owner.member],
    }),
  });
  const reduced = await verifyAndReduceControlLogEntry({
    current: null,
    entry,
    verifyGenesisAuthorization: async ({ commit: candidate }) =>
      candidate.ceremonyId === "ceremony:first_device-0001" &&
      candidate.activeMembers[0]?.endpointId === owner.member.endpointId,
  });
  return { owner, entry, state: reduced.state };
}

describe("anc/v1 signed control log", () => {
  it("commits endpoint-authorized grant revocation without changing membership authority", async () => {
    const value = await genesis();
    const revocation: ControlGrantRevocation = {
      suite: "anc/v1",
      type: "grant_revocation",
      vaultId: value.state.vaultId,
      revocationEnvelope: "a101",
    };
    const entry = await signed({
      current: value.state,
      signer: value.owner,
      inner: revocation,
      createdAt: "2026-07-17T01:00:01.000Z",
    });
    const innerBytes = encodeControlLogInnerEnvelope(revocation);
    expect(decodeControlLogInnerEnvelope(innerBytes)).toEqual(revocation);
    expect(
      decodeSignedControlLogEntry(encodeSignedControlLogEntry(entry)),
    ).toEqual(entry);
    await expect(
      verifyAndReduceControlLogEntry({ current: value.state, entry }),
    ).rejects.toMatchObject({
      code: "grant_revocation_authorization_required",
    });
    await expect(
      verifyAndReduceControlLogEntry({
        current: value.state,
        entry,
        verifyGrantRevocationAuthorization: async () => false,
      }),
    ).rejects.toMatchObject({
      code: "grant_revocation_authorization_required",
    });

    let observed: ControlGrantRevocation | null = null;
    const reduced = await verifyAndReduceControlLogEntry({
      current: value.state,
      entry,
      verifyGrantRevocationAuthorization: async ({ revocation: candidate }) => {
        observed = candidate;
        return true;
      },
    });
    expect(observed).toEqual(revocation);
    expect(reduced.state).toMatchObject({
      sequence: value.state.sequence + 1,
      membershipHash: value.state.membershipHash,
      activeMembers: value.state.activeMembers,
      removedEndpointIds: value.state.removedEndpointIds,
      epoch: value.state.epoch,
      freshnessMode: "endpoint_witnessed",
      signedAt: "2026-07-17T01:00:01.000Z",
    });
    expect(reduced.state.headHash).toBe(reduced.entryHash);

    const broker = await identity(3, "broker:revoker-0001", "broker");
    const forgedState: ControlLogState = {
      ...value.state,
      activeMembers: [broker.member, value.owner.member],
    };
    const brokerEntry = await signed({
      current: forgedState,
      signer: broker,
      inner: revocation,
    });
    await expect(
      verifyAndReduceControlLogEntry({
        current: forgedState,
        entry: brokerEntry,
        verifyGrantRevocationAuthorization: async () => true,
      }),
    ).rejects.toMatchObject({
      code: "grant_revocation_authorization_required",
    });

    expect(() =>
      decodeControlLogInnerEnvelope(
        encodeAncV1Canonical(
          new Map([
            [1, "anc/v1"],
            [2, value.state.vaultId],
            [3, "grant_revocation"],
            [160, new Uint8Array([0xa1, 0x01])],
            [999, "unknown"],
          ]),
        ),
      ),
    ).toThrow();
  });

  it("round-trips and authorizes a ceremony abort without changing membership authority", async () => {
    const value = await genesis();
    const abortState = {
      suite: "anc/v1" as const,
      vaultId: value.state.vaultId,
      type: "ceremony-abort-state" as const,
      ceremonyId: "ceremony:add_device-aborted",
      ceremonyKind: "add_device" as const,
      epoch: value.state.epoch,
      expectedControlSequence: value.state.sequence,
      expectedControlHeadHash: Uint8Array.from(
        Buffer.from(value.state.headHash, "hex"),
      ),
      completedSteps: ["candidate_keys_generated", "sas_verified"],
      alertCode: "sas_mismatch",
      incompleteReason: "user_rejected",
      plaintextOutstanding: false,
      abortReason: "sas_mismatch",
      signerEndpointId: value.owner.member.endpointId,
    };
    const encodedAbortState =
      encodeAncV1CeremonyAbortStateCommitment(abortState);
    const abort: ControlCeremonyAbort = {
      suite: "anc/v1",
      type: "ceremony_abort",
      vaultId: value.state.vaultId,
      ceremonyId: "ceremony:add_device-aborted",
      ceremonyKind: "add_device",
      ceremonyStateHash: ancV1BytesToHex(
        await hashAncV1CeremonyAbortStateCommitment(abortState),
      ),
      reasonCode: "sas_mismatch",
    };
    const entry = await signed({
      current: value.state,
      signer: value.owner,
      inner: abort,
      createdAt: "2026-07-17T01:00:01.000Z",
    });
    const encoded = encodeSignedControlLogEntry(entry);
    expect(decodeSignedControlLogEntry(encoded).innerEnvelope).toEqual(abort);
    expect(ancV1BytesToHex(encodeControlLogInnerEnvelope(abort))).toBe(
      "a70166616e632f763102727661756c743a636f6e74726f6c2d30303031036e636572656d6f6e795f61626f72741897781b636572656d6f6e793a6164645f6465766963652d61626f7274656418986a6164645f64657669636518995820271d457da682c8bb2fe47f1a84886b36fe286a6946c117fc557a539416e16add189a6c7361735f6d69736d61746368",
    );
    expect(ancV1BytesToHex(encoded)).toBe(
      "aa0166616e632f763102727661756c743a636f6e74726f6c2d3030303103696c6f672d656e747279047818323032362d30372d31375430313a30303a30312e3030305a056b6c6f672d656e7472793a31186e01186f58204cb822fc990dd81261ab37ad4540529226d284e92f7f2ccca8e036239fd91d321870588ca70166616e632f763102727661756c743a636f6e74726f6c2d30303031036e636572656d6f6e795f61626f72741897781b636572656d6f6e793a6164645f6465766963652d61626f7274656418986a6164645f64657669636518995820271d457da682c8bb2fe47f1a84886b36fe286a6946c117fc557a539416e16add189a6c7361735f6d69736d61746368187173656e64706f696e743a6f776e65722d30303031187258408bdf19cf467fcd42bc5dd16859a7277025d3534c3160055284ae72da5399748c156243bc2303c46754f38a21430ab2ff63b40f71f7d4569a069d8bc488ea0706",
    );
    await expect(
      verifyAndReduceControlLogEntry({
        current: value.state,
        entry,
      }),
    ).rejects.toMatchObject({ code: "ceremony_abort_authorization_required" });
    const transcript = {
      ...abortState,
      status: "aborted" as const,
      abortLogged: true as const,
      signedLogCommitted: false as const,
      priorTermination: null,
    };
    const context = { abort, entry, current: value.state };
    const mismatches: Record<string, unknown>[] = [
      { suite: "anc/v2" },
      { type: "ceremony-abort-state-other" },
      { vaultId: "vault:other" },
      { ceremonyId: "ceremony:other" },
      { ceremonyKind: "remove_device" },
      { epoch: abortState.epoch + 1 },
      { expectedControlSequence: abortState.expectedControlSequence + 1 },
      { expectedControlHeadHash: new Uint8Array(32).fill(0xfe) },
      { completedSteps: ["candidate_keys_generated"] },
      { alertCode: "other_alert" },
      { incompleteReason: "other_reason" },
      { plaintextOutstanding: true },
      { abortReason: "other_reason" },
      { signerEndpointId: "endpoint:other" },
      { status: "active" },
      { abortLogged: false },
      { signedLogCommitted: true },
      { priorTermination: "committed" },
    ];
    for (const mismatch of mismatches) {
      await expect(
        verifyAncV1CeremonyAbortAuthorization(
          encodedAbortState,
          { ...transcript, ...mismatch } as never,
          context,
        ),
      ).rejects.toThrow();
    }
    const contextMismatches = [
      { ...context, abort: { ...abort, ceremonyId: "ceremony:other" } },
      { ...context, abort: { ...abort, ceremonyKind: "remove_device" } },
      { ...context, abort: { ...abort, reasonCode: "other_reason" } },
      {
        ...context,
        abort: { ...abort, ceremonyStateHash: "fe".repeat(32) },
      },
      {
        ...context,
        entry: { ...entry, signerEndpointId: "endpoint:other" },
      },
      { ...context, current: { ...value.state, epoch: value.state.epoch + 1 } },
      {
        ...context,
        current: { ...value.state, sequence: value.state.sequence + 1 },
      },
      {
        ...context,
        current: { ...value.state, headHash: "fe".repeat(32) },
      },
    ];
    for (const mismatch of contextMismatches) {
      await expect(
        verifyAncV1CeremonyAbortAuthorization(
          encodedAbortState,
          transcript,
          mismatch as never,
        ),
      ).rejects.toThrow();
    }
    const reduced = await verifyAndReduceControlLogEntry({
      current: value.state,
      entry,
      verifyCeremonyAbortAuthorization: (context) =>
        verifyAncV1CeremonyAbortAuthorization(
          encodedAbortState,
          transcript,
          context,
        ),
    });
    expect(reduced.state).toMatchObject({
      sequence: value.state.sequence + 1,
      membershipHash: value.state.membershipHash,
      activeMembers: value.state.activeMembers,
      removedEndpointIds: value.state.removedEndpointIds,
      epoch: value.state.epoch,
    });
  });
  it("bootstraps one self-signed endpoint and round-trips exact canonical bytes", async () => {
    const value = await genesis();
    const bytes = encodeSignedControlLogEntry(value.entry);
    expect(decodeSignedControlLogEntry(bytes)).toEqual(value.entry);
    expect(value.state).toMatchObject({
      sequence: 0,
      epoch: 1,
      freshnessMode: "endpoint_witnessed",
      activeMembers: [value.owner.member],
    });
    await expect(
      verifyAndReduceControlLogEntry({ current: null, entry: value.entry }),
    ).rejects.toMatchObject({ code: "genesis_authorization_required" });
    await expect(
      verifyAndReduceControlLogEntry({
        current: null,
        entry: value.entry,
        verifyGenesisAuthorization: async () => false,
      }),
    ).rejects.toMatchObject({ code: "genesis_authorization_required" });
    await expect(
      verifyAndReduceControlLogEntry({
        current: value.state,
        entry: value.entry,
      }),
    ).resolves.toMatchObject({ idempotent: true });
  });

  it("requires both recovery hashes iff the commit is a recovery", async () => {
    const value = await genesis();
    const base = commit({
      ceremonyKind: "add_device",
      activeMembers: value.state.activeMembers,
    });
    expect(
      controlMembershipCommitSchema.safeParse({
        ...base,
        recoverySnapshotHash: hash("a"),
      }).success,
    ).toBe(false);
    expect(
      controlMembershipCommitSchema.safeParse({
        ...base,
        recoveryAuthorizationHash: hash("b"),
      }).success,
    ).toBe(false);
    expect(
      controlMembershipCommitSchema.safeParse({
        ...base,
        recoverySnapshotHash: hash("a"),
        recoveryAuthorizationHash: hash("b"),
      }).success,
    ).toBe(false);
    const recovery = {
      ...base,
      ceremonyKind: "recovery" as const,
    };
    expect(controlMembershipCommitSchema.safeParse(recovery).success).toBe(
      false,
    );
    expect(
      controlMembershipCommitSchema.safeParse({
        ...recovery,
        recoverySnapshotHash: hash("a"),
      }).success,
    ).toBe(false);
    expect(
      controlMembershipCommitSchema.safeParse({
        ...recovery,
        recoveryAuthorizationHash: hash("b"),
      }).success,
    ).toBe(false);
    expect(
      controlMembershipCommitSchema.safeParse({
        ...recovery,
        recoverySnapshotHash: hash("a"),
        recoveryAuthorizationHash: hash("b"),
      }).success,
    ).toBe(true);
  });

  it("adds a device and broker only under the existing endpoint signer", async () => {
    const value = await genesis();
    const device = await identity(2, "endpoint:second-0001", "endpoint");
    const addDevice = await signed({
      current: value.state,
      signer: value.owner,
      inner: commit({
        ceremonyKind: "add_device",
        previousMembershipHash: value.state.membershipHash,
        activeMembers: [value.owner.member, device.member],
      }),
    });
    const withDevice = (
      await verifyAndReduceControlLogEntry({
        current: value.state,
        entry: addDevice,
      })
    ).state;
    const broker = await identity(3, "broker:primary-0001", "broker");
    const addBroker = await signed({
      current: withDevice,
      signer: value.owner,
      inner: commit({
        ceremonyKind: "add_broker",
        previousMembershipHash: withDevice.membershipHash,
        activeMembers: [broker.member, value.owner.member, device.member].sort(
          (left, right) => left.endpointId.localeCompare(right.endpointId),
        ),
      }),
    });
    const withBroker = (
      await verifyAndReduceControlLogEntry({
        current: withDevice,
        entry: addBroker,
      })
    ).state;
    expect(withBroker.activeMembers).toContainEqual(broker.member);

    const selfEnroll = await signed({
      current: value.state,
      signer: broker,
      inner: commit({
        ceremonyKind: "add_broker",
        previousMembershipHash: value.state.membershipHash,
        activeMembers: [broker.member, value.owner.member].sort((left, right) =>
          left.endpointId.localeCompare(right.endpointId),
        ),
      }),
    });
    await expect(
      verifyAndReduceControlLogEntry({
        current: value.state,
        entry: selfEnroll,
      }),
    ).rejects.toMatchObject({ code: "candidate_self_enrollment" });
  });

  it("removes a device and atomically replaces the sole broker after rotation", async () => {
    const value = await genesis();
    const device = await identity(2, "endpoint:second-0001", "endpoint");
    const broker = await identity(3, "broker:old-0001", "broker");
    const addDevice = await signed({
      current: value.state,
      signer: value.owner,
      inner: commit({
        ceremonyKind: "add_device",
        previousMembershipHash: value.state.membershipHash,
        activeMembers: [value.owner.member, device.member],
      }),
    });
    let state = (
      await verifyAndReduceControlLogEntry({
        current: value.state,
        entry: addDevice,
      })
    ).state;
    const addBroker = await signed({
      current: state,
      signer: value.owner,
      inner: commit({
        ceremonyKind: "add_broker",
        previousMembershipHash: state.membershipHash,
        activeMembers: [broker.member, value.owner.member, device.member].sort(
          (left, right) => left.endpointId.localeCompare(right.endpointId),
        ),
      }),
    });
    state = (
      await verifyAndReduceControlLogEntry({ current: state, entry: addBroker })
    ).state;
    const removeDevice = await signed({
      current: state,
      signer: value.owner,
      inner: commit({
        ceremonyKind: "remove_device",
        epoch: 2,
        previousMembershipHash: state.membershipHash,
        activeMembers: [broker.member, value.owner.member],
        removedEndpointIds: [device.member.endpointId],
        rotationCompleted: true,
        recoveryWrapHash: hash("f"),
      }),
    });
    state = (
      await verifyAndReduceControlLogEntry({
        current: state,
        entry: removeDevice,
        verifyRecoveryWrapRotation: async () => true,
      })
    ).state;
    expect(state.removedEndpointIds).toContain(device.member.endpointId);

    const reenrollRemoved = await signed({
      current: state,
      signer: value.owner,
      inner: commit({
        ceremonyKind: "add_device",
        epoch: state.epoch,
        previousMembershipHash: state.membershipHash,
        activeMembers: [broker.member, value.owner.member, device.member].sort(
          (left, right) => left.endpointId.localeCompare(right.endpointId),
        ),
      }),
    });
    await expect(
      verifyAndReduceControlLogEntry({
        current: state,
        entry: reenrollRemoved,
      }),
    ).rejects.toMatchObject({ code: "invalid_transition" });

    const replacement = await identity(4, "broker:new-0001", "broker");
    const replace = await signed({
      current: state,
      signer: value.owner,
      inner: commit({
        ceremonyKind: "broker_replacement",
        epoch: 3,
        previousMembershipHash: state.membershipHash,
        activeMembers: [replacement.member, value.owner.member],
        removedEndpointIds: [broker.member.endpointId],
        rotationCompleted: true,
        outstandingJobsResolved: true,
        recoveryWrapHash: hash("1"),
      }),
    });
    state = (
      await verifyAndReduceControlLogEntry({
        current: state,
        entry: replace,
        verifyRecoveryWrapRotation: async () => true,
      })
    ).state;
    expect(
      state.activeMembers.filter((member) => member.role === "broker"),
    ).toEqual([replacement.member]);
    expect(state.epoch).toBe(3);
    expect(state.removedEndpointIds).toEqual(
      [device.member.endpointId, broker.member.endpointId].sort(),
    );
  });

  it("removes a broker to return to device-only authority", async () => {
    const value = await genesis();
    const broker = await identity(3, "broker:removable-0001", "broker");
    const addBroker = await signed({
      current: value.state,
      signer: value.owner,
      inner: commit({
        ceremonyKind: "add_broker",
        previousMembershipHash: value.state.membershipHash,
        activeMembers: [broker.member, value.owner.member],
      }),
    });
    const withBroker = (
      await verifyAndReduceControlLogEntry({
        current: value.state,
        entry: addBroker,
      })
    ).state;
    const removeBroker = await signed({
      current: withBroker,
      signer: value.owner,
      inner: commit({
        ceremonyKind: "remove_broker",
        epoch: 2,
        previousMembershipHash: withBroker.membershipHash,
        activeMembers: [value.owner.member],
        removedEndpointIds: [broker.member.endpointId],
        rotationCompleted: true,
        outstandingJobsResolved: true,
        recoveryWrapHash: hash("f"),
      }),
    });
    await expect(
      verifyAndReduceControlLogEntry({
        current: withBroker,
        entry: removeBroker,
      }),
    ).rejects.toMatchObject({ code: "recovery_wrap_rotation_required" });
    await expect(
      verifyAndReduceControlLogEntry({
        current: withBroker,
        entry: removeBroker,
        verifyRecoveryWrapRotation: async (callback) => {
          callback.commit.epoch = 99;
          callback.entry.sequence = 99;
          callback.current.epoch = 99;
          return true;
        },
      }),
    ).resolves.toMatchObject({
      state: {
        epoch: 2,
        activeMembers: [value.owner.member],
        removedEndpointIds: [broker.member.endpointId],
      },
    });
  });

  it("requires an external recovery authorization verifier for snapshot pruning", async () => {
    const value = await genesis();
    const recovered = await identity(9, "endpoint:recovered-0001", "endpoint");
    const recovery = await signed({
      current: value.state,
      signer: recovered,
      inner: commit({
        ceremonyKind: "recovery",
        epoch: 2,
        previousMembershipHash: value.state.membershipHash,
        activeMembers: [recovered.member],
        removedEndpointIds: [value.owner.member.endpointId],
        rotationCompleted: true,
        recoverySnapshotHash: hash("a"),
        recoveryAuthorizationHash: hash("b"),
        recoveryGeneration: 2,
        recoveryId: "recovery:authority-0002",
        recoverySigningPublicKey: hash("1"),
        recoveryKeyAgreementPublicKey: hash("2"),
        recoveryWrapHash: hash("3"),
      }),
    });
    await expect(
      verifyAndReduceControlLogEntry({ current: value.state, entry: recovery }),
    ).rejects.toMatchObject({ code: "recovery_authorization_required" });
    await expect(
      verifyAndReduceControlLogEntry({
        current: value.state,
        entry: recovery,
        verifyRecoveryAuthorization: async (callback) => {
          const allowed =
            callback.commit.recoveryAuthorizationHash === hash("b");
          callback.commit.epoch = 99;
          callback.entry.sequence = 99;
          callback.current.epoch = 99;
          return allowed;
        },
      }),
    ).resolves.toMatchObject({
      state: { activeMembers: [recovered.member], epoch: 2 },
    });
  });

  it("labels endpoint-witnessed and broker-self-signed unchanged continuity", async () => {
    const value = await genesis();
    const broker = await identity(3, "broker:primary-0001", "broker");
    const addBroker = await signed({
      current: value.state,
      signer: value.owner,
      inner: commit({
        ceremonyKind: "add_broker",
        previousMembershipHash: value.state.membershipHash,
        activeMembers: [broker.member, value.owner.member],
      }),
    });
    let state = (
      await verifyAndReduceControlLogEntry({
        current: value.state,
        entry: addBroker,
      })
    ).state;
    const checkpoint = {
      suite: "anc/v1" as const,
      type: "continuity_checkpoint" as const,
      vaultId: state.vaultId,
      membershipHash: state.membershipHash,
    };
    const witnessed = await signed({
      current: state,
      signer: value.owner,
      inner: checkpoint,
      createdAt: "2026-07-17T01:10:00.000Z",
    });
    state = (
      await verifyAndReduceControlLogEntry({ current: state, entry: witnessed })
    ).state;
    expect(state.freshnessMode).toBe("endpoint_witnessed");
    const selfSigned = await signed({
      current: state,
      signer: broker,
      inner: checkpoint,
      createdAt: "2026-07-17T01:20:00.000Z",
    });
    state = (
      await verifyAndReduceControlLogEntry({
        current: state,
        entry: selfSigned,
      })
    ).state;
    expect(state.freshnessMode).toBe("eventual_fork_detection");
    expect(
      resolveControlLogEndpointAuthorization(
        state,
        broker.member.endpointId,
        new Date("2026-07-17T01:21:00.000Z"),
      ),
    ).toMatchObject({
      endpointId: broker.member.endpointId,
      authenticatedControlHead: {
        signedAt: "2026-07-17T01:20:00.000Z",
        freshnessMode: "eventual_fork_detection",
      },
    });
    expect(() =>
      assertFreshControlLogHead(state, new Date("2026-07-17T01:35:00.000Z")),
    ).toThrow("Control log verification failed");
  });

  it("detects rollback, sequence gaps, forks, wrong roles, and tampering", async () => {
    const value = await genesis();
    const continuity = {
      suite: "anc/v1" as const,
      type: "continuity_checkpoint" as const,
      vaultId: value.state.vaultId,
      membershipHash: value.state.membershipHash,
    };
    const next = await signed({
      current: value.state,
      signer: value.owner,
      inner: continuity,
    });
    const advanced = (
      await verifyAndReduceControlLogEntry({
        current: value.state,
        entry: next,
      })
    ).state;
    await expect(
      verifyAndReduceControlLogEntry({ current: advanced, entry: value.entry }),
    ).rejects.toMatchObject({ code: "rollback" });
    await expect(
      verifyAndReduceControlLogEntry({
        current: value.state,
        entry: { ...next, sequence: 2 },
      }),
    ).rejects.toMatchObject({ code: "gap" });
    await expect(
      verifyAndReduceControlLogEntry({
        current: value.state,
        entry: { ...next, previousHash: hash("c") },
      }),
    ).rejects.toMatchObject({ code: "fork" });

    const broker = await identity(3, "broker:wrong-role-0001", "broker");
    const forgedState: ControlLogState = {
      ...value.state,
      activeMembers: [broker.member, value.owner.member],
    };
    const wrongRole = await signed({
      current: forgedState,
      signer: broker,
      inner: commit({
        ceremonyKind: "add_device",
        previousMembershipHash: forgedState.membershipHash,
        activeMembers: forgedState.activeMembers,
      }),
    });
    await expect(
      verifyAndReduceControlLogEntry({
        current: forgedState,
        entry: wrongRole,
      }),
    ).rejects.toMatchObject({ code: "unauthorized_signer" });

    await expect(
      verifyAndReduceControlLogEntry({
        current: value.state,
        entry: { ...next, signature: "00".repeat(64) },
      }),
    ).rejects.toMatchObject({ code: "invalid_signature" });
  });

  it("retains more than sixty-four authenticated replay tombstones", async () => {
    const value = await genesis();
    const removedEndpointIds = Array.from(
      { length: 65 },
      (_, index) => `endpoint:removed-${index.toString().padStart(3, "0")}`,
    );
    expect(
      controlLogStateSchema.parse({
        ...value.state,
        removedEndpointIds,
      }).removedEndpointIds,
    ).toEqual(removedEndpointIds);
  });

  it("pins fixed canonical bytes and verifies the portable signature with sodium-native", async () => {
    const value = await genesis();
    const encoded = encodeSignedControlLogEntry(value.entry);
    expect(ancV1BytesToHex(encoded)).toBe(
      "aa0166616e632f763102727661756c743a636f6e74726f6c2d3030303103696c6f672d656e747279047818323032362d30372d31375430313a30303a30302e3030305a056b6c6f672d656e7472793a30186e00186f582000000000000000000000000000000000000000000000000000000000000000001870590181b20166616e632f763102727661756c743a636f6e74726f6c2d3030303103716d656d626572736869705f636f6d6d6974188c781a636572656d6f6e793a66697273745f6465766963652d30303031188d6c66697273745f646576696365188e01188ff61890818673656e64706f696e743a6f776e65722d3030303168656e64706f696e74f458208a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c58202929292929292929292929292929292929292929292929292929292929292929781e656e726f6c6c6d656e743a656e64706f696e743a6f776e65722d303030311891801892f41893f41894f61895f6189b01189c777265636f766572793a617574686f726974792d30303031189d5820cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc189e5820dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd189f5820eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee187173656e64706f696e743a6f776e65722d3030303118725840c6c99c6b3386a343ca711e1551d0a11e19ec0f71f5d4ff81d9b4714002453fde3d6de8b27b161e6fd4a68809ef121454b6930aa4e38beab1cf66050a15cad301",
    );

    const nativePublicKey = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES);
    const nativePrivateKey = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES);
    sodium.crypto_sign_seed_keypair(
      nativePublicKey,
      nativePrivateKey,
      Buffer.from(value.owner.seed),
    );
    const signature = Buffer.from(value.entry.signature, "hex");
    const { signature: _signature, ...unsigned } = value.entry;
    const nativeMessage = Buffer.concat([
      Buffer.from(e2eeDomainSeparationPrefix("log-entry")),
      Buffer.from(encodeUnsignedControlLogEntry(unsigned)),
    ]);
    expect(
      sodium.crypto_sign_verify_detached(
        signature,
        nativeMessage,
        nativePublicKey,
      ),
    ).toBe(true);
    const nativeSignature = Buffer.alloc(sodium.crypto_sign_BYTES);
    sodium.crypto_sign_detached(
      nativeSignature,
      nativeMessage,
      nativePrivateKey,
    );
    expect(nativeSignature.toString("hex")).toBe(value.entry.signature);
    expect(value.entry.signature).toBe(
      "c6c99c6b3386a343ca711e1551d0a11e19ec0f71f5d4ff81d9b4714002453fde3d6de8b27b161e6fd4a68809ef121454b6930aa4e38beab1cf66050a15cad301",
    );
  });
});
