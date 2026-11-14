import { H3 } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";
import { getH3App } from "./framework-request-handler.js";
import { decodeOAuthState } from "./google-oauth.js";

vi.mock("../deploy/route-discovery.js", () => ({
  getMissingDefaultPlugins: vi.fn(async () => []),
}));
vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn(async () => undefined),
  ensureTableExists: vi.fn(async () => undefined),
}));
const { signInEmail } = vi.hoisted(() => ({
  signInEmail: vi.fn(async () => ({ token: "test-dev-session" })),
}));
vi.mock("./better-auth-instance.js", () => ({
  getBetterAuth: vi.fn(async () => ({
    handler: vi.fn(async () => new Response("{}")),
    api: {
      getSession: vi.fn(async () => null),
      signInEmail,
      signUpEmail: vi.fn(async () => undefined),
    },
  })),
  getBetterAuthSync: vi.fn(() => undefined),
}));
vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: vi.fn(async () => ({ rows: [] })) }),
  getRefusedLocalDatabaseSource: () => null,
  isLocalDatabase: () => true,
  retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
}));

import { autoMountAuth } from "./auth.js";

describe("mounted auth continuations", () => {
  beforeEach(() => {
    signInEmail.mockClear();
    vi.stubEnv("AUTH_DISABLED", "");
    vi.stubEnv("ACCESS_TOKEN", "");
    vi.stubEnv("ACCESS_TOKENS", "");
    vi.stubEnv("VITE_APP_BASE_PATH", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetAppConfigForTests();
  });

  it("keeps the Builder signup attempt in a standard Google redirect without desktop flow metadata", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("GOOGLE_CLIENT_ID", "example-google-client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "example-google-secret");
    vi.stubEnv(
      "BETTER_AUTH_SECRET",
      "example-auth-secret-for-state-signing-only",
    );
    vi.stubEnv("APP_BASE_PATH", "");
    resetAppConfigForTests();
    const app = new H3();
    await autoMountAuth(getH3App({ h3: app }), {});
    const response = await app.request(
      new Request(
        "http://localhost/_agent-native/google/auth-url?redirect=1&builder_signup_attempt=signup-attempt-example-123&flow_id=signup-attempt-example-123",
      ),
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(
      decodeOAuthState(
        location.searchParams.get("state") ?? undefined,
        "http://localhost/_agent-native/google/callback",
      ),
    ).toMatchObject({
      ok: true,
      builderSignupAttemptId: "signup-attempt-example-123",
      desktop: false,
    });
  });

  it.each([
    ["/dispatch"],
    ["/org/apps/content"],
    ["/portal", "/org/apps/content"],
  ])(
    "keeps mounted deep links through dev auto-login at %j",
    async (...mounts) => {
      const base = mounts.join("");
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("APP_BASE_PATH", base);
      vi.stubEnv("AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT", "");
      const app = new H3();
      await autoMountAuth(getH3App({ h3: app }), {
        getSession: async () => null,
      });
      let mounted = app;
      for (const mount of [...mounts].reverse()) {
        const parent = new H3();
        parent.mount(mount, mounted);
        mounted = parent;
      }
      const send = (path: string) => {
        const req = new Request(`http://localhost${path}`, {
          headers: { accept: "text/html" },
        });
        const requestUrl = new URL(req.url);
        // The Node adapter shares its mutable URL with the event.
        Object.defineProperty(req, "_url", { value: requestUrl });
        Object.defineProperty(req, "url", { get: () => requestUrl.href });
        Object.defineProperty(req, "runtime", {
          value: {
            node: {
              req: {
                url: path,
                method: "GET",
                socket: { remoteAddress: "127.0.0.1" },
              },
            },
          },
        });
        Object.defineProperty(req, "context", {
          value: { clientAddress: "127.0.0.1" },
          writable: true,
        });
        return mounted.request(req);
      };

      const nonCanonicalResponse = await send(`${base}/documents\\item`);
      expect(nonCanonicalResponse.status).toBe(400);
      expect(nonCanonicalResponse.headers.has("location")).toBe(false);
      expect(signInEmail).not.toHaveBeenCalled();

      for (const [input, expected] of [
        ["/documents/item?view=compact", "/documents/item?view=compact"],
        [
          "/documents/item%3Asection%3Fquery%23part?view=compact&next=%23hash",
          "/documents/item:section%3Fquery%23part?view=compact&next=%23hash",
        ],
      ]) {
        const response = await send(`${base}${input}`);
        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toBe(`${base}${expected}`);
        expect(response.headers.get("set-cookie")).toContain(
          "agent-native-first-run=1",
        );
      }
      expect(signInEmail).toHaveBeenCalledTimes(2);
    },
  );
});
