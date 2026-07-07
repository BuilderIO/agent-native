import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSsrHandler = vi.hoisted(() => vi.fn());
const mockSetResponseHeader = vi.hoisted(() => vi.fn());

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
  });

  it("preserves public dashboard page cache headers when no agent token is present", async () => {
    const response = (await (handler as any)({
      url: "https://analytics.example.com/dashboards/dashboard-1",
      query: {},
    })) as Response;

    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
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

  it("marks tokenized dashboard pages private and no-store", async () => {
    const event = {
      url: "https://analytics.example.com/dashboards/dashboard-1?agent_access=tok%2B1",
      query: { agent_access: "tok+1" },
    };

    const response = (await (handler as any)(event)) as Response;

    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=0, no-store",
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mockSetResponseHeader).toHaveBeenCalledWith(
      event,
      "Cache-Control",
      "private, max-age=0, no-store",
    );
    expect(mockSetResponseHeader).toHaveBeenCalledWith(
      event,
      "Referrer-Policy",
      "no-referrer",
    );

    const html = await response.text();
    expect(html).toContain("agent_access=tok%2B1");
  });
});
