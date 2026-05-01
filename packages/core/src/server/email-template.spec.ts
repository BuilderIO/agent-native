import { describe, expect, it } from "vitest";
import { emailLink, renderEmail } from "./email-template.js";

describe("renderEmail", () => {
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
