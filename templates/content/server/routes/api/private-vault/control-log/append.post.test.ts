import { beforeEach, describe, expect, it, vi } from "vitest";

const getHeader = vi.hoisted(() => vi.fn());
const readPrivateVaultBoundedBody = vi.hoisted(() => vi.fn());
const setResponseHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());
const appendPrivateVaultControlLogRotation = vi.hoisted(() => vi.fn());

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
  appendPrivateVaultControlLogRotation: (...args: unknown[]) =>
    appendPrivateVaultControlLogRotation(...args),
  PrivateVaultControlLogAppendError: class extends Error {
    constructor(readonly code: string) {
      super("append failed");
    }
  },
}));

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
    appendPrivateVaultControlLogRotation.mockResolvedValue(
      new Uint8Array([5, 6, 7]),
    );
  });

  it("rejects malformed proof transport before reading an anonymous body", async () => {
    getHeader.mockImplementation((_event, name: string) =>
      name === "x-anc-endpoint-request-proof" ? "not+base64" : headers[name],
    );
    await expect(handler({} as never)).resolves.toEqual({ error: "Not found" });
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 404);
    expect(readPrivateVaultBoundedBody).not.toHaveBeenCalled();
    expect(appendPrivateVaultControlLogRotation).not.toHaveBeenCalled();
  });

  it("streams only the declared bounded binary body into proof verification", async () => {
    const result = await handler({} as never);
    expect(readPrivateVaultBoundedBody).toHaveBeenCalledWith(
      expect.anything(),
      4,
      1_114_368,
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
