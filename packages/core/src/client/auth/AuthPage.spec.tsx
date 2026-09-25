import { readFileSync } from "node:fs";

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getOnboardingHtml } from "../../server/onboarding-html.js";
import {
  AuthPage,
  isAuthenticatedAuthSession,
  isConfirmedAnonymousAuthSession,
  isVerificationLinkInvalid,
  oauthReturnTarget,
  resolveGoogleAuthUrlPath,
  shouldUseIdentitySsoForGoogle,
  shouldAutoFederateIdentitySso,
  shouldHideAuthSubtitle,
  shouldStartWithLocalDev,
  type AuthPageProps,
} from "./AuthPage.js";

function propsFromHtml(html: string): AuthPageProps {
  const match = html.match(
    /<script type="application\/json" id="agent-native-auth-data">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("auth page data is missing");
  return JSON.parse(match[1]!) as AuthPageProps;
}

describe("AuthPage", () => {
  it("does not show raw Google OAuth exceptions to users", () => {
    const source = readFileSync(
      new URL("./AuthPage.tsx", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("const startGoogle = React.useCallback");
    const end = source.indexOf(
      "  }, [\n    apiPath,\n    googleAuthUrlPath",
      start,
    );
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const googleOAuthCatch = source.slice(start, end);

    expect(googleOAuthCatch).toContain('text: t("failedToConnect")');
    expect(googleOAuthCatch).not.toContain("error.message");
  });

  it("recognizes Better Auth invalid-token redirects as expired verification links", () => {
    expect(isVerificationLinkInvalid("verification_link_invalid")).toBe(true);
    expect(isVerificationLinkInvalid("INVALID_TOKEN")).toBe(true);
    expect(isVerificationLinkInvalid("INVALID_CALLBACK_URL")).toBe(false);

    expect(
      propsFromHtml(getOnboardingHtml({ requestPath: "/?error=INVALID_TOKEN" }))
        .initialView,
    ).toBe("login");
  });

  it("hides account-only guidance when local development sign-in is available", () => {
    expect(shouldHideAuthSubtitle("signup", true)).toBe(true);
    expect(shouldHideAuthSubtitle("signup", false)).toBe(false);
    expect(shouldHideAuthSubtitle("login", true)).toBe(false);
  });

  it("starts local development sign-in collapsed unless the URL requests auth", () => {
    expect(shouldStartWithLocalDev("/", "")).toBe(true);
    expect(shouldStartWithLocalDev("/", "?tab=signup")).toBe(false);
    expect(shouldStartWithLocalDev("/", "?tab=login")).toBe(false);
    expect(shouldStartWithLocalDev("/", "?verified=1")).toBe(false);
    expect(shouldStartWithLocalDev("/", "?error=INVALID_TOKEN")).toBe(false);
    expect(shouldStartWithLocalDev("/login", "")).toBe(false);
    expect(shouldStartWithLocalDev("/signup/", "")).toBe(false);
    expect(shouldStartWithLocalDev("/sign-in", "")).toBe(false);
    expect(
      shouldStartWithLocalDev("/_agent-native/sign-in", "?return=%2Fplans"),
    ).toBe(false);
    expect(shouldStartWithLocalDev("/", "?c=%2Fplans")).toBe(false);
  });

  it("only confirms anonymous sessions from a readable auth response", () => {
    expect(
      isConfirmedAnonymousAuthSession(
        { ok: true, status: 200 },
        { error: "Not authenticated" },
        true,
      ),
    ).toBe(true);
    expect(
      isConfirmedAnonymousAuthSession(
        { ok: true, status: 200 },
        { error: "Session unavailable" },
        true,
      ),
    ).toBe(false);
    expect(
      isConfirmedAnonymousAuthSession(
        { ok: false, status: 503 },
        { error: "Not authenticated" },
        true,
      ),
    ).toBe(false);
  });

  it("only treats a successful session response with an email as signed in", () => {
    expect(
      isAuthenticatedAuthSession({ ok: true }, { email: "person@example.com" }),
    ).toBe(true);
    expect(
      isAuthenticatedAuthSession(
        { ok: true },
        { error: "Not authenticated", email: "person@example.com" },
      ),
    ).toBe(false);
    expect(isAuthenticatedAuthSession({ ok: false }, {})).toBe(false);
  });

  it("only auto-federates identity SSO on its canonical origin", () => {
    expect(
      shouldAutoFederateIdentitySso({
        identitySsoAuto: true,
        publicOAuthOrigin: "https://design.agent-native.com",
        currentOrigin: "https://design.agent-native.com",
      }),
    ).toBe(true);
    expect(
      shouldAutoFederateIdentitySso({
        identitySsoAuto: true,
        publicOAuthOrigin: "https://design.agent-native.com",
        currentOrigin: "https://pr-4689--agent-native-design.netlify.app",
      }),
    ).toBe(false);
  });

  it("uses Identity SSO for Google sign-in on immutable Netlify deploy URLs", () => {
    const deployOrigin = `https://${"a".repeat(24)}--agent-native-analytics.netlify.app`;
    expect(
      shouldUseIdentitySsoForGoogle({
        googleViaIdentitySso: true,
        currentOrigin: deployOrigin,
      }),
    ).toBe(true);
    expect(
      shouldUseIdentitySsoForGoogle({
        googleViaIdentitySso: true,
        currentOrigin:
          "https://deploy-preview-42--agent-native-analytics.netlify.app",
      }),
    ).toBe(false);
    expect(
      shouldUseIdentitySsoForGoogle({
        googleViaIdentitySso: false,
        currentOrigin: deployOrigin,
      }),
    ).toBe(false);
  });

  it("enables preview Google SSO only for the current immutable site deploy", () => {
    const previousSiteName = process.env.SITE_NAME;
    process.env.SITE_NAME = "agent-native-analytics";
    const deployHost = `${"a".repeat(24)}--agent-native-analytics.netlify.app`;

    try {
      const deployProps = propsFromHtml(
        getOnboardingHtml({ requestHost: deployHost }),
      );
      const aliasProps = propsFromHtml(
        getOnboardingHtml({
          requestHost: "deploy-preview-42--agent-native-analytics.netlify.app",
        }),
      );

      expect(deployProps.googleViaIdentitySso).toBe(true);
      expect(aliasProps.googleViaIdentitySso).toBe(false);
      expect(deployProps.identitySsoEnabled).toBe(false);

      const mailProps = propsFromHtml(
        getOnboardingHtml({
          requestHost: deployHost,
          googleScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        }),
      );
      expect(mailProps.googleViaIdentitySso).toBe(false);
    } finally {
      if (previousSiteName === undefined) delete process.env.SITE_NAME;
      else process.env.SITE_NAME = previousSiteName;
    }
  });

  it("renders the password auth surface on the server without browser globals", () => {
    const props = propsFromHtml(getOnboardingHtml());
    const html = renderToString(
      <AuthPage
        {...props}
        identitySsoEnabled={false}
        identitySsoAuto={false}
      />,
    );

    expect(html).toContain('id="signup-form"');
    expect(html).toContain('id="login-form"');
    expect(html).toContain('id="forgot-form"');
    expect(html).not.toContain("onclick");
  });

  it("renders the organization SSO email entry point when enabled", () => {
    const props = propsFromHtml(getOnboardingHtml());
    const html = renderToString(<AuthPage {...props} organizationSsoEnabled />);

    expect(html).toContain('id="organization-sso-form"');
    expect(html).toContain('id="organization-sso-submit"');
  });

  it("composes the shared two-panel marketing home for branded auth", () => {
    const onboardingHtml = getOnboardingHtml({
      requestHost: "slides.agent-native.com",
    });
    const props = propsFromHtml(onboardingHtml);
    const html = renderToString(<AuthPage {...props} />);

    expect(html).toContain('data-agent-native-marketing-home="true"');
    expect(html).toContain('class="auth-marketing-visual"');
    expect(html).toContain('data-agent-native-starfield="true"');
    expect(html).not.toContain("New to Slides?");
    expect(html).toContain("Welcome to Slides");
    expect(html).toContain('data-i18n="welcomeToApp"');
    expect(html).toContain("Sign in or create your account");
    expect(html).toContain("Say it. Show it.");
    expect(html).toContain('class="app-status-badge">alpha</span>');
    expect(html).toContain('class="oss-badge"');
    expect(html).toContain('href="https://agent-native.com/apps/slides"');
    expect(html).toContain('class="auth-marketing-description-link"');
    expect(html.indexOf('class="auth-marketing-description"')).toBeLessThan(
      html.indexOf('class="auth-marketing-description-link"'),
    );
    expect(
      html.indexOf('class="auth-marketing-description-link"'),
    ).toBeLessThan(html.indexOf('class="oss-badge"'));
    const githubBadge = html.match(/<a class="oss-badge"[^>]*>/)?.[0];
    expect(githubBadge).toContain(
      'href="https://github.com/BuilderIO/agent-native"',
    );
    expect(githubBadge).toContain('target="_blank"');
    const badgeStart = html.indexOf(githubBadge ?? "");
    const githubIcon = html.indexOf("<svg", badgeStart);
    const sourceLabel = html.indexOf('data-i18n="openSource"', badgeStart);
    expect(githubIcon).toBeGreaterThan(badgeStart);
    expect(html.slice(githubIcon, sourceLabel)).toContain('aria-hidden="true"');
    expect(onboardingHtml).toContain(
      "top: max(1rem, env(safe-area-inset-top));\n    inset-inline-end: max(4rem, calc(env(safe-area-inset-right) + 3.5rem));",
    );
    expect(html).toContain('class="split');
    expect(html).toContain('class="marketing-panel"');
    expect(html).toContain('class="form-panel');
    expect(html).toContain('id="heading"');
    expect(html).not.toContain('id="local-note"');
    expect(onboardingHtml).toContain(
      ".auth-marketing-home .marketing-panel {\n    order: 1;\n    flex: 1 1 50%;",
    );
    expect(onboardingHtml).toContain(
      ".auth-marketing-home .auth-marketing-screenshot-wrap {\n    position: fixed;\n    inset: 0;",
    );
    expect(onboardingHtml).toContain("transform: translateY(-5vh);");
    expect(onboardingHtml).toContain(
      "body.has-marketing .locale-picker {\n    top: auto;",
    );
    expect(onboardingHtml).toContain("box-shadow: none;");
    expect(onboardingHtml).toContain(
      ".auth-marketing-home .form-panel {\n    order: 2;\n    flex: 1 1 50%;",
    );
    expect(onboardingHtml).toContain("border-inline-start: 1px solid");
    expect(onboardingHtml).toContain("@media (prefers-color-scheme: light)");
    expect(onboardingHtml).toContain("--auth-marketing-right-bg: Canvas;");
    expect(onboardingHtml).toContain("color-scheme: light;");
    expect(onboardingHtml).toContain(
      ".auth-marketing-home .card .verification-copy",
    );
  });

  it("places Learn more after the marketing description for every app", () => {
    const props = propsFromHtml(
      getOnboardingHtml({ requestHost: "mail.agent-native.com" }),
    );
    const html = renderToString(<AuthPage {...props} />);

    expect(html.indexOf('class="auth-marketing-description"')).toBeLessThan(
      html.indexOf('class="auth-marketing-description-link"'),
    );
    expect(html).not.toContain('class="auth-marketing-top-right"');
    expect(html).not.toContain("New to Mail?");
  });

  it.each(["slides.agent-native.com", "analytics.agent-native.com"])(
    "keeps shared visual markup for %s",
    (requestHost) => {
      const props = propsFromHtml(getOnboardingHtml({ requestHost }));
      const html = renderToString(<AuthPage {...props} />);

      expect(props.marketing?.screenshotWidth).toBeGreaterThan(0);
      expect(props.marketing?.screenshotHeight).toBeGreaterThan(0);
      expect(html).toContain('class="auth-marketing-visual"');
      expect(html).toContain('data-agent-native-starfield="true"');
    },
  );

  it("keeps the magic-link entry and completion surfaces in the React tree", () => {
    const props = propsFromHtml(getOnboardingHtml({ authMode: "magic-link" }));
    const html = renderToString(<AuthPage {...props} />);

    expect(props.initialView).toBe("magicLink");
    expect(html).toContain('id="magic-link-form"');
    expect(html).toContain('id="magic-link-success"');
    expect(html).toContain('id="magic-link-success-email"');
    expect(html).toContain('id="use-password-link"');
  });

  it("keeps the magic-link entry subtitle honest about the controls it renders", () => {
    const props = propsFromHtml(getOnboardingHtml({ authMode: "magic-link" }));
    const html = renderToString(<AuthPage {...props} />);

    expect(props.initialView).toBe("magicLink");
    // The Create account / Sign in tabs are the only account chooser, and this
    // view hides them on purpose: one email field registers and signs in.
    expect(html).toMatch(/id="auth-tabs"[^>]*\shidden=""/);
    expect(html).toContain("Sign in or create your account");
    expect(html).not.toContain("Create an account or sign in");
  });

  it("still shows the account chooser on the password entry view", () => {
    const props = propsFromHtml(getOnboardingHtml());
    const html = renderToString(<AuthPage {...props} />);

    expect(props.initialView).toBe("signup");
    expect(html).toContain('id="auth-tabs"');
    expect(html).not.toMatch(/id="auth-tabs"[^>]*\shidden=""/);
  });

  it("returns Builder Electron OAuth to the local workspace gateway", () => {
    const target = "/agent?tab=context";
    const genericElectron = "Mozilla/5.0 Electron/32.0 BuilderDesktop";

    expect(oauthReturnTarget(target, "", genericElectron)).toBe(
      "http://127.0.0.1:8080/agent?tab=context",
    );
    expect(
      oauthReturnTarget(
        target,
        "",
        "Mozilla/5.0 Electron/43.4.0 AgentNativeDesktop/0.1.150",
      ),
    ).toBe("http://127.0.0.1:8080/agent?tab=context");
    expect(oauthReturnTarget(target, "", "Mozilla/5.0 Chrome/138.0")).toBe(
      target,
    );
  });

  it("keeps Builder preview OAuth at the public app root", () => {
    expect(
      resolveGoogleAuthUrlPath({
        builderPreview: true,
        currentOrigin: "https://preview.builder.codes",
        publicOAuthOrigin: "https://dispatch.agent-native.com",
        runtimeAppBasePath: "/dispatch",
      }),
    ).toBe("https://dispatch.agent-native.com/_agent-native/google/auth-url");
    expect(
      resolveGoogleAuthUrlPath({
        builderPreview: true,
        currentOrigin: "https://agent-workspace.builder.io",
        publicOAuthOrigin: "https://agent-workspace.builder.io",
        runtimeAppBasePath: "/dispatch",
      }),
    ).toBe("/dispatch/_agent-native/google/auth-url");
  });
});
