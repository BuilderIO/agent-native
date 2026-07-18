import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const getHeader = vi.hoisted(() => vi.fn());
const getRouterParam = vi.hoisted(() => vi.fn());
const setResponseHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());
const deleteObject = vi.hoisted(() => vi.fn());

vi.mock("../../../../lib/private-vault-genesis-account-scope.js", () => ({
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
vi.mock("../../../../lib/private-vault-objects.js", () => ({
  PrivateVaultObjectNotFoundError: class extends Error {},
  privateVaultObjectService: { deleteObject },
}));

import handler from "./[objectId].delete";

describe("DELETE /api/private-vault/objects/:objectId", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getHeader.mockImplementation((_event, name: string) =>
      name === "x-agent-native-csrf" ? "1" : undefined,
    );
    getRouterParam.mockReturnValue("object:test-0001");
  });

  it("returns the uniform not-found response for an unauthenticated mutation", async () => {
    getSession.mockResolvedValue(null);

    const result = await handler({} as never);

    expect(result).toEqual({ error: "Not found" });
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 404);
    expect(deleteObject).not.toHaveBeenCalled();
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
