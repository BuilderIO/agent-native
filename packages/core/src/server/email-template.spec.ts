import { describe, expect, it } from "vitest";

import { emailLink, renderEmail } from "./email-template.js";

describe("renderEmail", () => {
  it("uses a CID-backed brand header with a text fallback", () => {
    const { html } = renderEmail({
      brandName: "Clips",
      heading: "Your recording is ready",
      paragraphs: ["Open your recording below."],
    });

    expect(html).toContain('src="cid:agent-native-logo"');
    expect(html).toContain('alt="Clips"');
    expect(html).toContain(">Clips</span>");
  });

  it("uses an org logo when a valid https URL is provided", () => {
    const { html } = renderEmail({
      brandName: "Clips",
      brandLogoUrl: "https://cdn.example.com/org-logo.png",
      heading: "You've been given access",
      paragraphs: ["Open your recording below."],
    });

    expect(html).toContain('src="https://cdn.example.com/org-logo.png"');
    expect(html).not.toContain('src="cid:agent-native-logo"');
  });

  it("falls back to the embedded logo for non-https or relative logo URLs", () => {
    const { html } = renderEmail({
      brandName: "Clips",
      brandLogoUrl: "/api/media/org-logo.png",
      heading: "You've been given access",
      paragraphs: ["Open your recording below."],
    });

    expect(html).toContain('src="cid:agent-native-logo"');
  });

  it("injects trusted heroHtml above the CTA", () => {
    const marker = '<div id="custom-hero">preview</div>';
    const { html } = renderEmail({
      heading: "Access granted",
      paragraphs: ["Watch the recording below."],
      heroHtml: marker,
      cta: { label: "Open", url: "https://clips.example.com/r/abc" },
    });

    expect(html).toContain(marker);
    expect(html.indexOf(marker)).toBeLessThan(
      html.indexOf("https://clips.example.com/r/abc"),
    );
  });

  it("omits the hero when no heroHtml is provided", () => {
    const { html } = renderEmail({
      heading: "Access granted",
      paragraphs: ["No preview here."],
    });

    expect(html).not.toContain("custom-hero");
  });

  it("renders CTA buttons without visible fallback URLs", () => {
    const { html } = renderEmail({
      heading: "Your meeting is booked",
      paragraphs: [
        `Meeting link: ${emailLink(
          "Join meeting",
          "https://builder-io.zoom.us/j/123?pwd=secret",
        )}.`,
      ],
      cta: {
        label: "Manage booking",
        url: "http://localhost:8082/booking/manage/token",
      },
    });

    expect(html).toContain(">Join meeting</a>");
    expect(html).toMatch(/>\s*Manage booking\s*<\/a>/);
    expect(html).not.toContain("Or paste this link into your browser");
    expect(html).not.toMatch(/>https?:\/\//);
  });
});
