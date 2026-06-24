import { afterEach, describe, expect, it, vi } from "vitest";
import { getOnboardingHtml } from "./onboarding-html.js";
import { BUILT_IN_AUTH_MARKETING } from "./auth-marketing.js";
import {
  AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER,
  AGENT_NATIVE_SOCIAL_IMAGE_PATH,
} from "../shared/social-meta.js";

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

  describe("federated SSO button (AGENT_NATIVE_IDENTITY_HUB_URL)", () => {
    it("env unset → login HTML is byte-for-byte identical (no SSO button, no residue)", () => {
      // Capture baseline with the env unequivocally absent.
      delete process.env.AGENT_NATIVE_IDENTITY_HUB_URL;
      const baseline = getOnboardingHtml();
      expect(baseline).not.toContain("identity-sso-btn");
      expect(baseline).not.toContain("/_agent-native/identity/login");
      expect(baseline).not.toContain("Sign in with Agent-Native");

      // Re-render with the env still unset → must be the exact same string.
      const again = getOnboardingHtml();
      expect(again).toBe(baseline);
    });

    it("env set → injects exactly one conditional SSO entry pointing at /identity/login", () => {
      vi.stubEnv(
        "AGENT_NATIVE_IDENTITY_HUB_URL",
        "https://dispatch.agent-native.com",
      );
      const html = getOnboardingHtml();
      expect(html).toContain('id="identity-sso-btn"');
      expect(html).toContain('href="/_agent-native/identity/login"');
      expect(html).toContain("Sign in with Agent-Native");
      expect(html).toContain("function __anIdentitySsoUrl()");
      expect(html).toContain("params.set('return', __anGetReturnPath())");
      expect(html).toContain(
        "identity.addEventListener('click', __anStartIdentitySso)",
      );
      // Exactly one rendered element — not duplicated across layout branches.
      expect(html.split('id="identity-sso-btn"').length - 1).toBe(1);
    });

    it("malformed env value is treated as OFF (no button, no throw)", () => {
      vi.stubEnv("AGENT_NATIVE_IDENTITY_HUB_URL", "not a url");
      const html = getOnboardingHtml();
      expect(html).not.toContain("identity-sso-btn");
    });
  });

  describe("googleOnly login is env-independent (safe to CDN-cache)", () => {
    it("renders a working Google button even when GOOGLE_CLIENT_ID/SECRET are absent at render time", () => {
      // The login page is a public, CDN-cacheable shell that may be rendered in
      // any context (build, an env-less cold start, a stale-while-revalidate
      // refresh). A Google-only app must ALWAYS render a usable button and must
      // never bake a "not configured" error into that cached HTML — otherwise a
      // single bad render freezes the broken page for every visitor until the
      // SWR window expires. A genuinely misconfigured server surfaces the error
      // at click time via the auth API instead.
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;

      const html = getOnboardingHtml({ googleOnly: true });

      expect(html).toContain('id="google-btn"');
      expect(html).toContain("async function signInWithGoogle()");
      expect(html).not.toContain("Google sign-in is not configured");
    });

    it("the rendered HTML is byte-for-byte identical with and without Google env vars", () => {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      const withoutEnv = getOnboardingHtml({ googleOnly: true });

      vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");
      const withEnv = getOnboardingHtml({ googleOnly: true });

      expect(withoutEnv).toBe(withEnv);
    });
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

  it("validates email/password auth emails before submitting forms", () => {
    const html = getOnboardingHtml();

    expect(html).toContain("function __anIsValidAuthEmail(value)");
    expect(html).toContain("/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/");
    expect(html).toContain(
      "Enter a valid email address, like you@example.com.",
    );
    expect(html).toContain(
      "body: JSON.stringify({ email: email, password: pass })",
    );
    expect(html).toContain("password: document.getElementById('l-pass').value");
  });

  it("omits hosted terms and privacy links on unhosted email signup", () => {
    const html = getOnboardingHtml();

    expect(html).not.toContain("https://www.agent-native.com/terms");
    expect(html).not.toContain("https://www.agent-native.com/privacy");
    expect(html).toContain(".legal-note");
  });

  it("shows a secondary terms and privacy notice on hosted email signup", () => {
    const html = getOnboardingHtml({
      requestHost: "calendar.agent-native.com",
    });

    expect(html).toContain(
      'By signing up, you accept our <a href="https://www.agent-native.com/terms"',
    );
    expect(html).toContain(
      '<a href="https://www.agent-native.com/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>',
    );
    expect(html).toContain(".legal-note");
  });

  it("shows configured terms and privacy links on custom email signup", () => {
    const html = getOnboardingHtml({
      signupLegalNotice: {
        termsUrl: "https://example.com/legal/terms",
        privacyUrl: "https://example.com/legal/privacy",
        termsLabel: "Service Terms",
        privacyLabel: "Privacy Notice",
      },
    });

    expect(html).toContain(
      '<a href="https://example.com/legal/terms" target="_blank" rel="noreferrer">Service Terms</a>',
    );
    expect(html).toContain(
      '<a href="https://example.com/legal/privacy" target="_blank" rel="noreferrer">Privacy Notice</a>',
    );
  });

  it("normalizes sign-in return targets before redirect and preserves hashes", () => {
    const html = getOnboardingHtml();

    expect(html).toContain("function __anNormalizeReturnPath(raw)");
    expect(html).toContain(
      "if (url.origin !== window.location.origin) return '';",
    );
    expect(html).toContain("return url.pathname + url.search + url.hash;");
    expect(html).toContain(
      "return window.location.pathname + window.location.search + window.location.hash;",
    );
    expect(html).toContain(
      "if (value.charAt(0) === '/' && (value.charAt(1) === '/' || value.charAt(1) === '\\\\')) return '';",
    );
  });

  it("uses branded first-party marketing from the request host", () => {
    const html = getOnboardingHtml({
      requestHost: "dispatch.agent-native.com",
    });

    expect(html).toContain('class="marketing-panel"');
    expect(html).toContain("Agent-Native Dispatch");
    expect(html).toContain(
      "Your AI agent manages secrets, orchestrates other agents",
    );
    expect(html).toContain("100% free and open source");
    expect(html).toContain(
      `${AGENT_NATIVE_SOCIAL_IMAGE_PATH}?v=${AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER}`,
    );
  });

  it("puts hosted Google warnings in a popover with a run-local choice", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");

    const command =
      "npx @agent-native/core@latest create my-mail-app --template mail";
    const html = getOnboardingHtml({
      googleOnly: true,
      marketing: {
        appName: "Agent-Native Mail",
        tagline: "Manage email with an agent.",
        runLocalCommand: command,
      },
      googleSignInNotice: {
        host: "mail.agent-native.com",
        title: "Google may show a warning",
        body: "Google may ask you to confirm before continuing.",
        continueLabel: "Continue to Google",
        cancelLabel: "Run locally",
      },
    });

    expect(html).toContain('class="google-signin"');
    expect(html).toContain(
      'aria-haspopup="dialog" aria-expanded="false" aria-controls="google-preflight"',
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Google may show a warning");
    expect(html).toContain('id="google-preflight-run-local"');
    expect(html).toContain("Run locally");
    expect(html).not.toContain("Not now");
    expect(html).toContain('id="google-preflight-run-local-panel"');
    expect(html).toContain(command);
    expect(html).toContain("function __anChooseRunLocalFromGoogleNotice()");
    expect(html).toContain("__anCopyGoogleNoticeRunLocalCommand()");
  });

  it("has branded auth marketing for every core built-in template host", () => {
    const coreSlugs = [
      "calendar",
      "content",
      "plan",
      "slides",
      "clips",
      "brain",
      "analytics",
      "mail",
      "dispatch",
      "forms",
      "design",
      "assets",
      "chat",
    ];

    for (const slug of coreSlugs) {
      const html = getOnboardingHtml({
        requestHost: `${slug}.agent-native.com`,
      });

      expect(html).toContain('class="marketing-panel"');
      expect(html).toContain(BUILT_IN_AUTH_MARKETING[slug]!.appName);
    }
  });

  it("keeps unknown apps on the compact generic auth page", () => {
    const html = getOnboardingHtml({
      requestHost: "workspace.example.com",
    });

    expect(html).not.toContain('class="marketing-panel"');
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
      "__anSetOAuthDebug(reason || 'Opening Google sign-in redirect', flowId)",
    );
    expect(html).toContain(
      "function __anHandlePopupOAuthFailure(ret, btn, err, flowId, redirectReason, builderFrameMessage)",
    );
    expect(html).toContain("Allow popups for this site and try again");
    expect(html).toContain(
      "Opening Google sign-in redirect from Builder preview",
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
    expect(html).toContain("function __anIsInFrame()");
    expect(html).toContain(
      "if (__anIsBuilderPreview()) return __anIsInFrame() ? 'popup' : 'redirect'",
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
    expect(html).toContain(
      "if (oauthReturn) params.set('return', oauthReturn)",
    );
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
