import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  body: {} as unknown,
  authorization: "Bearer valid",
  ownerEmail: "owner@example.test",
  bodyBytes: 0,
  maxBodyBytes: 0,
  status: vi.fn(),
  verifyInternalToken: vi.fn(),
  processBackfill: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  extractInternalBearerToken: (header: string | undefined) =>
    header?.replace(/^Bearer\s+/i, "") ?? null,
  readBodyWithSizeLimit: async (_event: unknown, maxBytes: number) => {
    mocks.maxBodyBytes = maxBytes;
    if (mocks.bodyBytes > maxBytes) {
      mocks.status(413);
      throw Object.assign(new Error("Request body too large"), {
        statusCode: 413,
      });
    }
    return mocks.body;
  },
  runWithRequestContext: (_context: unknown, callback: () => unknown) =>
    callback(),
  verifyInternalToken: mocks.verifyInternalToken,
}));
vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (_event: unknown, name: string) =>
    name === "authorization" ? mocks.authorization : undefined,
  setResponseStatus: (_event: unknown, status: number) => mocks.status(status),
}));
vi.mock("../../../db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ ownerEmail: mocks.ownerEmail }],
        }),
      }),
    }),
  }),
  schema: { aiFilterBackfills: { id: {}, ownerEmail: {} } },
}));
vi.mock("../../../lib/ai-filter-backfill.js", () => ({
  processMailAiFilterBackfills: mocks.processBackfill,
}));

import worker from "./mail-ai-filter-backfill-worker.post.js";

describe("Mail AI backfill background worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.body = { taskId: "run-1", runId: "run-1" };
    mocks.authorization = "Bearer valid";
    mocks.bodyBytes = 0;
    mocks.maxBodyBytes = 0;
    mocks.verifyInternalToken.mockReturnValue(true);
  });

  it("bounds the public request body before token verification", async () => {
    mocks.bodyBytes = 1025;

    await expect((worker as any)({})).resolves.toMatchObject({ ok: false });
    expect(mocks.maxBodyBytes).toBe(1024);
    expect(mocks.status).toHaveBeenCalledWith(413);
    expect(mocks.verifyInternalToken).not.toHaveBeenCalled();
  });

  it("rejects a task token that is not signed for the run", async () => {
    mocks.body = { taskId: "other-task", runId: "run-1" };

    await expect((worker as any)({})).resolves.toMatchObject({ ok: false });
    expect(mocks.status).toHaveBeenCalledWith(400);
    expect(mocks.verifyInternalToken).not.toHaveBeenCalled();
    expect(mocks.processBackfill).not.toHaveBeenCalled();
  });

  it("verifies the run token and derives the owner from the stored row", async () => {
    mocks.verifyInternalToken.mockImplementation(
      (runId: string, token: string) => runId === "run-1" && token === "valid",
    );

    await expect((worker as any)({})).resolves.toEqual({
      ok: true,
      runId: "run-1",
    });
    expect(mocks.verifyInternalToken).toHaveBeenCalledWith("run-1", "valid");
    expect(mocks.processBackfill).toHaveBeenCalledWith(
      "owner@example.test",
      "run-1",
    );
  });
});
