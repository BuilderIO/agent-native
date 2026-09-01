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
    const html = renderToString(
      <AuthPage
        {...propsFromHtml(
          getOnboardingHtml({ requestHost: "slides.agent-native.com" }),
        )}
      />,
    );

    expect(html).toContain('data-agent-native-marketing-home="true"');
    expect(html).toContain('class="auth-marketing-screenshot"');
    expect(html).toContain("/auth-marketing/slides.webp");
    expect(html).toContain('href="https://agent-native.com/apps/slides"');
    expect(html).toContain("New to Slides?");
    expect(html).not.toContain('data-agent-native-starfield="true"');
    expect(html).toContain('class="split');
    expect(html).toContain('class="marketing-panel"');
    expect(html).toContain('class="form-panel');
    expect(html).toMatch(
      /class="auth-marketing-top-right">\s*<a[^>]+class="auth-marketing-learn-more"/,
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
