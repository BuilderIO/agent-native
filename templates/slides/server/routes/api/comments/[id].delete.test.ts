import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockRunWithRequestContext = vi.hoisted(() => vi.fn());
const mockGetRouterParam = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockActionRun = vi.hoisted(() => vi.fn());

const { MockForbiddenError } = vi.hoisted(() => {
  class MockForbiddenError extends Error {
    statusCode = 403;
  }
  return { MockForbiddenError };
});

vi.mock("@agent-native/core/server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  runWithRequestContext: (...args: unknown[]) =>
    mockRunWithRequestContext(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  ForbiddenError: MockForbiddenError,
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: (...args: unknown[]) => mockGetRouterParam(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("../../../../actions/delete-slide-comment.js", () => ({
  default: { run: (...args: unknown[]) => mockActionRun(...args) },
}));

import handler from "./[id].delete";

beforeEach(() => {
  vi.resetAllMocks();
  mockGetRouterParam.mockReturnValue("c-1");
  mockGetSession.mockResolvedValue({
    email: "author@example.com",
    orgId: "org-1",
  });
  mockRunWithRequestContext.mockImplementation(
    (_ctx: unknown, fn: () => unknown) => fn(),
  );
});

describe("DELETE /api/comments/:id (slides)", () => {
  it("delegates to the delete-slide-comment action", async () => {
    mockActionRun.mockResolvedValue({ ok: true });

    const result = await handler({} as any);

    expect(mockActionRun).toHaveBeenCalledWith({ id: "c-1" });
    expect(result).toEqual({ ok: true });
  });

  it("maps a Forbidden failure from the action to 404", async () => {
    mockActionRun.mockRejectedValue(new MockForbiddenError("Forbidden"));

    const result = await handler({} as any);

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 404);
    expect(result).toEqual({ error: "Comment not found" });
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const result = await handler({} as any);

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 401);
    expect(result).toEqual({ error: "Unauthorized" });
    expect(mockActionRun).not.toHaveBeenCalled();
  });
});
