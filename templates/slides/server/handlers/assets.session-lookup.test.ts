import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  runWithRequestContext: async (_ctx: unknown, fn: () => unknown) => fn(),
}));

vi.mock("@agent-native/core/org", () => ({
  getOrgContext: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  getDb: vi.fn(() => ({})),
  schema: { uploadedAssets: {} },
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: vi.fn(),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
  readMultipartFormData: vi.fn(async () => []),
}));

import { deleteAsset, listAssets, uploadAsset } from "./assets";

// Regression for the same session-lookup bug fixed in
// request-auth-context.ts: `getSession(event).catch(() => null)` used to
// collapse a DB blip / cookie race into the same shape a genuine anonymous
// visitor gets, so every asset route returned 401 "Unauthorized" for what was
// actually a server failure.
describe.each([
  ["uploadAsset", uploadAsset],
  ["listAssets", listAssets],
  ["deleteAsset", deleteAsset],
])("%s session-lookup regression", (_name, handler) => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockSetResponseStatus.mockReset();
  });

  it("reports a 503 service error, not 401 Unauthorized, when the session lookup fails", async () => {
    mockGetSession.mockRejectedValue(new Error("db unavailable"));

    const result = await handler({} as any);

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 503);
    expect(mockSetResponseStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      401,
    );
    expect((result as { error?: string })?.error).not.toMatch(/unauthorized/i);
  });

  it("still reports 401 Unauthorized for a genuine anonymous visitor", async () => {
    mockGetSession.mockResolvedValue(null);

    const result = await handler({} as any);

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 401);
    expect((result as { error?: string })?.error).toBe("Unauthorized");
  });
});
