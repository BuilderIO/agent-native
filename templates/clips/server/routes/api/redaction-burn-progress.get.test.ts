import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetQuery = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockGetSession = vi.hoisted(() => vi.fn());
const mockRunWithRequestContext = vi.hoisted(() => vi.fn());
const mockResolveAccess = vi.hoisted(() => vi.fn());
const mockGetBurnProgress = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (...args: unknown[]) => mockGetQuery(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  runWithRequestContext: (...args: unknown[]) =>
    mockRunWithRequestContext(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
}));

vi.mock("../../lib/redaction-burn-progress.js", () => ({
  getBurnProgress: (...args: unknown[]) => mockGetBurnProgress(...args),
}));

const { default: handler } = await import("./redaction-burn-progress.get.js");

const event = { __event: true } as never;

describe("GET /api/redaction-burn-progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetQuery.mockReturnValue({ id: "rec_1" });
    mockGetSession.mockResolvedValue({
      email: "owner@example.com",
      orgId: "org_1",
    });
    mockRunWithRequestContext.mockImplementation(
      async (_context: unknown, fn: () => unknown) => fn(),
    );
    mockResolveAccess.mockResolvedValue({ role: "owner" });
    mockGetBurnProgress.mockReturnValue({ status: "running", percent: 42 });
  });

  it("answers the owner with the progress, inside their request context", async () => {
    const result = await (handler as (e: never) => Promise<unknown>)(event);

    expect(result).toEqual({ status: "running", percent: 42 });
    expect(mockSetResponseStatus).not.toHaveBeenCalled();
    expect(mockRunWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "owner@example.com", orgId: "org_1" },
      expect.any(Function),
    );
    expect(mockResolveAccess).toHaveBeenCalledWith("recording", "rec_1");
  });

  it("does not ask about access at all when there is no session", async () => {
    mockGetSession.mockResolvedValue(null);

    const result = await (handler as (e: never) => Promise<unknown>)(event);

    expect(result).toEqual({ error: "Unauthorized" });
    expect(mockSetResponseStatus).toHaveBeenCalledWith(event, 401);
    expect(mockResolveAccess).not.toHaveBeenCalled();
  });

  it("refuses a viewer: a percentage is the owner's business", async () => {
    mockResolveAccess.mockResolvedValue({ role: "viewer" });

    const result = await (handler as (e: never) => Promise<unknown>)(event);

    expect(result).toEqual({ error: "Forbidden" });
    expect(mockSetResponseStatus).toHaveBeenCalledWith(event, 403);
    expect(mockGetBurnProgress).not.toHaveBeenCalled();
  });

  it("refuses rather than throwing when access cannot be resolved", async () => {
    mockResolveAccess.mockRejectedValue(new Error("sharing unavailable"));

    const result = await (handler as (e: never) => Promise<unknown>)(event);

    expect(result).toEqual({ error: "Forbidden" });
    expect(mockSetResponseStatus).toHaveBeenCalledWith(event, 403);
  });

  it("needs an id", async () => {
    mockGetQuery.mockReturnValue({});

    const result = await (handler as (e: never) => Promise<unknown>)(event);

    expect(result).toEqual({ error: "id is required" });
    expect(mockSetResponseStatus).toHaveBeenCalledWith(event, 400);
    expect(mockGetSession).not.toHaveBeenCalled();
  });
});
