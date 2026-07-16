import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const getHeader = vi.hoisted(() => vi.fn());
const getRouterParam = vi.hoisted(() => vi.fn());
const setResponseHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());
const getResult = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getSession: (...args: unknown[]) => getSession(...args),
}));
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (...args: unknown[]) => getHeader(...args),
  getRouterParam: (...args: unknown[]) => getRouterParam(...args),
  setResponseHeader: (...args: unknown[]) => setResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => setResponseStatus(...args),
}));
vi.mock("../../../../../lib/private-vault-jobs.js", () => ({
  PrivateVaultJobNotFoundError: class extends Error {},
  privateVaultJobService: { getResult },
}));

import handler from "./result.get";

describe("GET /api/private-vault/jobs/:jobId/result", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getHeader.mockReturnValue("vault:test-0001");
    getRouterParam.mockReturnValue("job:test-0001");
  });

  it("uses the same hardened 404 for a missing session", async () => {
    getSession.mockResolvedValue(null);

    const response = await handler({} as never);

    expect(response).toEqual({ error: "Not found" });
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 404);
    expect(getResult).not.toHaveBeenCalled();
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Cache-Control",
      "no-store",
    );
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Referrer-Policy",
      "no-referrer",
    );
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "X-Content-Type-Options",
      "nosniff",
    );
  });

  it("returns exact ciphertext and only admitted result metadata", async () => {
    getSession.mockResolvedValue({
      email: "owner@example.test",
      orgId: "org:test-0001",
    });
    getResult.mockResolvedValue({
      result: {
        ciphertextByteLength: 4,
        algorithmId: "anc/v1",
        epoch: 2,
        jobHash: "digest:job-test-0001",
        state: "completed",
      },
      ciphertext: new Uint8Array([1, 2, 3, 4]),
    });

    const response = await handler({} as never);

    expect(response).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(getResult).toHaveBeenCalledWith(
      {
        ownerEmail: "owner@example.test",
        orgId: "org:test-0001",
        vaultId: "vault:test-0001",
      },
      "job:test-0001",
    );
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Content-Type",
      "application/octet-stream",
    );
    expect(JSON.stringify(response)).not.toContain("provider");
    expect(JSON.stringify(response)).not.toContain("url");
  });
});
