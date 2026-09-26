import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSsrHandler = vi.hoisted(() => vi.fn());
const mockSetResponseHeader = vi.hoisted(() => vi.fn());
const mockVerifyScopedAgentAccessToken = vi.hoisted(() =>
  vi.fn((_token: unknown, _options: unknown) => ({ ok: true })),
);
const mockBuildSessionReplayAgentContext = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  AGENT_ACCESS_PARAM: "agent_access",
  verifyScopedAgentAccessToken: (token: unknown, options: unknown) =>
    mockVerifyScopedAgentAccessToken(token, options),
}));

vi.mock("../lib/session-replay-agent-context.js", () => ({
  buildSessionReplayAgentContext: (...args: unknown[]) =>
    mockBuildSessionReplayAgentContext(...args),
  safeJsonForHtml: (value: unknown) => JSON.stringify(value),
  SESSION_REPLAY_AGENT_ACCESS_PARAM: "agent_access",
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

function htmlResponse(headers: HeadersInit = {}) {
  return new Response("<html><head></head><body>ok</body></html>", {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60",
      ...headers,
    },
  });
}

describe("Analytics page agent discovery injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
    mockSsrHandler.mockResolvedValue(htmlResponse());
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: true });
    mockBuildSessionReplayAgentContext.mockResolvedValue(null);
  });

  it("preserves public dashboard page cache headers when no agent token is present", async () => {
    const response = (await (handler as any)({
      url: "https://analytics.example.com/dashboards/dashboard-1",
      query: {},
    })) as Response;

    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get("netlify-vary")).toBeNull();
    expect(mockSetResponseHeader).not.toHaveBeenCalledWith(
      expect.anything(),
      "Cache-Control",
      expect.anything(),
    );

    const html = await response.text();
    expect(html).toContain('id="analytics-dashboard-agent-context"');
    expect(html).toContain(
      "https://analytics.example.com/api/dashboard-agent-context.json?id=dashboard-1",
    );
    expect(html).not.toContain("agent_access=");
  });

  it("keeps tokenized dashboard pages on the public SSR cache policy", async () => {
    const event = {
      url: "https://analytics.example.com/dashboards/dashboard-1?agent_access=tok%2B1",
      query: { agent_access: "tok+1" },
    };

    const response = (await (handler as any)(event)) as Response;

    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get("netlify-vary")).toBe("query");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mockSetResponseHeader).not.toHaveBeenCalledWith(
      event,
      "Cache-Control",
      expect.anything(),
    );
    expect(mockSetResponseHeader).toHaveBeenCalledWith(
      event,
      "Referrer-Policy",
      "no-referrer",
    );
    expect(mockSetResponseHeader).toHaveBeenCalledWith(
      event,
      "netlify-vary",
      "query",
    );

    const html = await response.text();
    expect(html).toContain("agent_access=tok%2B1");
  });

  it("keys token-authorized session replay context by the full query string", async () => {
    mockBuildSessionReplayAgentContext.mockResolvedValue({
      summary: "Private replay summary",
    });

    const response = (await (handler as any)({
      url: "https://analytics.example.com/sessions/replay-1?agent_access=sample-token",
      query: { agent_access: "sample-token" },
    })) as Response;

    expect(response.headers.get("netlify-vary")).toBe("query");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await response.text()).toContain("Private replay summary");
  });

  it("does not put invalid tokens in the shared HTML or cache key", async () => {
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: false });
    const response = (await (handler as any)({
      url: "https://analytics.example.com/dashboards/dashboard-1?agent_access=invalid",
      query: { agent_access: "invalid" },
    })) as Response;

    expect(response.headers.get("netlify-vary")).toBeNull();
    expect(await response.text()).not.toContain("agent_access=invalid");
  });
});
