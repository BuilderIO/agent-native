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

  it("renders a dark secondary CTA and closing paragraphs", () => {
    const { html, text } = renderEmail({
      heading: 'Alice shared "Standup" with you',
      paragraphs: [],
      cta: { label: "Open Recording", url: "https://clips.example/r/rec-1" },
      secondaryCta: {
        label: "Summarize with AI",
        url: "https://clips.example/r/rec-1?panel=agent",
      },
      closingParagraphs: [
        `Reply to reach ${emailLink("alice@example.com", "mailto:alice@example.com")} directly.`,
      ],
    });

    expect(html).toMatch(/>\s*Open Recording\s*<\/a>/);
    expect(html).toMatch(/>\s*Summarize with AI\s*<\/a>/);
    expect(html.indexOf("Summarize with AI")).toBeGreaterThan(
      html.indexOf("Open Recording"),
    );
    expect(html).toContain("background:#141417; border:1px solid #3f3f46;");
    expect(html).toContain(">alice@example.com</a>");
    expect(text).toContain(
      "Summarize with AI: https://clips.example/r/rec-1?panel=agent",
    );
    expect(text).toContain("Reply to reach alice@example.com directly.");
  });

  it("renders a safe treated link block after the CTA", () => {
    const url = "https://clips.example/r/rec-1?view=agent&mode=summary";
    const { html, text } = renderEmail({
      heading: "Your Clip is ready",
      paragraphs: ["Open it below."],
      cta: { label: "Open Clip", url },
      linkBlock: {
        intro: "Or feed this link to your AI agent:",
        url,
        placement: "after-cta",
      },
    });

    expect(html).toContain(
      'href="https://clips.example/r/rec-1?view=agent&amp;mode=summary"',
    );
    expect(html).toContain(
      ">https://clips.example/r/rec-1?view=agent&amp;mode=summary</a>",
    );
    expect(html.indexOf("Or feed this link")).toBeGreaterThan(
      html.indexOf("Open Clip"),
    );
    expect(text).toContain(
      "Open Clip: https://clips.example/r/rec-1?view=agent&mode=summary\n\nOr feed this link to your AI agent:\nhttps://clips.example/r/rec-1?view=agent&mode=summary",
    );
  });
  it("turns the footer link token into an anchor and keeps its URL in text", () => {
    const { html, text } = renderEmail({
      heading: "New comment",
      paragraphs: ["Someone commented."],
      footer: "Notifications are on in your {link}.",
      footerLink: {
        label: "Clips settings",
        url: "https://clips.example/settings?tab=general",
      },
    });

    expect(html).toContain(
      '<a href="https://clips.example/settings?tab=general" style="color:#a1a1aa; text-decoration:underline;">Clips settings</a>',
    );
    expect(text).toContain(
      "Notifications are on in your Clips settings (https://clips.example/settings?tab=general).",
    );
  });

  it("leaves the token visible when no footer link was supplied", () => {
    const { html, text } = renderEmail({
      heading: "New comment",
      paragraphs: ["Someone commented."],
      footer: "Notifications are on in your {link}.",
    });

    expect(html).toContain("Notifications are on in your {link}.");
    expect(text).toContain("Notifications are on in your {link}.");
  });
});
