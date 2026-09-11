import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getOnboardingHtml } from "../../server/onboarding-html.js";
import {
  AuthPage,
  isAuthenticatedAuthSession,
  isConfirmedAnonymousAuthSession,
  oauthReturnTarget,
  resolveGoogleAuthUrlPath,
  shouldAutoFederateIdentitySso,
  shouldHideAuthSubtitle,
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
  it("hides account-only guidance when local development sign-in is available", () => {
    expect(shouldHideAuthSubtitle("signup", true)).toBe(true);
    expect(shouldHideAuthSubtitle("signup", false)).toBe(false);
    expect(shouldHideAuthSubtitle("login", true)).toBe(false);
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

  it("composes the shared marketing home and animated background for branded auth", () => {
    const onboardingHtml = getOnboardingHtml({
      requestHost: "slides.agent-native.com",
    });
    const props = propsFromHtml(onboardingHtml);
    const html = renderToString(<AuthPage {...props} />);

    expect(html).toContain('data-agent-native-marketing-home="true"');
    expect(html).toContain("auth-marketing-screenshot");
    expect(html).not.toContain('<img class="auth-marketing-screenshot"');
    expect(html).toContain("New to Slides?");
    expect(html).toContain('href="https://agent-native.com/apps/slides"');
    expect(html).toContain('class="auth-marketing-learn-more"');
    expect(onboardingHtml).toContain(
      "bottom: max(1rem, env(safe-area-inset-bottom));\n    inset-inline-end: max(1rem, env(safe-area-inset-right));",
    );
    expect(html).toContain('class="split');
    expect(html).toContain('class="marketing-panel"');
    expect(html).toContain('class="form-panel');
    expect(html).toContain('id="heading"');
    expect(html).not.toContain('id="local-note"');
    expect(onboardingHtml).toContain("aspect-ratio: 914 / 818");
    expect(onboardingHtml).toContain("width: 100%");
    expect(onboardingHtml).toContain(
      "position: fixed;\n    inset: 0;\n    z-index: 0;",
    );
    expect(onboardingHtml).toContain("max-height: none;");
    expect(onboardingHtml).toContain("filter: none");
    expect(onboardingHtml).toContain("opacity: 0.15");
    expect(onboardingHtml).toContain("object-fit: cover");
    expect(onboardingHtml).toContain(
      "box-shadow: 0 12px 36px rgba(0,0,0,0.38)",
    );
    expect(onboardingHtml).toContain(
      "box-shadow: 0 18px 50px rgba(0,0,0,0.62)",
    );
    expect(onboardingHtml).toContain(
      "position: fixed;\n    inset: 0;\n    z-index: 1;\n    display: flex;\n    align-items: center;\n    justify-content: flex-start;",
    );
    expect(onboardingHtml).toContain(
      ".auth-marketing-home.has-product-screenshot .form-panel > .card {\n    margin-block: auto;\n  }",
    );
    expect(onboardingHtml).not.toContain(
      ".auth-marketing-home.has-product-screenshot .marketing-panel { display: none; }",
    );
    expect(onboardingHtml).toContain("border-radius: 0.75rem;");
    expect(onboardingHtml).toContain("@media (prefers-color-scheme: light)");
    expect(onboardingHtml).toContain(
      "background: color-mix(in srgb, CanvasText 4%, Canvas);",
    );
    expect(onboardingHtml).toContain("color-scheme: light;");
    expect(onboardingHtml).toContain(
      ".auth-marketing-home .card .verification-copy",
    );
  });

  it("places the learn-more link bottom-right for every app, with no per-app opt-in", () => {
    // Mail never configured a placement — bottom-right is the only layout, not a toggle.
    const props = propsFromHtml(
      getOnboardingHtml({ requestHost: "mail.agent-native.com" }),
    );
    const html = renderToString(<AuthPage {...props} />);

    expect(props.marketing).not.toHaveProperty("learnMorePlacement");
    expect(html).toContain('class="auth-marketing-learn-more"');
    expect(html).not.toContain("has-bottom-right-learn-more");
  });

  it.each([
    ["slides.agent-native.com", "914 / 818"],
    ["analytics.agent-native.com", "927 / 818"],
  ])("keeps the declared screenshot ratio for %s", (requestHost, ratio) => {
    const html = getOnboardingHtml({ requestHost });

    expect(html).toContain(`style="aspect-ratio:${ratio}"`);
    expect(html).toContain("auth-marketing-screenshot");
  });

  it("keeps the magic-link entry and completion surfaces in the React tree", () => {
    const props = propsFromHtml(getOnboardingHtml({ authMode: "magic-link" }));
    const html = renderToString(<AuthPage {...props} />);

    expect(props.initialView).toBe("magicLink");
    expect(html).toContain('id="magic-link-form"');
    expect(html).toContain('id="magic-link-success"');
    expect(html).toContain('id="magic-link-success-email"');
    expect(html).toContain('id="use-password-link"');
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
