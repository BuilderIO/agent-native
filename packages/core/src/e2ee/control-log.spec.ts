import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { ancV1BytesToHex } from "./canonical.js";
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
  type ControlMembershipCommit,
  controlLogStateSchema,
  createSignedControlLogEntry,
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
    ...patch,
  };
}

async function signed(input: {
  current: ControlLogState | null;
  inner:
    | ControlMembershipCommit
    | ControlCeremonyAbort
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
      "a70166616e632f763102727661756c743a636f6e74726f6c2d30303031036e636572656d6f6e795f61626f72741897781b636572656d6f6e793a6164645f6465766963652d61626f7274656418986a6164645f64657669636518995820de0a32eedbf3346e32783650b1f54ce81de542ea69d7d613990d1e15ebdf0eb6189a6c7361735f6d69736d61746368",
    );
    expect(ancV1BytesToHex(encoded)).toBe(
      "aa0166616e632f763102727661756c743a636f6e74726f6c2d3030303103696c6f672d656e747279047818323032362d30372d31375430313a30303a30312e3030305a056b6c6f672d656e7472793a31186e01186f58208ec347170a0141befdf29e8bb47d63137e891668699cad0432b7315f93b3ec8a1870588ca70166616e632f763102727661756c743a636f6e74726f6c2d30303031036e636572656d6f6e795f61626f72741897781b636572656d6f6e793a6164645f6465766963652d61626f7274656418986a6164645f64657669636518995820dda765dd954038664146fd02558d9766f22e4af04217b66e54541670f3ec2599189a6c7361735f6d69736d61746368187173656e64706f696e743a6f776e65722d3030303118725840199140b5a503274c4f437306da1d85dcdd2a72672bfe5c0a36049fec241951c3a144bf898e9e38017b5f731c72c905a8993eed6b5a38ca6197e147aa452d5e0c",
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
      }),
    });
    state = (
      await verifyAndReduceControlLogEntry({
        current: state,
        entry: removeDevice,
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
      }),
    });
    state = (
      await verifyAndReduceControlLogEntry({ current: state, entry: replace })
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
      }),
    });
    await expect(
      verifyAndReduceControlLogEntry({
        current: withBroker,
        entry: removeBroker,
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
      }),
    });
    await expect(
      verifyAndReduceControlLogEntry({ current: value.state, entry: recovery }),
    ).rejects.toMatchObject({ code: "recovery_authorization_required" });
    await expect(
      verifyAndReduceControlLogEntry({
        current: value.state,
        entry: recovery,
        verifyRecoveryAuthorization: async ({ commit: candidate }) =>
          candidate.recoveryAuthorizationHash === hash("b"),
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
      "aa0166616e632f763102727661756c743a636f6e74726f6c2d3030303103696c6f672d656e747279047818323032362d30372d31375430313a30303a30302e3030305a056b6c6f672d656e7472793a30186e00186f58200000000000000000000000000000000000000000000000000000000000000000187058f8ad0166616e632f763102727661756c743a636f6e74726f6c2d3030303103716d656d626572736869705f636f6d6d6974188c781a636572656d6f6e793a66697273745f6465766963652d30303031188d6c66697273745f646576696365188e01188ff61890818673656e64706f696e743a6f776e65722d3030303168656e64706f696e74f458208a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c58202929292929292929292929292929292929292929292929292929292929292929781e656e726f6c6c6d656e743a656e64706f696e743a6f776e65722d303030311891801892f41893f41894f61895f6187173656e64706f696e743a6f776e65722d3030303118725840d3d1b152295cb1d4000bf303c4f30cc26ac3c88c421b763f93f84d3d90a2707166a12f95eacbfe49325faab537d500e7828b934bb1740685814a9491ef19220c",
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
      "d3d1b152295cb1d4000bf303c4f30cc26ac3c88c421b763f93f84d3d90a2707166a12f95eacbfe49325faab537d500e7828b934bb1740685814a9491ef19220c",
    );
  });
});
