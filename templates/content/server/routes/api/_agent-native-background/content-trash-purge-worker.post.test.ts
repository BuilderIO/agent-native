import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readBody: vi.fn(),
  setResponseStatus: vi.fn(),
  verifyToken: vi.fn(),
  runWithRequestContext: vi.fn(),
  processPurge: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  readBody: (...args: unknown[]) => mocks.readBody(...args),
  setResponseStatus: (...args: unknown[]) => mocks.setResponseStatus(...args),
}));

vi.mock("drizzle-orm", () => ({ eq: vi.fn(() => "eq") }));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (...args: unknown[]) =>
    mocks.runWithRequestContext(...args),
  verifyScopedAgentAccessToken: (...args: unknown[]) =>
    mocks.verifyToken(...args),
}));

vi.mock("../../../db/index.js", () => {
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    limit: (...args: unknown[]) => mocks.limit(...args),
  };
  return {
    getDb: () => ({ select: vi.fn(() => builder) }),
    schema: {
      contentTrashPurgeOperations: {
        id: "operations.id",
        actorEmail: "operations.actorEmail",
        orgId: "operations.orgId",
      },
    },
  };
});

vi.mock("../../../lib/content-trash-purge.js", () => ({
  CONTENT_TRASH_PURGE_TOKEN_KIND: "content-trash-purge",
  processContentTrashPurge: (...args: unknown[]) => mocks.processPurge(...args),
}));

import handler from "./content-trash-purge-worker.post.js";

const operationId = "11111111-1111-4111-8111-111111111111";

describe("Content Trash purge worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readBody.mockResolvedValue({ operationId, token: "example-token" });
    mocks.verifyToken.mockReturnValue({ ok: true });
    mocks.limit.mockResolvedValue([
      { actorEmail: "owner@example.test", orgId: "org-example" },
    ]);
    mocks.processPurge.mockResolvedValue({ status: "succeeded" });
    mocks.runWithRequestContext.mockImplementation(
      (_context: unknown, run: () => unknown) => run(),
    );
  });

  it("rejects a missing token before token verification or database access", async () => {
    mocks.readBody.mockResolvedValue({ operationId });

    await expect(handler({} as never)).resolves.toEqual({
      ok: false,
      error: "Invalid Trash purge job",
    });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(
      expect.anything(),
      400,
    );
    expect(mocks.verifyToken).not.toHaveBeenCalled();
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("reports an unreadable request body instead of treating it as missing input", async () => {
    mocks.readBody.mockRejectedValue(new Error("body stream failed"));

    await expect(handler({} as never)).resolves.toEqual({
      ok: false,
      error: "Unable to read Trash purge job",
    });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(
      expect.anything(),
      400,
    );
    expect(mocks.verifyToken).not.toHaveBeenCalled();
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("rejects an invalid scoped token before database access", async () => {
    mocks.verifyToken.mockReturnValue({ ok: false });

    await expect(handler({} as never)).resolves.toEqual({
      ok: false,
      error: "Invalid or expired Trash purge token",
    });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(
      expect.anything(),
      401,
    );
    expect(mocks.verifyToken).toHaveBeenCalledWith("example-token", {
      resourceKind: "content-trash-purge",
      resourceId: operationId,
    });
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.processPurge).not.toHaveBeenCalled();
  });

  it("runs a valid scoped dispatch as the persisted operation actor", async () => {
    await expect(handler({} as never)).resolves.toEqual({
      ok: true,
      operationId,
      result: { status: "succeeded" },
    });
    expect(mocks.runWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "owner@example.test", orgId: "org-example" },
      expect.any(Function),
    );
    expect(mocks.processPurge).toHaveBeenCalledWith(operationId);
  });
});
