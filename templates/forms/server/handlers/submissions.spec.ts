import { beforeEach, describe, expect, it, vi } from "vitest";

// Mutable request body so each test can drive a different submission payload.
const state = vi.hoisted(() => ({
  body: null as unknown,
  inserted: [] as Array<Record<string, unknown>>,
  session: null as null | { email?: string; orgId?: string },
}));

const publishedForm = {
  id: "form_1",
  title: "Agent Native Feedback",
  slug: "agent-native-feedback",
  fields: JSON.stringify([
    { id: "msg", type: "textarea", label: "Feedback", required: false },
  ]),
  settings: JSON.stringify({}),
  status: "published",
  ownerEmail: "owner@example.com",
  deletedAt: null,
};

vi.mock("h3", () => ({
  defineEventHandler: (fn: unknown) => fn,
  getRouterParam: () => "form_1",
  getQuery: () => ({}),
  getRequestHeader: () => undefined,
  setResponseStatus: vi.fn(),
  getRequestIP: () => "1.2.3.4",
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: async () => state.session,
  readBody: async () => state.body,
  runWithRequestContext: (_ctx: unknown, fn: () => unknown) => fn(),
  verifyCaptcha: async () => ({ success: true }),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  appStatePut: async () => {},
}));

vi.mock("../db/index.js", async () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => Promise.resolve([publishedForm]) }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        state.inserted.push(v);
        return Promise.resolve();
      },
    }),
  }),
  schema: await vi.importActual("../db/schema.js"),
}));

const { submitForm } = await import("./submissions.js");

async function submit(body: unknown) {
  state.body = body;
  return (submitForm as unknown as (e: unknown) => Promise<unknown>)({});
}

describe("submitForm pageUrl pass-through", () => {
  beforeEach(() => {
    state.inserted.length = 0;
    state.session = null;
    publishedForm.settings = JSON.stringify({});
  });

  it("persists the page URL and client surface forwarded in _meta", async () => {
    const res = await submit({
      data: { msg: "love it" },
      _meta: {
        pageUrl: "https://clips.agent-native.com/library?ref=clip_share",
        submitterEmail: "user@example.com",
        clientSurface: "tauri",
      },
    });

    expect(res).toMatchObject({ success: true });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]!.pageUrl).toBe(
      "https://clips.agent-native.com/library?ref=clip_share",
    );
    expect(state.inserted[0]!.submitterEmail).toBe("user@example.com");
    expect(state.inserted[0]!.clientSurface).toBe("tauri");
  });

  it("stores null when no page context is sent (direct fill)", async () => {
    const res = await submit({ data: { msg: "no page" } });

    expect(res).toMatchObject({ success: true });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]!.pageUrl).toBeNull();
    expect(state.inserted[0]!.clientSurface).toBeNull();
  });

  it("drops an unknown client surface to null", async () => {
    const res = await submit({
      data: { msg: "spoofed" },
      _meta: { clientSurface: "android-native" },
    });

    expect(res).toMatchObject({ success: true });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]!.clientSurface).toBeNull();
  });

  it("drops synthetic anonymous submitter emails forwarded in _meta", async () => {
    const res = await submit({
      data: { msg: "anonymous feedback" },
      _meta: {
        submitterEmail:
          "anon-ee79aaee-98e2-452a-9476-5205713803c0@agent-native.com",
      },
    });

    expect(res).toMatchObject({ success: true });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]!.submitterEmail).toBeNull();
  });

  it("drops synthetic anonymous submitter emails from the Forms session", async () => {
    state.session = {
      email: "anon-ee79aaee-98e2-452a-9476-5205713803c0@agent-native.com",
    };

    const res = await submit({ data: { msg: "host session is anonymous" } });

    expect(res).toMatchObject({ success: true });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]!.submitterEmail).toBeNull();
  });

  it("falls back to a real metadata email when the Forms session is anonymous", async () => {
    state.session = {
      email: "anon-ee79aaee-98e2-452a-9476-5205713803c0@agent-native.com",
    };

    const res = await submit({
      data: { msg: "cross-app feedback" },
      _meta: { submitterEmail: "real-user@example.com" },
    });

    expect(res).toMatchObject({ success: true });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]!.submitterEmail).toBe("real-user@example.com");
  });

  it("suppresses identity, IP, and source metadata in strict anonymous mode", async () => {
    publishedForm.settings = JSON.stringify({ anonymous: true });
    state.session = { email: "signed-in@example.com" };

    const res = await submit({
      data: { msg: "private feedback" },
      _meta: {
        submitterEmail: "metadata@example.com",
        chatSessionId: "chat-sensitive",
        activeRunId: "run-sensitive",
        pageUrl: "https://example.test/account/private",
        clientSurface: "web",
      },
    });

    expect(res).toMatchObject({ success: true });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      ip: null,
      submitterEmail: null,
      pageUrl: null,
      clientSurface: null,
    });
  });
});
