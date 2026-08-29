import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthPageProps } from "../client/auth/AuthPage.js";
import { LOCALE_STORAGE_KEY } from "../localization/shared.js";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "../shared/password-policy.js";
import {
  AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER,
  AGENT_NATIVE_SOCIAL_IMAGE_PATH,
} from "../shared/social-meta.js";
import { BUILT_IN_AUTH_MARKETING } from "./auth-marketing.js";
import { getOnboardingHtml, getResetPasswordHtml } from "./onboarding-html.js";

function readAuthPageData(html: string): AuthPageProps {
  const match = html.match(
    /<script type="application\/json" id="agent-native-auth-data">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("auth page data is missing");
  return JSON.parse(match[1]!) as AuthPageProps;
}

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

  it("includes a beta switcher on the standalone auth page", () => {
    const html = getOnboardingHtml({
      requestHost: "beta.analytics.agent-native.com",
    });

    expect(html).toContain('id="environment-badge"');
    expect(html).toContain("You&#x27;re on Agent-Native Beta");
    expect(html).toContain("Switch to production");
    expect(html).toContain('id="environment-hide-badge"');
    expect(readAuthPageData(html).environmentBetaHosts).toHaveProperty(
      "analytics.agent-native.com",
    );
    expect(html).toContain('src="/assets/auth-client.js"');
    expect(html).toContain("left: max(0.75rem, env(safe-area-inset-left));");
    expect(html).toContain("left: 0;");
    expect(html).toContain(
      "width: 100%;\n    min-height: 2rem;\n    margin-top: 0.5rem;\n    margin-bottom: -0.5rem;",
    );
    expect(html).toContain(
      "width: min(17.5rem, calc(100vw - 1.5rem));\n    box-sizing: border-box;\n    padding: 1.25rem;",
    );
    expect(html).toContain('id="environment-badge" aria-expanded="false"');
  });

  it("ships a hydratable React auth surface without inline auth handlers", () => {
    const html = getOnboardingHtml();

    expect(html).toContain('id="agent-native-auth-root"');
    expect(html).toContain('src="/assets/auth-client.js"');
    expect(html).toContain(
      'type="application/json" id="agent-native-auth-data"',
    );
    expect(html).not.toContain('onclick="signInWithGoogle()"');
    expect(html).not.toContain("__anAuthView");
  });

  it("renders deep-link tab selection in the initial SSR view", () => {
    expect(
      readAuthPageData(getOnboardingHtml({ requestPath: "/sign-in?tab=login" }))
        .initialView,
    ).toBe("login");
    expect(
      readAuthPageData(getOnboardingHtml({ requestPath: "/signup?tab=signup" }))
        .initialView,
    ).toBe("signup");
  });

  it("keeps the local-dev CTA hidden in cached HTML and reveals it only for loopback hosts", () => {
    const html = getOnboardingHtml();

    expect(html).toContain('id="local-dev-signin" hidden');
    expect(html).toContain('id="local-dev-btn"');
    expect(html).toContain('class="btn-local-dev btn-primary"');
    expect(html).toContain('id="local-dev-full-options" hidden');
    expect(html).toContain('id="full-auth-options" class="full-auth-options"');
    expect(html).toContain("Continue as local dev");
    expect(html).toContain("Show full sign in options");
    expect(html).toContain("Only works in local development on this computer.");
    expect(html).toContain('id="local-dev-help"');
    expect(html).toContain(
      'href="https://www.agent-native.com/docs/authentication#local-development-sign-in"',
    );
    expect(html).toContain("Learn about local development sign-in");
    expect(html).toContain('class="local-dev-help-glyph"');
    expect(html).toContain("width: 1.5rem;");
    expect(html).toContain("width: 0.625rem;");
    expect(html).toContain("height: 0.625rem;");
    expect(html).toContain(".full-auth-options { margin-top: 1rem; }");
    expect(readAuthPageData(html).builderPreviewLocalDevEnabled).toBe(false);
    expect(readAuthPageData(html).docsAuthUrl).toContain(
      "local-development-sign-in",
    );
  });

  it("enables the local-dev CTA on Builder previews only with explicit opt-in", () => {
    vi.stubEnv("AGENT_NATIVE_ALLOW_BUILDER_PREVIEW_LOCAL_DEV", "1");

    const html = getOnboardingHtml();

    expect(readAuthPageData(html).builderPreviewLocalDevEnabled).toBe(true);

    vi.stubEnv("NODE_ENV", "production");
    expect(
      readAuthPageData(getOnboardingHtml()).builderPreviewLocalDevEnabled,
    ).toBe(false);
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

    it("canonical hosted login pages omit the browser SSO option", () => {
      vi.stubEnv("APP_URL", "https://calendar.agent-native.com");
      delete process.env.AGENT_NATIVE_IDENTITY_HUB_URL;

      const html = getOnboardingHtml();

      expect(html).not.toContain("identity-sso-btn");
      expect(html).not.toContain("Sign in with Agent-Native");
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
      expect(html).toContain("data-agent-native-embedded-init");
      expect(html).toContain(
        'params.get("embedded") === "1" || window.self !== window.top',
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

  describe("googleOnly login follows deployment credentials", () => {
    it("disables Google sign-in when the credential pair is absent", () => {
      // A Google-only page must not send visitors into the desktop exchange
      // flow when the server cannot mount a matching Google OAuth route.
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.GOOGLE_SIGN_IN_CLIENT_ID;
      delete process.env.GOOGLE_SIGN_IN_CLIENT_SECRET;

      const html = getOnboardingHtml({ googleOnly: true });

      expect(html).not.toContain('id="google-btn"');
      expect(html).toContain('id="google-err"');
      expect(html).toContain('class="google-error show"');
      expect(html).toContain('data-i18n="googleNotConfigured"');
      expect(html).toContain("Google sign-in is not available right now.");
    });

    it("disables Google sign-in when only one credential is present", () => {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.GOOGLE_SIGN_IN_CLIENT_ID;
      vi.stubEnv("GOOGLE_SIGN_IN_CLIENT_SECRET", "sign-in-secret-without-id");

      const html = getOnboardingHtml({ googleOnly: true });

      expect(html).not.toContain('id="google-btn"');
      expect(html).toContain("Google sign-in is not available right now.");
    });

    it("renders Google sign-in when a complete credential pair is present", () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");

      const html = getOnboardingHtml({ googleOnly: true });

      expect(html).toContain('id="google-btn"');
      expect(readAuthPageData(html).showGoogle).toBe(true);
      expect(html).not.toContain('class="google-error show"');
    });
  });

  it("reveals the upgrade note only from explicit upgrade markers", () => {
    const html = getOnboardingHtml();

    expect(html).toContain('data-i18n-data-upgrade-copy="upgradeCopy"');
    expect(readAuthPageData(html).initialPrompt).toBe(false);
  });

  it("injects APP_BASE_PATH so mounted login pages call app-scoped auth endpoints", () => {
    vi.stubEnv("APP_BASE_PATH", "/starter/");
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");

    const html = getOnboardingHtml();

    expect(html).toContain('src="/starter/assets/auth-client.js"');
    expect(readAuthPageData(html).appBasePath).toBe("/starter");
  });

  it("derives the workspace mount for request-specific and cached login HTML", () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;

    const requestHtml = getOnboardingHtml({
      requestPath: "/dispatch/sign-in?c=continuation",
    });
    expect(readAuthPageData(requestHtml).appBasePath).toBe("/dispatch");
    expect(requestHtml).toContain('src="/dispatch/assets/auth-client.js"');

    const cachedHtml = getOnboardingHtml();
    expect(readAuthPageData(cachedHtml).appBasePath).toBe("");
    expect(readAuthPageData(cachedHtml).workspaceRuntime).toBe(true);
    expect(cachedHtml).toContain('src="/assets/auth-client.js"');
  });

  it("derives the workspace mount for the reset page asset", () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;

    const resetHtml = getResetPasswordHtml(
      "/dispatch/_agent-native/auth/reset?token=reset-token",
    );

    expect(readAuthPageData(resetHtml).appBasePath).toBe("/dispatch");
    expect(resetHtml).toContain('src="/dispatch/assets/auth-client.js"');
    expect(resetHtml).toContain('href="/dispatch/favicon.svg"');
  });

  it("validates email/password auth emails before submitting forms", () => {
    const html = getOnboardingHtml();

    expect(html).toContain('id="signup-form"');
    expect(html).toContain('id="login-form"');
    expect(html).toContain('type="email"');
    expect(readAuthPageData(html).passwordMinLength).toBe(PASSWORD_MIN_LENGTH);
  });

  it("uses clear client-side validation and hides technical auth errors", () => {
    const html = getOnboardingHtml();
    const resetHtml = getResetPasswordHtml();

    expect(html).toContain(`maxLength="${PASSWORD_MAX_LENGTH}"`);
    expect(resetHtml).toContain('id="agent-native-auth-root"');
    expect(resetHtml).toContain('pageType":"reset-password"');
    expect(resetHtml).toContain('src="/assets/auth-client.js"');
    expect(resetHtml).toContain("Choose a new password");
    expect(resetHtml).toContain(`maxLength="${PASSWORD_MAX_LENGTH}"`);
  });

  it("does not render a run-local CTA in the auth marketing panel", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");
    const html = getOnboardingHtml({
      googleOnly: true,
      marketing: {
        appName: "Calendar",
        tagline: "Your AI agent manages your calendar.",
        runLocalCommand:
          "npx @agent-native/core@latest create my-calendar-app --template calendar",
      },
    });

    expect(html).not.toContain('id="run-local-button"');
    expect(html).not.toContain('id="run-local-panel"');
    expect(html).not.toContain("Run Locally");
    expect(html).not.toContain("function __anCopyRunLocalCommand()");
    expect(html).toContain('id="google-btn"');
    expect(readAuthPageData(html).showGoogle).toBe(true);
  });

  it("renders the policy password minimum in signup and reset forms", () => {
    const html = getOnboardingHtml();
    const resetHtml = getResetPasswordHtml();

    expect(html).toContain(`minLength="${PASSWORD_MIN_LENGTH}"`);
    expect(html).toContain(`maxLength="${PASSWORD_MAX_LENGTH}"`);
    expect(html).toContain(`At least ${PASSWORD_MIN_LENGTH} characters`);
    expect(html).not.toContain('minlength="8"');
    expect(resetHtml).toContain(`minLength="${PASSWORD_MIN_LENGTH}"`);
    expect(resetHtml).toContain(`maxLength="${PASSWORD_MAX_LENGTH}"`);
    expect(resetHtml).toContain(`At least ${PASSWORD_MIN_LENGTH} characters`);
    expect(resetHtml).not.toContain('minlength="8"');
  });

  it("keeps the password flow unchanged by default", () => {
    const html = getOnboardingHtml();

    expect(html).not.toContain('id="magic-link-form"');
    expect(html).toContain('id="signup-form"');
    expect(html).toContain('id="login-form"');
    expect(readAuthPageData(html).authMode).toBe("password");
  });

  it("does not autofocus auth inputs on initial load", () => {
    expect(getOnboardingHtml()).not.toContain("autofocus");
    expect(getOnboardingHtml({ authMode: "magic-link" })).not.toContain(
      "autofocus",
    );
    expect(getResetPasswordHtml()).not.toContain("autofocus");
  });

  it("renders the email-only magic-link view with a progressive password fallback", () => {
    const html = getOnboardingHtml({ authMode: "magic-link" });

    expect(html).toContain('id="magic-link-form"');
    expect(html).toContain('id="m-email"');
    expect(html).toContain('id="magic-link-submit"');
    expect(html).toContain('class="magic-link-submit"');
    expect(html).toContain(".magic-link-submit { display: block; }");
    expect(readAuthPageData(html).initialView).toBe("magicLink");
    expect(html).toContain('id="magic-link-success"');
    expect(html).toContain('id="magic-link-success-email"');
    expect(html).toContain(".btn-google.magic-link-secondary");
    expect(html).toContain("margin-top: 0.375rem;");
    expect(html).toContain("margin-bottom: 0.875rem;");
    expect(html).toContain("text-align: start;");
    expect(html).toContain('id="use-password-link"');
    expect(html).toContain('class="link-button auth-mode-link"');
    expect(html).toContain(
      'style="margin-top:0.75rem;font-size:0.75rem;text-align:start"',
    );
    expect(html).toContain('id="back-to-magic-link"');
    expect(html).toContain('id="auth-tabs"');
    expect(html).toContain('data-i18n="magicLinkTitle">Welcome</h1>');
    expect(html).toContain("Create an account or sign in");
    expect(html).toContain("Continue with email");
    expect(html).not.toContain("onclick=");
  });

  it("does not let a remembered password tab override the magic-link entry view", () => {
    expect(
      readAuthPageData(getOnboardingHtml({ authMode: "magic-link" }))
        .initialView,
    ).toBe("magicLink");
    expect(readAuthPageData(getOnboardingHtml()).initialView).toBe("signup");
  });

  it("renders a quiet centered auth surface for an initial prompt", () => {
    const html = getOnboardingHtml({
      authMode: "magic-link",
      initialPrompt: true,
      marketing: {
        appName: "Slides",
        tagline: "Build presentations alongside your agent.",
      },
    });

    expect(html).toContain('<body class="simplified-auth">');
    expect(html).toContain("body.simplified-auth { background: #141414; }");
    expect(html).toContain("box-shadow: none;");
    expect(html).not.toContain('id="starfield"');
    expect(html).not.toContain('class="marketing-panel"');
    expect(html).not.toContain('class="app-name"');
  });

  it("localizes the magic-link copy through the existing auth catalogs", () => {
    const html = getOnboardingHtml({ authMode: "magic-link" });

    expect(html).toContain("欢迎");
    expect(html).toContain("创建账户或登录");
    expect(html).toContain("使用邮箱继续");
    expect(html).toContain("我们已向以下邮箱发送安全登录链接：");
    expect(html).toContain("改用密码");
    expect(html).toContain("我們已向以下電子郵件寄送安全登入連結：");
  });

  it("shows the hosted terms notice on the initial magic-link view", () => {
    const html = getOnboardingHtml({
      authMode: "magic-link",
      requestHost: "slides.agent-native.com",
    });

    expect(html).toContain('id="magic-link-form"');
    expect(html).toContain(
      'data-i18n="legalPrefix">By signing up, you accept our',
    );
    expect(html).toContain('href="https://www.agent-native.com/terms"');
    expect(html).toContain('href="https://www.agent-native.com/privacy"');
  });

  it("keeps the pending verification email across a redirect without storing its password", () => {
    const html = getOnboardingHtml();

    expect(html).toContain('id="verification-step"');
    expect(html).toContain('id="verify-email"');
    expect(html).not.toContain("pendingSignupPassword");
  });

  it("normalizes and rehydrates the stored verification email at runtime", () => {
    const html = getOnboardingHtml();
    expect(html).toContain('id="agent-native-auth-data"');
    expect(html).toContain('id="verification-step"');
    expect(html).toContain('id="resend-verification"');
    expect(html).toContain('id="back-to-signup"');
  });

  it("captures first-touch attribution on the standalone auth page", () => {
    const html = getOnboardingHtml();

    expect(html).toContain('id="agent-native-auth-root"');
    expect(html).toContain('src="/assets/auth-client.js"');
    expect(html).not.toContain("document.cookie = 'an_ft='");
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

    expect(html).toContain('data-i18n="legalPrefix"');
    expect(html).toContain('href="https://www.agent-native.com/terms"');
    expect(html).toContain('data-i18n="legalTerms">Terms</a>');
    expect(html).toContain(
      'href="https://www.agent-native.com/privacy" target="_blank" rel="noreferrer"',
    );
    expect(html).toContain('data-i18n="legalPrivacy">Privacy Policy</a>');
    expect(html).toContain(".legal-note");
  });

  it("renders a locale picker that shares the app locale preference", () => {
    const html = getOnboardingHtml({
      requestHost: "forms.agent-native.com",
    });

    expect(html).toContain('id="auth-locale-trigger"');
    expect(html).toContain('id="auth-locale-menu"');
    expect(readAuthPageData(html).localeStorageKey).toBe(LOCALE_STORAGE_KEY);
    expect(html).toContain('data-locale-value="es-ES"');
    expect(html).toContain("Español");
    expect(html).not.toContain("Español (Spanish)");
    expect(html).not.toContain("English (en-US)");
    expect(html).toContain('data-system-language="true">System</span>');
    expect(html).toContain('data-i18n="createAccount"');
    expect(html).toContain("Crear cuenta");
  });

  it("localizes built-in Forms auth marketing copy from the locale picker", () => {
    const html = getOnboardingHtml({
      requestHost: "forms.agent-native.com",
    });

    expect(html).toContain('data-marketing-field="tagline"');
    expect(html).toContain('data-marketing-feature-index="0"');
    expect(html).toContain("你的 AI 代理会与你一起构建、发布和分析表单。");
    expect(html).toContain("用一句话创建完整表单");
    expect(readAuthPageData(html).marketingLocales["zh-CN"]?.tagline).toContain(
      "构建、发布和分析表单",
    );
  });

  it("keeps built-in marketing on beta template subdomains", () => {
    const html = getOnboardingHtml({
      requestHost: "beta.clips.agent-native.com",
    });

    expect(html).toContain("你的 AI 代理会转录、总结并搜索你记录的所有内容。");
  });

  it("keeps custom Clips auth marketing copy out of built-in localization", () => {
    const html = getOnboardingHtml({
      requestHost: "clips.agent-native.com",
      marketing: {
        appName: "Clips",
        tagline:
          "Your AI agent transcribes, summarizes, and searches everything you record alongside you.",
        features: [
          "One-click screen recording (Loom-style) with auto titles, summaries, and chapters",
          "Calendar-synced meeting notes (Granola-style) with live transcripts and AI action items",
          "Push-to-talk voice dictation (Wisprflow-style) — hold Fn anywhere, get clean text back",
          "One searchable library across recordings, meetings, and dictations",
        ],
      },
    });

    expect(html).toContain(
      "One-click screen recording (Loom-style) with auto titles, summaries, and chapters",
    );
    expect(readAuthPageData(html).marketingLocales).toEqual({});
    expect(html).not.toContain("var rootLocale =");
  });

  it("keeps custom marketing that reuses a built-in app name out of built-in localized copy", () => {
    const html = getOnboardingHtml({
      requestHost: "app.example.com",
      marketing: {
        appName: "Dispatch",
        tagline: BUILT_IN_AUTH_MARKETING.dispatch.tagline,
        description: "Route parcels across your own fleet.",
        features: ["Track every van on one map"],
      },
    });

    expect(html).not.toContain('var __AN_AUTH_MARKETING_SLUG = "dispatch"');
    expect(html).toContain("Route parcels across your own fleet.");
    expect(html).toContain("Track every van on one map");
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

  it("shows a quiet local-files escape hatch on hosted Plan signup", () => {
    const html = getOnboardingHtml({
      requestHost: "plan.agent-native.com",
    });

    expect(html).toContain('class="signup-local-mode-note"');
    expect(html).toContain(
      "Prefer no account or self-hosting? Switch /visual-plan to local files only:",
    );
    expect(html).toContain(
      "npx @agent-native/core@latest skills add visual-plan --mode local-files --scope user",
    );
    expect(html).toContain('id="copy-signup-local-mode"');
    expect(readAuthPageData(html).signupLocalModeNote?.command).toContain(
      "skills add visual-plan --mode local-files",
    );
  });

  it("keeps the local-files escape hatch off other hosted signup pages", () => {
    const html = getOnboardingHtml({
      requestHost: "calendar.agent-native.com",
    });

    expect(html).not.toContain('id="signup-local-mode-note"');
    expect(html).not.toContain("skills add visual-plan --mode local-files");
  });

  it("normalizes sign-in return targets through the one shared primitive", () => {
    const html = getOnboardingHtml();

    expect(html).toContain('src="/assets/auth-client.js"');
    expect(readAuthPageData(html).appBasePath).toBe("");
    expect(html).not.toContain("function __anNormalizeReturnPath");
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

  it("omits the run-local CTA from Mail and Calendar auth pages", () => {
    for (const slug of ["mail", "calendar"]) {
      const html = getOnboardingHtml({
        requestHost: `${slug}.agent-native.com`,
        googleOnly: true,
      });

      expect(html).not.toContain('id="run-local-button"');
      expect(html).not.toContain('id="run-local-panel"');
      expect(html).not.toContain("Run Locally");
    }
  });

  it("keeps unknown apps on the compact generic auth page", () => {
    const html = getOnboardingHtml({
      requestHost: "workspace.example.com",
    });

    expect(html).not.toContain('class="marketing-panel"');
  });

  it("does not localize custom marketing that reuses a built-in app name", () => {
    const html = getOnboardingHtml({
      marketing: {
        appName: "Calendar",
        tagline: "Plan your team's work with a custom calendar.",
      },
    });

    expect(html).toContain("Plan your team's work with a custom calendar.");
    expect(readAuthPageData(html).marketingLocales).toEqual({});
  });

  it("does not localize custom marketing from a built-in request host", () => {
    const html = getOnboardingHtml({
      requestHost: "dispatch.agent-native.com",
      marketing: {
        appName: "Custom Dispatch",
        tagline: "Route your own work with a custom dispatch flow.",
      },
    });

    expect(html).toContain("Route your own work with a custom dispatch flow.");
    expect(readAuthPageData(html).marketingLocales).toEqual({});
  });

  it("embeds the public OAuth origin for Builder desktop redirects", () => {
    vi.stubEnv("APP_URL", "https://agent-workspace.builder.io");
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");

    const html = getOnboardingHtml();

    const data = readAuthPageData(html);
    expect(data.publicOAuthOrigin).toBe("https://agent-workspace.builder.io");
    expect(data.workspaceGatewayReturnOrigin).toBe("");
    expect(html).toContain('src="/assets/auth-client.js"');
  });

  it("embeds the local workspace gateway return origin when configured", () => {
    vi.stubEnv("VITE_WORKSPACE_OAUTH_ORIGIN", "http://127.0.0.1:8080/");
    vi.stubEnv("WORKSPACE_GATEWAY_URL", "http://127.0.0.1:8080/");
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");

    const html = getOnboardingHtml();

    const data = readAuthPageData(html);
    expect(data.publicOAuthOrigin).toBe("");
    expect(data.workspaceGatewayReturnOrigin).toBe("http://127.0.0.1:8080");
  });
});
