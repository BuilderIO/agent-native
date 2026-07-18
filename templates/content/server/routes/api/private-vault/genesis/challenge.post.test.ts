import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const getOrgContext = vi.hoisted(() => vi.fn());
const getHeader = vi.hoisted(() => vi.fn());
const readBody = vi.hoisted(() => vi.fn());
const resolveScope = vi.hoisted(() => vi.fn());
const issueChallenge = vi.hoisted(() => vi.fn());
const setResponseHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getCurrentBetterAuthSession: getSession,
}));
vi.mock("@agent-native/core/org", () => ({ getOrgContext }));
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (...args: unknown[]) => getHeader(...args),
  setResponseHeader: (...args: unknown[]) => setResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => setResponseStatus(...args),
}));
vi.mock("../../../../lib/private-vault-bounded-body.js", () => ({
  readPrivateVaultBoundedBody: (...args: unknown[]) => readBody(...args),
}));
vi.mock("../../../../lib/private-vault-genesis-account-scope.js", () => ({
  resolvePrivateVaultGenesisAccountScope: (...args: unknown[]) =>
    resolveScope(...args),
}));
vi.mock("../../../../lib/private-vault-genesis-admission.js", () => ({
  issuePrivateVaultGenesisChallenge: (...args: unknown[]) =>
    issueChallenge(...args),
  PrivateVaultGenesisAdmissionError: class extends Error {
    constructor(readonly code: string) {
      super("challenge failed");
    }
  },
}));

import { ANC_V1_GENESIS_ACCOUNT_ADMISSION_CANDIDATE_MAX_BYTES } from "@agent-native/core/e2ee";

import handler from "./challenge.post";

const scope = {
  subjectId: "stable-user",
  ownerEmail: "owner@example.test",
  orgId: "org-1",
  role: "member",
  accountId: `account:${"a".repeat(64)}`,
  workspaceId: `workspace:${"b".repeat(64)}`,
};
const headers: Record<string, string> = {
  "sec-fetch-site": "same-origin",
  "content-type":
    "application/vnd.agent-native.genesis-admission-candidate+cbor",
  "content-length": "3",
};

describe("POST /api/private-vault/genesis/challenge", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getHeader.mockImplementation((_event, name: string) => headers[name]);
    getSession.mockResolvedValue({
      email: "owner@example.test",
      userId: "stable-user",
    });
    getOrgContext.mockResolvedValue({
      email: "owner@example.test",
      orgId: "org-1",
      role: "member",
    });
    resolveScope.mockResolvedValue(scope);
    readBody.mockResolvedValue(new Uint8Array([1, 2, 3]));
    issueChallenge.mockResolvedValue(new Uint8Array([4, 5]));
  });

  it("issues only after stable identity, current membership, and bounded candidate read", async () => {
    await expect(handler({} as never)).resolves.toEqual(new Uint8Array([4, 5]));
    expect(readBody).toHaveBeenCalledWith(
      expect.anything(),
      3,
      ANC_V1_GENESIS_ACCOUNT_ADMISSION_CANDIDATE_MAX_BYTES,
    );
    expect(issueChallenge).toHaveBeenCalledWith({
      scope,
      candidate: new Uint8Array([1, 2, 3]),
    });
  });

  it("fails closed after membership removal without reading candidate bytes", async () => {
    resolveScope.mockResolvedValue(null);
    await expect(handler({} as never)).resolves.toEqual({ error: "Not found" });
    expect(readBody).not.toHaveBeenCalled();
  });
});
