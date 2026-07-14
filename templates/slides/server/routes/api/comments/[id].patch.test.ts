import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockRunWithRequestContext = vi.hoisted(() => vi.fn());
const mockGetRouterParam = vi.hoisted(() => vi.fn());
const mockReadBody = vi.hoisted(() => vi.fn());
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
  readBody: (...args: unknown[]) => mockReadBody(...args),
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

vi.mock("../../../../actions/update-slide-comment.js", () => ({
  default: { run: (...args: unknown[]) => mockActionRun(...args) },
}));

import handler from "./[id].patch";

beforeEach(() => {
  vi.resetAllMocks();
  mockGetRouterParam.mockReturnValue("c-1");
  mockReadBody.mockResolvedValue({ resolved: false });
  mockGetSession.mockResolvedValue({
    email: "author@example.com",
    orgId: "org-1",
  });
  // Run the callback directly, like the real runWithRequestContext would.
  mockRunWithRequestContext.mockImplementation(
    (_ctx: unknown, fn: () => unknown) => fn(),
  );
});

describe("PATCH /api/comments/:id (slides)", () => {
  it("delegates resolve to the update-slide-comment action", async () => {
    mockReadBody.mockResolvedValue({ resolved: true });
    mockActionRun.mockResolvedValue({ ok: true, resolved: true });

    const result = await handler({} as any);

    expect(mockActionRun).toHaveBeenCalledWith({
      id: "c-1",
      resolved: true,
      content: undefined,
    });
    expect(result).toEqual({ ok: true, resolved: true });
  });

  it("delegates reopen (resolved: false) to the action instead of silently no-oping", async () => {
    mockReadBody.mockResolvedValue({ resolved: false });
    mockActionRun.mockResolvedValue({ ok: true, resolved: false });

    const result = await handler({} as any);

    // Before this fix, the route had no branch for resolved === false and
    // would silently return { ok: true } without ever reopening the thread.
    expect(mockActionRun).toHaveBeenCalledWith({
      id: "c-1",
      resolved: false,
      content: undefined,
    });
    expect(result).toEqual({ ok: true, resolved: false });
  });

  it("maps a Forbidden failure from the action to 404, not 403", async () => {
    mockActionRun.mockRejectedValue(new MockForbiddenError("Forbidden"));

    const result = await handler({} as any);

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 404);
    expect(result).toEqual({ error: "Comment not found" });
  });

  it("maps a not-found failure from the action to 404", async () => {
    mockActionRun.mockRejectedValue(new Error("Comment not found: c-1"));

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
