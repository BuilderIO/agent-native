import { describe, expect, it } from "vitest";

import {
  ANC_V1_VAULT_BOOTSTRAP_CONTROL_MAX_BYTES,
  ANC_V1_VAULT_BOOTSTRAP_FRAME_MAX_BYTES,
  ANC_V1_VAULT_BOOTSTRAP_PAGE_MAX_ENTRIES,
  AncV1VaultBootstrapProtocolError,
  decodeAncV1VaultBootstrapRequest,
  decodeAncV1VaultBootstrapResponse,
  encodeAncV1VaultBootstrapRequest,
  encodeAncV1VaultBootstrapResponse,
} from "./vault-bootstrap-protocol.js";

const vaultId = "vault-bootstrap-0001";
const head = { sequence: 1, hash: "ab".repeat(32) };

describe("anc/v1 vault bootstrap protocol", () => {
  it("round-trips canonical initial and pinned continuation requests", () => {
    const initial = {
      version: 1,
      suite: "anc/v1",
      type: "vault-bootstrap-request",
      afterSequence: -1,
      expectedHead: null,
    } as const;
    const encoded = encodeAncV1VaultBootstrapRequest(initial);
    expect(decodeAncV1VaultBootstrapRequest(encoded)).toEqual(initial);

    const continued = {
      ...initial,
      afterSequence: 0,
      expectedHead: head,
    } as const;
    expect(
      decodeAncV1VaultBootstrapRequest(
        encodeAncV1VaultBootstrapRequest(continued),
      ),
    ).toEqual(continued);
  });

  it("round-trips contiguous pages and places the recovery wrap only at the head", () => {
    const first = encodeAncV1VaultBootstrapResponse({
      metadata: {
        version: 1,
        suite: "anc/v1",
        type: "vault-bootstrap-response",
        vaultId,
        afterSequence: -1,
        throughSequence: 0,
        head,
        complete: false,
        recoveryWrapHash: null,
      },
      entries: [Uint8Array.of(1, 2, 3)],
      entryRecoveryWraps: [Uint8Array.of(9)],
      recoveryWrap: null,
    });
    expect(decodeAncV1VaultBootstrapResponse(first)).toEqual({
      metadata: {
        version: 1,
        suite: "anc/v1",
        type: "vault-bootstrap-response",
        vaultId,
        afterSequence: -1,
        throughSequence: 0,
        head,
        complete: false,
        entryByteLengths: [3],
        entryRecoveryWrapByteLengths: [1],
        recoveryWrapHash: null,
        recoveryWrapByteLength: 0,
      },
      entries: [Uint8Array.of(1, 2, 3)],
      entryRecoveryWraps: [Uint8Array.of(9)],
      recoveryWrap: null,
    });

    const final = encodeAncV1VaultBootstrapResponse({
      metadata: {
        version: 1,
        suite: "anc/v1",
        type: "vault-bootstrap-response",
        vaultId,
        afterSequence: 0,
        throughSequence: 1,
        head,
        complete: true,
        recoveryWrapHash: "cd".repeat(32),
      },
      entries: [Uint8Array.of(4, 5)],
      entryRecoveryWraps: [null],
      recoveryWrap: Uint8Array.of(6, 7, 8),
    });
    expect(decodeAncV1VaultBootstrapResponse(final)).toMatchObject({
      metadata: {
        throughSequence: 1,
        complete: true,
        entryByteLengths: [2],
        entryRecoveryWrapByteLengths: [0],
        recoveryWrapByteLength: 3,
      },
      entries: [Uint8Array.of(4, 5)],
      entryRecoveryWraps: [null],
      recoveryWrap: Uint8Array.of(6, 7, 8),
    });
  });

  it("rejects noncanonical controls, cursor ambiguity, gaps, and misplaced wraps", () => {
    const initial = encodeAncV1VaultBootstrapRequest({
      version: 1,
      suite: "anc/v1",
      type: "vault-bootstrap-request",
      afterSequence: -1,
      expectedHead: null,
    });
    expect(() =>
      decodeAncV1VaultBootstrapRequest(
        new TextEncoder().encode(
          JSON.stringify(
            JSON.parse(new TextDecoder().decode(initial)),
            null,
            2,
          ),
        ),
      ),
    ).toThrow(AncV1VaultBootstrapProtocolError);
    expect(() =>
      encodeAncV1VaultBootstrapRequest({
        version: 1,
        suite: "anc/v1",
        type: "vault-bootstrap-request",
        afterSequence: 0,
        expectedHead: null,
      }),
    ).toThrow(AncV1VaultBootstrapProtocolError);
    expect(() =>
      encodeAncV1VaultBootstrapResponse({
        metadata: {
          version: 1,
          suite: "anc/v1",
          type: "vault-bootstrap-response",
          vaultId,
          afterSequence: -1,
          throughSequence: 1,
          head,
          complete: true,
          recoveryWrapHash: "cd".repeat(32),
        },
        entries: [Uint8Array.of(1)],
        entryRecoveryWraps: [null],
        recoveryWrap: Uint8Array.of(2),
      }),
    ).toThrow(AncV1VaultBootstrapProtocolError);
  });

  it("rejects truncation, trailing bytes, oversized pages, and oversized controls", () => {
    const frame = encodeAncV1VaultBootstrapResponse({
      metadata: {
        version: 1,
        suite: "anc/v1",
        type: "vault-bootstrap-response",
        vaultId,
        afterSequence: -1,
        throughSequence: 1,
        head,
        complete: true,
        recoveryWrapHash: "cd".repeat(32),
      },
      entries: [Uint8Array.of(1), Uint8Array.of(2)],
      entryRecoveryWraps: [null, Uint8Array.of(8, 9)],
      recoveryWrap: Uint8Array.of(3),
    });
    expect(() => decodeAncV1VaultBootstrapResponse(frame.slice(0, -1))).toThrow(
      AncV1VaultBootstrapProtocolError,
    );
    const trailing = new Uint8Array(frame.byteLength + 1);
    trailing.set(frame);
    expect(() => decodeAncV1VaultBootstrapResponse(trailing)).toThrow(
      AncV1VaultBootstrapProtocolError,
    );
    expect(() =>
      encodeAncV1VaultBootstrapResponse({
        metadata: {
          version: 1,
          suite: "anc/v1",
          type: "vault-bootstrap-response",
          vaultId,
          afterSequence: -1,
          throughSequence: ANC_V1_VAULT_BOOTSTRAP_PAGE_MAX_ENTRIES,
          head: {
            sequence: ANC_V1_VAULT_BOOTSTRAP_PAGE_MAX_ENTRIES,
            hash: "ab".repeat(32),
          },
          complete: true,
          recoveryWrapHash: "cd".repeat(32),
        },
        entries: Array.from(
          { length: ANC_V1_VAULT_BOOTSTRAP_PAGE_MAX_ENTRIES + 1 },
          () => Uint8Array.of(1),
        ),
        entryRecoveryWraps: Array.from(
          { length: ANC_V1_VAULT_BOOTSTRAP_PAGE_MAX_ENTRIES + 1 },
          () => null,
        ),
        recoveryWrap: Uint8Array.of(2),
      }),
    ).toThrow(AncV1VaultBootstrapProtocolError);
    expect(() =>
      decodeAncV1VaultBootstrapRequest(
        new Uint8Array(ANC_V1_VAULT_BOOTSTRAP_CONTROL_MAX_BYTES + 1),
      ),
    ).toThrow(AncV1VaultBootstrapProtocolError);
    expect(() =>
      decodeAncV1VaultBootstrapResponse(
        new Uint8Array(ANC_V1_VAULT_BOOTSTRAP_FRAME_MAX_BYTES + 1),
      ),
    ).toThrow(AncV1VaultBootstrapProtocolError);
  });
});
