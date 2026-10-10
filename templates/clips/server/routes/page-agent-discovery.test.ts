import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSsrHandler = vi.hoisted(() => vi.fn());
const mockRecording = vi.hoisted(() => ({
  value: null as Record<string, unknown> | null,
}));

vi.mock("@agent-native/core/server/ssr-handler", () => ({
  createH3SSRHandler: () => mockSsrHandler,
}));

vi.mock("@agent-native/core/server", () => ({
  getForwardedRequestOrigin: (event: { url: string }) =>
    new URL(event.url).origin,
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (event: { query?: Record<string, unknown> }) => event.query ?? {},
  getRequestURL: (event: { url: string }) => new URL(event.url),
  setResponseHeader: (
    event: { responseHeaders?: Map<string, string> },
    name: string,
    value: string,
  ) => {
    event.responseHeaders ??= new Map();
    event.responseHeaders.set(name.toLowerCase(), value);
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
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
    mockSsrHandler.mockImplementation(() => htmlResponse());
  });

  it("puts transcript discovery metadata in the head of share links", async () => {
    const response = (await (handler as any)({
      url: "https://clips.example.com/share/rec-1",
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
    expect(html).toContain("clips-get-transcript");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get("content-length")).toBeNull();
  });

  it("puts transcript discovery metadata in the head of embed links", async () => {
    const response = (await (handler as any)({
      url: "https://clips.example.com/embed/rec-1",
      query: {},
    })) as Response;
    const html = await response.text();

    expect(html).toContain(
      'href="https://clips.example.com/api/agent-context.json?id=rec-1"',
    );
    expect(html).toContain("clips-get-frame");
  });

  it("puts transcript and frame discovery in public direct recording links", async () => {
    const response = (await (handler as any)({
      url: "https://clips.example.com/r/rec-1",
      query: {},
    })) as Response;
    const html = await response.text();

    expect(html).toContain(
      '<link rel="alternate" type="application/json" href="https://clips.example.com/api/agent-context.json?id=rec-1"',
    );
    expect(html).toContain("clips-get-transcript");
    expect(html).toContain("clips-get-frame");
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

  it("gives private links generic agent discovery without clip details", async () => {
    mockRecording.value = recording({
      title: "Secret private clip title",
      status: "processing",
      visibility: "private",
    });

    const shareResponse = (await (handler as any)({
      url: "https://clips.example.com/share/rec-1",
      query: {},
    })) as Response;
    const shareHtml = await shareResponse.text();
    expect(shareHtml).toContain(
      'href="https://clips.example.com/api/agent-context.json?id=rec-1"',
    );
    expect(shareHtml).toContain("Share with agents");
    expect(shareHtml).not.toContain("Secret private clip title");
    expect(shareHtml).not.toContain('"recordingStatus":"processing"');

    const directResponse = (await (handler as any)({
      url: "https://clips.example.com/r/rec-1",
      query: {},
    })) as Response;
    expect(await directResponse.text()).toContain("agent-context.json");
  });

  it("keeps tokenized links discoverable without echoing the token", async () => {
    mockRecording.value = recording({
      title: "Secret private clip title",
      visibility: "private",
    });
    const tokenEvent = {
      url: "https://clips.example.com/share/rec-1?agent_access=tok%2B1",
      query: { agent_access: "tok+1" },
      responseHeaders: new Map<string, string>(),
    };
    const tokenResponse = (await (handler as any)(tokenEvent)) as Response;
    const html = await tokenResponse.text();

    expect(html).toContain("clips-agent-context");
    expect(html).toContain("Share with agents");
    expect(html).not.toContain("Secret private clip title");
    expect(html).not.toContain("agent_access=tok%2B1");
    expect(html).not.toContain("tok+1");
    expect(tokenResponse.headers.get("cache-control")).toBe(
      "public, max-age=60",
    );
    expect(tokenEvent.responseHeaders.get("referrer-policy")).toBe(
      "no-referrer",
    );
  });

  it("gives expired recordings generic discovery without revealing status", async () => {
    mockRecording.value = recording({
      title: "Expired private details",
      status: "failed",
      expiresAt: "2020-01-01T00:00:00.000Z",
    });

    const response = (await (handler as any)({
      url: "https://clips.example.com/share/rec-1",
      query: {},
    })) as Response;

    const html = await response.text();
    expect(html).toContain("agent-context.json");
    expect(html).toContain("Share with agents");
    expect(html).not.toContain("Expired private details");
    expect(html).not.toContain('"recordingStatus":"failed"');
  });

  it("treats t as playback state rather than an access token", async () => {
    const response = (await (handler as any)({
      url: "https://clips.example.com/share/rec-1?t=1500",
      query: { t: "1500" },
    })) as Response;

    expect(await response.text()).toContain("clips-agent-context");
  });

  it("publishes generic discovery for unknown ids without revealing existence", async () => {
    mockRecording.value = null;

    const response = (await (handler as any)({
      url: "https://clips.example.com/share/unknown-id",
      query: {},
    })) as Response;

    expect(await response.text()).toContain(
      'href="https://clips.example.com/api/agent-context.json?id=unknown-id"',
    );
  });
});
