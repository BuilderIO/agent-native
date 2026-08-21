import { afterEach, describe, expect, it, vi } from "vitest";

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
    expect(html).toContain("You're on Agent Native Beta");
    expect(html).toContain("Switch to production");
    expect(html).toContain("__anInitEnvironmentBadge");
    expect(html).toContain("agentNativeBetaOptOut");
    expect(html).toContain("agent-native:beta-opt-out-until");
    expect(html).toContain("window.localStorage.setItem");
    expect(html).toContain("window.history.replaceState");
    expect(html).toContain('id="environment-badge" aria-expanded="false"');
  });

  it("redirects signed-in visitors without a cache-buster query loop", () => {
    const html = getOnboardingHtml();

    expect(html).toContain("window.location.replace(ret || __anResumeHref())");
    expect(html).not.toContain("__anWithAuthCacheBypass");
    expect(html).not.toContain("__an_auth_redirect");
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
    expect(html).toContain("function __anIsLoopbackHostname()");
    expect(html).toContain("function __anSetFullAuthOptionsVisible(visible)");
    expect(html).toContain("fetch(__anPath('/_agent-native/auth/local-dev')");
    expect(html).toContain("method: 'GET'");
    expect(html).toContain("cache: 'no-store'");
    expect(html).toContain("data.available === true");
    expect(html).toContain("hostname.indexOf('127.') === 0");
    expect(html).toContain(
      "var __AN_BUILDER_PREVIEW_LOCAL_DEV_ENABLED = false;",
    );
    expect(html).not.toContain("NODE_ENV");
  });

  it("enables the local-dev CTA on Builder previews only with explicit opt-in", () => {
    vi.stubEnv("AGENT_NATIVE_ALLOW_BUILDER_PREVIEW_LOCAL_DEV", "1");

    const html = getOnboardingHtml();

    expect(html).toContain(
      "var __AN_BUILDER_PREVIEW_LOCAL_DEV_ENABLED = true;",
    );
    expect(html).toContain("function __anIsBuilderPreviewHost()");
    expect(html).toContain("function __anCanUseLocalDevSignin()");
    expect(html).toContain("hostname.endsWith('.builder.my')");

    vi.stubEnv("NODE_ENV", "production");
    expect(getOnboardingHtml()).toContain(
      "var __AN_BUILDER_PREVIEW_LOCAL_DEV_ENABLED = false;",
    );
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
      expect(html).toContain("function __anIdentitySsoUrl()");
      expect(html).toContain("params.set('return', __anResumeHref())");
      expect(html).toContain(
        "identity.addEventListener('click', __anStartIdentitySso)",
      );
      expect(html).toContain("data-agent-native-embedded-init");
      expect(html).toContain(
        'params.get("embedded") === "1" || window.self !== window.top',
      );
      expect(html).toContain(
        'html[data-agent-native-embedded="1"] #identity-sso-btn { display: none !important; }',
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
      expect(html).toContain('onclick="signInWithGoogle()"');
      expect(html).not.toContain("google-preflight");
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

  it("derives the workspace mount for request-specific and cached login HTML", () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;

    const requestHtml = getOnboardingHtml({
      requestPath: "/dispatch/sign-in?c=continuation",
    });
    expect(requestHtml).toContain('var configured = "/dispatch";');

    const cachedHtml = getOnboardingHtml();
    expect(cachedHtml).toContain('var configured = "";');
    const start = cachedHtml.indexOf("function __anBasePath()");
    const end = cachedHtml.indexOf("function __anPath", start);
    const basePath = new Function(
      "window",
      `${cachedHtml.slice(start, end)} return __anBasePath();`,
    )({ location: { pathname: "/dispatch/sign-in" } });
    expect(basePath).toBe("/dispatch");

    const rootBasePath = new Function(
      "window",
      `${cachedHtml.slice(start, end)} return __anBasePath();`,
    )({ location: { pathname: "/sign-in" } });
    expect(rootBasePath).toBe("");
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

  it("uses clear client-side validation and hides technical auth errors", () => {
    const html = getOnboardingHtml();
    const resetHtml = getResetPasswordHtml();

    expect(html).toContain("function __anAuthErrorText(data, fallback)");
    expect(html).toContain("function __anBindPasswordValidation(input)");
    expect(html).toContain(
      "input.setCustomValidity(__anT('passwordMinPlaceholder'))",
    );
    expect(html).toContain(`maxlength="${PASSWORD_MAX_LENGTH}"`);
    expect(html).toContain(
      "We couldn't create your account. Please try again.",
    );
    expect(html).toContain(
      "We couldn't reach the server. Check your connection and try again.",
    );
    expect(html).toContain("function __anVerificationRedirectError()");
    expect(html).toContain("verification_link_invalid");
    expect(html).toContain(
      "This verification link is invalid or expired. Request a new one.",
    );
    expect(resetHtml).toContain(
      "This password reset link is missing or invalid. Request a new one.",
    );
    expect(resetHtml).toContain(
      "We couldn't update your password. The link may have expired; request a new one.",
    );
    expect(resetHtml).toContain(`maxlength="${PASSWORD_MAX_LENGTH}"`);

    const onboardingScript = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    const resetScript = resetHtml.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(onboardingScript).toBeTruthy();
    expect(resetScript).toBeTruthy();
    expect(() => new Function(onboardingScript!)).not.toThrow();
    expect(() => new Function(resetScript!)).not.toThrow();
  });

  it("does not render a run-local CTA in the auth marketing panel", () => {
    const html = getOnboardingHtml({
      googleOnly: true,
      marketing: {
        appName: "Calendar",
        tagline: "Your AI agent manages your calendar.",
        runLocalCommand:
          "npx @agent-native/core@latest create my-calendar-app --template calendar",
      },
    });

    const onboardingScript = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(onboardingScript).toBeTruthy();
    expect(html).not.toContain('id="run-local-button"');
    expect(html).not.toContain('id="run-local-panel"');
    expect(html).not.toContain("Run Locally");
    expect(html).not.toContain("function __anCopyRunLocalCommand()");
    expect(html).toContain('onclick="signInWithGoogle()"');
    expect(() => new Function(onboardingScript!)).not.toThrow();
  });

  it("renders the policy password minimum in signup and reset forms", () => {
    const html = getOnboardingHtml();
    const resetHtml = getResetPasswordHtml();

    expect(html).toContain(`minlength="${PASSWORD_MIN_LENGTH}"`);
    expect(html).toContain(`maxlength="${PASSWORD_MAX_LENGTH}"`);
    expect(html).toContain(`At least ${PASSWORD_MIN_LENGTH} characters`);
    expect(html).not.toContain('minlength="8"');
    expect(resetHtml).toContain(`minlength="${PASSWORD_MIN_LENGTH}"`);
    expect(resetHtml).toContain(`maxlength="${PASSWORD_MAX_LENGTH}"`);
    expect(resetHtml).toContain(`At least ${PASSWORD_MIN_LENGTH} characters`);
    expect(resetHtml).not.toContain('minlength="8"');
  });

  it("keeps the password flow unchanged by default", () => {
    const html = getOnboardingHtml();

    expect(html).not.toContain('id="magic-link-form"');
    expect(html).toContain('id="signup-form"');
    expect(html).toContain('id="login-form"');
    expect(html).toContain("/_agent-native/auth/login");
  });

  it("renders the email-only magic-link view with a progressive password fallback", () => {
    const html = getOnboardingHtml({ authMode: "magic-link" });

    expect(html).toContain('id="magic-link-form"');
    expect(html).toContain('id="m-email"');
    expect(html).toContain('id="magic-link-submit"');
    expect(html).toContain('class="magic-link-submit"');
    expect(html).toContain(".magic-link-submit { display: none; }");
    expect(html).toContain('id="magic-link-success"');
    expect(html).toContain('id="magic-link-success-email"');
    expect(html).toContain("function showMagicLinkSuccess(email)");
    expect(html).toContain("button.classList.toggle('is-visible', isValid)");
    expect(html).toContain(
      "googleButton.classList.toggle('magic-link-secondary', isValid)",
    );
    expect(html).toContain(".btn-google.magic-link-secondary");
    expect(html).toContain("margin-top: 0.375rem;");
    expect(html).toContain("margin-bottom: 0.875rem;");
    expect(html).toContain("text-align: start;");
    expect(html).toContain(
      "magicLinkEmail.addEventListener('input', updateMagicLinkSubmitState)",
    );
    expect(html).toContain('id="use-password-link"');
    expect(html).toContain('class="link-button auth-mode-link"');
    expect(html).toContain(
      'style="margin-top:0.75rem;font-size:0.75rem;text-align:start"',
    );
    expect(html).toContain('id="back-to-magic-link"');
    expect(html).toContain("/_agent-native/auth/magic-link");
    expect(html).toContain("callbackURL: isDesktopMagicLink");
    expect(html).toContain("/_agent-native/auth/magic-link/desktop-callback");
    expect(html).toContain(
      "__anWaitForOAuthExchange(magicFlowId, __anResumeHref(), btn, msg, 'magic-link', magicVerifier)",
    );
    expect(html).toContain(
      "var initial = __AN_AUTH_MODE === 'magic-link' ? 'magicLink' : 'signup';",
    );
    expect(html).toContain("if (initial === 'magicLink') showMagicLinkForm();");
    expect(html).toContain('class="tabs" id="auth-tabs"');
    expect(html).not.toContain('class="tabs" id="auth-tabs" hidden');
    expect(html).toContain(
      '<h1 id="heading" data-i18n="welcomeTitle">Welcome</h1>',
    );
    expect(html).toContain("Create an account or sign in");
    expect(html).not.toContain("Email me a sign-in link");
    expect(html).toContain("magicLinkTitle");
    expect(html).toContain("magicLinkSubtitle");
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
    expect(html).toContain("继续");
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

    expect(html).toContain(
      "var PENDING_SIGNUP_EMAIL_STORAGE_KEY = 'an.onboarding.pendingSignupEmail'",
    );
    expect(html).toContain(
      "localStorage.setItem(pendingSignupEmailStorageKey(), email)",
    );
    expect(html).toContain("rememberPendingSignupEmail(pendingSignupEmail)");
    expect(html).toContain(
      "pendingSignupEmail || readRememberedPendingSignupEmail()",
    );
    expect(html).toContain(
      "if (loginEmail && rememberedEmail) loginEmail.value = rememberedEmail",
    );
  });

  it("normalizes and rehydrates the stored verification email at runtime", () => {
    const html = getOnboardingHtml();
    const start = html.indexOf(
      "var PENDING_SIGNUP_EMAIL_STORAGE_KEY = 'an.onboarding.pendingSignupEmail'",
    );
    const end = html.indexOf("function setActiveTab", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const runtime = new Function(
      "localStorage",
      "__anBasePath",
      "__anIsValidAuthEmail",
      "__anNormalizeAuthEmail",
      `${html.slice(start, end)}
return { rememberPendingSignupEmail, readRememberedPendingSignupEmail };`,
    )(
      storage,
      () => "/design",
      (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      (value: string) => value.trim().toLowerCase(),
    ) as {
      rememberPendingSignupEmail: (email: string) => void;
      readRememberedPendingSignupEmail: () => string;
    };

    runtime.rememberPendingSignupEmail("URVI28@OUTLOOK.COM");
    expect(runtime.readRememberedPendingSignupEmail()).toBe(
      "urvi28@outlook.com",
    );
    expect(values.has("an.onboarding.pendingSignupEmail:/design")).toBe(true);

    runtime.rememberPendingSignupEmail("");
    expect(runtime.readRememberedPendingSignupEmail()).toBe("");
  });

  it("captures first-touch attribution on the standalone auth page", () => {
    const html = getOnboardingHtml();

    expect(html).toContain("function __anCaptureSignupAttribution()");
    expect(html).toContain("localStorage.getItem('an_attribution')");
    expect(html).toContain("document.cookie = 'an_ft='");
    expect(html).toContain("'utm_source'");
    expect(html).toContain("var returnPath = __anJourney.normalizeAppPath");
    expect(html).toContain("__anExternalReferrerHost(document.referrer || '')");
    expect(html).toContain("function __anSyncAnalyticsAnonymousId()");
    expect(html).toContain("localStorage.getItem('agent-native.anonymous_id')");
    expect(html).toContain("document.cookie = 'an_aid='");
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
    expect(html).toContain(
      `var __AN_AUTH_LOCALE_STORAGE_KEY = "${LOCALE_STORAGE_KEY}"`,
    );
    expect(html).toContain('data-locale-value="es-ES"');
    expect(html).toContain("Español");
    expect(html).not.toContain("Español (Spanish)");
    expect(html).not.toContain("English (en-US)");
    expect(html).toContain("<span data-system-language>System</span>");
    expect(html).toContain('data-i18n="createAccount"');
    expect(html).toContain("Crear cuenta");
    expect(html).toContain("function __anApplyAuthLocale");
    expect(html).toContain("function __anSetAuthLocaleMenuOpen");
    expect(html).toContain("root.setAttribute('dir', meta.dir || 'ltr')");
  });

  it("localizes built-in Forms auth marketing copy from the locale picker", () => {
    const html = getOnboardingHtml({
      requestHost: "forms.agent-native.com",
    });

    expect(html).toContain('data-marketing-field="tagline"');
    expect(html).toContain('data-marketing-feature-index="0"');
    expect(html).toContain("你的 AI 代理会与你一起构建、发布和分析表单。");
    expect(html).toContain("用一句话创建完整表单");
    expect(html).toContain("function __anApplyAuthMarketingCopy");
    expect(html).toContain('var __AN_AUTH_MARKETING_SLUG = "forms"');
  });

  it("keeps built-in marketing on beta template subdomains", () => {
    const html = getOnboardingHtml({
      requestHost: "beta.clips.agent-native.com",
    });

    expect(html).toContain('var __AN_AUTH_MARKETING_SLUG = "clips"');
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

    expect(html).toContain('var __AN_AUTH_MARKETING_SLUG = "";');
    expect(html).toContain(
      "One-click screen recording (Loom-style) with auto titles, summaries, and chapters",
    );
    expect(html).toContain("var __AN_AUTH_MARKETING_LOCALES = {};");
    expect(html).toContain("function __anResolveAuthSystemLocale()");
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
    expect(html).toContain("function __anCopySignupLocalModeCommand()");
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

    // The document must not carry its own return-path validator: the whole
    // point of the shared runtime is that there is nothing here to drift.
    expect(html).toContain("var __anCreateSignInJourney =");
    expect(html).toContain(
      "var __anJourney = __anCreateSignInJourney(__anBasePath());",
    );
    expect(html).toContain("function __anResumeHref()");
    expect(html).not.toContain("function __anNormalizeReturnPath");
    expect(html).not.toContain("function __anIsAuthEntryPath");
    expect(html).not.toContain("function __anGetSignedInReturnPath");

    // …and the embedded runtime really behaves, hashes and all.
    const script = html.slice(
      html.indexOf("var __anCreateSignInJourney ="),
      html.indexOf("var __anJourney = __anCreateSignInJourney"),
    );
    const journey = new Function(
      `${script} return __anCreateSignInJourney("");`,
    )() as {
      signInJourney: (input: {
        at: string;
        continuation?: string | null;
        legacyReturn?: string | null;
      }) => { signInHref: string | null; resumeHref: string };
      normalizeAppPath: (raw: string) => string | null;
    };
    expect(journey.normalizeAppPath("/inbox?a=1#top")).toBe("/inbox?a=1#top");
    expect(journey.normalizeAppPath("//evil.com")).toBeNull();
    expect(journey.normalizeAppPath("https://evil.com/x")).toBeNull();
    expect(journey.signInJourney({ at: "/login" })).toEqual({
      signInHref: null,
      resumeHref: "/",
    });
    expect(
      journey.signInJourney({
        at: "/sign-in",
        legacyReturn: "/inbox#x",
      }).resumeHref,
    ).toBe("/inbox#x");

    const mountedJourney = new Function(
      `${script} return __anCreateSignInJourney("/dispatch");`,
    )() as {
      encodeContinuation: (path: string) => string;
      signInJourney: (input: {
        at: string;
        continuation?: string | null;
        legacyReturn?: string | null;
      }) => { resumeHref: string };
    };
    const mountedTarget = "/dispatch/apps/feedback-leaderboard";
    const mountedToken = mountedJourney.encodeContinuation(mountedTarget);
    expect(
      mountedJourney.signInJourney({
        at: `/dispatch/sign-in?c=${mountedToken}`,
        continuation: mountedToken,
      }).resumeHref,
    ).toBe(mountedTarget);
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

    expect(html).toContain('var __AN_AUTH_MARKETING_SLUG = "";');
    expect(html).toContain("Plan your team's work with a custom calendar.");
    expect(html).toContain("var __AN_AUTH_MARKETING_LOCALES = {};");
  });

  it("does not localize custom marketing from a built-in request host", () => {
    const html = getOnboardingHtml({
      requestHost: "dispatch.agent-native.com",
      marketing: {
        appName: "Custom Dispatch",
        tagline: "Route your own work with a custom dispatch flow.",
      },
    });

    expect(html).toContain('var __AN_AUTH_MARKETING_SLUG = "";');
    expect(html).toContain("Route your own work with a custom dispatch flow.");
    expect(html).toContain("var __AN_AUTH_MARKETING_LOCALES = {};");
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
    expect(html).toContain("function __anMaybeRedirectSignedIn(ret)");
    expect(html).toContain("__anMaybeRedirectSignedIn();");
    expect(html).toContain(
      "__anMaybeRedirectSignedIn(__anResumeHref()).then(function(redirected)",
    );
    expect(html).toContain(
      "window.location.replace(__anSessionBridgeUrl(ret, sessionToken))",
    );
    expect(html).toContain(
      "var oauthReturn = __anIsBuilderPreview() ? __anOAuthReturnTarget(ret) : ret;",
    );
    expect(html).toContain("__anFinishOAuthExchange(ret, flowId, data.token)");
    expect(html).toContain(
      "__anWaitForOAuthExchange(flowId, ret, btn, err, 'google', verifier)",
    );
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
