import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const getOrgContext = vi.hoisted(() => vi.fn());
const getHeader = vi.hoisted(() => vi.fn());
const readPrivateVaultBoundedBody = vi.hoisted(() => vi.fn());
const resolveScope = vi.hoisted(() => vi.fn());
const setResponseHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());
const admitPrivateVaultGenesis = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getCurrentBetterAuthSession: (...args: unknown[]) => getSession(...args),
}));
vi.mock("@agent-native/core/org", () => ({
  getOrgContext: (...args: unknown[]) => getOrgContext(...args),
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
vi.mock("../../../../lib/private-vault-genesis-account-scope.js", () => ({
  resolvePrivateVaultGenesisAccountScope: (...args: unknown[]) =>
    resolveScope(...args),
}));
vi.mock("../../../../lib/private-vault-genesis-admission.js", () => ({
  admitPrivateVaultGenesis: (...args: unknown[]) =>
    admitPrivateVaultGenesis(...args),
  PrivateVaultGenesisAdmissionError: class extends Error {
    constructor(readonly code: string) {
      super("admission failed");
    }
  },
}));

import { ANC_V1_GENESIS_ACCOUNT_ADMISSION_REQUEST_MAX_BYTES } from "@agent-native/core/e2ee";

import { PrivateVaultGenesisAdmissionError } from "../../../../lib/private-vault-genesis-admission.js";
import handler from "./admit.post";

const scope = {
  subjectId: "stable-user-1",
  ownerEmail: "owner@example.test",
  orgId: "org-trusted",
  role: "member",
  accountId: `account:${"a".repeat(64)}`,
  workspaceId: `workspace:${"b".repeat(64)}`,
};
const proofHeader = Buffer.from(
  JSON.stringify({
    version: 1,
    suite: "anc/v1",
    type: "endpoint_request",
    vaultId: "11".repeat(16),
    endpointId: "22".repeat(16),
    method: "POST",
    path: "/api/private-vault/genesis/admit",
    bodyHash: "33".repeat(32),
    issuedAt: "2026-07-18T00:00:00.000Z",
    nonce: "44".repeat(16),
    signature: "55".repeat(64),
  }),
).toString("base64url");
const headers: Record<string, string> = {
  "sec-fetch-site": "same-origin",
  "content-type": "application/vnd.agent-native.genesis-admission+cbor",
  "content-length": "4",
  "x-anc-endpoint-request-proof": proofHeader,
};

describe("POST /api/private-vault/genesis/admit", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getHeader.mockImplementation((_event, name: string) => headers[name]);
    getSession.mockResolvedValue({
      email: "Owner@Example.Test",
      userId: "stable-user-1",
    });
    getOrgContext.mockResolvedValue({
      email: "owner@example.test",
      orgId: "org-trusted",
      orgName: "Trusted",
      role: "member",
    });
    resolveScope.mockResolvedValue(scope);
    readPrivateVaultBoundedBody.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    admitPrivateVaultGenesis.mockResolvedValue(new Uint8Array([5, 6, 7]));
  });

  it("checks same-origin CSRF before identity, membership, or body access", async () => {
    getHeader.mockReturnValue(undefined);
    await expect(handler({} as never)).resolves.toEqual({
      error: "Request unavailable",
    });
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 403);
    expect(getSession).not.toHaveBeenCalled();
    expect(resolveScope).not.toHaveBeenCalled();
  });

  it("requires a stable subject and live membership-derived scope", async () => {
    const result = await handler({} as never);
    expect(resolveScope).toHaveBeenCalledWith({
      userId: "stable-user-1",
      email: "Owner@Example.Test",
      orgId: "org-trusted",
    });
    expect(readPrivateVaultBoundedBody).toHaveBeenCalledWith(
      expect.anything(),
      4,
      ANC_V1_GENESIS_ACCOUNT_ADMISSION_REQUEST_MAX_BYTES,
    );
    expect(admitPrivateVaultGenesis).toHaveBeenCalledWith({
      scope,
      body: new Uint8Array([1, 2, 3, 4]),
      proof: expect.objectContaining({ signature: "55".repeat(64) }),
    });
    expect(result).toEqual(new Uint8Array([5, 6, 7]));
  });

  it("fails closed for BYOA-like identities and stale removed memberships", async () => {
    getSession.mockResolvedValue({ email: "owner@example.test" });
    await expect(handler({} as never)).resolves.toEqual({ error: "Not found" });
    expect(resolveScope).not.toHaveBeenCalled();

    getSession.mockResolvedValue({
      email: "owner@example.test",
      userId: "stable-user-1",
    });
    resolveScope.mockResolvedValue(null);
    await expect(handler({} as never)).resolves.toEqual({ error: "Not found" });
    expect(readPrivateVaultBoundedBody).not.toHaveBeenCalled();
  });

  it("rejects a missing endpoint proof before body admission", async () => {
    getHeader.mockImplementation((_event, name: string) =>
      name === "x-anc-endpoint-request-proof" ? undefined : headers[name],
    );
    await expect(handler({} as never)).resolves.toEqual({
      error: "Request unavailable",
    });
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 400);
    expect(readPrivateVaultBoundedBody).not.toHaveBeenCalled();
  });

  it("returns uniform unavailable responses for conflicts and storage failures", async () => {
    admitPrivateVaultGenesis.mockRejectedValue(
      new PrivateVaultGenesisAdmissionError("conflict"),
    );
    await handler({} as never);
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 409);

    admitPrivateVaultGenesis.mockRejectedValue(
      new PrivateVaultGenesisAdmissionError("unavailable"),
    );
    await handler({} as never);
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 503);
  });
});
