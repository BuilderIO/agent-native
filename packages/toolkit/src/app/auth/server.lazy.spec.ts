import { getOnboardingHtml } from "@agent-native/core/server/onboarding-html";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const corePlugin = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  createAuthPlugin: vi.fn(() => corePlugin),
}));

type RequestHook = (event: unknown) => Promise<void>;

// `url` is H3's reading of the path, which drops an escape a character doesn't
// need (`%73` for `s`); `req.url` keeps the path as it was sent.
function request(
  method: string,
  path: string,
  headers: Record<string, string>,
  h3Path = path,
) {
  return {
    req: {
      method,
      url: `https://slides.agent-native.com${path}`,
      headers: new Headers(headers),
    },
    url: new URL(`https://slides.agent-native.com${h3Path}`),
  };
}

async function installPlugin() {
  const server = await import("./server.js");
  const hook = vi.fn();
  const nitroApp = { hooks: { hook } };
  server.createToolkitAuthPlugin()(nitroApp);
  expect(corePlugin).toHaveBeenCalledWith(nitroApp);
  expect(hook).toHaveBeenCalledWith("request", expect.any(Function));
  const onRequest = hook.mock.calls[0]![1] as RequestHook;
  const signInHtml = () =>
    getOnboardingHtml({
      requestHost: "slides.agent-native.com",
      renderSignInPage: server.renderAuthPage,
    });
  return { onRequest, signInHtml };
}

describe("Toolkit auth plugin's lazy sign-in renderer", () => {
  beforeEach(() => {
    vi.resetModules();
    corePlugin.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("serves core's fallback markup until the renderers load", async () => {
    const { signInHtml } = await installPlugin();

    const html = signInHtml();
    expect(html).toContain('data-agent-native-auth-fallback="true"');
    expect(html).not.toContain('id="login-form"');
  });

  it("does not load the renderers for API calls or other posts", async () => {
    const { onRequest, signInHtml } = await installPlugin();

    await onRequest(
      request("GET", "/_agent-native/actions/list-documents", {
        accept: "*/*",
      }),
    );
    await onRequest(
      request("GET", "/_agent-native/org/me", { accept: "application/json" }),
    );
    await onRequest(
      request("POST", "/_agent-native/actions/update-document", {
        accept: "*/*",
      }),
    );
    await onRequest(request("POST", "/api/webhooks/github", { accept: "*/*" }));
    await onRequest(request("GET", "/api/documents", { accept: "*/*" }));
    await onRequest(request("HEAD", "/api/health", {}));
    await onRequest(request("GET", "/api", { accept: "*/*" }));
    await onRequest(request("GET", "/_agent-native", { accept: "*/*" }));

    expect(signInHtml()).toContain('data-agent-native-auth-fallback="true"');
  });

  it("loads for a page whose path only starts like the API's", async () => {
    const { onRequest, signInHtml } = await installPlugin();

    await onRequest(request("GET", "/apis", { accept: "*/*" }));

    expect(signInHtml()).toContain('id="login-form"');
  });

  it.each([
    [
      "a document navigation",
      "GET",
      "/_agent-native/sign-in",
      { "sec-fetch-dest": "document" },
    ],
    [
      "an iframe navigation",
      "GET",
      "/_agent-native/sign-in",
      { "sec-fetch-dest": "iframe" },
    ],
    [
      "an HTML request",
      "GET",
      "/_agent-native/sign-in",
      { accept: "text/html,application/xhtml+xml" },
    ],
    ["a form post", "POST", "/login", { "sec-fetch-dest": "document" }],
    ["another client's page read", "GET", "/", { accept: "*/*" }],
    [
      "another client's read of the old sign-in path",
      "GET",
      "/_agent-native/sign-in",
      { accept: "*/*" },
    ],
    ["a HEAD request for a page", "HEAD", "/login", {}],
  ])(
    "server-renders the sign-in page once %s has been handled",
    async (_kind, method, path, headers) => {
      const { onRequest, signInHtml } = await installPlugin();

      await onRequest(request(method, path, headers));

      const html = signInHtml();
      expect(html).toContain('id="login-form"');
      expect(html).not.toContain('data-agent-native-auth-fallback="true"');
    },
  );

  it("reads an escaped path the way the auth guard does", async () => {
    const { onRequest, signInHtml } = await installPlugin();

    await onRequest(
      request(
        "GET",
        "/_agent-native/%73ign-in",
        { accept: "*/*" },
        "/_agent-native/sign-in",
      ),
    );

    expect(signInHtml()).toContain('id="login-form"');
  });

  it("tells the app's API calls from its pages under its base path", async () => {
    vi.stubEnv("APP_BASE_PATH", "/apps/_agent-native/content");
    const base = "/apps/_agent-native/content";
    const { onRequest, signInHtml } = await installPlugin();

    await onRequest(
      request("GET", `${base}/_agent-native/actions/list-documents`, {
        accept: "*/*",
      }),
    );
    await onRequest(request("GET", `${base}/api/documents`, { accept: "*/*" }));
    expect(signInHtml()).toContain('data-agent-native-auth-fallback="true"');

    await onRequest(request("GET", `${base}/login`, { accept: "*/*" }));
    expect(signInHtml()).toContain('id="login-form"');
  });

  it("loads for the old sign-in path under the app's base path", async () => {
    vi.stubEnv("APP_BASE_PATH", "/docs");
    const { onRequest, signInHtml } = await installPlugin();

    await onRequest(
      request("GET", "/docs/_agent-native/sign-in", { accept: "*/*" }),
    );

    expect(signInHtml()).toContain('id="login-form"');
  });

  it("treats the app's own framework route prefix as its API", async () => {
    vi.stubEnv(
      "AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX",
      "/_platform",
    );
    const { onRequest, signInHtml } = await installPlugin();

    await onRequest(request("GET", "/_platform/ping", { accept: "*/*" }));
    await onRequest(
      request("GET", "/_platform/actions/list-documents", { accept: "*/*" }),
    );
    expect(signInHtml()).toContain('data-agent-native-auth-fallback="true"');

    await onRequest(request("GET", "/_platform/sign-in", { accept: "*/*" }));
    expect(signInHtml()).toContain('id="login-form"');
  });

  it("starts loading the renderers when it serves the fallback", async () => {
    const { signInHtml } = await installPlugin();

    expect(signInHtml()).toContain('data-agent-native-auth-fallback="true"');

    await vi.waitFor(() => expect(signInHtml()).toContain('id="login-form"'));
  });

  it("adds no request hook when the app brings both renderers", async () => {
    const server = await import("./server.js");

    const plugin = server.createToolkitAuthPlugin({
      renderSignInPage: () => "<main></main>",
      renderResetPasswordPage: () => "<main></main>",
    });

    expect(plugin).toBe(corePlugin);
  });
});
