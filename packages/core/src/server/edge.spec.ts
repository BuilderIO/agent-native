import { H3Event } from "h3";
import {
  assert,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";

const { readSession } = vi.hoisted(() => ({
  readSession: vi.fn<
    (request: { headers: Headers }) => Promise<{
      user: { id: string; email: string };
      session: { token: string };
    }>
  >(),
}));

vi.mock("./better-auth-instance.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getBetterAuthSync: () => ({ api: { getSession: readSession } }),
  getBetterAuth: async () => ({ api: { getSession: readSession } }),
  resumeIdentityRekeysForEmail: async () => {},
}));

vi.mock("../org/context.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveOrgIdForEmailViaEvent: async () => "org-browser",
}));

import { getBrowserCookieSession, runWithRequestContext } from "./edge.js";

describe("public edge browser identity", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_DISABLED", "false");
    resetAppConfigForTests();
    readSession.mockReset();
    readSession.mockImplementation(
      async ({ headers }: { headers: Headers }) => ({
        user: {
          id: "browser-user",
          email: headers.has("authorization")
            ? "agent@example.test"
            : "browser@example.test",
        },
        session: { token: "fake-browser-session" },
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetAppConfigForTests();
  });

  it("resolves only the cookie identity through the published server entry", async () => {
    const event = new H3Event(
      new Request("https://app.example.test/approve", {
        headers: {
          cookie: "__Secure-an.session_token=fake-browser-cookie",
          authorization: "Bearer fake-agent-credential",
          "sec-fetch-site": "same-origin",
        },
      }),
    );
    const session = await runWithRequestContext(
      { userEmail: "ambient@example.test" },
      () => getBrowserCookieSession(event),
    );
    expect(session).toMatchObject({
      email: "browser@example.test",
      orgId: "org-browser",
    });
    expect(readSession).toHaveBeenCalledTimes(1);
    const input = readSession.mock.lastCall?.[0];
    assert(input);
    expect(input.headers.get("cookie")).toBe(
      "__Secure-an.session_token=fake-browser-cookie",
    );
    expect(input.headers.has("authorization")).toBe(false);
    expect(input.headers.has("sec-fetch-site")).toBe(false);
  });

  it("does not substitute bearer, query or ambient identity for a missing cookie", async () => {
    const event = new H3Event(
      new Request(
        "https://app.example.test/approve?_session=fake-query-credential",
        {
          headers: {
            authorization: "Bearer fake-agent-credential",
            "sec-fetch-site": "same-origin",
          },
        },
      ),
    );
    const session = await runWithRequestContext(
      { userEmail: "ambient@example.test" },
      () => getBrowserCookieSession(event),
    );
    expect(session).toBeNull();
    expect(readSession).not.toHaveBeenCalled();
  });
});
