import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSsrHandler = vi.hoisted(() => vi.fn());
const mockSetResponseHeader = vi.hoisted(() => vi.fn());
const mockVerifyScopedAgentAccessToken = vi.hoisted(() =>
  vi.fn((_token: unknown, _options: unknown) => ({ ok: true })),
);

vi.mock("@agent-native/core/server", () => ({
  AGENT_ACCESS_PARAM: "agent_access",
  getConfiguredAppBasePath: () => "",
  verifyScopedAgentAccessToken: (token: unknown, options: unknown) =>
    mockVerifyScopedAgentAccessToken(token, options),
}));

vi.mock("@agent-native/core/server/ssr-handler", () => ({
  createH3SSRHandler: () => mockSsrHandler,
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (event: any) => event.query ?? {},
  getRequestURL: (event: any) => new URL(event.url),
  setResponseHeader: (...args: unknown[]) => mockSetResponseHeader(...args),
}));

import handler from "./[...page].get";

function htmlResponse() {
  return new Response("<html><head></head><body>ok</body></html>", {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

describe("Plan page agent discovery injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSsrHandler.mockResolvedValue(htmlResponse());
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: true });
  });

  it("keys token-authorized HTML by the full query string", async () => {
    const event = {
      url: "https://plan.example.com/plans/plan-1?agent_access=sample-token",
      query: { agent_access: "sample-token" },
    };

    const response = (await (handler as any)(event)) as Response;

    expect(mockVerifyScopedAgentAccessToken).toHaveBeenCalledWith(
      "sample-token",
      { resourceKind: "plan:plan", resourceId: "plan-1" },
    );
    expect(response.headers.get("netlify-vary")).toBe("query");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await response.text()).toContain("agent_access=sample-token");
  });

  it("omits invalid tokens from cached HTML", async () => {
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: false });
    const response = (await (handler as any)({
      url: "https://plan.example.com/plans/plan-1?agent_access=invalid",
      query: { agent_access: "invalid" },
    })) as Response;

    expect(response.headers.get("netlify-vary")).toBeNull();
    expect(await response.text()).not.toContain("agent_access=invalid");
  });
});
