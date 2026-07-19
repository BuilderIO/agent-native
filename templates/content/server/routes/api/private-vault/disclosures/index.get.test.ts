import { beforeEach, describe, expect, it, vi } from "vitest";

const setResponseHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());
const resolveScope = vi.hoisted(() => vi.fn());
const list = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (event: { headers: Record<string, string> }, name: string) =>
    event.headers[name],
  setResponseHeader: (...arguments_: unknown[]) =>
    setResponseHeader(...arguments_),
  setResponseStatus: (...arguments_: unknown[]) =>
    setResponseStatus(...arguments_),
}));
vi.mock("../../../../lib/private-vault-genesis-account-scope.js", () => ({
  resolveAuthenticatedPrivateVaultScope: (...arguments_: unknown[]) =>
    resolveScope(...arguments_),
}));
vi.mock("../../../../lib/private-vault-signed-disclosures.js", () => ({
  privateVaultSignedDisclosureService: { list },
}));

import handler from "./index.get.js";

const scope = {
  ownerEmail: "owner@example.com",
  orgId: "org_12345678",
  vaultId: "11".repeat(16),
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveScope.mockResolvedValue(scope);
});

describe("Private Vault disclosure activity route", () => {
  it("returns only session-scoped content-free signed rows", async () => {
    list.mockResolvedValue([
      {
        disclosureId: "22".repeat(16),
        vaultId: scope.vaultId,
        endpointId: "33".repeat(16),
        jobId: "44".repeat(16),
        grantId: "55".repeat(16),
        grantRef: "66".repeat(32),
        resourceId: "77".repeat(16),
        operation: "get-document",
        providerId: "codex-cli",
        destination: "gpt-5.6",
        outcome: "allowed",
        scopeHash: "88".repeat(32),
        issuedAt: "2026-07-18T12:00:00.000Z",
        expiresAt: "2026-07-18T12:10:00.000Z",
        serverReceivedAt: "2026-07-18T12:00:01.000Z",
        signedEnvelope: "oQEB",
      },
    ]);
    const event = { headers: { "x-anc-vault-id": scope.vaultId } };
    const result = await (handler as (event: unknown) => Promise<unknown>)(
      event,
    );
    expect(resolveScope).toHaveBeenCalledWith(event, scope.vaultId);
    expect(list).toHaveBeenCalledWith(scope, 50);
    expect(result).toEqual({
      version: 1,
      suite: "anc/v1",
      disclosures: [
        {
          disclosureId: "22".repeat(16),
          vaultId: scope.vaultId,
          endpointId: "33".repeat(16),
          jobId: "44".repeat(16),
          grantId: "55".repeat(16),
          resourceId: "77".repeat(16),
          operation: "get-document",
          providerId: "codex-cli",
          destination: "gpt-5.6",
          outcome: "allowed",
          issuedAt: "2026-07-18T12:00:00.000Z",
          expiresAt: "2026-07-18T12:10:00.000Z",
          serverReceivedAt: "2026-07-18T12:00:01.000Z",
          signedEnvelope: "oQEB",
        },
      ],
    });
  });
});
