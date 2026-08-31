import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarketingHome } from "./MarketingHome.js";
import { Starfield } from "./Starfield.js";

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
    expect(html).toContain("max-w-7xl");
    expect(html).toContain("py-16");
    expect(html).not.toContain("max-w-6xl");
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

  it("provides an opt-in auth composition without changing the default shell", () => {
    const html = renderToStaticMarkup(
      <MarketingHome
        appName="Example"
        variant="auth"
        background={<Starfield id="auth-starfield" />}
        auth={<div>Sign in form</div>}
      >
        <div>Marketing copy</div>
      </MarketingHome>,
    );

    expect(html).toContain("Marketing copy");
    expect(html).toContain("Sign in form");
    expect(html).toContain('id="auth-starfield"');
    expect(html).toContain("max-w-6xl");
    expect(html).toContain("max-w-md");
  });

  it("renders the starfield canvas without browser APIs during SSR", () => {
    const html = renderToStaticMarkup(<Starfield />);

    expect(html).toContain('<canvas id="starfield"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-agent-native-starfield="true"');
  });
});
