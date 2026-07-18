import { beforeEach, describe, expect, it, vi } from "vitest";

const getHeader = vi.hoisted(() => vi.fn());
const readPrivateVaultBoundedBody = vi.hoisted(() => vi.fn());
const setResponseHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());
const decodeAncV1ControlLogGenesisAppendRequest = vi.hoisted(() => vi.fn());
const decodeAncV1ControlLogRotationAppendRequest = vi.hoisted(() => vi.fn());
const decodeAncV1ControlLogRecoveryAppendRequest = vi.hoisted(() => vi.fn());
const appendPrivateVaultControlLogGenesis = vi.hoisted(() => vi.fn());
const appendPrivateVaultControlLogRotation = vi.hoisted(() => vi.fn());
const appendPrivateVaultControlLogRecovery = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/e2ee", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/e2ee")>()),
  decodeAncV1ControlLogGenesisAppendRequest: (...args: unknown[]) =>
    decodeAncV1ControlLogGenesisAppendRequest(...args),
  decodeAncV1ControlLogRotationAppendRequest: (...args: unknown[]) =>
    decodeAncV1ControlLogRotationAppendRequest(...args),
  decodeAncV1ControlLogRecoveryAppendRequest: (...args: unknown[]) =>
    decodeAncV1ControlLogRecoveryAppendRequest(...args),
}));
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (...args: unknown[]) => getHeader(...args),
  setResponseHeader: (...args: unknown[]) => setResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => setResponseStatus(...args),
}));
vi.mock("../../../../lib/private-vault-bounded-body.js", () => ({
  readPrivateVaultBoundedBody: (...args: unknown[]) =>
    readPrivateVaultBoundedBody(...args),
}));
vi.mock("../../../../lib/private-vault-control-log-append.js", () => ({
  appendPrivateVaultControlLogGenesis: (...args: unknown[]) =>
    appendPrivateVaultControlLogGenesis(...args),
  appendPrivateVaultControlLogRotation: (...args: unknown[]) =>
    appendPrivateVaultControlLogRotation(...args),
  appendPrivateVaultControlLogRecovery: (...args: unknown[]) =>
    appendPrivateVaultControlLogRecovery(...args),
  PrivateVaultControlLogAppendError: class extends Error {
    constructor(readonly code: string) {
      super("append failed");
    }
  },
}));

import { ANC_V1_CONTROL_LOG_APPEND_REQUEST_MAX_BYTES } from "@agent-native/core/e2ee";

import { PrivateVaultControlLogAppendError } from "../../../../lib/private-vault-control-log-append.js";
import handler from "./append.post";

const proof = {
  version: 1,
  suite: "anc/v1",
  type: "endpoint_request",
  vaultId: "vault:test-0001",
  endpointId: "endpoint:test-0001",
  method: "POST",
  path: "/api/private-vault/control-log/append",
  bodyHash: "11".repeat(32),
  issuedAt: "2026-07-17T01:00:00.000Z",
  nonce: "22".repeat(16),
  signature: "33".repeat(64),
};
const proofHeader = Buffer.from(JSON.stringify(proof)).toString("base64url");
const headers: Record<string, string> = {
  "x-anc-endpoint-request-proof": proofHeader,
  "content-type": "application/vnd.agent-native.control-log+cbor",
  "content-length": "4",
};

describe("POST /api/private-vault/control-log/append", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getHeader.mockImplementation((_event, name: string) => headers[name]);
    readPrivateVaultBoundedBody.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    decodeAncV1ControlLogGenesisAppendRequest.mockImplementation(() => {
      throw new Error("not genesis");
    });
    decodeAncV1ControlLogRecoveryAppendRequest.mockImplementation(() => {
      throw new Error("not recovery");
    });
    decodeAncV1ControlLogRotationAppendRequest.mockReturnValue({
      type: "control-log-rotation-append-request",
    });
    appendPrivateVaultControlLogGenesis.mockResolvedValue(
      new Uint8Array([8, 9]),
    );
    appendPrivateVaultControlLogRotation.mockResolvedValue(
      new Uint8Array([5, 6, 7]),
    );
    appendPrivateVaultControlLogRecovery.mockResolvedValue(
      new Uint8Array([4, 5]),
    );
  });

  it("rejects malformed proof transport before reading an anonymous body", async () => {
    getHeader.mockImplementation((_event, name: string) =>
      name === "x-anc-endpoint-request-proof" ? "not+base64" : headers[name],
    );
    await expect(handler({} as never)).resolves.toEqual({ error: "Not found" });
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 404);
    expect(readPrivateVaultBoundedBody).not.toHaveBeenCalled();
    expect(appendPrivateVaultControlLogGenesis).not.toHaveBeenCalled();
    expect(appendPrivateVaultControlLogRotation).not.toHaveBeenCalled();
  });

  it("dispatches only a strictly decoded genesis envelope to sequence zero", async () => {
    decodeAncV1ControlLogGenesisAppendRequest.mockReturnValue({
      type: "control-log-genesis-append-request",
    });
    const result = await handler({} as never);
    expect(appendPrivateVaultControlLogGenesis).toHaveBeenCalledWith({
      body: new Uint8Array([1, 2, 3, 4]),
      proof,
    });
    expect(appendPrivateVaultControlLogRotation).not.toHaveBeenCalled();
    expect(result).toEqual(new Uint8Array([8, 9]));
  });

  it("rejects an envelope that matches neither canonical request type", async () => {
    decodeAncV1ControlLogRotationAppendRequest.mockImplementation(() => {
      throw new Error("not rotation");
    });
    await expect(handler({} as never)).resolves.toEqual({ error: "Not found" });
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 404);
    expect(appendPrivateVaultControlLogGenesis).not.toHaveBeenCalled();
    expect(appendPrivateVaultControlLogRotation).not.toHaveBeenCalled();
  });

  it("dispatches a distinct recovery envelope before ordinary rotation", async () => {
    decodeAncV1ControlLogRecoveryAppendRequest.mockReturnValue({
      type: "control-log-recovery-append-request",
    });
    await expect(handler({} as never)).resolves.toEqual(new Uint8Array([4, 5]));
    expect(appendPrivateVaultControlLogRecovery).toHaveBeenCalledWith({
      body: new Uint8Array([1, 2, 3, 4]),
      proof,
    });
    expect(appendPrivateVaultControlLogRotation).not.toHaveBeenCalled();
  });

  it("streams only the declared bounded binary body into proof verification", async () => {
    const result = await handler({} as never);
    expect(readPrivateVaultBoundedBody).toHaveBeenCalledWith(
      expect.anything(),
      4,
      ANC_V1_CONTROL_LOG_APPEND_REQUEST_MAX_BYTES,
    );
    expect(appendPrivateVaultControlLogRotation).toHaveBeenCalledWith({
      body: new Uint8Array([1, 2, 3, 4]),
      proof,
    });
    expect(result).toEqual(new Uint8Array([5, 6, 7]));
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Cache-Control",
      "no-store",
    );
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Content-Length",
      "3",
    );
  });

  it("keeps authenticated append conflicts content-free", async () => {
    appendPrivateVaultControlLogRotation.mockRejectedValue(
      new PrivateVaultControlLogAppendError("conflict"),
    );
    await expect(handler({} as never)).resolves.toEqual({
      error: "Request unavailable",
    });
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 409);
  });
});
