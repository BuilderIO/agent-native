import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  body: {} as Record<string, unknown>,
  bodyThrows: false,
  method: "POST",
  status: 0,
  headers: {} as Record<string, string>,
  apiKey: null as string | null,
  sessionThrows: false,
  sessionEmail: "reader@example.com" as string | null,
  orgThrows: false,
  requestContexts: [] as { userEmail?: string; orgId?: string }[],
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getMethod: () => state.method,
  readBody: vi.fn(async () => {
    if (state.bodyThrows) throw new Error("malformed JSON");
    return state.body;
  }),
  setResponseStatus: (_event: unknown, status: number) => {
    state.status = status;
  },
  setResponseHeader: (_event: unknown, name: string, value: string) => {
    state.headers[name] = value;
  },
}));
vi.mock("./request-origin.js", () => ({ isSameOriginRequest: () => true }));
vi.mock("./auth.js", () => ({
  getSession: async () => {
    if (state.sessionThrows) throw new Error("session store unreachable");
    return state.sessionEmail ? { email: state.sessionEmail } : null;
  },
}));
vi.mock("../org/context.js", () => ({
  getOrgContext: async () => {
    if (state.orgThrows) throw new Error("org lookup failed");
    return { orgId: "org-1" };
  },
}));
vi.mock("./request-context.js", () => ({
  runWithRequestContext: async (
    ctx: { userEmail?: string; orgId?: string },
    fn: () => Promise<unknown>,
  ) => {
    state.requestContexts.push(ctx);
    return fn();
  },
}));
vi.mock("./credential-provider.js", () => ({
  resolveSecret: async () => state.apiKey,
}));

const { createSpeakHandler, synthesizeSpeech, SPEECH_MAX_CHARS } =
  await import("./speak.js");

function mockFetch(
  response: { status?: number; body?: BodyInit | null } = {},
): ReturnType<typeof vi.fn> {
  const fn = vi.fn(
    async () =>
      new Response(response.body ?? new Uint8Array([1, 2, 3]), {
        status: response.status ?? 200,
      }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function post() {
  const handler = createSpeakHandler() as unknown as (
    event: unknown,
  ) => Promise<any>;
  return handler({ node: {} });
}

beforeEach(() => {
  state.body = { text: "Good morning." };
  state.bodyThrows = false;
  state.method = "POST";
  state.status = 0;
  state.headers = {};
  state.apiKey = "sk-test";
  state.sessionThrows = false;
  state.sessionEmail = "reader@example.com";
  state.orgThrows = false;
  state.requestContexts = [];
  vi.unstubAllGlobals();
});

describe("synthesizeSpeech", () => {
  it("reports a missing key as a configuration state, not a failure", async () => {
    const result = await synthesizeSpeech({ text: "Hello.", apiKey: null });
    expect(result).toMatchObject({ status: "failed", reason: "no-provider" });
  });

  it("refuses a script longer than the provider accepts instead of truncating", async () => {
    const fetchMock = mockFetch();
    expect(SPEECH_MAX_CHARS).toBeGreaterThan(0);
    const result = await synthesizeSpeech({
      text: "a".repeat(SPEECH_MAX_CHARS + 1),
      apiKey: "sk-test",
    });
    expect(result).toMatchObject({ status: "failed", reason: "too-long" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps an empty script apart from an over-long one", async () => {
    const result = await synthesizeSpeech({ text: "  ", apiKey: "sk-test" });
    expect(result).toMatchObject({ status: "failed", reason: "empty" });
  });

  it("sends the voice and the delivery instructions", async () => {
    const fetchMock = mockFetch();
    const result = await synthesizeSpeech({
      text: "Good morning.",
      voice: "sage",
      instructions: "Read as a newsroom anchor.",
      apiKey: "sk-test",
    });
    expect(result).toMatchObject({ status: "ok", mimeType: "audio/mpeg" });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent).toMatchObject({
      voice: "sage",
      instructions: "Read as a newsroom anchor.",
      response_format: "mp3",
      input: "Good morning.",
    });
  });

  it("treats an empty 200 as a provider failure, because it plays as silence", async () => {
    mockFetch({ body: new Uint8Array() });
    const result = await synthesizeSpeech({
      text: "Good morning.",
      apiKey: "sk-test",
    });
    expect(result).toMatchObject({
      status: "failed",
      reason: "provider-error",
    });
  });

  it("carries the provider's status into the failure", async () => {
    mockFetch({ status: 401, body: "bad key" });
    const result = await synthesizeSpeech({
      text: "Good morning.",
      apiKey: "sk-test",
    });
    expect(result.status).toBe("failed");
    expect((result as { message: string }).message).toContain("401");
  });
});

describe("speak route", () => {
  it("answers with audio bytes and a no-store cache header", async () => {
    mockFetch();
    const body = await post();
    expect(state.status).toBe(0);
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(state.headers["Content-Type"]).toBe("audio/mpeg");
    expect(state.headers["Cache-Control"]).toBe("no-store");
  });

  it("rejects a non-POST", async () => {
    state.method = "GET";
    await post();
    expect(state.status).toBe(405);
  });

  it("400s with no provider configured, so a client can fall back", async () => {
    state.apiKey = null;
    const body = await post();
    expect(state.status).toBe(400);
    expect(body.reason).toBe("no-provider");
  });

  it("rejects an unknown voice rather than substituting the default", async () => {
    const fetchMock = mockFetch();
    state.body = { text: "Good morning.", voice: "saige" };
    const body = await post();
    expect(state.status).toBe(400);
    expect(body.error).toContain("saige");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("413s a script past the shared limit", async () => {
    state.body = { text: "a".repeat(SPEECH_MAX_CHARS + 1) };
    await post();
    expect(state.status).toBe(413);
  });

  it("400s an empty request", async () => {
    state.body = { text: "   " };
    await post();
    expect(state.status).toBe(400);
  });

  it("keeps an unreadable body apart from an absent one", async () => {
    state.bodyThrows = true;
    const body = await post();
    expect(state.status).toBe(400);
    expect(body.reason).toBe("unreadable-body");
  });

  it("resolves the key inside the caller's identity", async () => {
    mockFetch();
    await post();
    expect(state.requestContexts).toEqual([
      { userEmail: "reader@example.com", orgId: "org-1" },
    ]);
  });

  it("refuses an anonymous caller instead of spending the deploy key", async () => {
    const fetchMock = mockFetch();
    state.sessionEmail = null;

    const body = await post();

    expect(state.status).toBe(401);
    expect(body.reason).toBe("not-allowed");
    expect(state.requestContexts).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses when the session cannot be read, rather than going anonymous", async () => {
    const fetchMock = mockFetch();
    state.sessionThrows = true;
    const body = await post();
    // Falling through as an anonymous caller would resolve a different key —
    // or none, which every client reads as "narration is not configured".
    expect(state.status).toBe(503);
    expect(body.reason).toBe("identity-unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not abort the provider call when the request stream closes", async () => {
    // Node emits `close` on a fully-read request, not only on a client that
    // went away, so an abort wired to it cancels every normal synthesis and
    // surfaces as a bare 502 in the browser.
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (init.signal?.aborted) throw new Error("aborted");
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const handler = createSpeakHandler() as unknown as (
      event: unknown,
    ) => Promise<any>;
    const body = await handler({
      node: {
        // The body has already been consumed by the time the handler listens,
        // so Node delivers `close` immediately — during the provider call.
        req: {
          on: (event: string, fn: () => void) => {
            if (event === "close") queueMicrotask(fn);
          },
        },
      },
    });
    expect(state.status).toBe(0);
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("refuses when the org context cannot be read", async () => {
    const fetchMock = mockFetch();
    state.orgThrows = true;
    const body = await post();
    expect(state.status).toBe(503);
    expect(body.reason).toBe("identity-unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
