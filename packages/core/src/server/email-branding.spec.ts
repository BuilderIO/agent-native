import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  configureEmailBranding,
  resetEmailBranding,
} from "./email-branding.js";
import {
  listEmailRenderers,
  registerEmailRenderer,
  unregisterEmailRenderer,
} from "./email-renderer.js";
import { renderBuiltInEmail, renderEmail } from "./email-template.js";

function clearRenderers(): void {
  for (const renderer of listEmailRenderers()) {
    unregisterEmailRenderer(renderer.id);
  }
}

describe("configureEmailBranding", () => {
  beforeEach(() => {
    resetEmailBranding();
    clearRenderers();
  });
  afterEach(() => {
    resetEmailBranding();
    clearRenderers();
    vi.restoreAllMocks();
  });

  it("applies the configured logo and color when the caller passes none", () => {
    configureEmailBranding({
      logoUrl: "https://cdn.example.com/acme.png",
      color: "#4f46e5",
    });

    const { html } = renderEmail({
      heading: "Verify your email",
      paragraphs: ["Confirm your address."],
      cta: { label: "Verify", url: "https://app.example.com/verify" },
    });

    expect(html).toContain('src="https://cdn.example.com/acme.png"');
    expect(html).not.toContain("cid:agent-native-logo");
    expect(html).toContain("background:#4f46e5");
  });

  it("keeps the embedded logo when nothing is configured", () => {
    const { html } = renderEmail({
      heading: "Verify your email",
      paragraphs: ["Confirm your address."],
    });

    expect(html).toContain('src="cid:agent-native-logo"');
  });

  it("lets a per-call override win over the configured default", () => {
    configureEmailBranding({ logoUrl: "https://cdn.example.com/acme.png" });

    const { html } = renderEmail({
      brandLogoUrl: "https://cdn.example.com/tenant.png",
      heading: "Shared with you",
      paragraphs: ["Open it below."],
    });

    expect(html).toContain('src="https://cdn.example.com/tenant.png"');
  });

  it("falls back to the configured default, not the framework logo, when a per-call value is rejected", () => {
    configureEmailBranding({ logoUrl: "https://cdn.example.com/acme.png" });

    const { html } = renderEmail({
      brandLogoUrl: "/api/media/tenant.png",
      heading: "Shared with you",
      paragraphs: ["Open it below."],
    });

    expect(html).toContain('src="https://cdn.example.com/acme.png"');
    expect(html).not.toContain("cid:agent-native-logo");
  });

  it("throws at configuration time on a non-https logo", () => {
    expect(() =>
      configureEmailBranding({ logoUrl: "http://cdn.example.com/acme.png" }),
    ).toThrow(/absolute https/i);
  });

  it("throws at configuration time on a malformed color", () => {
    expect(() => configureEmailBranding({ color: "#fff" })).toThrow(
      /six-digit/i,
    );
  });

  it("leaves previous branding untouched when a new call throws", () => {
    configureEmailBranding({ logoUrl: "https://cdn.example.com/acme.png" });
    expect(() => configureEmailBranding({ color: "red" })).toThrow();

    const { html } = renderEmail({ heading: "Still branded", paragraphs: [] });
    expect(html).toContain('src="https://cdn.example.com/acme.png"');
  });
});

describe("registerEmailRenderer", () => {
  beforeEach(() => {
    resetEmailBranding();
    clearRenderers();
  });
  afterEach(() => {
    resetEmailBranding();
    clearRenderers();
    vi.restoreAllMocks();
  });

  it("replaces the built-in template entirely", () => {
    registerEmailRenderer({
      id: "acme",
      render: (args) => ({
        html: `<main>${args.heading}</main>`,
        text: args.heading,
      }),
    });

    const { html, text } = renderEmail({
      heading: "Reset your password",
      paragraphs: ["Ignored by this renderer."],
    });

    expect(html).toBe("<main>Reset your password</main>");
    expect(text).toBe("Reset your password");
    expect(html).not.toContain("cid:agent-native-logo");
  });

  it("lets a renderer wrap the built-in template without recursing", () => {
    registerEmailRenderer({
      id: "wrapper",
      render: (args) => {
        const base = renderBuiltInEmail(args);
        return { html: `<!--acme-->${base.html}`, text: base.text };
      },
    });

    const { html } = renderEmail({
      heading: "Wrapped",
      paragraphs: ["Body copy."],
    });

    expect(html.startsWith("<!--acme-->")).toBe(true);
    expect(html).toContain("Wrapped");
  });

  it("restores the built-in template after unregistering", () => {
    registerEmailRenderer({
      id: "acme",
      render: () => ({ html: "x", text: "x" }),
    });
    unregisterEmailRenderer("acme");

    const { html } = renderEmail({
      heading: "Back to default",
      paragraphs: [],
    });
    expect(html).toContain("cid:agent-native-logo");
  });

  it("throws rather than silently sending when a renderer returns the wrong shape", () => {
    registerEmailRenderer({
      id: "broken",
      render: () => ({ html: undefined }) as never,
    });

    expect(() => renderEmail({ heading: "Nope", paragraphs: [] })).toThrow(
      /must return/i,
    );
  });

  it("propagates a throwing renderer instead of falling back", () => {
    registerEmailRenderer({
      id: "explodes",
      render: () => {
        throw new Error("template blew up");
      },
    });

    expect(() => renderEmail({ heading: "Nope", paragraphs: [] })).toThrow(
      "template blew up",
    );
  });

  it("warns and uses the last registration when more than one is registered", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerEmailRenderer({
      id: "first",
      render: () => ({ html: "1", text: "1" }),
    });
    registerEmailRenderer({
      id: "second",
      render: () => ({ html: "2", text: "2" }),
    });

    expect(renderEmail({ heading: "x", paragraphs: [] }).html).toBe("2");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("first, second");
  });

  it("rejects a renderer without an id or render function", () => {
    expect(() =>
      registerEmailRenderer({
        render: () => ({ html: "", text: "" }),
      } as never),
    ).toThrow(/id is required/i);
    expect(() => registerEmailRenderer({ id: "bad" } as never)).toThrow(
      /must be a function/i,
    );
  });
});
