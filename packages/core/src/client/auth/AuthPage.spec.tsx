import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getOnboardingHtml } from "../../server/onboarding-html.js";
import {
  AuthPage,
  oauthReturnTarget,
  resolveGoogleAuthUrlPath,
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
  it("renders the password auth surface on the server without browser globals", () => {
    const html = renderToString(
      <AuthPage {...propsFromHtml(getOnboardingHtml())} />,
    );

    expect(html).toContain('id="signup-form"');
    expect(html).toContain('id="login-form"');
    expect(html).toContain('id="forgot-form"');
    expect(html).not.toContain("onclick");
  });

  it("composes the shared marketing home and product screenshot for branded auth", () => {
    const onboardingHtml = getOnboardingHtml({
      requestHost: "slides.agent-native.com",
    });
    const props = propsFromHtml(onboardingHtml);
    const html = renderToString(<AuthPage {...props} />);

    expect(props.marketing?.learnMorePlacement).toBe("bottom-right");
    expect(html).toContain('data-agent-native-marketing-home="true"');
    expect(html).toContain('class="auth-marketing-screenshot"');
    expect(html).toContain("/auth-marketing/slides.webp");
    expect(html).toContain("New to Slides?");
    expect(html).toContain('href="https://agent-native.com/apps/slides"');
    expect(html).toContain('class="auth-marketing-learn-more"');
    expect(html).toContain("has-bottom-right-learn-more");
    expect(html).not.toContain('data-agent-native-starfield="true"');
    expect(html).toContain('class="split');
    expect(html).toContain('class="marketing-panel"');
    expect(html).toContain('class="form-panel');
    expect(html).toContain('id="heading"');
    expect(html).not.toContain('id="local-note"');
    expect(onboardingHtml).toContain("aspect-ratio: 914 / 818");
    expect(onboardingHtml).toContain("width: 100%");
    expect(onboardingHtml).toContain("filter: blur(0.3px)");
    expect(onboardingHtml).toContain("opacity: 0.8");
    expect(onboardingHtml).toContain(
      "box-shadow: 0 18px 50px rgba(0,0,0,0.62)",
    );
    expect(onboardingHtml).toContain("flex: 1 1 0;");
    expect(onboardingHtml).toContain("flex: 0 0 28rem;");
    expect(onboardingHtml).toContain("margin-inline: 0;");
    expect(onboardingHtml).toContain("border-radius: 0.75rem;");
    expect(onboardingHtml).toContain("@media (prefers-color-scheme: light)");
    expect(onboardingHtml).toContain(
      "background: color-mix(in srgb, CanvasText 4%, Canvas);",
    );
    expect(onboardingHtml).toContain("color-scheme: light;");
    expect(onboardingHtml).toContain(
      "@media (min-width: 901px) and (max-width: 1500px)",
    );
    expect(onboardingHtml).toContain("left: -140px");
    expect(onboardingHtml).toContain(
      "grid-template-columns: minmax(0, 927px) minmax(0, 1fr);",
    );
  });

  it("places Calendar's learn-more link in the bottom-right corner", () => {
    const props = propsFromHtml(
      getOnboardingHtml({ requestHost: "calendar.agent-native.com" }),
    );
    const html = renderToString(<AuthPage {...props} />);

    expect(props.marketing?.learnMorePlacement).toBe("bottom-right");
    expect(html).toContain("has-bottom-right-learn-more");
  });

  it.each([
    ["slides.agent-native.com", "914 / 818"],
    ["analytics.agent-native.com", "927 / 818"],
  ])("keeps the declared screenshot ratio for %s", (requestHost, ratio) => {
    const html = getOnboardingHtml({ requestHost });

    expect(html).toContain(`style="aspect-ratio:${ratio}"`);
    expect(html).toContain('class="auth-marketing-screenshot"');
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
