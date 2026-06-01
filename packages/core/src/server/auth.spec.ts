import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const DEFAULT_SSR_CACHE_CONTROL =
  "public, max-age=5, stale-while-revalidate=604800, stale-if-error=3600";
const DEFAULT_SSR_NETLIFY_CDN_CACHE_CONTROL =
  "public, durable, max-age=5, stale-while-revalidate=604800, stale-if-error=3600";

describe("server/auth", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.doUnmock("./better-auth-instance.js");
    vi.doUnmock("../db/client.js");
    vi.resetModules();
  });

  describe("shouldSkipEmailVerification", () => {
    it("is enabled by default in development and test", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const { shouldSkipEmailVerification } =
        await import("./better-auth-instance.js");

      expect(shouldSkipEmailVerification()).toBe(true);

      vi.stubEnv("NODE_ENV", "test");
      expect(shouldSkipEmailVerification()).toBe(true);
    });

    it("is disabled by default in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const { shouldSkipEmailVerification } =
        await import("./better-auth-instance.js");

      expect(shouldSkipEmailVerification()).toBe(false);
    });

    it("is enabled by AUTH_SKIP_EMAIL_VERIFICATION=1", async () => {
      vi.stubEnv("AUTH_SKIP_EMAIL_VERIFICATION", "1");
      const { shouldSkipEmailVerification } =
        await import("./better-auth-instance.js");

      expect(shouldSkipEmailVerification()).toBe(true);
    });

    it("treats blank, false, and 0 as disabled", async () => {
      const { shouldSkipEmailVerification } =
        await import("./better-auth-instance.js");

      vi.stubEnv("AUTH_SKIP_EMAIL_VERIFICATION", "");
      expect(shouldSkipEmailVerification()).toBe(false);

      vi.stubEnv("AUTH_SKIP_EMAIL_VERIFICATION", "false");
      expect(shouldSkipEmailVerification()).toBe(false);

      vi.stubEnv("AUTH_SKIP_EMAIL_VERIFICATION", "0");
      expect(shouldSkipEmailVerification()).toBe(false);
    });
  });

  describe("autoMountAuth", () => {
    it("throws when app is null/undefined in production mode", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "secret");
      const { autoMountAuth } = await import("./auth.js");

      await expect(autoMountAuth(null as any)).rejects.toThrow(
        "autoMountAuth: H3 app is required",
      );
    });

    it("returns false when app is null in dev mode", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const { autoMountAuth } = await import("./auth.js");

      expect(await autoMountAuth(null as any)).toBe(false);
    });

    it("enables Better Auth in dev mode", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("DEBUG", "1");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      const { autoMountAuth } = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const app = createMockApp();
      const result = await autoMountAuth(app);

      expect(result).toBe(true);
      const allLogs = logSpy.mock.calls.map((c) => c[0]).join(" ");
      expect(
        allLogs.includes("Better Auth") ||
          allLogs.includes("Auth guard registered"),
      ).toBe(true);
      logSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("enables Better Auth when no tokens in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("DEBUG", "1");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      const { autoMountAuth } = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const app = createMockApp();
      const result = await autoMountAuth(app);

      // Returns true even if Better Auth init fails — auth guard is still
      // registered as a fallback to block unauthenticated access.
      expect(result).toBe(true);
      // Either Better Auth initialized successfully, or the fallback guard was registered
      const allLogs = logSpy.mock.calls.map((c) => c[0]).join(" ");
      expect(
        allLogs.includes("Better Auth") ||
          allLogs.includes("Auth guard registered"),
      ).toBe(true);
      logSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("mounts generic Google OAuth routes by default when credentials are configured", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("GOOGLE_CLIENT_ID", "google-client");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;

      vi.doMock("./better-auth-instance.js", () => ({
        getBetterAuth: vi.fn(async () => ({
          handler: vi.fn(async () => new Response("{}")),
          api: {
            getSession: vi.fn(async () => null),
            signInEmail: vi.fn(),
            signUpEmail: vi.fn(),
            signOut: vi.fn(),
          },
        })),
        getBetterAuthSync: vi.fn(() => undefined),
      }));

      const { autoMountAuth } = await import("./auth.js");
      const app = createMockApp();
      await autoMountAuth(app);

      const paths = app.use.mock.calls
        .map((call: any[]) => call[0])
        .filter((path: unknown): path is string => typeof path === "string");
      expect(paths).toContain("/_agent-native/google/auth-url");
      expect(paths).toContain("/_agent-native/google/callback");
    });

    it("lets templates own Google OAuth routes when opted out", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("GOOGLE_CLIENT_ID", "google-client");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;

      vi.doMock("./better-auth-instance.js", () => ({
        getBetterAuth: vi.fn(async () => ({
          handler: vi.fn(async () => new Response("{}")),
          api: {
            getSession: vi.fn(async () => null),
            signInEmail: vi.fn(),
            signUpEmail: vi.fn(),
            signOut: vi.fn(),
          },
        })),
        getBetterAuthSync: vi.fn(() => undefined),
      }));

      const { autoMountAuth } = await import("./auth.js");
      const app = createMockApp();
      await autoMountAuth(app, {
        googleOnly: true,
        mountGoogleOAuthRoutes: false,
      });

      const paths = app.use.mock.calls
        .map((call: any[]) => call[0])
        .filter((path: unknown): path is string => typeof path === "string");
      expect(paths).not.toContain("/_agent-native/google/auth-url");
      expect(paths).not.toContain("/_agent-native/google/callback");
      expect(paths).toContain("/_agent-native/auth/ba");
    });

    it("passes through an already-mounted generic Google route when a template opts out later", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("GOOGLE_CLIENT_ID", "google-client");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;

      vi.doMock("./better-auth-instance.js", () => ({
        getBetterAuth: vi.fn(async () => ({
          handler: vi.fn(async () => new Response("{}")),
          api: {
            getSession: vi.fn(async () => null),
            signInEmail: vi.fn(),
            signUpEmail: vi.fn(),
            signOut: vi.fn(),
          },
        })),
        getBetterAuthSync: vi.fn(() => undefined),
      }));

      const { autoMountAuth } = await import("./auth.js");
      const app = createMockApp();
      await autoMountAuth(app);

      const authUrlHandler = app.use.mock.calls.find(
        (call: any[]) => call[0] === "/_agent-native/google/auth-url",
      )?.[1];
      expect(authUrlHandler).toBeTypeOf("function");

      await autoMountAuth(app, {
        googleOnly: true,
        mountGoogleOAuthRoutes: false,
      });

      expect(
        await authUrlHandler(
          createMockEvent({ path: "/_agent-native/google/auth-url" }),
        ),
      ).toBeUndefined();
    });

    it("preserves matching Builder preview proxy return URLs in OAuth state", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("GOOGLE_CLIENT_ID", "google-client");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret");
      vi.stubEnv("BETTER_AUTH_SECRET", "state-secret");
      vi.stubEnv("APP_URL", "https://agent-workspace.builder.io");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;

      vi.doMock("./better-auth-instance.js", () => ({
        getBetterAuth: vi.fn(async () => ({
          handler: vi.fn(async () => new Response("{}")),
          api: {
            getSession: vi.fn(async () => null),
            signInEmail: vi.fn(),
            signUpEmail: vi.fn(),
            signOut: vi.fn(),
            listOrganizations: vi.fn(),
          },
        })),
        getBetterAuthSync: vi.fn(() => undefined),
      }));

      const { autoMountAuth } = await import("./auth.js");
      const { decodeOAuthState } = await import("./google-oauth.js");
      const app = createMockApp();
      await autoMountAuth(app);

      const authUrlHandler = app.use.mock.calls.find(
        (call: any[]) => call[0] === "/_agent-native/google/auth-url",
      )?.[1];
      const previewOrigin =
        "https://940ebc5a83164aa6a37dde445e494f3a-electric-cliff-2caez1jb.builderio.xyz";

      const result = await authUrlHandler(
        createMockEvent({
          path: "/_agent-native/google/auth-url",
          query: {
            return: `${previewOrigin}/dispatch?builder.preview=interact`,
          },
          headers: {
            host: "agent-workspace.builder.io",
            "x-forwarded-proto": "https",
            referer: `${previewOrigin}/?builder.preview=interact`,
          },
        }),
      );

      const authUrl = new URL(result.url);
      const state = decodeOAuthState(
        authUrl.searchParams.get("state") || undefined,
        "https://agent-workspace.builder.io/_agent-native/google/callback",
      );
      expect(state.returnUrl).toBe(
        `${previewOrigin}/dispatch?builder.preview=interact`,
      );

      const rejected = await authUrlHandler(
        createMockEvent({
          path: "/_agent-native/google/auth-url",
          query: {
            return:
              "https://other-electric-cliff.builderio.xyz/dispatch?builder.preview=interact",
          },
          headers: {
            host: "agent-workspace.builder.io",
            "x-forwarded-proto": "https",
            referer: `${previewOrigin}/?builder.preview=interact`,
          },
        }),
      );
      const rejectedState = decodeOAuthState(
        new URL(rejected.url).searchParams.get("state") || undefined,
        "https://agent-workspace.builder.io/_agent-native/google/callback",
      );
      expect(rejectedState.returnUrl).toBeUndefined();
    });

    it("uses a derived A2A secret for Google OAuth state in production workspaces", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
      vi.stubEnv("GOOGLE_CLIENT_ID", "google-client");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret");
      vi.stubEnv("A2A_SECRET", "workspace-root-secret");
      vi.stubEnv("APP_URL", "https://agent-workspace.builder.io");
      delete process.env.OAUTH_STATE_SECRET;
      delete process.env.BETTER_AUTH_SECRET;
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;

      vi.doMock("./better-auth-instance.js", () => ({
        getBetterAuth: vi.fn(async () => ({
          handler: vi.fn(async () => new Response("{}")),
          api: {
            getSession: vi.fn(async () => null),
            signInEmail: vi.fn(),
            signUpEmail: vi.fn(),
            signOut: vi.fn(),
            listOrganizations: vi.fn(),
          },
        })),
        getBetterAuthSync: vi.fn(() => undefined),
      }));

      const { autoMountAuth } = await import("./auth.js");
      const { decodeOAuthState } = await import("./google-oauth.js");
      const app = createMockApp();
      await autoMountAuth(app);

      const authUrlHandler = app.use.mock.calls.find(
        (call: any[]) => call[0] === "/_agent-native/google/auth-url",
      )?.[1];
      const result = await authUrlHandler(
        createMockEvent({
          path: "/_agent-native/google/auth-url",
          headers: {
            host: "agent-workspace.builder.io",
            "x-forwarded-proto": "https",
          },
        }),
      );
      const stateParam = new URL(result.url).searchParams.get("state");

      expect(
        decodeOAuthState(
          stateParam || undefined,
          "https://agent-workspace.builder.io/_agent-native/google/callback",
        ).redirectUri,
      ).toBe(
        "https://agent-workspace.builder.io/_agent-native/google/callback",
      );

      vi.stubEnv("A2A_SECRET", "different-root-secret");
      expect(
        decodeOAuthState(
          stateParam || undefined,
          "https://fallback.example/_agent-native/google/callback",
        ).redirectUri,
      ).toBe("https://fallback.example/_agent-native/google/callback");
    });

    it("uses Better Auth, not token-only browser auth, when ACCESS_TOKEN is set", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      vi.stubEnv("DEBUG", "1");
      vi.doMock("./better-auth-instance.js", () => ({
        getBetterAuth: vi.fn(async () => ({
          handler: vi.fn(async () => new Response("{}")),
          api: {
            getSession: vi.fn(async () => null),
            signInEmail: vi.fn(),
            signUpEmail: vi.fn(),
            signOut: vi.fn(),
          },
        })),
        getBetterAuthSync: vi.fn(() => undefined),
      }));
      const { autoMountAuth } = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const app = createMockApp();
      const result = await autoMountAuth(app);

      expect(result).toBe(true);
      const paths = app.use.mock.calls
        .map((call: any[]) => call[0])
        .filter((path: unknown): path is string => typeof path === "string");
      expect(paths).toContain("/_agent-native/auth/ba");
      const allLogs = logSpy.mock.calls.map((c) => c[0]).join(" ");
      expect(allLogs).toContain("Better Auth");
      expect(allLogs).not.toContain("access token");
      logSpy.mockRestore();
    });

    it("does not render an access-token login page when ACCESS_TOKEN is set", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      vi.stubEnv("APP_BASE_PATH", "/demo");
      vi.doMock("./better-auth-instance.js", () => ({
        getBetterAuth: vi.fn(async () => ({
          handler: vi.fn(async () => new Response("{}")),
          api: {
            getSession: vi.fn(async () => null),
            signInEmail: vi.fn(),
            signUpEmail: vi.fn(),
            signOut: vi.fn(),
          },
        })),
        getBetterAuthSync: vi.fn(() => undefined),
      }));
      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      const result = await guard(createMockEvent({ path: "/demo" }));
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(200);
      expect((result as Response).headers.get("Cache-Control")).toBe(
        DEFAULT_SSR_CACHE_CONTROL,
      );
      expect((result as Response).headers.get("CDN-Cache-Control")).toBe(
        DEFAULT_SSR_CACHE_CONTROL,
      );
      expect(
        (result as Response).headers.get("Netlify-CDN-Cache-Control"),
      ).toBe(DEFAULT_SSR_NETLIFY_CDN_CACHE_CONTROL);

      const html = await (result as Response).text();
      expect(html).toContain("Create account");
      expect(html).not.toContain("This app is private");
      expect(html).not.toContain("Private deployment");
      expect(html).not.toContain("ACCESS_TOKEN");
    });

    it("custom auth without loginHtml does not render an access-token page", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app, {
        getSession: async () => null,
      });

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      const result = await guard(createMockEvent({ path: "/starter" }));
      expect(result).toBeInstanceOf(Response);

      const html = await (result as Response).text();
      expect(html).toContain("Sign in is not configured");
      expect(html).not.toContain("This app is private");
      expect(html).not.toContain("Private deployment");
      expect(html).not.toContain("ACCESS_TOKEN");
    });

    it("recognizes auth routes under APP_BASE_PATH in the global guard", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      vi.stubEnv("APP_BASE_PATH", "/docs");
      const { autoMountAuth } = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const app = createMockApp();
      await autoMountAuth(app);
      logSpy.mockRestore();

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      const result = await guard(
        createMockEvent({ path: "/docs/_agent-native/auth/session" }),
      );
      expect(result).toBeUndefined();
    });

    it("allows public workspace app pages while keeping API and framework routes protected", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      vi.stubEnv("APP_BASE_PATH", "/portal");
      vi.stubEnv("AGENT_NATIVE_WORKSPACE_APP_AUDIENCE", "public");
      vi.stubEnv("AGENT_NATIVE_WORKSPACE_APP_PROTECTED_PATHS", '["/admin"]');
      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      await expect(
        guard(createMockEvent({ path: "/portal" })),
      ).resolves.toBeUndefined();
      await expect(
        guard(createMockEvent({ path: "/portal/pricing" })),
      ).resolves.toBeUndefined();

      const adminResult = await guard(
        createMockEvent({ path: "/portal/admin/users" }),
      );
      expect(adminResult).toBeInstanceOf(Response);
      expect((adminResult as Response).status).toBe(200);
      expect((adminResult as Response).headers.get("Cache-Control")).toBe(
        DEFAULT_SSR_CACHE_CONTROL,
      );

      const adminDataResult = await guard(
        createMockEvent({
          path: "/portal/admin/users.data",
          headers: { accept: "text/x-script" },
        }),
      );
      expect(adminDataResult).toEqual({ error: "Unauthorized" });

      const apiResult = await guard(
        createMockEvent({ path: "/portal/api/private" }),
      );
      expect(apiResult).toEqual({ error: "Unauthorized" });

      const actionResult = await guard(
        createMockEvent({ path: "/portal/_agent-native/actions/list" }),
      );
      expect(actionResult).toEqual({ error: "Unauthorized" });
    });

    it("allows selected public workspace page paths in an internal app", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      vi.stubEnv("APP_BASE_PATH", "/docs");
      vi.stubEnv("AGENT_NATIVE_WORKSPACE_APP_AUDIENCE", "internal");
      vi.stubEnv("AGENT_NATIVE_WORKSPACE_APP_PUBLIC_PATHS", "/,/share");
      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      await expect(
        guard(createMockEvent({ path: "/docs" })),
      ).resolves.toBeUndefined();
      await expect(
        guard(createMockEvent({ path: "/docs/share/report" })),
      ).resolves.toBeUndefined();

      const privateResult = await guard(
        createMockEvent({ path: "/docs/admin" }),
      );
      expect(privateResult).toBeInstanceOf(Response);
      expect((privateResult as Response).status).toBe(200);
      expect((privateResult as Response).headers.get("Cache-Control")).toBe(
        DEFAULT_SSR_CACHE_CONTROL,
      );
    });

    it("relays root workspace OAuth callbacks to the app from state", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      vi.stubEnv("APP_NAME", "dispatch");
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      const state = `${Buffer.from(JSON.stringify({ app: "calendar" })).toString("base64url")}.sig`;
      const result = await guard(
        createMockEvent({
          path: "/_agent-native/google/callback",
          query: { code: "abc", state },
        }),
      );

      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(302);
      expect((result as Response).headers.get("location")).toBe(
        `/calendar/_agent-native/google/callback?code=abc&state=${state}`,
      );
    });

    it("lets signed Builder connect URLs bypass the global auth guard", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      vi.stubEnv("BETTER_AUTH_SECRET", "builder-connect-secret");
      vi.stubEnv("APP_BASE_PATH", "/todays-priorities");
      const { autoMountAuth } = await import("./auth.js");
      const { BUILDER_CONNECT_PARAM, signBuilderConnectToken } =
        await import("./builder-browser.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      const token = signBuilderConnectToken("jameson@builder.io");

      await expect(
        guard(
          createMockEvent({
            path: "/todays-priorities/_agent-native/builder/connect",
            query: { [BUILDER_CONNECT_PARAM]: token },
          }),
        ),
      ).resolves.toBeUndefined();

      await expect(
        guard(
          createMockEvent({
            path: "/todays-priorities/_agent-native/builder/connect",
            query: { [BUILDER_CONNECT_PARAM]: `${token}.tampered` },
          }),
        ),
      ).resolves.toEqual({ error: "Unauthorized" });
    });

    it("lets Builder connect callbacks with owner cookies bypass the global auth guard", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      vi.stubEnv("BETTER_AUTH_SECRET", "builder-connect-secret");
      vi.stubEnv("APP_BASE_PATH", "/todays-priorities");
      const { autoMountAuth } = await import("./auth.js");
      const { BUILDER_CONNECT_OWNER_COOKIE, signBuilderConnectToken } =
        await import("./builder-browser.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      const token = signBuilderConnectToken("jameson@builder.io");

      await expect(
        guard(
          createMockEvent({
            path: "/todays-priorities/_agent-native/builder/callback",
            headers: {
              cookie: `${BUILDER_CONNECT_OWNER_COOKIE}=${token}`,
            },
          }),
        ),
      ).resolves.toBeUndefined();
    });

    it("lets Builder connect callbacks with signed callback state bypass the global auth guard", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      vi.stubEnv("BETTER_AUTH_SECRET", "builder-connect-secret");
      vi.stubEnv("APP_BASE_PATH", "/todays-priorities");
      const { autoMountAuth } = await import("./auth.js");
      const { BUILDER_STATE_PARAM, signBuilderCallbackState } =
        await import("./builder-browser.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      const state = signBuilderCallbackState("jameson@builder.io");

      await expect(
        guard(
          createMockEvent({
            path: "/todays-priorities/_agent-native/builder/callback",
            query: { [BUILDER_STATE_PARAM]: state },
          }),
        ),
      ).resolves.toBeUndefined();
    });

    it("lets Builder connect callbacks with signed callback state bypass stale session cookies", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      vi.stubEnv("BETTER_AUTH_SECRET", "builder-connect-secret");
      vi.stubEnv("APP_BASE_PATH", "/todays-priorities");
      const { autoMountAuth } = await import("./auth.js");
      const { BUILDER_STATE_PARAM, signBuilderCallbackState } =
        await import("./builder-browser.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      const state = signBuilderCallbackState("jameson@builder.io");

      await expect(
        guard(
          createMockEvent({
            path: "/todays-priorities/_agent-native/builder/callback",
            query: { [BUILDER_STATE_PARAM]: state },
            headers: {
              cookie: "an_session=stale-localhost-session",
            },
          }),
        ),
      ).resolves.toBeUndefined();
    });

    it("lets signed integration processor routes bypass the global auth guard", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      const { autoMountAuth } = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const app = createMockApp();
      await autoMountAuth(app);
      logSpy.mockRestore();

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      for (const path of [
        "/dispatch/_agent-native/integrations/process-task",
        "/dispatch/_agent-native/integrations/process-a2a-continuation",
      ]) {
        const event = createMockEvent({ path });
        event.req.method = "POST";
        event.node.req.method = "POST";

        await expect(guard(event)).resolves.toBeUndefined();
      }
    });

    it("env-gates the federated-SSO route bypass (no-op when AGENT_NATIVE_IDENTITY_HUB_URL is unset)", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      delete process.env.AGENT_NATIVE_IDENTITY_HUB_URL;
      const { autoMountAuth } = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const app = createMockApp();
      await autoMountAuth(app);
      logSpy.mockRestore();

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      // Env UNSET → the identity routes are NOT bypassed: the guard must
      // treat them like any other unauthenticated /_agent-native/* request
      // (it returns a 401 body, i.e. NOT `undefined`). This is the
      // regression assertion for the env-unset-no-op invariant.
      for (const path of [
        "/_agent-native/identity/login",
        "/_agent-native/identity/callback",
      ]) {
        const result = await guard(createMockEvent({ path }));
        expect(result).not.toBeUndefined();
      }

      // Env SET → both routes bypass the blanket guard so the handler can
      // run its own signature/CSRF verification.
      vi.stubEnv(
        "AGENT_NATIVE_IDENTITY_HUB_URL",
        "https://dispatch.agent-native.com",
      );
      for (const path of [
        "/_agent-native/identity/login",
        "/_agent-native/identity/callback",
      ]) {
        await expect(guard(createMockEvent({ path }))).resolves.toBeUndefined();
      }
    });

    it("serves mounted login and signup pages from the framework guard", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app, {
        getSession: async () => null,
        loginHtml: "<!doctype html><title>QA login</title>",
      });

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      for (const path of ["/dispatch/login", "/dispatch/signup"]) {
        const result = await guard(createMockEvent({ path }));

        expect(result).toBeInstanceOf(Response);
        expect((result as Response).status).toBe(200);
        expect(await (result as Response).text()).toContain("QA login");
      }
    });

    it("serves cacheable first-party branded auth when the default guard handles a built-in host", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      vi.doMock("./better-auth-instance.js", () => ({
        getBetterAuth: vi.fn(async () => ({
          handler: vi.fn(async () => new Response("{}")),
          api: {
            getSession: vi.fn(async () => null),
            signInEmail: vi.fn(),
            signUpEmail: vi.fn(),
            signOut: vi.fn(),
          },
        })),
        getBetterAuthSync: vi.fn(() => undefined),
      }));

      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      const result = await guard(
        createMockEvent({
          path: "/",
          headers: { host: "dispatch.agent-native.com" },
        }),
      );

      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(200);
      expect((result as Response).headers.get("Cache-Control")).toBe(
        DEFAULT_SSR_CACHE_CONTROL,
      );
      expect((result as Response).headers.get("X-Robots-Tag")).toBe(
        "noindex, nofollow",
      );
      const html = await (result as Response).text();
      expect(html).toContain("Agent-Native Dispatch");
      expect(html).toContain('class="marketing-panel"');
      expect(html).toContain("__anRedirectIfAlreadySignedIn");
    });

    it("keeps React Router data requests protected instead of serving cached login HTML", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app, {
        getSession: async () => null,
        loginHtml: "<!doctype html><title>QA login</title>",
      });

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      const event = createMockEvent({
        path: "/inbox.data",
        headers: { accept: "text/x-script" },
      });
      const result = await guard(event);

      expect(result).toEqual({ error: "Unauthorized" });
      expect(event.res.status).toBe(401);
    });

    it("redirects mounted login and signup pages when a session already exists", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app, {
        getSession: async () => ({ email: "qa+local@example.com" }),
        loginHtml: "<!doctype html><title>QA login</title>",
      });

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      for (const path of ["/dispatch/login", "/dispatch/signup"]) {
        const result = await guard(createMockEvent({ path }));

        expect(result).toBeInstanceOf(Response);
        expect((result as Response).status).toBe(302);
        expect((result as Response).headers.get("location")).toBe("/dispatch");
      }
    });

    it("allows app-state request-source headers in CORS preflight responses", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      const event = createMockEvent({
        path: "/_agent-native/application-state/navigation",
        headers: {
          origin: "http://localhost:1420",
          "access-control-request-method": "PUT",
          "access-control-request-headers": "x-request-source,content-type",
        },
      });
      event.req.method = "OPTIONS";
      event.node.req.method = "OPTIONS";

      const result = await guard(event);

      expect(result).toBe("");
      expect(event.res.status).toBe(204);
      expect(event.res.headers.get("access-control-allow-methods")).toContain(
        "HEAD",
      );
      expect(event.res.headers.get("access-control-allow-headers")).toContain(
        "X-Request-Source",
      );
    });

    it("rejects disallowed cross-origin preflight before auth", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      const event = createMockEvent({
        path: "/_agent-native/actions/list-decks",
        headers: {
          origin: "https://evil.example",
          "access-control-request-method": "GET",
        },
      });
      event.req.method = "OPTIONS";
      event.node.req.method = "OPTIONS";

      const result = await guard(event);

      expect(result).toBe("");
      expect(event.res.status).toBe(403);
      expect(event.res.headers.get("access-control-allow-origin")).toBeNull();
    });

    it.each([
      "https://520ba469ac5783c72c33d79bea940871.claudemcpcontent.com",
      "https://shakira-professor-conscious-frederick-trycloudflare-com.web-sandbox.oaiusercontent.com",
    ])(
      "allows MCP embed transplant preflights from %s before auth",
      async (origin) => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("ACCESS_TOKEN", "my-secret");
        const { autoMountAuth } = await import("./auth.js");

        const app = createMockApp();
        await autoMountAuth(app);

        const guard = app.use.mock.calls
          .map((call: any[]) => call[0])
          .find((arg: unknown) => typeof arg === "function");
        expect(guard).toBeTypeOf("function");

        const event = createMockEvent({
          path: "/_agent-native/embed/start",
          headers: {
            origin,
            "access-control-request-method": "GET",
            "access-control-request-headers": "x-agent-native-embed-transplant",
          },
        });
        event.req.method = "OPTIONS";
        event.node.req.method = "OPTIONS";

        const result = await guard(event);

        expect(result).toBe("");
        expect(event.res.status).toBe(204);
        expect(event.res.headers.get("access-control-allow-origin")).toBe(
          origin,
        );
        expect(event.res.headers.get("access-control-allow-headers")).toContain(
          "X-Agent-Native-Embed-Transplant",
        );
        expect(
          event.res.headers.get("access-control-allow-credentials"),
        ).toBeNull();
      },
    );

    it("handles Tauri auth preflights before route-specific auth handlers", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const calls = app.use.mock.calls;
      const corsIndex = calls.findIndex(
        (call: any[]) => call[0] === "/_agent-native/auth",
      );
      const loginIndex = calls.findIndex(
        (call: any[]) => call[0] === "/_agent-native/auth/login",
      );
      expect(corsIndex).toBeGreaterThanOrEqual(0);
      expect(loginIndex).toBeGreaterThan(corsIndex);

      const corsHandler = calls[corsIndex][1];
      const event = createMockEvent({
        path: "/_agent-native/auth/login",
        headers: {
          origin: "tauri://localhost",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });
      event.req.method = "OPTIONS";
      event.node.req.method = "OPTIONS";

      const result = await corsHandler(event);

      expect(result).toBe("");
      expect(event.res.status).toBe(204);
      expect(event.res.headers.get("access-control-allow-origin")).toBe(
        "tauri://localhost",
      );
      expect(event.res.headers.get("access-control-allow-methods")).toContain(
        "POST",
      );
      expect(event.res.headers.get("access-control-allow-headers")).toContain(
        "Content-Type",
      );
    });

    it("adds CORS headers to Tauri auth GETs while allowing the route to continue", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const corsHandler = app.use.mock.calls.find(
        (call: any[]) => call[0] === "/_agent-native/auth",
      )?.[1];
      expect(corsHandler).toBeTypeOf("function");

      const event = createMockEvent({
        path: "/_agent-native/auth/desktop-exchange",
        headers: { origin: "tauri://localhost" },
      });
      delete event.node.req.headers.origin;

      const result = await corsHandler(event);

      expect(result).toBeUndefined();
      expect(event.res.headers.get("access-control-allow-origin")).toBe(
        "tauri://localhost",
      );
      expect(event.res.headers.get("access-control-allow-credentials")).toBe(
        "true",
      );
    });

    it("returns a session token body for desktop email/password login", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;

      const signInEmail = vi.fn(async () => ({ token: "desktop-login-token" }));
      vi.doMock("./better-auth-instance.js", () => ({
        getBetterAuth: vi.fn(async () => ({
          handler: vi.fn(async () => new Response("{}")),
          api: {
            getSession: vi.fn(async () => null),
            signInEmail,
            signUpEmail: vi.fn(),
            signOut: vi.fn(),
          },
        })),
        getBetterAuthSync: vi.fn(() => undefined),
      }));
      vi.doMock("../db/client.js", () => ({
        getDbExec: () => ({ execute: vi.fn(async () => ({ rows: [] })) }),
        isPostgres: () => false,
        isLocalDatabase: () => true,
        intType: () => "INTEGER",
        retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
      }));

      const { autoMountAuth } = await import("./auth.js");
      const app = createMockApp();
      await autoMountAuth(app);

      const loginHandler = app.use.mock.calls.find(
        (call: any[]) => call[0] === "/_agent-native/auth/login",
      )?.[1];
      expect(loginHandler).toBeTypeOf("function");

      const request = new Request("http://localhost/_agent-native/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-source": "clips-desktop",
        },
        body: JSON.stringify({
          email: "USER@EXAMPLE.COM",
          password: "secret-password",
        }),
      });
      const event = createMockEvent({
        path: "/_agent-native/auth/login",
        headers: {
          "content-type": "application/json",
          "x-request-source": "clips-desktop",
        },
      });
      event.req = request;
      event.headers = request.headers;
      event.node.req.method = "POST";
      event.node.req.headers = Object.fromEntries(request.headers.entries());

      await expect(loginHandler(event)).resolves.toEqual({
        ok: true,
        token: "desktop-login-token",
        email: "user@example.com",
      });
      expect(signInEmail).toHaveBeenCalledWith({
        body: { email: "user@example.com", password: "secret-password" },
      });
    });

    it("accepts HEAD on the auth session endpoint", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const sessionHandler = app.use.mock.calls.find(
        (call: any[]) => call[0] === "/_agent-native/auth/session",
      )?.[1];
      expect(sessionHandler).toBeTypeOf("function");

      const event = createMockEvent({ path: "/_agent-native/auth/session" });
      event.req.method = "HEAD";
      event.node.req.method = "HEAD";

      const result = await sessionHandler(event);

      expect(event.res.status).toBe(200);
      expect(result).toEqual({ error: "Not authenticated" });
    });

    it("desktop exchange establishes the session cookie when redeeming a token", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;

      const mockExecute = vi.fn().mockImplementation(({ sql, args }: any) => {
        if (
          typeof sql === "string" &&
          sql.includes("DELETE FROM sessions") &&
          args?.[0] === "dex:flow-1"
        ) {
          return {
            rows: [{ email: "session-token-abc::user@gmail.com" }],
          };
        }
        return { rows: [] };
      });
      vi.doMock("../db/client.js", () => ({
        getDbExec: () => ({ execute: mockExecute }),
        isPostgres: () => false,
        isLocalDatabase: () => false,
        intType: () => "INTEGER",
        retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
      }));
      vi.doMock("./better-auth-instance.js", () => ({
        getBetterAuth: vi.fn(async () => ({
          handler: vi.fn(async () => new Response("{}")),
          api: {
            getSession: vi.fn(async () => null),
            signInEmail: vi.fn(),
            signUpEmail: vi.fn(),
            signOut: vi.fn(),
          },
        })),
        getBetterAuthSync: vi.fn(() => undefined),
      }));

      const { autoMountAuth } = await import("./auth.js");
      const app = createMockApp();
      await autoMountAuth(app);

      const exchangeHandler = app.use.mock.calls.find(
        (call: any[]) => call[0] === "/_agent-native/auth/desktop-exchange",
      )?.[1];
      expect(exchangeHandler).toBeTypeOf("function");

      const event = createMockEvent({
        path: "/_agent-native/auth/desktop-exchange",
        query: { flow_id: "flow-1" },
      });
      const result = await exchangeHandler(event);

      expect(result).toEqual({
        token: "session-token-abc",
        email: "user@gmail.com",
      });
      expect(event.res.headers.get("set-cookie")).toContain(
        "session-token-abc",
      );
    });

    it("desktop exchange can deliver OAuth errors to the app surface", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;

      vi.doMock("../db/client.js", () => ({
        getDbExec: () => ({ execute: vi.fn(async () => ({ rows: [] })) }),
        isPostgres: () => false,
        isLocalDatabase: () => false,
        intType: () => "INTEGER",
        retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
      }));
      vi.doMock("./better-auth-instance.js", () => ({
        getBetterAuth: vi.fn(async () => ({
          handler: vi.fn(async () => new Response("{}")),
          api: {
            getSession: vi.fn(async () => null),
            signInEmail: vi.fn(),
            signUpEmail: vi.fn(),
            signOut: vi.fn(),
          },
        })),
        getBetterAuthSync: vi.fn(() => undefined),
      }));

      const { autoMountAuth, setDesktopExchangeError } =
        await import("./auth.js");
      const app = createMockApp();
      await autoMountAuth(app);
      setDesktopExchangeError("flow-error", {
        message: "Sign out and try again.",
        code: "account_owner_mismatch",
        accountId: "steve@builder.io",
        attemptedOwner: "other@example.com",
      });

      const exchangeHandler = app.use.mock.calls.find(
        (call: any[]) => call[0] === "/_agent-native/auth/desktop-exchange",
      )?.[1];
      const result = await exchangeHandler(
        createMockEvent({
          path: "/_agent-native/auth/desktop-exchange",
          query: { flow_id: "flow-error" },
        }),
      );

      expect(result).toEqual({
        error: "Sign out and try again.",
        message: "Sign out and try again.",
        code: "account_owner_mismatch",
        accountId: "steve@builder.io",
        attemptedOwner: "other@example.com",
      });
    });

    it("surfaces Google callback failures through desktop exchange polling", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("GOOGLE_CLIENT_ID", "google-client");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret");
      vi.stubEnv("BETTER_AUTH_SECRET", "state-secret");
      vi.stubEnv("APP_URL", "https://agent-workspace.builder.io");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;

      vi.doMock("../db/client.js", () => ({
        getDbExec: () => ({ execute: vi.fn(async () => ({ rows: [] })) }),
        isPostgres: () => false,
        isLocalDatabase: () => false,
        intType: () => "INTEGER",
        retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
      }));
      vi.doMock("./better-auth-instance.js", () => ({
        getBetterAuth: vi.fn(async () => ({
          handler: vi.fn(async () => new Response("{}")),
          api: {
            getSession: vi.fn(async () => null),
            signInEmail: vi.fn(),
            signUpEmail: vi.fn(),
            signOut: vi.fn(),
          },
        })),
        getBetterAuthSync: vi.fn(() => undefined),
      }));

      const { autoMountAuth } = await import("./auth.js");
      const { encodeOAuthState } = await import("./google-oauth.js");
      const app = createMockApp();
      await autoMountAuth(app);

      const callbackHandler = app.use.mock.calls.find(
        (call: any[]) => call[0] === "/_agent-native/google/callback",
      )?.[1];
      const exchangeHandler = app.use.mock.calls.find(
        (call: any[]) => call[0] === "/_agent-native/auth/desktop-exchange",
      )?.[1];
      expect(callbackHandler).toBeTypeOf("function");
      expect(exchangeHandler).toBeTypeOf("function");

      const state = encodeOAuthState({
        redirectUri:
          "https://agent-workspace.builder.io/_agent-native/google/callback",
        desktop: true,
        flowId: "flow-denied",
      });
      const response = await callbackHandler(
        createMockEvent({
          path: "/_agent-native/google/callback",
          query: {
            state,
            error: "access_denied",
            error_description: "The user denied access",
          },
          headers: {
            host: "agent-workspace.builder.io",
            "x-forwarded-proto": "https",
          },
        }),
      );
      expect(response).toBeInstanceOf(Response);
      await expect((response as Response).text()).resolves.toContain(
        "The user denied access",
      );

      const result = await exchangeHandler(
        createMockEvent({
          path: "/_agent-native/auth/desktop-exchange",
          query: { flow_id: "flow-denied" },
        }),
      );

      expect(result).toMatchObject({
        error: "Google sign-in failed: The user denied access",
        message: "Google sign-in failed: The user denied access",
        code: "access_denied",
      });
    });

    it("strips APP_BASE_PATH before forwarding requests to Better Auth", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("APP_BASE_PATH", "/docs");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;

      let forwardedPath = "";
      vi.doMock("./better-auth-instance.js", () => ({
        getBetterAuth: vi.fn(async () => ({
          handler: async (request: Request) => {
            forwardedPath = new URL(request.url).pathname;
            return new Response(JSON.stringify({ ok: true }), {
              headers: { "content-type": "application/json" },
            });
          },
          api: {
            getSession: vi.fn(async () => null),
            signInEmail: vi.fn(),
            signUpEmail: vi.fn(),
            signOut: vi.fn(),
          },
        })),
        getBetterAuthSync: vi.fn(() => undefined),
      }));

      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const baHandler = app.use.mock.calls.find(
        (call: any[]) => call[0] === "/_agent-native/auth/ba",
      )?.[1];
      expect(baHandler).toBeTypeOf("function");

      const fullPath = "/docs/_agent-native/auth/ba/sign-in/email";
      const request = new Request(`http://localhost${fullPath}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const event = {
        req: request,
        url: new URL("http://localhost/sign-in/email"),
        res: { headers: new Headers(), status: 200 },
        node: {
          req: { headers: {}, url: fullPath, method: "POST" },
          res: {
            setHeader: vi.fn(),
            getHeader: vi.fn(),
            appendHeader: vi.fn(),
          },
        },
        headers: request.headers,
        context: {
          _mountedPathname: fullPath,
          _mountPrefix: "/docs/_agent-native/auth/ba",
        },
        path: "/sign-in/email",
      };

      await baHandler(event);

      expect(forwardedPath).toBe("/_agent-native/auth/ba/sign-in/email");
    });

    it("sanitizes resend verification callback URLs before forwarding to Better Auth", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;

      let forwardedBody: any;
      vi.doMock("./better-auth-instance.js", () => ({
        getBetterAuth: vi.fn(async () => ({
          handler: async (request: Request) => {
            forwardedBody = await request.json();
            return new Response(JSON.stringify({ ok: true }), {
              headers: { "content-type": "application/json" },
            });
          },
          api: {
            getSession: vi.fn(async () => null),
            signInEmail: vi.fn(),
            signUpEmail: vi.fn(),
            signOut: vi.fn(),
          },
        })),
        getBetterAuthSync: vi.fn(() => undefined),
      }));

      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const baHandler = app.use.mock.calls.find(
        (call: any[]) => call[0] === "/_agent-native/auth/ba",
      )?.[1];
      expect(baHandler).toBeTypeOf("function");

      const fullPath = "/_agent-native/auth/ba/send-verification-email";
      const request = new Request(`http://localhost${fullPath}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "user@example.com",
          callbackURL: "https://slack.com/app_redirect?channel=C123",
        }),
      });
      const event = {
        req: request,
        url: new URL("http://localhost/send-verification-email"),
        res: { headers: new Headers(), status: 200 },
        node: {
          req: { headers: {}, url: fullPath, method: "POST" },
          res: {
            setHeader: vi.fn(),
            getHeader: vi.fn(),
            appendHeader: vi.fn(),
          },
        },
        headers: request.headers,
        context: {
          _mountedPathname: fullPath,
          _mountPrefix: "/_agent-native/auth/ba",
        },
        path: "/send-verification-email",
      };

      await baHandler(event);

      expect(forwardedBody).toEqual({
        email: "user@example.com",
        callbackURL: "/",
      });
    });

    it("does not enable token-only browser auth when ACCESS_TOKENS is set", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKENS", "token1, token2, token3");
      vi.stubEnv("DEBUG", "1");
      delete process.env.ACCESS_TOKEN;
      vi.doMock("./better-auth-instance.js", () => ({
        getBetterAuth: vi.fn(async () => ({
          handler: vi.fn(async () => new Response("{}")),
          api: {
            getSession: vi.fn(async () => null),
            signInEmail: vi.fn(),
            signUpEmail: vi.fn(),
            signOut: vi.fn(),
          },
        })),
        getBetterAuthSync: vi.fn(() => undefined),
      }));
      const { autoMountAuth } = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const app = createMockApp();
      const result = await autoMountAuth(app);

      expect(result).toBe(true);
      const allLogs = logSpy.mock.calls.map((c) => c[0]).join(" ");
      expect(allLogs).toContain("Better Auth");
      expect(allLogs).not.toContain("access token");
      logSpy.mockRestore();
    });

    it("returns true when custom getSession is provided in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("DEBUG", "1");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      const { autoMountAuth } = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const app = createMockApp();
      const result = await autoMountAuth(app, {
        getSession: async () => ({ email: "test@test.com" }),
      });

      expect(result).toBe(true);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("custom getSession"),
      );
      logSpy.mockRestore();
    });
  });

  describe("getSession", () => {
    it("resolves bearer legacy session tokens for desktop clients", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;

      const mockExecute = vi.fn().mockImplementation(({ sql, args }: any) => {
        if (
          typeof sql === "string" &&
          sql.includes("SELECT") &&
          args?.[0] === "desktop-token-abc"
        ) {
          return {
            rows: [{ email: "user@gmail.com", created_at: Date.now() }],
          };
        }
        return { rows: [] };
      });
      vi.doMock("../db/client.js", () => ({
        getDbExec: () => ({ execute: mockExecute }),
        isPostgres: () => false,
        isLocalDatabase: () => true,
        intType: () => "INTEGER",
        retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
      }));

      const { getSession } = await import("./auth.js");
      const event = createMockEvent({
        headers: { authorization: "Bearer desktop-token-abc" },
      });

      expect(await getSession(event)).toEqual({
        email: "user@gmail.com",
        token: "desktop-token-abc",
      });
      expect(event.res.headers.get("set-cookie")).toBeNull();
    });

    it("promotes _session query tokens to a session cookie", async () => {
      vi.stubEnv("NODE_ENV", "production");

      const mockExecute = vi.fn().mockImplementation(({ sql, args }: any) => {
        if (
          typeof sql === "string" &&
          sql.includes("SELECT") &&
          args?.[0] === "mobile-token-abc"
        ) {
          return {
            rows: [{ email: "user@gmail.com", created_at: Date.now() }],
          };
        }
        return { rows: [] };
      });
      vi.doMock("../db/client.js", () => ({
        getDbExec: () => ({ execute: mockExecute }),
        isPostgres: () => false,
        isLocalDatabase: () => true,
        intType: () => "INTEGER",
        retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
      }));

      const { getSession } = await import("./auth.js");
      const event = createMockEvent({
        query: { _session: "mobile-token-abc" },
      });

      expect(await getSession(event)).toEqual({
        email: "user@gmail.com",
        token: "mobile-token-abc",
      });
      expect(event.res.headers.get("set-cookie")).toContain("mobile-token-abc");
    });

    it("checks duplicate framework cookies until it finds a live session", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;

      const mockExecute = vi.fn().mockImplementation((query: any) => {
        const sql = typeof query === "string" ? query : query.sql;
        const args = typeof query === "string" ? undefined : query.args;
        if (
          typeof sql === "string" &&
          sql.includes("SELECT") &&
          args?.[0] === "fresh-token"
        ) {
          return {
            rows: [{ email: "user@gmail.com", created_at: Date.now() }],
          };
        }
        return { rows: [] };
      });
      vi.doMock("../db/client.js", () => ({
        getDbExec: () => ({ execute: mockExecute }),
        isPostgres: () => false,
        isLocalDatabase: () => true,
        intType: () => "INTEGER",
        retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
      }));

      const { getSession } = await import("./auth.js");
      const event = createMockEvent({
        headers: {
          cookie: "an_session=stale-token; an_session=fresh-token",
        },
      });

      expect(await getSession(event)).toEqual({
        email: "user@gmail.com",
        token: "fresh-token",
      });
      const selectedTokens = mockExecute.mock.calls
        .map(([query]) => {
          if (typeof query === "string") return undefined;
          const sql = String(query?.sql ?? "");
          // Only count the legacy `sessions` token lookups; the org-backfill
          // queries (`org_members`, `settings`) are noise for this assertion.
          if (!/FROM\s+sessions\b/i.test(sql)) return undefined;
          return query.args?.[0];
        })
        .filter(Boolean);
      expect(selectedTokens).toEqual(["stale-token", "fresh-token"]);
    });

    it("migrates a legacy shared framework cookie into the isolated cookie name", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("COOKIE_DOMAIN", ".agent-native.com");
      vi.stubEnv("APP_NAME", "slides");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;

      const mockExecute = vi.fn().mockImplementation((query: any) => {
        const sql = typeof query === "string" ? query : query.sql;
        const args = typeof query === "string" ? undefined : query.args;
        if (
          typeof sql === "string" &&
          sql.includes("SELECT") &&
          args?.[0] === "legacy-token"
        ) {
          return {
            rows: [{ email: "user@gmail.com", created_at: Date.now() }],
          };
        }
        return { rows: [] };
      });
      vi.doMock("../db/client.js", () => ({
        getDbExec: () => ({ execute: mockExecute }),
        isPostgres: () => false,
        isLocalDatabase: () => true,
        intType: () => "INTEGER",
        retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
      }));

      const { getSession } = await import("./auth.js");
      const event = createMockEvent({
        headers: {
          cookie: "an_session=legacy-token",
          "x-forwarded-proto": "https",
        },
      });

      expect(await getSession(event)).toEqual({
        email: "user@gmail.com",
        token: "legacy-token",
      });
      const setCookie = event.res.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("an_session=");
      expect(setCookie).toContain("Max-Age=0");
      expect(setCookie).toContain("Domain=.agent-native.com");
      expect(setCookie).toContain("an_session_slides=legacy-token");
    });

    it("marks promoted cross-site session cookies secure on forwarded HTTPS requests", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.APP_URL;
      delete process.env.BETTER_AUTH_URL;

      const mockExecute = vi.fn().mockImplementation(({ sql, args }: any) => {
        if (
          typeof sql === "string" &&
          sql.includes("SELECT") &&
          args?.[0] === "desktop-token-abc"
        ) {
          return {
            rows: [{ email: "user@gmail.com", created_at: Date.now() }],
          };
        }
        return { rows: [] };
      });
      vi.doMock("../db/client.js", () => ({
        getDbExec: () => ({ execute: mockExecute }),
        isPostgres: () => false,
        isLocalDatabase: () => false,
        intType: () => "INTEGER",
        retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
      }));

      const { getSession } = await import("./auth.js");
      const event = createMockEvent({
        query: { _session: "desktop-token-abc" },
        headers: { "x-forwarded-proto": "https" },
      });
      // Netlify/H3 exposes headers through the web Request/H3 accessors, but
      // not always through the legacy Node request object.
      delete event.node.req.headers["x-forwarded-proto"];

      expect(await getSession(event)).toEqual({
        email: "user@gmail.com",
        token: "desktop-token-abc",
      });
      const setCookie = event.res.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("desktop-token-abc");
      expect(setCookie).toContain("SameSite=None");
      expect(setCookie).toContain("Secure");
    });

    it("falls through to _session query param when custom getSession returns null", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;

      const mockExecute = vi.fn().mockImplementation(({ sql, args }: any) => {
        if (
          typeof sql === "string" &&
          sql.includes("SELECT") &&
          args?.[0] === "mobile-token-abc"
        ) {
          return {
            rows: [{ email: "user@gmail.com", created_at: Date.now() }],
          };
        }
        return { rows: [] };
      });
      vi.doMock("../db/client.js", () => ({
        getDbExec: () => ({ execute: mockExecute }),
        isPostgres: () => false,
        isLocalDatabase: () => true,
        intType: () => "INTEGER",
        retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
      }));

      const authModule = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const app = createMockApp();
      await authModule.autoMountAuth(app, {
        getSession: async () => null,
      });
      logSpy.mockRestore();

      const event = createMockEvent({
        query: { _session: "mobile-token-abc" },
      });
      const session = await authModule.getSession(event);

      expect(session).toEqual({
        email: "user@gmail.com",
        token: "mobile-token-abc",
      });
    });

    it("uses custom getSession result when it returns a session", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;

      const authModule = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const app = createMockApp();
      await authModule.autoMountAuth(app, {
        getSession: async () => ({ email: "custom@auth.com" }),
      });
      logSpy.mockRestore();

      const event = createMockEvent({ query: { _session: "some-token" } });
      const session = await authModule.getSession(event);

      expect(session).toEqual({ email: "custom@auth.com" });
    });

    it("backfills orgId from org_members for a single-membership user", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;

      const mockExecute = vi.fn().mockImplementation((query: any) => {
        const sql = String(query?.sql ?? "");
        const args = query?.args ?? [];
        if (/FROM\s+sessions\b/i.test(sql) && args[0] === "token-abc") {
          return {
            rows: [{ email: "user@gmail.com", created_at: Date.now() }],
          };
        }
        if (/FROM\s+org_members\b/i.test(sql) && args[0] === "user@gmail.com") {
          return { rows: [{ org_id: "org-solo" }] };
        }
        return { rows: [] };
      });
      vi.doMock("../db/client.js", () => ({
        getDbExec: () => ({ execute: mockExecute }),
        isPostgres: () => false,
        isLocalDatabase: () => true,
        intType: () => "INTEGER",
        retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
      }));

      const { getSession } = await import("./auth.js");
      const event = createMockEvent({
        headers: { authorization: "Bearer token-abc" },
      });

      expect(await getSession(event)).toEqual({
        email: "user@gmail.com",
        token: "token-abc",
        orgId: "org-solo",
      });
    });

    it("honors active-org-id user setting for a multi-membership user", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;

      const mockExecute = vi.fn().mockImplementation((query: any) => {
        const sql = String(query?.sql ?? "");
        const args = query?.args ?? [];
        if (/FROM\s+sessions\b/i.test(sql) && args[0] === "token-multi") {
          return {
            rows: [{ email: "user@gmail.com", created_at: Date.now() }],
          };
        }
        if (/FROM\s+org_members\b/i.test(sql) && args[0] === "user@gmail.com") {
          return { rows: [{ org_id: "org-a" }, { org_id: "org-b" }] };
        }
        if (
          /FROM\s+settings\b/i.test(sql) &&
          args[0] === "u:user@gmail.com:active-org-id"
        ) {
          return { rows: [{ value: JSON.stringify({ orgId: "org-b" }) }] };
        }
        return { rows: [] };
      });
      vi.doMock("../db/client.js", () => ({
        getDbExec: () => ({ execute: mockExecute }),
        isPostgres: () => false,
        isLocalDatabase: () => true,
        intType: () => "INTEGER",
        retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
      }));

      const { getSession } = await import("./auth.js");
      const event = createMockEvent({
        headers: { authorization: "Bearer token-multi" },
      });

      expect(await getSession(event)).toEqual({
        email: "user@gmail.com",
        token: "token-multi",
        orgId: "org-b",
      });
    });
  });

  describe("safeReturnPath", () => {
    async function load() {
      const m = await import("./auth.js");
      return m.safeReturnPath;
    }

    it("returns '/' for null / empty / missing input", async () => {
      const safeReturnPath = await load();
      expect(safeReturnPath(null)).toBe("/");
      expect(safeReturnPath(undefined)).toBe("/");
      expect(safeReturnPath("")).toBe("/");
    });

    it("preserves a same-origin path", async () => {
      const safeReturnPath = await load();
      expect(safeReturnPath("/share/abc")).toBe("/share/abc");
      expect(safeReturnPath("/share/abc?x=1&y=2")).toBe("/share/abc?x=1&y=2");
      expect(safeReturnPath("/share/abc#section")).toBe("/share/abc#section");
      expect(safeReturnPath("/")).toBe("/");
    });

    it("blocks network-path references (//evil.com/...)", async () => {
      const safeReturnPath = await load();
      expect(safeReturnPath("//evil.com/path")).toBe("/");
      expect(safeReturnPath("//evil.com")).toBe("/");
    });

    it("blocks backslash-bypass that WHATWG normalises to //", async () => {
      const safeReturnPath = await load();
      // WHATWG URL parser converts `\` to `/` for HTTP scheme — a naive
      // `startsWith("//")` check would miss this.
      expect(safeReturnPath("/\\evil.com/path")).toBe("/");
      expect(safeReturnPath("\\\\evil.com/path")).toBe("/");
    });

    it("blocks absolute URLs and non-http schemes", async () => {
      const safeReturnPath = await load();
      expect(safeReturnPath("https://evil.com/path")).toBe("/");
      expect(safeReturnPath("http://evil.com/path")).toBe("/");
      expect(safeReturnPath("javascript:alert(1)")).toBe("/");
      expect(safeReturnPath("data:text/html,<x>")).toBe("/");
    });

    it("rejects control characters (header-injection defence)", async () => {
      const safeReturnPath = await load();
      expect(safeReturnPath("/foo\r\nLocation: /evil")).toBe("/");
      expect(safeReturnPath("/foo\nbar")).toBe("/");
      expect(safeReturnPath("/foo\tbar")).toBe("/");
      expect(safeReturnPath("/foo\x00bar")).toBe("/");
    });

    it("rejects scheme-changing absolute URLs even on same hostname", async () => {
      const safeReturnPath = await load();
      // Different scheme is a different origin — must reject.
      expect(safeReturnPath("https://safe-base.invalid/foo")).toBe("/");
    });

    it("strips host parts and returns just path/search/hash", async () => {
      const safeReturnPath = await load();
      // Even a same-origin absolute URL should normalise to just the path.
      // (We can't construct one easily without knowing the sentinel base,
      // so the test below covers the network-path resolve case which uses
      // the parsed segments.)
      expect(safeReturnPath("/foo?bar=1#baz")).toBe("/foo?bar=1#baz");
    });
  });

  describe("OAuth return URLs", () => {
    it("allows the configured local workspace gateway but rejects other absolute returns", async () => {
      vi.stubEnv("WORKSPACE_GATEWAY_URL", "http://127.0.0.1:8080/");
      const { safeOAuthReturnUrl } = await import("./oauth-return-url.js");

      expect(safeOAuthReturnUrl("http://127.0.0.1:8080/dispatch")).toBe(
        "http://127.0.0.1:8080/dispatch",
      );
      expect(safeOAuthReturnUrl("/todo")).toBe("/todo");
      expect(safeOAuthReturnUrl("https://evil.example/todo")).toBe("/");
      expect(safeOAuthReturnUrl("http://127.0.0.1:9090/dispatch")).toBe("/");
    });

    it("allows the active Builder preview proxy origin when supplied by the auth request", async () => {
      const { safeOAuthReturnUrl } = await import("./oauth-return-url.js");
      const previewOrigin =
        "https://940ebc5a83164aa6a37dde445e494f3a-electric-cliff-2caez1jb.builderio.xyz";

      expect(
        safeOAuthReturnUrl(
          `${previewOrigin}/dispatch?builder.preview=interact`,
        ),
      ).toBe("/");
      expect(
        safeOAuthReturnUrl(
          `${previewOrigin}/dispatch?builder.preview=interact`,
          { allowedOrigins: [previewOrigin] },
        ),
      ).toBe(`${previewOrigin}/dispatch?builder.preview=interact`);
      expect(
        safeOAuthReturnUrl(
          "https://other-electric-cliff.builderio.xyz/dispatch",
          { allowedOrigins: [previewOrigin] },
        ),
      ).toBe("/");
    });

    it("can bridge a hosted OAuth session back to the local workspace gateway", async () => {
      vi.stubEnv("WORKSPACE_GATEWAY_URL", "http://127.0.0.1:8080/");
      const { appendSessionToOAuthReturnUrl } =
        await import("./oauth-return-url.js");

      expect(
        appendSessionToOAuthReturnUrl(
          "http://127.0.0.1:8080/dispatch?builder.preview=interact",
          "session-token",
        ),
      ).toBe(
        "http://127.0.0.1:8080/dispatch?builder.preview=interact&_session=session-token",
      );
      expect(appendSessionToOAuthReturnUrl("/dispatch", "session-token")).toBe(
        "/dispatch",
      );
    });

    it("can bridge a hosted OAuth session back to a Builder preview proxy URL", async () => {
      const { appendSessionToOAuthReturnUrl } =
        await import("./oauth-return-url.js");
      const previewUrl =
        "https://940ebc5a83164aa6a37dde445e494f3a-electric-cliff-2caez1jb.builderio.xyz/dispatch?builder.preview=interact";

      expect(appendSessionToOAuthReturnUrl(previewUrl, "session-token")).toBe(
        `${previewUrl}&_session=session-token`,
      );
    });
  });

  describe("OAuth state returnUrl round-trip", () => {
    beforeEach(() => {
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-signing-key-do-not-use");
    });

    it("encodes and decodes returnUrl through signed state", async () => {
      const { encodeOAuthState, decodeOAuthState } =
        await import("./google-oauth.js");
      const state = encodeOAuthState(
        "http://x/cb",
        undefined,
        false,
        false,
        undefined,
        "/share/abc?x=1",
      );
      const decoded = decodeOAuthState(state, "http://x/cb");
      expect(decoded.returnUrl).toBe("/share/abc?x=1");
    });

    it("encodes and decodes app id through signed state for frame routing", async () => {
      const { encodeOAuthState, decodeOAuthState } =
        await import("./google-oauth.js");
      const state = encodeOAuthState({
        redirectUri: "http://x/cb",
        app: "mail",
      });
      const decoded = decodeOAuthState(state, "http://x/cb");
      expect(decoded.app).toBe("mail");
    });

    it("produces undefined returnUrl when none was encoded (backwards compat)", async () => {
      const { encodeOAuthState, decodeOAuthState } =
        await import("./google-oauth.js");
      const state = encodeOAuthState("http://x/cb");
      const decoded = decodeOAuthState(state, "http://x/cb");
      expect(decoded.returnUrl).toBeUndefined();
    });

    it("rejects tampered state — mutated payload fails HMAC", async () => {
      const { encodeOAuthState, decodeOAuthState } =
        await import("./google-oauth.js");
      const state = encodeOAuthState(
        "http://x/cb",
        undefined,
        false,
        false,
        undefined,
        "/safe",
      );
      // Flip a byte in the data half.
      const dotIdx = state.lastIndexOf(".");
      const data = state.slice(0, dotIdx);
      const sig = state.slice(dotIdx + 1);
      const tampered = data.slice(0, -1) + "X" + "." + sig;
      const decoded = decodeOAuthState(tampered, "http://x/fallback");
      // Bad signature → falls back to default; return is dropped.
      expect(decoded.redirectUri).toBe("http://x/fallback");
      expect(decoded.returnUrl).toBeUndefined();
    });

    it("decodes returnUrl as raw string — same-origin validation runs at the consumer", async () => {
      const { encodeOAuthState, decodeOAuthState } =
        await import("./google-oauth.js");
      // If a malicious actor with a leaked signing key encoded a cross-
      // origin URL, decode would surface it — but the consumer
      // (oauthCallbackResponse) runs safeReturnPath, so the redirect still
      // lands on "/". This test documents the layered defence.
      const state = encodeOAuthState(
        "http://x/cb",
        undefined,
        false,
        false,
        undefined,
        "//evil.com/path",
      );
      const decoded = decodeOAuthState(state, "http://x/cb");
      expect(decoded.returnUrl).toBe("//evil.com/path");
      // But safeReturnPath would catch this:
      const { safeReturnPath } = await import("./auth.js");
      expect(safeReturnPath(decoded.returnUrl)).toBe("/");
    });
  });

  describe("onboarding Google sign-in", () => {
    it("uses popup OAuth in Builder iframes and redirect OAuth for top-level Builder", async () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");
      vi.stubEnv("APP_URL", "https://agent-workspace.builder.io");

      const { getOnboardingHtml } = await import("./onboarding-html.js");
      const html = getOnboardingHtml({ googleOnly: true });

      expect(html).toContain(
        'var __AN_PUBLIC_OAUTH_ORIGIN = "https://agent-workspace.builder.io";',
      );
      expect(html).toContain('var __AN_WORKSPACE_GATEWAY_RETURN_ORIGIN = "";');
      expect(html).toContain("__anStartPopupOAuth(ret, btn, err)");
      expect(html).toContain("__anStartNativeDesktopOAuth(ret, btn, err)");
      expect(html).toContain(
        "__anPath('/_agent-native/auth/desktop-exchange')",
      );
      expect(html).toContain('id="google-debug"');
      expect(html).toContain(
        "__anSetOAuthDebug('Google popup opened; waiting for callback', flowId)",
      );
      expect(html).toContain(
        "function __anStartRedirectOAuth(ret, btn, err, flowId, reason)",
      );
      expect(html).toContain(
        "function __anHandlePopupOAuthFailure(ret, btn, err, flowId, redirectReason, builderFrameMessage)",
      );
      expect(html).toContain(
        "Google popup was blocked; falling back to redirect",
      );
      expect(html).toContain("Allow popups for this site and try again");
      expect(html).toContain(
        "Opening Google sign-in redirect from Builder preview",
      );
      expect(html).toContain(
        "never reached this app. Check the Google OAuth redirect URI",
      );
      expect(html).not.toContain("&debug=1");
      expect(html).toContain("params.set('desktop', '1')");
      expect(html).toContain("params.set('flow_id', flowId)");
      expect(html).toContain("params.set('redirect', '1')");
      expect(html).toContain("var __anBuilderPreviewSeen = false");
      expect(html).toContain("function __anRememberBuilderPreview()");
      expect(html).toContain(
        "sessionStorage.setItem('__an_builder_preview_seen', '1')",
      );
      expect(html).toContain("function __anHasBuilderPreviewSignal()");
      expect(html).toContain("params.has('builder.preview')");
      expect(html).toContain("__anIsBuilderPreview();");
      expect(html).toContain("__anIsBuilderDesktop()");
      expect(html).toContain("__anIsAgentNativeDesktop()");
      expect(html).toContain("function __anIsInFrame()");
      expect(html).toContain(
        "if (__anIsBuilderPreview()) return __anIsInFrame() ? 'popup' : 'redirect'",
      );
      expect(html).toContain(
        "__anSetOAuthDebug('Opening Google sign-in in system browser', flowId)",
      );
      expect(html).toContain(
        "__anSetOAuthDebug(reason || 'Opening Google sign-in redirect', flowId)",
      );
      expect(html).toContain("function __anBuilderPreviewReturnOrigin()");
      expect(html).toContain("function __anGoogleAuthUrlPath()");
      expect(html).toContain("function __anOAuthReturnTarget(ret)");
      expect(html).toContain(
        "function __anSessionBridgeUrl(ret, sessionToken)",
      );
      expect(html).toContain(
        "function __anFinishOAuthExchange(ret, flowId, sessionToken)",
      );
      expect(html).toContain(
        "window.location.replace(__anSessionBridgeUrl(ret, sessionToken))",
      );
      expect(html).toContain(
        "if (oauthReturn) params.set('return', oauthReturn)",
      );
      expect(html).toContain(
        "var oauthReturn = __anIsBuilderPreview() ? __anOAuthReturnTarget(ret) : ret;",
      );
      expect(html).toContain(
        "__anFinishOAuthExchange(ret, flowId, data.token)",
      );
      expect(html).toContain("__anWaitForOAuthExchange(flowId, ret, btn, err)");
      expect(html).toContain("window.location.reload()");
      expect(html).not.toContain(
        "__anWaitForOAuthExchange(flowId, target, btn, err)",
      );
      expect(html).toContain(
        "window.open('', '_blank', 'width=640,height=760')",
      );
      expect(html).toContain("popup.location.href = url");
      expect(html).toContain("__anOpenOAuthUrl(data.url)");
      expect(html).toContain("window.location.href = url");
      expect(html).not.toContain("window.open(data.url");
      expect(html).not.toContain("noopener,noreferrer,width=640,height=760");
      expect(html).not.toContain("Waiting for sign-in");
    });

    it("adds OAuth debug breadcrumbs to the minimal Google auth plugin page", async () => {
      vi.stubEnv("APP_URL", "https://agent-workspace.builder.io");
      const createAuthPlugin = vi.fn((options: any) => options);
      vi.doMock("./auth-plugin.js", () => ({ createAuthPlugin }));

      const { createGoogleAuthPlugin } =
        await import("./google-auth-plugin.js");
      createGoogleAuthPlugin();

      const loginHtml = createAuthPlugin.mock.calls[0]?.[0]?.loginHtml;
      expect(loginHtml).toContain(
        'var __AN_PUBLIC_OAUTH_ORIGIN = "https://agent-workspace.builder.io";',
      );
      expect(loginHtml).toContain(
        'var __AN_WORKSPACE_GATEWAY_RETURN_ORIGIN = "";',
      );
      expect(loginHtml).toContain('id="debug"');
      expect(loginHtml).toContain(
        "__anSetOAuthDebug('Google popup opened; waiting for callback', flowId)",
      );
      expect(loginHtml).toContain("var __anBuilderPreviewSeen = false");
      expect(loginHtml).toContain("function __anRememberBuilderPreview()");
      expect(loginHtml).toContain(
        "sessionStorage.setItem('__an_builder_preview_seen', '1')",
      );
      expect(loginHtml).toContain("function __anHasBuilderPreviewSignal()");
      expect(loginHtml).toContain("params.has('builder.preview')");
      expect(loginHtml).toContain("__anIsBuilderPreview();");
      expect(loginHtml).toContain("__anIsBuilderDesktop()");
      expect(loginHtml).toContain("__anIsAgentNativeDesktop()");
      expect(loginHtml).toContain("function __anIsInFrame()");
      expect(loginHtml).toContain(
        "if (__anIsBuilderPreview()) return __anIsInFrame() ? 'popup' : 'redirect'",
      );
      expect(loginHtml).toContain(
        "__anSetOAuthDebug('Opening Google sign-in in system browser', flowId)",
      );
      expect(loginHtml).toContain(
        "__anSetOAuthDebug(reason || 'Opening Google sign-in redirect', flowId)",
      );
      expect(loginHtml).toContain("function __anBuilderPreviewReturnOrigin()");
      expect(loginHtml).toContain(
        "var candidates = [window.location.href, document.referrer || ''];",
      );
      expect(loginHtml).toContain("function __anGoogleAuthUrlPath()");
      expect(loginHtml).toContain("function __anOAuthReturnTarget(ret)");
      expect(loginHtml).toContain(
        "function __anSessionBridgeUrl(ret, sessionToken)",
      );
      expect(loginHtml).toContain(
        "function __anFinishOAuthExchange(ret, flowId, sessionToken)",
      );
      expect(loginHtml).toContain(
        "window.location.replace(__anSessionBridgeUrl(ret, sessionToken))",
      );
      expect(loginHtml).toContain(
        "var oauthReturn = __anIsBuilderPreview() ? __anOAuthReturnTarget(ret) : ret;",
      );
      expect(loginHtml).toContain(
        "if (oauthReturn) params.set('return', oauthReturn)",
      );
      expect(loginHtml).toContain(
        "__anWaitForOAuthExchange(flowId, ret, btn, err)",
      );
      expect(loginHtml).toContain(
        "__anFinishOAuthExchange(ret, flowId, data.token)",
      );
      expect(loginHtml).toContain("window.location.reload()");
      expect(loginHtml).not.toContain(
        "__anWaitForOAuthExchange(flowId, target, btn, err)",
      );
      expect(loginHtml).toContain(
        "window.open('', '_blank', 'width=640,height=760')",
      );
      expect(loginHtml).toContain("popup.location.href = url");
      expect(loginHtml).toContain(
        "function __anStartRedirectOAuth(ret, btn, err, flowId, reason)",
      );
      expect(loginHtml).toContain(
        "function __anHandlePopupOAuthFailure(ret, btn, err, flowId, redirectReason, builderFrameMessage)",
      );
      expect(loginHtml).toContain(
        "Google popup was blocked; falling back to redirect",
      );
      expect(loginHtml).toContain("Allow popups for this site and try again");
      expect(loginHtml).toContain(
        "Opening Google sign-in redirect from Builder preview",
      );
      expect(loginHtml).toContain(
        "never reached this app. Check the Google OAuth redirect URI",
      );
      expect(loginHtml).not.toContain("&debug=1");
    });

    it("defaults googleAuthMode to 'auto' and honors explicit overrides + env var", async () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");
      const { getOnboardingHtml } = await import("./onboarding-html.js");

      const auto = getOnboardingHtml({ googleOnly: true });
      expect(auto).toContain('var __AN_GOOGLE_AUTH_MODE = "auto"');
      expect(auto).toContain("function __anResolveAuthFlow()");
      expect(auto).toContain("function __anIsElectron()");
      expect(auto).toContain("__anResolveAuthFlow() === 'popup'");

      const popup = getOnboardingHtml({
        googleOnly: true,
        googleAuthMode: "popup",
      });
      expect(popup).toContain('var __AN_GOOGLE_AUTH_MODE = "popup"');

      vi.stubEnv("GOOGLE_AUTH_MODE", "redirect");
      const fromEnv = getOnboardingHtml({ googleOnly: true });
      expect(fromEnv).toContain('var __AN_GOOGLE_AUTH_MODE = "redirect"');

      const explicitWins = getOnboardingHtml({
        googleOnly: true,
        googleAuthMode: "popup",
      });
      expect(explicitWins).toContain('var __AN_GOOGLE_AUTH_MODE = "popup"');
    });

    it("uses sign-in copy when only Google auth is enabled", async () => {
      const { getOnboardingHtml } = await import("./onboarding-html.js");
      const html = getOnboardingHtml({ googleOnly: true });

      expect(html).toContain('<h1 id="heading">Sign in</h1>');
      expect(html).toContain("Use your workspace Google account to continue");
      expect(html).not.toContain("Create an account to get started");
      expect(html).not.toContain('data-tab="signup"');
    });

    it("renders marketing assets under APP_BASE_PATH", async () => {
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      const { getOnboardingHtml } = await import("./onboarding-html.js");
      const html = getOnboardingHtml({
        marketing: {
          appName: "Dispatch",
          tagline: "Coordinate the workspace",
        },
      });

      expect(html).toContain('src="/dispatch/agent-native-icon-dark.svg"');
      expect(html).not.toContain('src="/agent-native-icon-dark.svg"');
    });

    it("renders an optional run-local command in the marketing panel", async () => {
      const { getOnboardingHtml } = await import("./onboarding-html.js");
      const html = getOnboardingHtml({
        marketing: {
          appName: "Agent-Native Mail",
          tagline: "Manage email with an agent.",
          runLocalCommand:
            "npx @agent-native/core create my-mail-app --template mail",
        },
      });

      expect(html).toContain('id="run-local-button"');
      expect(html).toContain("Run Locally");
      expect(html).toContain(
        "npx @agent-native/core create my-mail-app --template mail",
      );
      expect(html).toContain("function __anCopyRunLocalCommand()");
    });

    it("can split the Google preflight notice into paragraphs", async () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");

      const { getOnboardingHtml } = await import("./onboarding-html.js");
      const html = getOnboardingHtml({
        googleOnly: true,
        googleSignInNotice: {
          title: "Hosted Mail may show Google warnings",
          body: [
            "This demo uses a shared OAuth client.",
            "Self-hosting avoids this warning.",
          ],
        },
      });

      expect(html).toContain('id="google-preflight-copy"');
      expect(html).toContain("This demo uses a shared OAuth client.");
      expect(html).toContain("Self-hosting avoids this warning.");
      expect(html.match(/class="google-preflight-copy"/g)).toHaveLength(2);
    });

    it("defaults the active tab from the login or signup path", async () => {
      const { getOnboardingHtml } = await import("./onboarding-html.js");
      const html = getOnboardingHtml();

      expect(html).toContain("var path = location.pathname");
      expect(html).toContain("path === '/login' || path.endsWith('/login')");
      expect(html).toContain("path === '/signup' || path.endsWith('/signup')");
    });
  });

  describe("onboarding signup verification flow", () => {
    it("renders a dedicated email verification step after signup", async () => {
      const { getOnboardingHtml } = await import("./onboarding-html.js");
      const html = getOnboardingHtml();

      expect(html).toContain('id="verification-step"');
      expect(html).toContain('id="verify-continue"');
      expect(html).toContain('id="resend-verification"');
      expect(html).toContain('id="back-to-signup"');
      expect(html).toContain("showVerificationStep(email, pass)");
      expect(html).toContain("callbackURL: __anGetReturnPath()");
      expect(html).not.toContain(
        "Account created! Check your email to verify, then sign in.",
      );
    });

    it("silently signs in after verification completes outside the app", async () => {
      const { getOnboardingHtml } = await import("./onboarding-html.js");
      const html = getOnboardingHtml();

      expect(html).toContain("var pendingSignupPassword = ''");
      expect(html).toContain("async function signInWithPendingSignup()");
      expect(html).toContain("__anPath('/_agent-native/auth/login')");
      expect(html).toContain(
        "window.addEventListener('focus', maybeCompleteVerificationAfterReturn)",
      );
      expect(html).toContain(
        "checkVerificationSession(null, { silent: true })",
      );
    });
  });

  describe("OAuth session creation", () => {
    it("uses cross-site cookie attributes for HTTPS Google sign-in sessions", async () => {
      vi.stubEnv("NODE_ENV", "production");

      const mockExecute = vi.fn(async () => ({ rows: [] }));
      vi.doMock("../db/client.js", () => ({
        getDbExec: () => ({ execute: mockExecute }),
        isPostgres: () => false,
        isLocalDatabase: () => false,
        intType: () => "INTEGER",
        retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
      }));

      const { createOAuthSession } = await import("./google-oauth.js");
      const event = createMockEvent({
        headers: { "x-forwarded-proto": "https" },
      });
      delete event.node.req.headers["x-forwarded-proto"];

      const result = await createOAuthSession(event, "user@gmail.com", {
        hasProductionSession: false,
      });

      expect(result.sessionToken).toBeTypeOf("string");
      const setCookie = event.res.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain(result.sessionToken);
      expect(setCookie).toContain("SameSite=None");
      expect(setCookie).toContain("Secure");
    });

    it("clears stale host-only cookies before setting a custom-domain shared session", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("COOKIE_DOMAIN", ".example.com");
      vi.stubEnv("APP_NAME", "slides");

      const mockExecute = vi.fn(async () => ({ rows: [] }));
      vi.doMock("../db/client.js", () => ({
        getDbExec: () => ({ execute: mockExecute }),
        isPostgres: () => false,
        isLocalDatabase: () => false,
        intType: () => "INTEGER",
        retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
      }));

      const { createOAuthSession } = await import("./google-oauth.js");
      const event = createMockEvent({
        headers: {
          "x-forwarded-proto": "https",
          host: "slides.example.com",
        },
      });

      const result = await createOAuthSession(event, "user@gmail.com", {
        hasProductionSession: false,
      });

      const setCookie = event.res.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("an_session=");
      expect(setCookie).toContain("Max-Age=0");
      expect(setCookie).toContain("Domain=.example.com");
      expect(setCookie).toContain(result.sessionToken);
      expect(setCookie).toContain("an_session_slides=");
    });

    it("ignores first-party shared cookie domains and sets an isolated app session", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("COOKIE_DOMAIN", ".agent-native.com");
      vi.stubEnv("APP_NAME", "slides");

      const mockExecute = vi.fn(async () => ({ rows: [] }));
      vi.doMock("../db/client.js", () => ({
        getDbExec: () => ({ execute: mockExecute }),
        isPostgres: () => false,
        isLocalDatabase: () => false,
        intType: () => "INTEGER",
        retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
      }));

      const { createOAuthSession } = await import("./google-oauth.js");
      const event = createMockEvent({
        headers: {
          "x-forwarded-proto": "https",
          host: "slides.agent-native.com",
        },
      });

      const result = await createOAuthSession(event, "user@gmail.com", {
        hasProductionSession: false,
      });

      const setCookie = event.res.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("an_session=");
      expect(setCookie).toContain("Max-Age=0");
      expect(setCookie).toContain("Domain=.agent-native.com");
      expect(setCookie).toContain(`an_session_slides=${result.sessionToken}`);
      const sessionCookie = setCookie
        .split(/,(?=\s*[^=]+=)/)
        .map((value) => value.trim())
        .find((value) =>
          value.startsWith(`an_session_slides=${result.sessionToken}`),
        );
      expect(sessionCookie).toBeTruthy();
      expect(sessionCookie).not.toContain("Domain=.agent-native.com");
    });
  });

  describe("OAuth callback copy", () => {
    it("uses the requested app name for desktop exchange completion", async () => {
      const { oauthCallbackResponse } = await import("./google-oauth.js");
      const response = await Promise.resolve(
        oauthCallbackResponse(createMockEvent(), "steve@example.com", {
          desktop: true,
          flowId: "flow-1",
          sessionToken: "token-1",
          appName: "Mail",
        }),
      );
      expect(response).toBeInstanceOf(Response);
      const html = await (response as Response).text();
      expect(html).toContain("return to Mail");
      expect(html).toContain("window.close()");
      expect(html).toContain("Debug flow: flow-1");
      expect(html).toContain(
        "[agent-native][google-oauth] success page loaded",
      );
      expect(html).not.toContain("return to Clips");
    });

    it("uses a deep link for Agent Native desktop exchange completion", async () => {
      const { oauthCallbackResponse } = await import("./google-oauth.js");
      const response = await Promise.resolve(
        oauthCallbackResponse(
          createMockEvent({
            headers: {
              "user-agent":
                "Mozilla/5.0 ... Electron/41.2.2 AgentNativeDesktop/0.1.7",
            },
            query: { state: "state-1" },
          }),
          "steve@example.com",
          {
            desktop: true,
            flowId: "flow-1",
            sessionToken: "token-1",
            appName: "Mail",
          },
        ),
      );

      expect(response).toBeInstanceOf(Response);
      const html = await (response as Response).text();
      expect(html).toContain("agentnative://oauth-complete");
      expect(html).toContain("token=token-1");
      expect(html).toContain("state=state-1");
      expect(html).not.toContain("return to Mail");
    });

    it("does not deep-link from generic Electron webviews (e.g. Builder Fusion)", async () => {
      const { oauthCallbackResponse } = await import("./google-oauth.js");
      const response = await Promise.resolve(
        oauthCallbackResponse(
          createMockEvent({
            // Generic Electron UA without the AgentNativeDesktop marker —
            // matches Builder.io's Fusion webview, Slack desktop, etc.
            headers: {
              "user-agent":
                "Mozilla/5.0 ... Chrome/138.0 Electron/41.2.2 Safari/537.36",
            },
            query: { state: "state-1" },
          }),
          "steve@example.com",
          {
            desktop: true,
            flowId: "flow-1",
            sessionToken: "token-1",
            appName: "Mail",
          },
        ),
      );

      expect(response).toBeInstanceOf(Response);
      const html = await (response as Response).text();
      expect(html).not.toContain("agentnative://oauth-complete");
      expect(html).toContain("return to Mail");
      expect(html).toContain("window.close()");
    });

    it("uses a deep link for the no-flowId desktop login when UA marks AgentNativeDesktop", async () => {
      const { oauthCallbackResponse } = await import("./google-oauth.js");
      const event = createMockEvent({
        headers: {
          "user-agent":
            "Mozilla/5.0 ... Electron/41.2.2 AgentNativeDesktop/0.1.7",
        },
        query: { state: "state-1" },
      });
      const response = await Promise.resolve(
        oauthCallbackResponse(event, "steve@example.com", {
          desktop: true,
          sessionToken: "token-1",
        }),
      );
      expect(response).toBeInstanceOf(Response);
      const html = await (response as Response).text();
      expect(html).toContain("agentnative://oauth-complete");
      expect(html).toContain("token=token-1");
    });

    it("falls through to the web 302 when desktop=true but UA isn't AgentNativeDesktop (no flowId)", async () => {
      const { oauthCallbackResponse } = await import("./google-oauth.js");
      // Reproduces the Builder.io Fusion webview hitting the no-flowId
      // desktop login path with `desktop=true` in OAuth state but a generic
      // Electron UA. Pre-fix this rendered the dead-end "Open Agent Native"
      // deep-link page; now the server should fall through to a 302 redirect.
      const event = createMockEvent({
        headers: {
          "user-agent":
            "Mozilla/5.0 ... Chrome/138.0 Electron/41.2.2 Safari/537.36",
        },
        query: { state: "state-1" },
      });
      const response = await Promise.resolve(
        oauthCallbackResponse(event, "steve@example.com", {
          desktop: true,
          sessionToken: "token-1",
          returnUrl: "/dashboard",
        }),
      );
      // Web flow returns a string body (h3 sets Location via setResponseHeader).
      expect(typeof response === "string" || response === "").toBe(true);
      expect(event.res.status).toBe(302);
      expect(event.res.headers.get("Location")).toBe("/dashboard");
    });

    it("bridges hosted OAuth completion back to the local workspace gateway", async () => {
      vi.stubEnv("WORKSPACE_GATEWAY_URL", "http://127.0.0.1:8080/");
      const { oauthCallbackResponse } = await import("./google-oauth.js");
      const event = createMockEvent();
      const response = await Promise.resolve(
        oauthCallbackResponse(event, "steve@example.com", {
          sessionToken: "token-1",
          returnUrl: "http://127.0.0.1:8080/dispatch",
        }),
      );

      expect(typeof response === "string" || response === "").toBe(true);
      expect(event.res.status).toBe(302);
      expect(event.res.headers.get("Location")).toBe(
        "http://127.0.0.1:8080/dispatch?_session=token-1",
      );
      expect(event.res.headers.get("Referrer-Policy")).toBe("no-referrer");
    });
  });

  describe("getAppUrl", () => {
    it("preserves APP_BASE_PATH for framework callback URLs", async () => {
      vi.stubEnv("APP_BASE_PATH", "/docs/");
      const { getAppUrl } = await import("./google-oauth.js");
      const event = createMockEvent({
        headers: {
          host: "app.example.test",
          "x-forwarded-proto": "https",
        },
      });

      expect(getAppUrl(event, "/_agent-native/google/callback")).toBe(
        "https://app.example.test/docs/_agent-native/google/callback",
      );
    });
  });

  describe("getAppProductionUrl", () => {
    it("uses the workspace OAuth origin ahead of a loopback gateway", async () => {
      vi.stubEnv("WORKSPACE_OAUTH_ORIGIN", "https://auth.agent.example");
      vi.stubEnv("WORKSPACE_GATEWAY_URL", "http://127.0.0.1:8080");
      const { getAppProductionUrl } = await import("./app-url.js");

      expect(getAppProductionUrl()).toBe("https://auth.agent.example");
    });

    it("uses platform URLs ahead of loopback workspace gateways in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("URL", "https://workspace.example.test");
      vi.stubEnv("WORKSPACE_GATEWAY_URL", "http://127.0.0.1:8080");
      const { getAppProductionUrl } = await import("./app-url.js");

      expect(getAppProductionUrl()).toBe("https://workspace.example.test");
    });
  });

  describe("resolveOAuthRedirectUri", () => {
    it("defaults root workspace framework-route requests to the root callback", async () => {
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      const { resolveOAuthRedirectUri } = await import("./google-oauth.js");
      const event = createMockEvent({
        path: "/_agent-native/google/auth-url",
        headers: {
          host: "agent-workspace.builder.io",
          "x-forwarded-proto": "https",
        },
      });

      expect(resolveOAuthRedirectUri(event)).toBe(
        "https://agent-workspace.builder.io/_agent-native/google/callback",
      );
    });

    it("defaults app-base framework-route requests to the app-base callback", async () => {
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      const { resolveOAuthRedirectUri } = await import("./google-oauth.js");
      const event = createMockEvent({
        path: "/dispatch/_agent-native/google/auth-url",
        headers: {
          host: "agent-workspace.builder.io",
          "x-forwarded-proto": "https",
        },
      });

      expect(resolveOAuthRedirectUri(event)).toBe(
        "https://agent-workspace.builder.io/dispatch/_agent-native/google/callback",
      );
    });

    it("defaults app-base OAuth requests to the root callback relay in workspace mode", async () => {
      vi.stubEnv("APP_BASE_PATH", "/calendar");
      vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
      const { resolveOAuthRedirectUri } = await import("./google-oauth.js");
      const event = createMockEvent({
        path: "/calendar/_agent-native/google/auth-url",
        headers: {
          host: "agent-workspace.builder.io",
          "x-forwarded-proto": "https",
        },
      });

      expect(resolveOAuthRedirectUri(event)).toBe(
        "https://agent-workspace.builder.io/_agent-native/google/callback",
      );
    });

    it("uses the configured public app URL instead of the local workspace gateway for workspace OAuth redirects", async () => {
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
      vi.stubEnv("APP_URL", "https://agent-workspace.builder.io");
      vi.stubEnv("WORKSPACE_GATEWAY_URL", "http://127.0.0.1:8080");
      const { resolveOAuthRedirectUri } = await import("./google-oauth.js");
      const event = createMockEvent({
        path: "/_agent-native/google/auth-url",
        headers: {
          host: "127.0.0.1:8080",
          referer:
            "https://940ebc5a83164aa6a37dde445e494f3a-thunder-handle-xmq6tgfy.builderio.xyz/?builder.preview=interact",
        },
      });

      expect(resolveOAuthRedirectUri(event)).toBe(
        "https://agent-workspace.builder.io/_agent-native/google/callback",
      );
    });

    it("uses the configured workspace OAuth origin instead of the local gateway", async () => {
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
      vi.stubEnv("WORKSPACE_OAUTH_ORIGIN", "https://auth.agent.example");
      vi.stubEnv("WORKSPACE_GATEWAY_URL", "http://127.0.0.1:8080");
      const { resolveOAuthRedirectUri } = await import("./google-oauth.js");
      const event = createMockEvent({
        path: "/_agent-native/google/auth-url",
        headers: {
          host: "127.0.0.1:8080",
          referer:
            "https://940ebc5a83164aa6a37dde445e494f3a-thunder-handle-xmq6tgfy.builderio.xyz/?builder.preview=interact",
        },
      });

      expect(resolveOAuthRedirectUri(event)).toBe(
        "https://auth.agent.example/_agent-native/google/callback",
      );
    });

    it("prefers platform public URLs over loopback workspace gateways in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
      vi.stubEnv("URL", "https://workspace.example.test");
      vi.stubEnv("WORKSPACE_GATEWAY_URL", "http://127.0.0.1:8080");
      const { resolveOAuthRedirectUri } = await import("./google-oauth.js");
      const event = createMockEvent({
        path: "/_agent-native/google/auth-url",
        headers: {
          host: "127.0.0.1:8080",
          "x-forwarded-proto": "http",
        },
      });

      expect(resolveOAuthRedirectUri(event)).toBe(
        "https://workspace.example.test/_agent-native/google/callback",
      );
    });

    it("uses a public workspace gateway when no app URL is configured", async () => {
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
      vi.stubEnv("WORKSPACE_GATEWAY_URL", "https://agent-workspace.builder.io");
      const { resolveOAuthRedirectUri } = await import("./google-oauth.js");
      const event = createMockEvent({
        path: "/_agent-native/google/auth-url",
        headers: {
          host: "940ebc5a83164aa6a37dde445e494f3a-thunder-handle-xmq6tgfy.builderio.xyz",
          "x-forwarded-proto": "https",
        },
      });

      expect(resolveOAuthRedirectUri(event)).toBe(
        "https://agent-workspace.builder.io/_agent-native/google/callback",
      );
    });

    it("uses the configured public app URL instead of Builder preview hosts for workspace OAuth redirects", async () => {
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
      vi.stubEnv("APP_URL", "https://agent-workspace.builder.io");
      vi.stubEnv("WORKSPACE_GATEWAY_URL", "http://127.0.0.1:8080");
      const { resolveOAuthRedirectUri } = await import("./google-oauth.js");
      const event = createMockEvent({
        path: "/_agent-native/google/auth-url",
        headers: {
          host: "940ebc5a83164aa6a37dde445e494f3a-thunder-handle-xmq6tgfy.builderio.xyz",
          "x-forwarded-proto": "https",
        },
      });

      expect(resolveOAuthRedirectUri(event)).toBe(
        "https://agent-workspace.builder.io/_agent-native/google/callback",
      );
    });

    it("does not use Builder preview origins as OAuth redirect URIs", async () => {
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
      const { resolveOAuthRedirectUri } = await import("./google-oauth.js");
      const event = createMockEvent({
        path: "/_agent-native/google/auth-url",
        headers: {
          host: "127.0.0.1:8080",
          referer:
            "https://940ebc5a83164aa6a37dde445e494f3a-thunder-handle-xmq6tgfy.builderio.xyz/?builder.preview=interact",
        },
      });

      expect(resolveOAuthRedirectUri(event)).toBe(
        "http://127.0.0.1:8080/_agent-native/google/callback",
      );
    });

    it("allows same-origin root and app-base framework redirect overrides", async () => {
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      const { resolveOAuthRedirectUri } = await import("./google-oauth.js");
      const headers = {
        host: "agent-workspace.builder.io",
        "x-forwarded-proto": "https",
      };

      expect(
        resolveOAuthRedirectUri(
          createMockEvent({
            path: "/_agent-native/google/auth-url",
            headers,
            query: {
              redirect_uri:
                "https://agent-workspace.builder.io/_agent-native/google/callback",
            },
          }),
        ),
      ).toBe(
        "https://agent-workspace.builder.io/_agent-native/google/callback",
      );
      expect(
        resolveOAuthRedirectUri(
          createMockEvent({
            path: "/dispatch/_agent-native/google/auth-url",
            headers,
            query: {
              redirect_uri:
                "https://agent-workspace.builder.io/dispatch/_agent-native/google/callback",
            },
          }),
        ),
      ).toBe(
        "https://agent-workspace.builder.io/dispatch/_agent-native/google/callback",
      );
    });

    it("rejects cross-origin redirect overrides", async () => {
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      const { resolveOAuthRedirectUri } = await import("./google-oauth.js");
      const event = createMockEvent({
        path: "/_agent-native/google/auth-url",
        headers: {
          host: "agent-workspace.builder.io",
          "x-forwarded-proto": "https",
        },
        query: {
          redirect_uri: "https://evil.example/_agent-native/google/callback",
        },
      });

      expect(resolveOAuthRedirectUri(event)).toBeNull();
    });

    it("rejects root redirect overrides from app-base framework-route requests", async () => {
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      const { resolveOAuthRedirectUri } = await import("./google-oauth.js");
      const event = createMockEvent({
        path: "/dispatch/_agent-native/google/auth-url",
        headers: {
          host: "agent-workspace.builder.io",
          "x-forwarded-proto": "https",
        },
        query: {
          redirect_uri:
            "https://agent-workspace.builder.io/_agent-native/google/callback",
        },
      });

      expect(resolveOAuthRedirectUri(event)).toBeNull();
    });

    it("allows root callback relay overrides from app-base requests in workspace mode", async () => {
      vi.stubEnv("APP_BASE_PATH", "/calendar");
      vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
      const { resolveOAuthRedirectUri } = await import("./google-oauth.js");
      const event = createMockEvent({
        path: "/calendar/_agent-native/google/auth-url",
        headers: {
          host: "agent-workspace.builder.io",
          "x-forwarded-proto": "https",
        },
        query: {
          redirect_uri:
            "https://agent-workspace.builder.io/_agent-native/google/callback",
        },
      });

      expect(resolveOAuthRedirectUri(event)).toBe(
        "https://agent-workspace.builder.io/_agent-native/google/callback",
      );
    });
  });

  // Regression guard: better-auth 1.6.0 validates emails with Zod v4's
  // `z.email()`. The original auto dev-account email `dev@local` has no
  // TLD and is rejected as INVALID_EMAIL, which silently broke the
  // zero-setup auto-sign-in on every fresh local dev DB. The fix moves
  // the constant to `dev@local.test` (RFC 6761 reserved, never resolves)
  // while keeping `dev@local` recognized as the legacy dev account.
  describe("auto dev account email format", () => {
    // Must mirror AUTO_DEV_ACCOUNT_EMAIL / LEGACY_AUTO_DEV_ACCOUNT_EMAIL
    // in auth.ts (module-private constants).
    const AUTO_DEV_ACCOUNT_EMAIL = "dev@local.test";
    const LEGACY_AUTO_DEV_ACCOUNT_EMAIL = "dev@local";

    it("uses an address that passes better-auth's z.email() validator", async () => {
      const z = await import("zod");
      expect(z.email().safeParse(AUTO_DEV_ACCOUNT_EMAIL).success).toBe(true);
      // The pre-fix address is exactly the one that failed validation.
      expect(z.email().safeParse(LEGACY_AUTO_DEV_ACCOUNT_EMAIL).success).toBe(
        false,
      );
    });

    it("keeps the new and legacy emails distinct so both are excluded as the dev account", () => {
      expect(AUTO_DEV_ACCOUNT_EMAIL).not.toBe(LEGACY_AUTO_DEV_ACCOUNT_EMAIL);
      expect(AUTO_DEV_ACCOUNT_EMAIL).toMatch(/\.test$/);
    });
  });

  describe("isLoopbackAddress", () => {
    it("accepts loopback peers (IPv4, IPv6, IPv4-mapped, 127/8, zone id)", async () => {
      const { isLoopbackAddress } = await import("./auth.js");
      for (const ip of [
        "127.0.0.1",
        "127.5.6.7",
        "::1",
        "::1%lo0",
        "::ffff:127.0.0.1",
      ]) {
        expect(isLoopbackAddress(ip)).toBe(true);
      }
    });

    it("rejects every non-loopback / unknown peer (the dev auto-account + desktop-SSO gate)", async () => {
      const { isLoopbackAddress } = await import("./auth.js");
      for (const ip of [
        "203.0.113.5",
        "192.168.4.70",
        "10.0.0.2",
        "169.254.1.1",
        "0.0.0.0",
        "::",
        "::ffff:192.168.4.70",
        "1.127.0.0", // must NOT match the 127/8 prefix check
        "localhost",
        "",
        undefined,
      ]) {
        expect(isLoopbackAddress(ip)).toBe(false);
      }
    });
  });
});

// --- Mock helpers ---

function createMockApp(): any {
  return {
    use: vi.fn(),
  };
}

function createMockEvent(opts?: {
  cookies?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  path?: string;
}): any {
  const query = opts?.query || {};
  const headers = opts?.headers || {};
  const qs = Object.entries(query)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const pathname = opts?.path || "/";
  const url = qs ? `${pathname}?${qs}` : pathname;
  const requestHeaders = new Headers({ host: "localhost", ...headers });
  return {
    // h3 v2 shape: event.req is the web Request, event.url is a parsed URL,
    // event.res holds the response headers map.
    req: {
      method: "GET",
      url: `http://localhost${url}`,
      headers: requestHeaders,
    },
    url: new URL(`http://localhost${url}`),
    res: {
      headers: new Headers(),
      status: 200,
    },
    // Legacy v1 shape kept for any code paths still using event.node.req
    node: {
      req: {
        headers: { host: "localhost", ...headers },
        url,
        method: "GET",
      },
      res: {
        setHeader: vi.fn(),
        getHeader: vi.fn(),
        appendHeader: vi.fn(),
      },
    },
    headers: requestHeaders,
    context: {},
    path: url,
    _cookies: opts?.cookies || {},
  };
}
