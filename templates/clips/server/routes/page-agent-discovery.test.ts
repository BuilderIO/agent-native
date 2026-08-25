import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSsrHandler = vi.hoisted(() => vi.fn());
const mockVerifyScopedAgentAccessToken = vi.hoisted(() => vi.fn());
const mockRecording = vi.hoisted(() => ({
  value: null as Record<string, unknown> | null,
}));

vi.mock("@agent-native/core/server/ssr-handler", () => ({
  createH3SSRHandler: () => mockSsrHandler,
}));

vi.mock("@agent-native/core/server", () => ({
  verifyScopedAgentAccessToken: (...args: unknown[]) =>
    mockVerifyScopedAgentAccessToken(...args),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (event: { query?: Record<string, unknown> }) => event.query ?? {},
  getRequestURL: (event: { url: string }) => new URL(event.url),
  setResponseHeader: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    select: () => {
      const builder: any = {
        from: () => builder,
        where: () => builder,
        limit: async () => (mockRecording.value ? [mockRecording.value] : []),
      };
      return builder;
    },
  }),
  schema: {
    recordings: {
      id: "recordings.id",
      title: "recordings.title",
      status: "recordings.status",
      visibility: "recordings.visibility",
      password: "recordings.password",
      expiresAt: "recordings.expiresAt",
      archivedAt: "recordings.archivedAt",
      trashedAt: "recordings.trashedAt",
    },
  },
}));

vi.mock("../lib/media-permissions.js", () => ({
  MEDIA_CAPTURE_PERMISSIONS_POLICY: "camera=*, microphone=(self)",
  withMediaCapturePermissions: (response: Response) => response,
}));

vi.mock("../lib/public-agent-context.js", () => ({
  getServerAppBasePath: () => "",
  queryString: (value: unknown) =>
    typeof value === "string"
      ? value
      : Array.isArray(value) && typeof value[0] === "string"
        ? value[0]
        : "",
}));

import handler from "./[...page].get";

function recording(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    title: "Public clip",
    status: "ready",
    visibility: "public",
    password: null,
    expiresAt: null,
    archivedAt: null,
    trashedAt: null,
    ...overrides,
  };
}

function htmlResponse(body = "<html><head></head><body>ok</body></html>") {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60",
      "content-length": String(body.length),
    },
  });
}

describe("Clips page agent discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecording.value = recording();
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: false });
    mockSsrHandler.mockImplementation(() => htmlResponse());
  });

  it("puts transcript discovery metadata in the head of legacy /r links", async () => {
    const response = (await (handler as any)({
      url: "https://clips.example.com/r/rec-1",
      query: {},
    })) as Response;
    const html = await response.text();

    expect(html).toContain(
      '<link rel="alternate" type="application/json" href="https://clips.example.com/api/agent-context.json?id=rec-1"',
    );
    expect(html.indexOf("agent-context.json")).toBeLessThan(
      html.indexOf("<body>"),
    );
    expect(html).toContain('id="clips-agent-context"');
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get("content-length")).toBeNull();
  });

  it("does not duplicate the discovery script already rendered by /share", async () => {
    mockSsrHandler.mockResolvedValue(
      htmlResponse(
        '<html><head></head><body><script type="application/agent-native+json" id="clips-agent-context">existing</script></body></html>',
      ),
    );

    const response = (await (handler as any)({
      url: "https://clips.example.com/share/rec-1",
      query: {},
    })) as Response;
    const html = await response.text();

    expect(html.match(/id="clips-agent-context"/g)).toHaveLength(1);
    expect(html.match(/rel="alternate"/g)).toHaveLength(1);
  });

  it("only exposes private clips through a valid scoped agent token", async () => {
    mockRecording.value = recording({ visibility: "private" });
    const publicResponse = (await (handler as any)({
      url: "https://clips.example.com/r/rec-1",
      query: {},
    })) as Response;
    expect(await publicResponse.text()).not.toContain("agent-context.json");

    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: true });
    const tokenResponse = (await (handler as any)({
      url: "https://clips.example.com/r/rec-1?agent_access=tok%2B1",
      query: { agent_access: "tok+1" },
    })) as Response;
    const html = await tokenResponse.text();

    expect(html).toContain("agent_access=tok%2B1");
    expect(tokenResponse.headers.get("cache-control")).toBe(
      "public, max-age=60",
    );
    expect(tokenResponse.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
