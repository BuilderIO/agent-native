// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import {
  sanitizeHtml,
  stripGcalInviteHtml,
  isHtml,
} from "./sanitize-description";

describe("sanitizeHtml", () => {
  it("preserves allowed tags", () => {
    expect(sanitizeHtml("<p>hello</p>")).toBe("<p>hello</p>");
    expect(sanitizeHtml("<b>bold</b>")).toBe("<b>bold</b>");
    expect(sanitizeHtml('<a href="https://x.com">link</a>')).toBe(
      '<a href="https://x.com" target="_blank" rel="noopener noreferrer">link</a>',
    );
  });

  it("strips disallowed tags but keeps content", () => {
    expect(sanitizeHtml("<script>alert(1)</script>safe")).toBe("safe");
    expect(sanitizeHtml("<style>.x{}</style>safe")).toBe("safe");
    expect(sanitizeHtml("<custom>text</custom>")).toBe("text");
  });

  it("strips disallowed attributes", () => {
    expect(sanitizeHtml('<p dir="ltr">text</p>')).toBe("<p>text</p>");
    expect(sanitizeHtml('<p style="color:red">text</p>')).toBe("<p>text</p>");
  });

  it("blocks unsafe href values", () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe(
      '<a target="_blank" rel="noopener noreferrer">x</a>',
    );
    expect(sanitizeHtml('<a href="//evil.test">x</a>')).toBe(
      '<a target="_blank" rel="noopener noreferrer">x</a>',
    );
  });

  it("handles self-closing tags", () => {
    // DOMParser serializes void elements without self-closing slash
    expect(sanitizeHtml("<br>")).toMatch(/^<br\s?\/?>$/);
    expect(sanitizeHtml("<br/>")).toMatch(/^<br\s?\/?>$/);
    expect(sanitizeHtml("<hr>")).toMatch(/^<hr\s?\/?>$/);
  });

  it("strips html-blob wrapper but keeps inner content", () => {
    const input = "<html-blob><p>hello</p></html-blob>";
    const result = sanitizeHtml(input);
    expect(result).toBe("<p>hello</p>");
    expect(result).not.toContain("html-blob");
  });
});

describe("stripGcalInviteHtml", () => {
  it("does not strip user content", () => {
    const html =
      '<p>LinkedIn: <a href="https://linkedin.com/in/foo">link</a><br />Ph#: 555-1234</p>';
    expect(stripGcalInviteHtml(html)).toContain("LinkedIn:");
    expect(stripGcalInviteHtml(html)).toContain("555-1234");
  });

  it("preserves opening <p> tag (no p> leak)", () => {
    const html = "<p>Hello world</p>";
    const result = stripGcalInviteHtml(html);
    expect(result).toBe("<p>Hello world</p>");
    expect(result).not.toMatch(/^p>/);
  });

  it("preserves closing </p> tag at end", () => {
    const html = "<p>Hello</p>";
    const result = stripGcalInviteHtml(html);
    expect(result.endsWith("</p>")).toBe(true);
  });

  it("preserves content after <hr> separators", () => {
    const html = "<p>Before</p><hr /><p>After the separator</p>";
    const result = stripGcalInviteHtml(html);
    expect(result).toContain("Before");
    expect(result).toContain("After the separator");
  });

  it("trims leading <br> tags without eating <p> tags", () => {
    const html = "<br /><br /><p>Content</p>";
    const result = stripGcalInviteHtml(html);
    expect(result).toBe("<p>Content</p>");
  });

  it("trims trailing <br> tags without eating </p> tags", () => {
    const html = "<p>Content</p><br /><br />";
    const result = stripGcalInviteHtml(html);
    expect(result).toBe("<p>Content</p>");
  });

  it("strips Reply for / Yes/No/Maybe buttons", () => {
    const html =
      "<p>Description</p><table><tr><td>Reply for test@test.com Yes No Maybe</td></tr></table>";
    const result = stripGcalInviteHtml(html);
    expect(result).toContain("Description");
    expect(result).not.toContain("Reply for");
  });

  it("strips Invitation from Google Calendar footer", () => {
    const html =
      '<p>Event info</p>Invitation from <a href="https://calendar.google.com">Google Calendar</a>';
    const result = stripGcalInviteHtml(html);
    expect(result).toContain("Event info");
    expect(result).not.toContain("Invitation from");
  });

  it("handles full Google Calendar Zoom description", () => {
    const sanitized =
      '<p>LinkedIn: <a href="https://www.linkedin.com/in/ramansharma/" target="_blank" rel="noopener noreferrer">https://www.linkedin.com/in/ramansharma/</a><br />Ph#: 425-647-6517</p><p><u></u></p><hr /><p><br /></p><p>Deja Flakes is inviting you to a scheduled Zoom meeting.<br />Join Zoom Meeting<br /><a href="https://trueplatform.zoom.us/j/85250575399?pwd=aNo2RedvUQmOmOgraMF3QRWhrL0tlF.1" target="_blank" rel="noopener noreferrer">https://trueplatform.zoom.us/j/85250575399?pwd=aNo2RedvUQmOmOgraMF3QRWhrL0tlF.1</a></p><p>Meeting ID: 852 5057 5399<br />Passcode: 494196</p><p><u></u></p><hr /><p><br /></p><p>One tap mobile<br />+12063379723,,85250575399# US (Seattle)</p><p>Join instructions<br /><a href="https://trueplatform.zoom.us/meetings/85250575399/invitations?" target="_blank" rel="noopener noreferrer">https://trueplatform.zoom.us/meetings/85250575399/invitations?</a></p>';

    const result = stripGcalInviteHtml(sanitized);

    // Must not start with "p>" (broken tag)
    expect(result).not.toMatch(/^p>/);
    // Must start with a proper tag
    expect(result).toMatch(/^<[a-z]/);

    // Must preserve key content
    expect(result).toContain("LinkedIn:");
    expect(result).toContain("425-647-6517");
    expect(result).toContain("Zoom meeting");
    expect(result).toContain("Meeting ID:");
    expect(result).toContain("Passcode: 494196");
    expect(result).toContain("One tap mobile");
  });
});

describe("isHtml", () => {
  it("detects HTML", () => {
    expect(isHtml("<p>hello</p>")).toBe(true);
    expect(isHtml("<br>")).toBe(true);
  });

  it("rejects plain text", () => {
    expect(isHtml("just text")).toBe(false);
    expect(isHtml("a < b > c")).toBe(false);
  });
});
