import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockFetchBuilderDesignSystemDecodeJobStatus = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  runWithRequestContext: async (_ctx: unknown, fn: () => unknown) => fn(),
  fetchBuilderDesignSystemDecodeJobStatus: (...args: unknown[]) =>
    mockFetchBuilderDesignSystemDecodeJobStatus(...args),
  FeatureNotConfiguredError: class FeatureNotConfiguredError extends Error {},
}));

vi.mock("@agent-native/core/org", () => ({
  getOrgContext: vi.fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: vi.fn(() => ({ jobId: "job-1" })),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

import { designSystemDecodeJobStatus } from "./design-system-decode-job-status";

describe("designSystemDecodeJobStatus session-lookup regression", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockSetResponseStatus.mockReset();
    mockFetchBuilderDesignSystemDecodeJobStatus.mockReset();
  });

  it("reports a 503 service error, not 401 Unauthorized, when the session lookup fails", async () => {
    // Regression: `getSession(event).catch(() => null)` used to collapse a
    // DB blip / cookie race into the same shape a genuine anonymous visitor
    // gets, so this route returned 401 "Unauthorized" for a server failure.
    mockGetSession.mockRejectedValue(new Error("db unavailable"));

    const result = await designSystemDecodeJobStatus({} as any);

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 503);
    expect(mockSetResponseStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      401,
    );
    expect(result?.error).not.toMatch(/unauthorized/i);
    expect(mockFetchBuilderDesignSystemDecodeJobStatus).not.toHaveBeenCalled();
  });

  it("still reports 401 Unauthorized for a genuine anonymous visitor", async () => {
    mockGetSession.mockResolvedValue(null);

    const result = await designSystemDecodeJobStatus({} as any);

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 401);
    expect(result?.error).toBe("Unauthorized");
  });
});
