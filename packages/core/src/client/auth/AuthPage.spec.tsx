import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getOnboardingHtml } from "../../server/onboarding-html.js";
import { AuthPage, type AuthPageProps } from "./AuthPage.js";

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

  it("composes the shared marketing home and starfield for branded auth", () => {
    const html = renderToString(
      <AuthPage
        {...propsFromHtml(
          getOnboardingHtml({ requestHost: "slides.agent-native.com" }),
        )}
      />,
    );

    expect(html).toContain('data-agent-native-marketing-home="true"');
    expect(html).toContain('data-agent-native-starfield="true"');
    expect(html).toContain('class="split');
    expect(html).toContain('class="marketing-panel"');
    expect(html).toContain('class="form-panel');
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
});
