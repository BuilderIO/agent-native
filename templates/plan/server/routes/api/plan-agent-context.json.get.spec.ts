import { beforeEach, describe, expect, it, vi } from "vitest";

const mockVerifyScopedAgentAccessToken = vi.hoisted(() => vi.fn());
const mockLoadPlanBundle = vi.hoisted(() => vi.fn());
const mockLoadPlanBundleForAgentAccess = vi.hoisted(() => vi.fn());
const mockSetResponseHeader = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  AGENT_ACCESS_PARAM: "agent_access",
  verifyScopedAgentAccessToken: (...args: unknown[]) =>
    mockVerifyScopedAgentAccessToken(...args),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (event: any) => event.query ?? {},
  setResponseHeader: (...args: unknown[]) => mockSetResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("../../plans.js", () => ({
  loadPlanBundle: (...args: unknown[]) => mockLoadPlanBundle(...args),
  loadPlanBundleForAgentAccess: (...args: unknown[]) =>
    mockLoadPlanBundleForAgentAccess(...args),
}));

import handler from "./plan-agent-context.json.get";

function makeBundle(id = "plan-1") {
  return {
    plan: {
      id,
      title: "Launch plan",
      kind: "plan",
    },
    access: { role: "viewer", visibility: "public" },
    sections: [],
    comments: [],
    events: [],
    summary: { sectionCount: 0, commentCount: 0 },
  };
}

describe("plan agent context route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: false });
    mockLoadPlanBundle.mockResolvedValue(makeBundle());
    mockLoadPlanBundleForAgentAccess.mockResolvedValue(makeBundle());
  });

  it("falls back to the normal public read path when an agent token is invalid", async () => {
    const result = await (handler as any)({
      query: { id: "plan-1", agent_access: "bad-token" },
    });

    expect(mockVerifyScopedAgentAccessToken).toHaveBeenCalledWith("bad-token", {
      resourceKind: "plan:plan",
      resourceId: "plan-1",
    });
    expect(mockLoadPlanBundle).toHaveBeenCalledWith("plan-1");
    expect(mockLoadPlanBundleForAgentAccess).not.toHaveBeenCalled();
    expect(mockSetResponseStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      403,
    );
    expect(result).toMatchObject({
      resourceType: "plan",
      id: "plan-1",
      title: "Launch plan",
      access: { visibility: "public" },
    });
  });

  it("uses the scoped agent-access loader when the token is valid", async () => {
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: true });

    await (handler as any)({
      query: { id: "plan-1", agent_access: "valid-token" },
    });

    expect(mockLoadPlanBundleForAgentAccess).toHaveBeenCalledWith("plan-1");
    expect(mockLoadPlanBundle).not.toHaveBeenCalled();
  });
});
