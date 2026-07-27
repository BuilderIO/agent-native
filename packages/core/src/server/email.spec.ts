import { afterEach, describe, expect, it, vi } from "vitest";

import { sendEmail } from "./email";

describe("sendEmail", () => {
  afterEach(() => {
    vi.useRealTimers();
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

  it("attaches the built-in brand logo when the HTML references it", async () => {
    vi.stubEnv("SENDGRID_API_KEY", "sendgrid-example-key");
    vi.stubEnv("EMAIL_FROM", "Agent Native <reports@example.com>");
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({
      to: "reader@example.com",
      subject: "Recording ready",
      html: '<img src="cid:agent-native-logo" alt="Clips" />',
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.attachments).toEqual([
      expect.objectContaining({
        filename: "agent-native-logo.png",
        type: "image/png",
        disposition: "inline",
        content_id: "agent-native-logo",
      }),
    ]);
    expect(body.attachments[0].content).toMatch(/^[A-Za-z0-9+/]+=*$/);
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

  it("aborts provider requests at the caller's delivery deadline", async () => {
    vi.useFakeTimers();
    vi.stubEnv("RESEND_API_KEY", "resend-example-key");
    vi.stubEnv("EMAIL_FROM", "Agent Native <reports@example.com>");
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            requestSignal = init?.signal ?? undefined;
            requestSignal?.addEventListener(
              "abort",
              () => reject(requestSignal?.reason),
              { once: true },
            );
          }),
      ),
    );

    const pending = expect(
      sendEmail({
        to: "reader@example.com",
        subject: "Dashboard",
        html: "<p>Report</p>",
        timeoutMs: 25,
      }),
    ).rejects.toThrow("Email send timed out after 25ms");
    await vi.advanceTimersByTimeAsync(25);

    await pending;
    expect(requestSignal?.aborted).toBe(true);
  });
});
