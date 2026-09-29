import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/index.js";
import { ENVIRONMENT_BADGE_MESSAGES } from "../localization/environment-badge-messages.js";
import { LOCALE_STORAGE_KEY } from "../localization/shared.js";
import type {
  AuthPageProps,
  ResetPasswordPageProps,
} from "../shared/auth-page-types.js";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "../shared/password-policy.js";
import { encodeContinuation } from "../shared/sign-in-journey.js";
import {
  AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER,
  AGENT_NATIVE_SOCIAL_IMAGE_PATH,
} from "../shared/social-meta.js";
import { AUTH_MARKETING_LOCALE_COPY } from "./auth-marketing-locales.js";
import { BUILT_IN_AUTH_MARKETING } from "./auth-marketing.js";
import { injectBetaOptOutPersistence } from "./beta-opt-out-html.js";
import {
  getDeploySettingsRequiredHtml,
  getOnboardingHtml as getCoreOnboardingHtml,
  getResetPasswordHtml as getCoreResetPasswordHtml,
} from "./onboarding-html.js";

const getOnboardingHtml: typeof getCoreOnboardingHtml = (opts = {}) =>
  getCoreOnboardingHtml({
    ...opts,
    renderSignInPage:
      opts.renderSignInPage ??
      ((props) => `<main data-auth-view="${props.initialView}" />`),
  });

const getResetPasswordHtml: typeof getCoreResetPasswordHtml = (
  requestPath,
  renderer,
) =>
  getCoreResetPasswordHtml(
    requestPath,
    renderer ?? ((props) => `<main data-page="${props.pageType}" />`),
  );

function readAuthPageData(html: string): AuthPageProps {
  const match = html.match(
    /<script type="application\/json" id="agent-native-auth-data">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("auth page data is missing");
  return JSON.parse(match[1]!) as AuthPageProps;
}

describe("getOnboardingHtml", () => {
  afterEach(() => {
    resetAppConfigForTests();
    vi.unstubAllEnvs();
  });

  it("does not include local upgrade copy in SSR HTML by default", () => {
    const html = getOnboardingHtml();

    expect(html).not.toContain("local@localhost");
    expect(html).not.toContain("You started this flow");
    expect(readAuthPageData(html).initialPrompt).toBe(false);
  });

  it("uses the injected auth renderer and falls back to a plain HTML shell", () => {
    const renderSignInPage = vi.fn(
      (props: AuthPageProps) =>
        `<main data-view="${props.initialView}">Custom sign-in</main>`,
    );
    const rendered = getCoreOnboardingHtml({ renderSignInPage });

    expect(renderSignInPage).toHaveBeenCalledWith(
      expect.objectContaining({ initialView: "signup" }),
    );
    expect(rendered).toContain(
      '<main data-view="signup">Custom sign-in</main>',
    );
    expect(rendered).not.toContain("data-agent-native-auth-fallback");

    const fallback = getCoreOnboardingHtml();
    expect(fallback).toContain('data-agent-native-auth-fallback="true"');
    expect(fallback).toContain('<main class="auth-fallback"');
    expect(fallback).toContain('id="agent-native-auth-data"');
    expect(readAuthPageData(fallback).initialView).toBe("signup");
  });

  it("uses the injected reset renderer and a plain HTML fallback", () => {
    const renderResetPasswordPage = vi.fn(
      (props: ResetPasswordPageProps) =>
        `<main data-page="${props.pageType}">Custom reset</main>`,
    );
    const rendered = getCoreResetPasswordHtml(
      "/workspace/_agent-native/auth/reset",
      renderResetPasswordPage,
    );

    expect(renderResetPasswordPage).toHaveBeenCalledWith(
      expect.objectContaining({
        pageType: "reset-password",
      }),
    );
    expect(rendered).toContain(
      '<main data-page="reset-password">Custom reset</main>',
    );
    expect(rendered).not.toContain("data-agent-native-auth-fallback");

    const fallback = getCoreResetPasswordHtml();
    expect(fallback).toContain('data-agent-native-auth-fallback="true"');
    expect(fallback).toContain('<main class="card"><h1>Reset password</h1>');
    expect(fallback).toContain('id="agent-native-auth-data"');
    expect(
      JSON.parse(
        fallback.match(
          /<script type="application\/json" id="agent-native-auth-data">([\s\S]*?)<\/script>/,
        )?.[1] ?? "{}",
      ),
    ).toMatchObject({ pageType: "reset-password" });
  });

  it("includes an environment switcher on the standalone auth page", () => {
    const html = injectBetaOptOutPersistence(
      getOnboardingHtml({
        requestHost: "beta.analytics.agent-native.com",
      }),
    );

    expect(html).toContain('id="environment-badge"');
    expect(html).toContain(
      `var messagesByLocale = ${JSON.stringify(ENVIRONMENT_BADGE_MESSAGES)};`,
    );
    expect(html).toContain('data-agent-native-environment-switcher-script="1"');
    expect(html).toContain("button.textContent = messages.betaLabel");
    expect(html).toContain(
      "productionLink.textContent = messages.switchToProduction",
    );
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

  it("ships the injected auth surface with serialized data and a client bundle", () => {
    const html = getOnboardingHtml();

    expect(html).toContain('id="agent-native-auth-root"');
    expect(html).toContain('src="/assets/auth-client.js"');
    expect(html).toContain(
      'type="application/json" id="agent-native-auth-data"',
    );
    expect(html).toContain('<main data-auth-view="signup" />');
  });

  it("renders the built-in app marketing surface beside shared auth", () => {
    const html = getOnboardingHtml({ requestHost: "clips.agent-native.com" });

    expect(readAuthPageData(html).appName).toBe("Agent-Native Clips");
    expect(readAuthPageData(html).marketing?.learnMoreUrl).toBe(
      "https://agent-native.com/apps/clips",
    );
  });

  it("allows a hosted app to opt out of catalog auth marketing", () => {
    const html = getOnboardingHtml({
      requestHost: "chat.agent-native.com",
      marketing: false,
    });

    expect(html).toContain('class="auth-centered"');
    expect(html).toContain(
      ".auth-centered {\n    display: flex;\n    justify-content: center;",
    );
    expect(html).not.toContain('class="marketing-panel"');
    expect(html).not.toContain("data-agent-native-marketing-home");
    expect(readAuthPageData(html).marketing).toBeUndefined();
  });

  it("version-stamps the auth client when the deployment build id is available", () => {
    vi.stubGlobal("__AGENT_NATIVE_BUILD_ID__", "deploy-auth-client-123");

    try {
      expect(getOnboardingHtml()).toContain(
        'src="/assets/auth-client.js?__an_build=deploy-auth-client-123"',
      );
      expect(getResetPasswordHtml()).toContain(
        'src="/assets/auth-client.js?__an_build=deploy-auth-client-123"',
      );
    } finally {
      vi.unstubAllGlobals();
    }
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
    expect(
      readAuthPageData(
        getOnboardingHtml({ requestPath: "/sign-in?c=continuation" }),
      ).initialView,
    ).toBe("login");
  });

  it("passes local-dev sign-in configuration to the auth renderer", () => {
    const html = getOnboardingHtml();

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

  describe("browser federated SSO", () => {
    it("passes disabled federation state when no hub is configured", () => {
      delete process.env.AGENT_NATIVE_IDENTITY_HUB_URL;
      const baseline = getOnboardingHtml();
      expect(readAuthPageData(baseline).identitySsoEnabled).toBe(false);
      expect(readAuthPageData(baseline).identitySsoAuto).toBe(false);

      const again = getOnboardingHtml();
      expect(again).toBe(baseline);
    });

    it("uses silent federation instead of showing a manual CTA on canonical hosted login pages", () => {
      vi.stubEnv("APP_URL", "https://calendar.agent-native.com");
      delete process.env.AGENT_NATIVE_IDENTITY_HUB_URL;

      const html = getOnboardingHtml({
        requestHost: "calendar.agent-native.com",
      });

      expect(readAuthPageData(html).identitySsoEnabled).toBe(true);
      expect(readAuthPageData(html).identitySsoAuto).toBe(true);
    });

    it.each([
      ["return", encodeURIComponent("/protected?tab=1")],
      ["c", encodeContinuation("/protected?tab=1")],
    ])(
      "preserves a validated %s destination for an explicitly configured hub",
      (key, value) => {
        vi.stubEnv(
          "AGENT_NATIVE_IDENTITY_HUB_URL",
          "https://dispatch.agent-native.com",
        );

        const html = getOnboardingHtml({
          requestHost: "app.example.test",
          requestPath: `/sign-in?${key}=${value}`,
        });

        expect(readAuthPageData(html).identitySsoAuto).toBe(false);
      },
    );

    it("rejects an external return target for an explicitly configured hub", () => {
      vi.stubEnv(
        "AGENT_NATIVE_IDENTITY_HUB_URL",
        "https://dispatch.agent-native.com",
      );

      const html = getOnboardingHtml({
        requestHost: "app.example.test",
        requestPath: "/sign-in?return=https%3A%2F%2Fevil.example",
      });

      expect(readAuthPageData(html).identitySsoEnabled).toBe(true);
    });

    it("keeps root auth markup independent of request query parameters", () => {
      vi.stubEnv("APP_URL", "https://calendar.agent-native.com");
      delete process.env.AGENT_NATIVE_IDENTITY_HUB_URL;

      const html = getOnboardingHtml({
        requestHost: "calendar.agent-native.com",
        requestPath: "/?return=%2Fprotected",
      });

      expect(readAuthPageData(html).identitySsoAuto).toBe(true);
    });

    it("keeps silent federation enabled in cached canonical login HTML", () => {
      vi.stubEnv("APP_URL", "https://calendar.agent-native.com");
      delete process.env.AGENT_NATIVE_IDENTITY_HUB_URL;

      expect(readAuthPageData(getOnboardingHtml()).identitySsoAuto).toBe(true);
    });

    it("renders the federation CTA for an explicitly configured hub", () => {
      vi.stubEnv(
        "AGENT_NATIVE_IDENTITY_HUB_URL",
        "https://dispatch.agent-native.com",
      );
      const html = getOnboardingHtml();
      expect(readAuthPageData(html).identitySsoEnabled).toBe(true);
      expect(readAuthPageData(html).identitySsoAuto).toBe(false);
      expect(html).toContain("data-agent-native-embedded-init");
      expect(html).toContain(
        'params.get("embedded") === "1" || window.self !== window.top',
      );
    });

    it("malformed hub configuration does not change the auth surface", () => {
      vi.stubEnv("AGENT_NATIVE_IDENTITY_HUB_URL", "not a url");
      const html = getOnboardingHtml();
      expect(readAuthPageData(html).identitySsoEnabled).toBe(false);
    });

    it("ignores the removed browser SSO request fields", () => {
      const html = getOnboardingHtml({
        identitySsoRequestHost: "dispatch.agent-native.com",
        identitySsoRequestProtocol: "https",
      });

      expect(readAuthPageData(html).identitySsoEnabled).toBe(false);
    });
  });

  describe("googleOnly login follows deployment credentials", () => {
    it("disables Google sign-in when the credential pair is absent", () => {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.GOOGLE_SIGN_IN_CLIENT_ID;
      delete process.env.GOOGLE_SIGN_IN_CLIENT_SECRET;

      const html = getOnboardingHtml({ googleOnly: true });

      expect(readAuthPageData(html).showGoogle).toBe(false);
      expect(readAuthPageData(html).initialView).toBe("googleOnly");
    });

    it("disables Google sign-in when only one credential is present", () => {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.GOOGLE_SIGN_IN_CLIENT_ID;
      vi.stubEnv("GOOGLE_SIGN_IN_CLIENT_SECRET", "sign-in-secret-without-id");

      const html = getOnboardingHtml({ googleOnly: true });

      expect(readAuthPageData(html).showGoogle).toBe(false);
    });

    it("renders Google sign-in when a complete credential pair is present", () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");

      const html = getOnboardingHtml({ googleOnly: true });

      expect(readAuthPageData(html).showGoogle).toBe(true);
    });
  });

  it("reveals the upgrade note only from explicit upgrade markers", () => {
    const html = getOnboardingHtml();

    expect(readAuthPageData(html).initialPrompt).toBe(false);
  });

  it("uses readable text and visible control borders for branded auth in light mode", () => {
    const html = getOnboardingHtml({
      requestHost: "slides.agent-native.com",
    });

    expect(html).toContain(
      ".auth-marketing-home .card input {\n      color: var(--auth-marketing-foreground);\n      border-color: var(--auth-marketing-border);",
    );
    expect(html).toContain(
      ".auth-marketing-home .auth-marketing-description-link {\n    color: var(--auth-marketing-muted);",
    );
    expect(html).toContain("--auth-marketing-muted: GrayText;");
    expect(html).toContain(".auth-marketing-home .card input:focus {");
    expect(html).toContain(".auth-marketing-home .card input::placeholder {");
    expect(html).toContain(
      '.auth-marketing-home .card .btn-google,\n    .auth-marketing-home .card .btn-primary,\n    .auth-marketing-home .card button[type="submit"]',
    );
  });

  it("injects APP_BASE_PATH so mounted login pages call app-scoped auth endpoints", () => {
    vi.stubEnv("APP_BASE_PATH", "/starter/");
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");

    const html = getOnboardingHtml();

    expect(html).toContain('src="/starter/assets/auth-client.js"');
    expect(readAuthPageData(html).appBasePath).toBe("/starter");
  });

  it("uses the Vite base for mounted auth assets and metadata", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/viteapp");
    delete process.env.APP_BASE_PATH;

    const html = getOnboardingHtml({
      requestHost: "slides.agent-native.com",
      requestOrigin: "https://slides.agent-native.com",
    });

    const pageData = readAuthPageData(html);
    expect(pageData.appBasePath).toBe("/viteapp");
    expect(html).toContain('src="/viteapp/assets/auth-client.js"');
    expect(pageData.appName).toBe("Agent-Native Slides");
    expect(html).not.toContain("/viteapp/auth-marketing/");
    expect(html).toContain('href="/viteapp/favicon.svg"');
    expect(html).toContain('href="/viteapp/icon-180.svg"');
    expect(html).toContain(
      "https://slides.agent-native.com/viteapp/_agent-native/og-image.png",
    );
  });

  it("labels first-party share cards with the full product name", () => {
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;

    const html = getOnboardingHtml({
      requestHost: "mail.agent-native.com",
      requestOrigin: "https://mail.agent-native.com",
      marketing: {
        appName: "Mail",
        learnMoreUrl: "https://agent-native.com/apps/mail",
        tagline:
          "Your AI agent reads, drafts, and organizes email alongside you.",
      },
    });

    expect(html).toContain(
      '<meta property="og:title" content="Agent-Native Mail"/>',
    );
    expect(html).toContain(
      '<meta property="og:site_name" content="Agent-Native"/>',
    );
    expect(html).toContain('<meta property="og:type" content="website"/>');
    expect(html).toContain(
      '<meta property="og:url" content="https://mail.agent-native.com/"/>',
    );
    expect(html).toContain(
      '<meta property="og:image:alt" content="Agent-Native Mail: Read it. Write it. Let your agent take it from here."/>',
    );
    expect(html).toContain(
      `og-image.png?v=${AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER}`,
    );
  });

  it("does not claim Agent-Native provenance for catalog copy on a custom host", () => {
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
    vi.stubEnv("AGENT_NATIVE_TEMPLATE", "mail");

    const html = getOnboardingHtml({
      requestHost: "inbox.example.com",
      requestOrigin: "https://inbox.example.com",
    });

    expect(html).toContain('property="og:site_name"');
    expect(html).not.toContain(
      '<meta property="og:site_name" content="Agent-Native"/>',
    );
  });

  it("keeps a custom app's own name on its share card", () => {
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;

    const html = getOnboardingHtml({
      requestHost: "inbox.example.com",
      requestOrigin: "https://inbox.example.com",
      marketing: { appName: "Mail", tagline: "Acme's inbox." },
    });

    expect(html).toContain('<meta property="og:title" content="Mail"/>');
    expect(html).toContain('<meta property="og:site_name" content="Mail"/>');
    expect(html).not.toContain("Agent-Native Mail");
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

  it("passes password limits to the injected auth renderer", () => {
    const html = getOnboardingHtml();

    expect(readAuthPageData(html).passwordMinLength).toBe(PASSWORD_MIN_LENGTH);
    expect(readAuthPageData(html).passwordMaxLength).toBe(PASSWORD_MAX_LENGTH);
  });

  it("includes reset-password data in the plain fallback document", () => {
    const html = getOnboardingHtml();
    const resetHtml = getResetPasswordHtml();

    expect(resetHtml).toContain('id="agent-native-auth-root"');
    expect(resetHtml).toContain('pageType":"reset-password"');
    expect(resetHtml).toContain('src="/assets/auth-client.js"');
    expect(resetHtml).toContain('<main data-page="reset-password" />');
    expect(readAuthPageData(resetHtml).passwordMaxLength).toBe(
      PASSWORD_MAX_LENGTH,
    );
    expect(html).toContain('<main data-auth-view="signup" />');
  });

  it("renders configured marketing beside Google-only auth", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");
    const html = getOnboardingHtml({
      googleOnly: true,
      marketing: {
        appName: "Calendar",
        tagline: "Your AI agent manages your calendar.",
      },
    });

    expect(readAuthPageData(html)).toMatchObject({
      initialView: "googleOnly",
      showGoogle: true,
      marketing: { appName: "Calendar" },
    });
  });

  it("passes password policy to signup and reset renderers", () => {
    const html = getOnboardingHtml();
    const resetHtml = getResetPasswordHtml();

    expect(readAuthPageData(html)).toMatchObject({
      passwordMinLength: PASSWORD_MIN_LENGTH,
      passwordMaxLength: PASSWORD_MAX_LENGTH,
    });
    expect(readAuthPageData(resetHtml)).toMatchObject({
      passwordMinLength: PASSWORD_MIN_LENGTH,
      passwordMaxLength: PASSWORD_MAX_LENGTH,
    });
  });

  it("keeps the password flow unchanged by default", () => {
    const html = getOnboardingHtml();

    expect(readAuthPageData(html)).toMatchObject({
      authMode: "password",
      initialView: "signup",
    });
  });

  it("does not autofocus auth inputs on initial load", () => {
    expect(getOnboardingHtml()).not.toContain("autofocus");
    expect(getOnboardingHtml({ authMode: "magic-link" })).not.toContain(
      "autofocus",
    );
    expect(getResetPasswordHtml()).not.toContain("autofocus");
  });

  it("passes the email-only magic-link view to the injected renderer", () => {
    const html = getOnboardingHtml({ authMode: "magic-link" });

    expect(readAuthPageData(html)).toMatchObject({
      authMode: "magic-link",
      initialView: "magicLink",
    });
    expect(html).toContain('id="agent-native-auth-root"');
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
    expect(readAuthPageData(html).initialPrompt).toBe(true);
    expect(readAuthPageData(html).marketing).toBeUndefined();
  });

  it("localizes the magic-link copy through the existing auth catalogs", () => {
    const html = getOnboardingHtml({ authMode: "magic-link" });

    const locales = readAuthPageData(html).locales;
    expect(Object.values(locales["zh-CN"] ?? {})).toContain("欢迎");
    expect(Object.values(locales["zh-CN"] ?? {})).toContain(
      "继续以登录或创建账户",
    );
    expect(Object.values(locales["zh-CN"] ?? {})).toContain("使用邮箱继续");
    expect(Object.values(locales["zh-CN"] ?? {})).toContain(
      "我们已向以下邮箱发送安全登录链接：",
    );
    expect(Object.values(locales["zh-CN"] ?? {})).toContain("改用密码");
    expect(Object.values(locales["zh-TW"] ?? {})).toContain(
      "我們已向以下電子郵件寄送安全登入連結：",
    );
  });

  it("shows the hosted terms notice on the initial magic-link view", () => {
    const html = getOnboardingHtml({
      authMode: "magic-link",
      requestHost: "slides.agent-native.com",
    });

    expect(readAuthPageData(html).signupLegalNotice).toMatchObject({
      termsUrl: "https://www.agent-native.com/terms",
      privacyUrl: "https://www.agent-native.com/privacy",
    });
  });

  it("keeps the pending verification email across a redirect without storing its password", () => {
    const html = getOnboardingHtml();

    expect(html).not.toContain("pendingSignupPassword");
  });

  it("normalizes and rehydrates the stored verification email at runtime", () => {
    const html = getOnboardingHtml();
    expect(html).toContain('id="agent-native-auth-data"');
    expect(readAuthPageData(html).initialView).toBe("signup");
  });

  it("captures first-touch attribution on the standalone auth page", () => {
    const html = getOnboardingHtml();

    expect(html).toContain('id="agent-native-auth-root"');
    expect(html).toContain('src="/assets/auth-client.js"');
    expect(html).not.toContain("document.cookie = 'an_ft='");
  });

  it("omits hosted terms and privacy links on unhosted email signup", () => {
    const html = getOnboardingHtml();

    expect(readAuthPageData(html).signupLegalNotice).toBeUndefined();
  });

  it("shows a secondary terms and privacy notice on hosted email signup", () => {
    const html = getOnboardingHtml({
      requestHost: "calendar.agent-native.com",
    });

    expect(readAuthPageData(html).signupLegalNotice).toMatchObject({
      termsUrl: "https://www.agent-native.com/terms",
      privacyUrl: "https://www.agent-native.com/privacy",
    });
  });

  it("renders a locale picker that shares the app locale preference", () => {
    const html = getOnboardingHtml({
      requestHost: "forms.agent-native.com",
    });

    expect(readAuthPageData(html).localeStorageKey).toBe(LOCALE_STORAGE_KEY);
    expect(readAuthPageData(html).localeOptions).toContainEqual({
      value: "es-ES",
      label: "Español",
    });
    expect(readAuthPageData(html).locales["es-ES"]).toHaveProperty(
      "createAccount",
      "Crear cuenta",
    );
  });

  it("uses the marketing auth surface for branded template hosts", () => {
    const html = getOnboardingHtml({
      requestHost: "forms.agent-native.com",
    });

    expect(readAuthPageData(html).appName).toBe("Agent-Native Forms");
    expect(readAuthPageData(html).marketing).toBeDefined();
  });

  it("keeps the app marketing on beta template subdomains", () => {
    const html = getOnboardingHtml({
      requestHost: "beta.clips.agent-native.com",
    });

    expect(readAuthPageData(html).appName).toBe("Agent-Native Clips");
    expect(readAuthPageData(html).marketing).toBeDefined();
  });

  it("localizes configured marketing for its hosted built-in template", () => {
    const html = getOnboardingHtml({
      requestHost: "slides.agent-native.com",
      marketing: {
        appName: "Slides",
        learnMoreUrl: "https://agent-native.com/apps/slides",
        tagline: BUILT_IN_AUTH_MARKETING.slides.tagline,
      },
    });
    const chineseCopy = readAuthPageData(html).marketingLocales["zh-CN"];

    expect(chineseCopy?.tagline).toBe(
      AUTH_MARKETING_LOCALE_COPY["zh-CN"]?.slides?.tagline,
    );
    expect(chineseCopy?.authHeadline).toBe(chineseCopy?.tagline);
    expect(chineseCopy?.authDescription).toBeUndefined();
  });

  it("renders custom marketing copy beside the auth form", () => {
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

    const pageData = readAuthPageData(html);
    expect(pageData.appName).toBe("Clips");
    expect(pageData.marketing?.tagline).toBe(
      "Your AI agent transcribes, summarizes, and searches everything you record alongside you.",
    );
    expect(pageData.marketing?.features).toContain(
      "One-click screen recording (Loom-style) with auto titles, summaries, and chapters",
    );
    expect(pageData.marketingLocales).toEqual({});
  });

  it("keeps branded social metadata with the marketing panel", () => {
    const html = getOnboardingHtml({
      marketing: {
        appName: "Clips",
        tagline: "The template's existing public tagline.",
        learnMoreUrl: "https://agent-native.com/apps/clips",
      },
    });

    expect(readAuthPageData(html).appName).toBe("Clips");
    expect(html).toContain('property="og:image:alt"');
    expect(readAuthPageData(html).marketing?.learnMoreUrl).toBe(
      "https://agent-native.com/apps/clips",
    );
  });

  it("keeps custom marketing that reuses a built-in app name out of built-in localized copy", () => {
    const html = getOnboardingHtml({
      requestHost: "app.example.com",
      marketing: {
        appName: "Dispatch",
        tagline: BUILT_IN_AUTH_MARKETING.dispatch.tagline,
        description: "Route parcels across your own fleet.",
        features: ["Track every van on one map"],
        learnMoreUrl: "https://agent-native.com/apps/slides",
      },
    });

    expect(readAuthPageData(html).appName).toBe("Dispatch");
    expect(readAuthPageData(html).marketing?.description).toBe(
      "Route parcels across your own fleet.",
    );
    expect(readAuthPageData(html).marketing?.features).toEqual([
      "Track every van on one map",
    ]);
    expect(readAuthPageData(html).marketingLocales).toEqual({});
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

    expect(readAuthPageData(html).signupLegalNotice).toMatchObject({
      termsUrl: "https://example.com/legal/terms",
      privacyUrl: "https://example.com/legal/privacy",
      termsLabel: "Service Terms",
      privacyLabel: "Privacy Notice",
    });
  });

  it("shows a quiet local-files escape hatch on hosted Plan signup", () => {
    const html = getOnboardingHtml({
      requestHost: "plan.agent-native.com",
    });

    expect(readAuthPageData(html).signupLocalModeNote?.command).toContain(
      "skills add visual-plan --mode local-files",
    );
  });

  it("keeps the local-files escape hatch off other hosted signup pages", () => {
    const html = getOnboardingHtml({
      requestHost: "calendar.agent-native.com",
    });

    expect(readAuthPageData(html).signupLocalModeNote).toBeUndefined();
  });

  it("normalizes sign-in return targets through the one shared primitive", () => {
    const html = getOnboardingHtml();

    expect(html).toContain('src="/assets/auth-client.js"');
    expect(readAuthPageData(html).appBasePath).toBe("");
    expect(html).not.toContain("function __anNormalizeReturnPath");
  });

  it("passes the configured app home to the hydrated sign-in page", () => {
    defineAppConfig({ app: { homePath: "/inbox" } });

    expect(readAuthPageData(getOnboardingHtml()).homePath).toBe("/inbox");
  });

  it("uses app branding in the first-party marketing UI", () => {
    const html = getOnboardingHtml({
      requestHost: "dispatch.agent-native.com",
    });

    expect(readAuthPageData(html).appName).toBe("Agent-Native Dispatch");
    expect(readAuthPageData(html).marketing).toBeDefined();
    expect(html).toContain(
      `${AGENT_NATIVE_SOCIAL_IMAGE_PATH}?v=${AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER}`,
    );
  });

  it("uses the marketing auth surface for every built-in template host", () => {
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

      expect(readAuthPageData(html).appName).toBe(
        BUILT_IN_AUTH_MARKETING[slug]!.appName,
      );
      expect(readAuthPageData(html).marketing?.learnMoreUrl).toBe(
        `https://agent-native.com/apps/${slug}`,
      );
    }
  });

  it("passes marketing and Google configuration for Mail and Calendar", () => {
    for (const slug of ["mail", "calendar"]) {
      const html = getOnboardingHtml({
        requestHost: `${slug}.agent-native.com`,
        googleOnly: true,
      });

      expect(readAuthPageData(html).marketing).toBeDefined();
      expect(readAuthPageData(html).googleOnly).toBe(true);
    }
  });

  it("keeps unknown apps on the compact generic auth page", () => {
    const html = getOnboardingHtml({
      requestHost: "workspace.example.com",
    });

    expect(readAuthPageData(html).marketing).toBeUndefined();
    expect(readAuthPageData(html).appName).toBeUndefined();
  });

  it("renders custom marketing metadata on the shared auth UI", () => {
    const html = getOnboardingHtml({
      marketing: {
        appName: "Calendar",
        tagline: "Plan your team's work with a custom calendar.",
      },
    });

    expect(readAuthPageData(html).appName).toBe("Calendar");
    expect(readAuthPageData(html).marketing?.tagline).toBe(
      "Plan your team's work with a custom calendar.",
    );
    expect(readAuthPageData(html).marketing?.tagline).toBe(
      "Plan your team's work with a custom calendar.",
    );
  });

  it("renders configured marketing metadata on built-in hosts", () => {
    const html = getOnboardingHtml({
      requestHost: "dispatch.agent-native.com",
      marketing: {
        appName: "Custom Dispatch",
        tagline: "Route your own work with a custom dispatch flow.",
      },
    });

    expect(readAuthPageData(html).appName).toBe("Custom Dispatch");
    expect(readAuthPageData(html).marketing?.tagline).toBe(
      "Route your own work with a custom dispatch flow.",
    );
    expect(readAuthPageData(html).marketing?.tagline).toBe(
      "Route your own work with a custom dispatch flow.",
    );
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

describe("getDeploySettingsRequiredHtml", () => {
  it("names each key in the visitor's language", () => {
    const html = getDeploySettingsRequiredHtml({
      keys: ["DATABASE_URL", "A2A_SECRET"],
      locale: "ja-JP",
      dir: "ltr",
    });

    expect(html).toContain('<html lang="ja-JP" dir="ltr">');
    expect(html).toContain(
      "<h1>このデプロイのセットアップを完了してください</h1>",
    );
    expect(html).toContain(
      "<code>DATABASE_URL</code>, <code>A2A_SECRET</code>",
    );
    expect(html).toContain("セットアップガイドを見る");
    expect(html).not.toContain("{keys}");
  });

  it("lays out right-to-left locales right-to-left", () => {
    const html = getDeploySettingsRequiredHtml({
      keys: ["BETTER_AUTH_SECRET"],
      locale: "ar-SA",
      dir: "rtl",
    });

    expect(html).toContain('<html lang="ar-SA" dir="rtl">');
    expect(html).toContain("<h1>أكمل إعداد عملية النشر هذه</h1>");
  });

  it("falls back to English for a locale without auth copy", () => {
    const html = getDeploySettingsRequiredHtml({
      keys: ["BETTER_AUTH_SECRET"],
      locale: "xx-XX",
      dir: "ltr",
    });

    expect(html).toContain("<h1>Finish setting up this deployment</h1>");
    expect(html).toContain(
      "Missing or invalid environment variables: <code>BETTER_AUTH_SECRET</code>. Add them",
    );
  });
});
