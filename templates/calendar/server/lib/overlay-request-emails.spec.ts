import { describe, expect, it } from "vitest";

import { renderOverlayRequestEmail } from "./overlay-request-emails";

const APP_LINK = "https://example.com/_agent-native/open?app=calendar";

describe("renderOverlayRequestEmail", () => {
  it("escapes a malicious requester name before it reaches the HTML", () => {
    const rendered = renderOverlayRequestEmail({
      requesterName: '<img src=x onerror="alert(1)">',
      requesterEmail: "dana.hill@example.com",
      appLink: APP_LINK,
    });

    expect(rendered.html).not.toContain("<img src=x");
    expect(rendered.html).toContain("&lt;img");
    expect(rendered.html).not.toContain('onerror="');
    expect(rendered.html).toContain("onerror=&quot;");
  });

  it("strips CRLF from the requester name so it cannot inject a header", () => {
    const rendered = renderOverlayRequestEmail({
      requesterName: "Dana\r\nBcc: victim@example.com",
      requesterEmail: "dana.hill@example.com",
      appLink: APP_LINK,
    });

    expect(rendered.subject).not.toMatch(/[\r\n]/);
    expect(rendered.subject).toContain("Dana Bcc: victim@example.com");
  });

  it("includes the name, CTA link, and the working-hours ask", () => {
    const rendered = renderOverlayRequestEmail({
      requesterName: "Dana Hill",
      requesterEmail: "dana.hill@example.com",
      appLink: APP_LINK,
    });

    expect(rendered.subject).toContain("Dana Hill");
    expect(rendered.html).toContain("Dana Hill");
    expect(rendered.html).toContain(APP_LINK);
    expect(rendered.html).toContain("working hours");
  });

  it("falls back to the requester email when no name is provided", () => {
    const rendered = renderOverlayRequestEmail({
      requesterEmail: "dana.hill@example.com",
      appLink: APP_LINK,
    });

    expect(rendered.subject).toContain("dana.hill@example.com");
    expect(rendered.html).toContain("dana.hill@example.com");
  });
});
