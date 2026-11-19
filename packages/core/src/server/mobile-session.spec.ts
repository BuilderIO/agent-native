import { H3 } from "h3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../deploy/route-discovery.js", () => ({
  getMissingDefaultPlugins: vi.fn(async () => []),
}));
const db = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => db,
}));
import { authSessionsStore, autoMountAuth, COOKIE_NAME } from "./auth.js";
import { getH3App } from "./framework-request-handler.js";

let app: H3;
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AUTH_DISABLED", "");
  vi.stubEnv("ACCESS_TOKEN", "qa-test-configured-access");
  vi.stubEnv("ACCESS_TOKENS", "");
  vi.stubEnv("APP_BASE_PATH", "");
  vi.spyOn(authSessionsStore, "ready").mockResolvedValue();
  db.execute
    .mockReset()
    .mockImplementation(
      async ({ sql, args }: { sql: string; args: unknown[] }) => ({
        rows:
          sql.includes("FROM sessions") && args[0] === "qa-test-app-session"
            ? [{ email: "qa-test@example.test", created_at: Date.now() }]
            : sql.includes('FROM "user"') && args[0] === "qa-test@example.test"
              ? [
                  {
                    id: "qa-test-user",
                    email: "qa-test@example.test",
                    email_verified: true,
                    name: "QA test",
                  },
                ]
              : [],
      }),
    );
  app = new H3();
  await autoMountAuth(getH3App({ h3: app }), {
    getSession: async () => ({
      email: "cookie-only@example.test",
      token: "qa-test-cookie-only",
    }),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
function request(headers: Record<string, string>, method = "POST") {
  return app.request(
    new Request("https://app.example.test/_agent-native/auth/mobile-session", {
      method,
      headers,
    }),
  );
}

it("installs only an explicitly authenticated app session as an HttpOnly cookie", async () => {
  const response = await request({
    origin: "https://app.example.test",
    authorization: "Bearer qa-test-app-session",
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  const cookies = response.headers.getSetCookie();
  expect(
    cookies.some(
      (value) =>
        value.startsWith(COOKIE_NAME + "=qa-test-app-session;") &&
        /HttpOnly/i.test(value),
    ),
  ).toBe(true);
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it.each([
  {
    headers: {
      origin: "https://other.example.test",
      authorization: "Bearer qa-test-app-session",
    },
    status: 403,
  },
  { headers: { authorization: "Bearer qa-test-app-session" }, status: 403 },
  {
    headers: {
      origin: "https://app.example.test",
      cookie: "an_session=qa-test-cookie-only",
    },
    status: 401,
  },
  {
    headers: {
      origin: "https://app.example.test",
      authorization: "Bearer qa-test-unknown",
    },
    status: 401,
  },
  {
    headers: {
      origin: "https://app.example.test",
      authorization: "Bearer qa-test-app-session",
      "sec-fetch-site": "cross-site",
    },
    status: 403,
  },
])(
  "refuses a handoff with invalid origin/credential ($status)",
  async ({ headers, status }) => {
    const response = await request(headers);
    expect(response.status).toBe(status);
    expect(response.headers.getSetCookie()).toHaveLength(0);
  },
);

it("supports originless native WebView requests only with the mobile source header", async () => {
  const response = await request({
    "x-request-source": "mobile",
    authorization: "Bearer qa-test-app-session",
  });
  expect(response.status).toBe(200);
});
it("refuses GET and an unavailable session store", async () => {
  const get = await request({}, "GET");
  expect(get.status).toBe(405);
  db.execute.mockRejectedValueOnce(new Error("QA test store unavailable"));
  const post = await request({
    origin: "https://app.example.test",
    authorization: "Bearer qa-test-app-session",
  });
  expect(post.status).toBe(503);
  expect(post.headers.getSetCookie()).toHaveLength(0);
});

it("uses the public HTTPS origin behind a TLS terminator", async () => {
  const response = await app.request(
    new Request("http://app.example.test/_agent-native/auth/mobile-session", {
      method: "POST",
      headers: {
        origin: "https://app.example.test",
        authorization: "Bearer qa-test-app-session",
      },
    }),
  );
  expect(response.status).toBe(200);
  expect(
    response.headers
      .getSetCookie()
      .some((value) => value.startsWith(COOKIE_NAME + "=qa-test-app-session;")),
  ).toBe(true);
});

it("resolves the installed cookie on a later session request without a bearer", async () => {
  const handoff = await request({
    origin: "https://app.example.test",
    authorization: "Bearer qa-test-app-session",
  });
  const cookie = handoff.headers
    .getSetCookie()
    .find((value) => value.startsWith(COOKIE_NAME + "=qa-test-app-session;"))
    ?.split(";")[0];
  if (!cookie) throw new Error("Session handoff did not set its cookie");
  const confirmation = await app.request(
    new Request("https://app.example.test/_agent-native/auth/session", {
      headers: { cookie },
    }),
  );
  expect(confirmation.status).toBe(200);
  expect(await confirmation.json()).toMatchObject({
    email: "qa-test@example.test",
    token: "qa-test-app-session",
  });
});
