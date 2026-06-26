import { afterEach, describe, expect, it, vi } from "vitest";

import { sendEmail } from "./email";

describe("sendEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("maps inline CID attachments for SendGrid", async () => {
    vi.stubEnv("SENDGRID_API_KEY", "sendgrid-example-key");
    vi.stubEnv("EMAIL_FROM", "Agent Native <reports@example.com>");
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({
      to: "reader@example.com",
      subject: "Dashboard",
      html: '<img src="cid:dashboard_png" />',
      attachments: [
        {
          filename: "dashboard.png",
          content: Buffer.from("png"),
          contentType: "image/png",
          contentId: "dashboard_png",
          disposition: "inline",
        },
      ],
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.attachments).toEqual([
      {
        filename: "dashboard.png",
        content: Buffer.from("png").toString("base64"),
        type: "image/png",
        disposition: "inline",
        content_id: "dashboard_png",
      },
    ]);
  });

  it("maps inline CID attachments for Resend", async () => {
    vi.stubEnv("RESEND_API_KEY", "resend-example-key");
    vi.stubEnv("EMAIL_FROM", "Agent Native <reports@example.com>");
    const fetchMock = vi.fn(async () => Response.json({ id: "email_123" }));
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({
      to: "reader@example.com",
      subject: "Dashboard",
      html: '<img src="cid:dashboard_png" />',
      attachments: [
        {
          filename: "dashboard.png",
          content: Buffer.from("png"),
          contentType: "image/png",
          contentId: "dashboard_png",
        },
      ],
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.attachments).toEqual([
      {
        filename: "dashboard.png",
        content: Buffer.from("png").toString("base64"),
        content_type: "image/png",
        content_id: "dashboard_png",
      },
    ]);
  });
});
