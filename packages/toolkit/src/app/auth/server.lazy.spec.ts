import { getOnboardingHtml } from "@agent-native/core/server/onboarding-html";
import { beforeEach, describe, expect, it, vi } from "vitest";

const corePlugin = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  createAuthPlugin: vi.fn(() => corePlugin),
}));

type RequestHook = (event: unknown) => Promise<void>;

function request(
  method: string,
  path: string,
  headers: Record<string, string>,
) {
  return {
    req: {
      method,
      url: `https://slides.agent-native.com${path}`,
      headers: new Headers(headers),
    },
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
      request("GET", "/docs/_agent-native/org/me", {
        accept: "application/json",
      }),
    );
    await onRequest(
      request("POST", "/_agent-native/actions/update-document", {
        accept: "*/*",
      }),
    );
    await onRequest(request("POST", "/api/webhooks/github", { accept: "*/*" }));

    expect(signInHtml()).toContain('data-agent-native-auth-fallback="true"');
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
      "/docs/_agent-native/sign-in",
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
