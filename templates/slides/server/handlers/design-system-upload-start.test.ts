import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockStartBuilderDesignSystemUpload = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  runWithRequestContext: async (_ctx: unknown, fn: () => unknown) => fn(),
  startBuilderDesignSystemUpload: (...args: unknown[]) =>
    mockStartBuilderDesignSystemUpload(...args),
  FeatureNotConfiguredError: class FeatureNotConfiguredError extends Error {},
}));

vi.mock("@agent-native/core/org", () => ({
  getOrgContext: vi.fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  readBody: vi.fn(async () => ({
    attachments: [{ name: "a.fig", mimetype: "app/fig", declaredSize: 10 }],
  })),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

import { designSystemUploadStart } from "./design-system-upload-start";

describe("designSystemUploadStart session-lookup regression", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockSetResponseStatus.mockReset();
    mockStartBuilderDesignSystemUpload.mockReset();
  });

  it("reports a 503 service error, not 401 Unauthorized, when the session lookup fails", async () => {
    // Regression: `getSession(event).catch(() => null)` used to collapse a
    // DB blip / cookie race into the same shape a genuine anonymous visitor
    // gets, so this route returned 401 "Unauthorized" for a server failure.
    mockGetSession.mockRejectedValue(new Error("db unavailable"));

    const result = await designSystemUploadStart({} as any);

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 503);
    expect(mockSetResponseStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      401,
    );
    expect(result?.error).not.toMatch(/unauthorized/i);
    expect(mockStartBuilderDesignSystemUpload).not.toHaveBeenCalled();
  });

  it("still reports 401 Unauthorized for a genuine anonymous visitor", async () => {
    mockGetSession.mockResolvedValue(null);

    const result = await designSystemUploadStart({} as any);

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 401);
    expect(result?.error).toBe("Unauthorized");
  });
});
