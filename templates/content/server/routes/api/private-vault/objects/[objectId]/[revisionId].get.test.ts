import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const getHeader = vi.hoisted(() => vi.fn());
const getRouterParam = vi.hoisted(() => vi.fn());
const setResponseHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());
const getRevision = vi.hoisted(() => vi.fn());

vi.mock("../../../../../lib/private-vault-genesis-account-scope.js", () => ({
  resolveAuthenticatedPrivateVaultScope: (...args: unknown[]) =>
    getSession(...args),
}));
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (...args: unknown[]) => getHeader(...args),
  getRouterParam: (...args: unknown[]) => getRouterParam(...args),
  setResponseHeader: (...args: unknown[]) => setResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => setResponseStatus(...args),
}));
vi.mock("../../../../../lib/private-vault-objects.js", () => ({
  PrivateVaultObjectNotFoundError: class extends Error {},
  privateVaultObjectService: { getRevision },
}));

import handler from "./[revisionId].get";

describe("GET /api/private-vault/objects/:objectId/:revisionId", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getHeader.mockReturnValue("vault:test-0001");
    getRouterParam.mockImplementation((_event, name: string) =>
      name === "objectId" ? "object:test-0001" : "revision:test-0001",
    );
  });

  it("returns the uniform not-found response without disclosing session state", async () => {
    getSession.mockResolvedValue(null);

    const result = await handler({} as never);

    expect(result).toEqual({ error: "Not found" });
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 404);
    expect(getRevision).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("provider");
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
});
