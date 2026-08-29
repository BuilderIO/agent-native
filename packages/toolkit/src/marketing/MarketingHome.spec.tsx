import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarketingHome } from "./MarketingHome.js";

describe("MarketingHome", () => {
  it("renders the default marketing shell and action links on the server", () => {
    const html = renderToStaticMarkup(
      <MarketingHome
        appName="Example"
        tagline="Build something useful"
        description="A public description"
        valueProps={[{ title: "Reusable", description: "By default" }]}
        primaryActionHref="/home"
        secondaryActionHref="/sign-in"
      />,
    );

    expect(html).toContain('data-agent-native-marketing-home="true"');
    expect(html).toContain("Build something useful");
    expect(html).toContain('href="/home"');
    expect(html).toContain("Open Example");
    expect(html).toContain('href="/sign-in"');
    expect(html).toContain("Sign in");
    expect(html).toContain("Reusable");
  });

  it("allows a route to replace the hero while retaining the public shell", () => {
    const html = renderToStaticMarkup(
      <MarketingHome appName="Example" background={<canvas />}>
        <div>Custom hero</div>
      </MarketingHome>,
    );

    expect(html).toContain("Custom hero");
    expect(html).not.toContain("Example</p>");
    expect(html).toContain("<canvas");
  });
});
