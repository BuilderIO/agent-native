import { afterEach, describe, expect, it, vi } from "vitest";
import { getOnboardingHtml } from "./onboarding-html.js";

describe("getOnboardingHtml", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not include local upgrade copy in SSR HTML by default", () => {
    const html = getOnboardingHtml();

    expect(html).not.toContain("local@localhost");
    expect(html).not.toContain("You started this flow");
    expect(html).toContain('id="upgrade-note"');
  });

  it("reveals the upgrade note only from explicit upgrade markers", () => {
    const html = getOnboardingHtml();

    expect(html).toContain("upgrade-from-local");
    expect(html).toContain("an_migrate_from_local");
    expect(html).toContain(
      "Continue signing in to attach this app to your account and migrate local data.",
    );
  });

  it("injects APP_BASE_PATH so mounted login pages call app-scoped auth endpoints", () => {
    vi.stubEnv("APP_BASE_PATH", "/starter/");
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");

    const html = getOnboardingHtml();

    expect(html).toContain('var configured = "/starter";');
    expect(html).toContain("__anPath('/_agent-native/auth/session')");
    expect(html).toContain("__anPath('/_agent-native/auth/register')");
    expect(html).toContain("__anPath('/_agent-native/auth/login')");
    expect(html).toContain(
      "__anPath('/_agent-native/auth/ba/request-password-reset')",
    );
    expect(html).toContain("__anPath('/_agent-native/google/auth-url')");
  });

  it("embeds the public OAuth origin for Builder desktop redirects", () => {
    vi.stubEnv("APP_URL", "https://agent-workspace.builder.io");
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");

    const html = getOnboardingHtml();

    expect(html).toContain(
      'var __AN_PUBLIC_OAUTH_ORIGIN = "https://agent-workspace.builder.io";',
    );
    expect(html).toContain('var __AN_WORKSPACE_GATEWAY_RETURN_ORIGIN = "";');
    expect(html).toContain(
      "__anSetOAuthDebug('Opening Google sign-in redirect')",
    );
    expect(html).toContain(
      "__anSetOAuthDebug('Opening Google sign-in in system browser', flowId)",
    );
    expect(html).toContain("function __anBuilderPreviewReturnOrigin()");
    expect(html).toContain("var __anBuilderPreviewSeen = false");
    expect(html).toContain("function __anRememberBuilderPreview()");
    expect(html).toContain(
      "sessionStorage.setItem('__an_builder_preview_seen', '1')",
    );
    expect(html).toContain("function __anHasBuilderPreviewSignal()");
    expect(html).toContain("params.has('builder.preview')");
    expect(html).toContain("__anIsBuilderPreview();");
    expect(html).toContain(
      "if (__anIsBuilderPreview()) return __anIsBuilderDesktop() ? 'redirect' : 'popup'",
    );
    expect(html).toContain(
      "var candidates = [window.location.href, document.referrer || ''];",
    );
    expect(html).toContain("function __anIsAgentNativeDesktop()");
    expect(html).toContain("function __anGoogleAuthUrlPath()");
    expect(html).toContain("function __anOAuthReturnTarget(ret)");
    expect(html).toContain("function __anSessionBridgeUrl(ret, sessionToken)");
    expect(html).toContain(
      "function __anFinishOAuthExchange(ret, flowId, sessionToken)",
    );
    expect(html).toContain(
      "window.location.replace(__anSessionBridgeUrl(ret, sessionToken))",
    );
    expect(html).toContain(
      "var oauthReturn = __anIsBuilderPreview() ? __anOAuthReturnTarget(ret) : ret;",
    );
    expect(html).toContain("__anFinishOAuthExchange(ret, flowId, data.token)");
    expect(html).toContain("__anWaitForOAuthExchange(flowId, ret, btn, err)");
    expect(html).toContain("window.location.reload()");
    expect(html).toContain("params.set('return', __anOAuthReturnTarget(ret))");
  });

  it("embeds the local workspace gateway return origin when configured", () => {
    vi.stubEnv("VITE_WORKSPACE_OAUTH_ORIGIN", "http://127.0.0.1:8080/");
    vi.stubEnv("WORKSPACE_GATEWAY_URL", "http://127.0.0.1:8080/");
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");

    const html = getOnboardingHtml();

    expect(html).toContain('var __AN_PUBLIC_OAUTH_ORIGIN = "";');
    expect(html).toContain(
      'var __AN_WORKSPACE_GATEWAY_RETURN_ORIGIN = "http://127.0.0.1:8080";',
    );
    expect(html).toContain("function __anNormalizeWorkspaceReturnPath(ret)");
    expect(html).toContain("path === '/dispatch/dispatch'");
  });
});
