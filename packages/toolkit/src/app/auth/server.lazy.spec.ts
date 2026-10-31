import { getOnboardingHtml } from "@agent-native/core/server/onboarding-html";
import { beforeEach, describe, expect, it, vi } from "vitest";

const corePlugin = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  createAuthPlugin: vi.fn(() => corePlugin),
}));

type RequestHook = (event: unknown) => Promise<void>;

function request(method: string, headers: Record<string, string>) {
  return { req: { method, headers: new Headers(headers) } };
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

  it("does not load the renderers for API calls", async () => {
    const { onRequest, signInHtml } = await installPlugin();

    await onRequest(request("GET", { accept: "*/*" }));
    await onRequest(request("GET", { accept: "application/json" }));
    await onRequest(request("POST", { accept: "text/html" }));

    expect(signInHtml()).toContain('data-agent-native-auth-fallback="true"');
  });

  it.each([
    ["a document", { "sec-fetch-dest": "document" }],
    ["an iframe", { "sec-fetch-dest": "iframe" }],
    ["an HTML", { accept: "text/html,application/xhtml+xml" }],
  ])(
    "server-renders the sign-in page once %s request has been handled",
    async (_kind, headers) => {
      const { onRequest, signInHtml } = await installPlugin();

      await onRequest(request("GET", headers));

      const html = signInHtml();
      expect(html).toContain('id="login-form"');
      expect(html).not.toContain('data-agent-native-auth-fallback="true"');
    },
  );

  it("adds no request hook when the app brings both renderers", async () => {
    const server = await import("./server.js");

    const plugin = server.createToolkitAuthPlugin({
      renderSignInPage: () => "<main></main>",
      renderResetPasswordPage: () => "<main></main>",
    });

    expect(plugin).toBe(corePlugin);
  });
});
