import { describe, expect, it } from "vitest";

import {
  bodyToHtml,
  buildRawEmail,
  encodeAddressHeader,
  encodeMimeHeaderValue,
  resolveComposeAttachments,
} from "./outgoing-email.js";

/** Decode a URL-safe base64 raw message to a string for header inspection. */
function decodeRaw(raw: string): string {
  const standard = raw.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(standard, "base64").toString("utf8");
}

describe("encodeMimeHeaderValue", () => {
  it("leaves pure-ASCII headers unchanged", () => {
    expect(encodeMimeHeaderValue("Just plain ASCII text")).toBe(
      "Just plain ASCII text",
    );
  });

  it("RFC 2047 base64-encodes em-dash subjects so they don't arrive as mojibake", () => {
    const subject = "Offsite — What Are You Most Looking Forward To?";
    const encoded = encodeMimeHeaderValue(subject);
    expect(encoded).toBe(
      "=?UTF-8?B?T2Zmc2l0ZSDigJQgV2hhdCBBcmUgWW91IE1vc3QgTG9va2luZyBGb3J3YXJkIFRvPw==?=",
    );
    const m = encoded.match(/^=\?UTF-8\?B\?(.+)\?=$/);
    expect(m).not.toBeNull();
    expect(Buffer.from(m![1], "base64").toString("utf8")).toBe(subject);
  });

  it("encodes accented characters and smart quotes", () => {
    expect(encodeMimeHeaderValue("Café — “quoted”")).toMatch(
      /^=\?UTF-8\?B\?.+\?=$/,
    );
  });
});

describe("encodeAddressHeader", () => {
  it("leaves bare ASCII emails unchanged", () => {
    expect(encodeAddressHeader("alice@example.com")).toBe("alice@example.com");
  });

  it("leaves ASCII display names unchanged", () => {
    expect(encodeAddressHeader("Alice <alice@example.com>")).toBe(
      "Alice <alice@example.com>",
    );
  });

  it("encodes only the display-name portion when it contains non-ASCII", () => {
    const result = encodeAddressHeader("Étienne <e@example.com>");
    expect(result).toBe("=?UTF-8?B?w4l0aWVubmU=?= <e@example.com>");
  });

  it("handles a list of addresses", () => {
    const result = encodeAddressHeader("Alice <a@x.com>, Bob <b@y.com>");
    expect(result).toBe("Alice <a@x.com>, Bob <b@y.com>");
  });
});

describe("buildRawEmail — CRLF header injection", () => {
  // Confirms that agent- or upstream-controlled strings containing \r\n cannot
  // inject extra RFC 2822 header lines into the outgoing message.  The CRLF is
  // collapsed to a space (still appears inline in the header value) but no
  // standalone header line is injected — checked by asserting the decoded
  // output contains no bare \r\nBcc: or \nBcc: separator.

  const base = {
    from: "sender@example.com",
    to: "recipient@example.com",
    subject: "Hello",
    body: "Test body",
  };

  it("strips CRLF in the To header so no standalone Bcc line is injected", () => {
    const raw = buildRawEmail({
      ...base,
      to: "legit@example.com\r\nBcc: attacker@evil.com",
    });
    const decoded = decodeRaw(raw);
    // The CRLF is collapsed, so the injected text appears inline in the To
    // value rather than as a separate header line.
    expect(decoded).not.toMatch(/\r\nBcc:\s/);
    expect(decoded).toMatch(/^To: /m);
  });

  it("strips CRLF in the Subject header so no standalone Bcc line is injected", () => {
    const raw = buildRawEmail({
      ...base,
      subject: "Normal\r\nBcc: attacker@evil.com",
    });
    const decoded = decodeRaw(raw);
    expect(decoded).not.toMatch(/\r\nBcc:\s/);
  });

  it("strips CRLF in the In-Reply-To header so no standalone Bcc line is injected", () => {
    const raw = buildRawEmail({
      ...base,
      inReplyTo: "<msg-id@example.com>\r\nBcc: attacker@evil.com",
    });
    const decoded = decodeRaw(raw);
    expect(decoded).not.toMatch(/\r\nBcc:\s/);
  });

  it("strips CRLF in the References header so no standalone Bcc line is injected", () => {
    const raw = buildRawEmail({
      ...base,
      references: "<ref@example.com>\r\nBcc: attacker@evil.com",
    });
    const decoded = decodeRaw(raw);
    expect(decoded).not.toMatch(/\r\nBcc:\s/);
  });

  it("strips LF-only injection attempts", () => {
    const raw = buildRawEmail({
      ...base,
      to: "legit@example.com\nBcc: attacker@evil.com",
    });
    const decoded = decodeRaw(raw);
    expect(decoded).not.toMatch(/\r\nBcc:\s/);
    expect(decoded).not.toMatch(/\nBcc:\s/);
  });
});

describe("bodyToHtml", () => {
  it("renders angle-bracket pasted URLs without leaking escaped delimiters", () => {
    const url = "https://calendar.agent-native.com/book/steve/meeting";
    const html = bodyToHtml(`Can we Zoom this week? <${url}>`);

    expect(html).toContain(`href="${url}"`);
    expect(html).toContain(`>${url}</a>`);
    expect(html).not.toContain("&lt;");
    expect(html).not.toContain("&gt;");
  });

  it("does not double-escape ampersands in markdown link URLs", () => {
    const html = bodyToHtml(
      "Here is [my calendar](https://example.com/book?a=1&b=2).",
    );

    // marked emits the href with a raw & (valid HTML5); accept either form but
    // never a double-escaped &amp;amp;
    expect(html).toMatch(
      /href="https:\/\/example\.com\/book\?a=1(&amp;|&)b=2"/,
    );
    expect(html).not.toContain("&amp;amp;");
  });

  it("renders tables (GFM) that the hand-rolled converter couldn't handle", () => {
    const md = `| Name | Score |\n| ---- | ----- |\n| Alice | 90 |\n| Bob | 85 |`;
    const html = bodyToHtml(md);
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("Alice");
    expect(html).toContain("Bob");
  });

  it("renders nested lists", () => {
    const md = `- Top\n  - Nested\n    - Deep`;
    const html = bodyToHtml(md);
    // marked produces nested <ul> elements for nested lists
    expect(html.match(/<ul/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(html).toContain("Top");
    expect(html).toContain("Nested");
  });
});

describe("buildRawEmail — attachments", () => {
  it("produces a multipart/mixed message when attachments are provided", () => {
    const raw = buildRawEmail({
      from: "sender@example.com",
      to: "recipient@example.com",
      subject: "With attachment",
      body: "See attached.",
      attachments: [
        {
          id: "test-id",
          filename: "report.pdf",
          originalName: "Q2-Report.pdf",
          mimeType: "application/pdf",
          size: 5,
          url: "/api/media/report.pdf",
          data: Buffer.from("hello"),
        },
      ],
    });
    const decoded = decodeRaw(raw);
    expect(decoded).toContain("multipart/mixed");
    expect(decoded).toContain("multipart/alternative");
    expect(decoded).toContain("Content-Disposition: attachment");
    expect(decoded).toContain('filename="Q2-Report.pdf"');
    expect(decoded).toContain("Content-Transfer-Encoding: base64");
    // base64 of "hello"
    expect(decoded).toContain(Buffer.from("hello").toString("base64"));
  });

  it("produces a plain multipart/alternative message when there are no attachments", () => {
    const raw = buildRawEmail({
      from: "sender@example.com",
      to: "recipient@example.com",
      subject: "No attachment",
      body: "Just text.",
    });
    const decoded = decodeRaw(raw);
    expect(decoded).not.toContain("multipart/mixed");
    expect(decoded).toContain("multipart/alternative");
  });

  it("resolveComposeAttachments returns empty array for non-array input", async () => {
    expect(await resolveComposeAttachments(null)).toEqual([]);
    expect(await resolveComposeAttachments(undefined)).toEqual([]);
    expect(await resolveComposeAttachments("not an array")).toEqual([]);
  });

  it("resolveComposeAttachments skips entries without a filename", async () => {
    expect(await resolveComposeAttachments([{ id: "x" }])).toEqual([]);
  });

  it("resolveComposeAttachments skips path-traversal filenames", async () => {
    // Should throw or skip — both paths (throw or skip) mean 0 resolved.
    // The function skips entries with '/' or '..' in the filename check.
    expect(
      await resolveComposeAttachments([{ filename: "../etc/passwd" }]),
    ).toEqual([]);
    expect(
      await resolveComposeAttachments([{ filename: "sub/file.pdf" }]),
    ).toEqual([]);
  });

  it("resolveComposeAttachments can hydrate Gmail-backed draft attachments", async () => {
    const resolved = await resolveComposeAttachments(
      [
        {
          id: "att-1",
          filename: "invoice.pdf",
          originalName: "invoice.pdf",
          mimeType: "application/pdf",
          size: 5,
          url: "/api/attachments?messageId=msg-1&id=att-1",
          source: "gmail",
          gmailMessageId: "msg-1",
          gmailAttachmentId: "att-1",
          accountEmail: "sender@example.com",
        },
      ],
      "owner@example.com",
      {
        readGmailAttachment: async (attachment) => {
          expect(attachment.gmailMessageId).toBe("msg-1");
          expect(attachment.gmailAttachmentId).toBe("att-1");
          expect(attachment.accountEmail).toBe("sender@example.com");
          return Buffer.from("hello");
        },
      },
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      filename: "invoice.pdf",
      originalName: "invoice.pdf",
      mimeType: "application/pdf",
      source: "gmail",
      gmailMessageId: "msg-1",
      gmailAttachmentId: "att-1",
      accountEmail: "sender@example.com",
    });
    expect(resolved[0].data.toString("utf8")).toBe("hello");
  });
});
