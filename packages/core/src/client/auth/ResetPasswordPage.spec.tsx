import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getResetPasswordHtml } from "../../server/onboarding-html.js";
import {
  ResetPasswordPage,
  type ResetPasswordPageProps,
} from "./ResetPasswordPage.js";

function propsFromHtml(html: string): ResetPasswordPageProps {
  const match = html.match(
    /<script type="application\/json" id="agent-native-auth-data">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("reset page data is missing");
  return JSON.parse(match[1]!) as ResetPasswordPageProps;
}

describe("ResetPasswordPage", () => {
  it("renders the password reset surface as React without inline handlers", () => {
    const html = renderToString(
      <ResetPasswordPage {...propsFromHtml(getResetPasswordHtml())} />,
    );

    expect(html).toContain('id="reset-form"');
    expect(html).toContain('id="p1"');
    expect(html).toContain('id="p2"');
    expect(html).toContain('id="back-link"');
    expect(html).not.toContain("onclick");
  });
});
