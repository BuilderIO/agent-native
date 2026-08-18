import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockGetOrgContext = vi.hoisted(() => vi.fn());
const mockRunWithRequestContext = vi.hoisted(() =>
  vi.fn(async (_ctx: unknown, fn: () => unknown) => fn()),
);

vi.mock("@agent-native/core/server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  runWithRequestContext: (ctx: unknown, fn: () => unknown) =>
    mockRunWithRequestContext(ctx, fn),
}));

vi.mock("@agent-native/core/org", () => ({
  getOrgContext: (...args: unknown[]) => mockGetOrgContext(...args),
}));

import {
  resolveSlidesRequestAuth,
  resolveSlidesRequestAuthContext,
  SlidesSessionLookupError,
} from "./request-auth-context";

describe("resolveSlidesRequestAuthContext", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetOrgContext.mockReset();
  });

  it("returns an undefined email for a genuine anonymous visitor (no session, no error)", async () => {
    mockGetSession.mockResolvedValue(null);

    const context = await resolveSlidesRequestAuthContext({} as any);

    expect(context).toEqual({ email: undefined, orgId: undefined });
  });

  it("throws SlidesSessionLookupError instead of returning a fake anonymous context when the lookup itself fails", async () => {
    // Regression for Toni's report: `getSession(event).catch(() => null)`
    // used to collapse a DB blip / cookie race into the same shape a real
    // anonymous visitor gets, so callers reported "unauthorized" for what
    // was actually a server-side failure.
    mockGetSession.mockRejectedValue(new Error("db unavailable"));

    await expect(
      resolveSlidesRequestAuthContext({} as any),
    ).rejects.toBeInstanceOf(SlidesSessionLookupError);
  });
});

describe("resolveSlidesRequestAuth", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetOrgContext.mockReset();
  });

  it("resolves ok:true with an undefined email for a genuine anonymous visitor", async () => {
    mockGetSession.mockResolvedValue(null);

    const result = await resolveSlidesRequestAuth({} as any);

    expect(result).toEqual({
      ok: true,
      context: { email: undefined, orgId: undefined },
    });
  });

  it("resolves ok:false with a non-401 status when the session lookup fails, never as unauthorized", async () => {
    mockGetSession.mockRejectedValue(new Error("db unavailable"));

    const result = await resolveSlidesRequestAuth({} as any);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).not.toBe(401);
      expect(result.statusCode).toBe(503);
      expect(result.error).not.toMatch(/unauthorized/i);
    }
  });
});
