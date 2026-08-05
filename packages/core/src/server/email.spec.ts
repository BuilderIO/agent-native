import { afterEach, describe, expect, it, vi } from "vitest";

import { getEmailReadiness, sendEmail } from "./email";

describe("sendEmail", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("overrides only the verified sender display name and maps Reply-To", async () => {
    vi.stubEnv("SENDGRID_API_KEY", "sendgrid-example-key");
    vi.stubEnv("EMAIL_FROM", "Agent Native <reports@example.com>");
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({
      to: "reader@example.com",
      subject: "A Clip was shared",
      html: "<p>Open it below.</p>",
      fromName: "Alex Doe (via Agent-Native Clips)",
      replyTo: "alex@example.com",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.from).toEqual({
      email: "reports@example.com",
      name: "Alex Doe (via Agent-Native Clips)",
    });
    expect(body.reply_to).toEqual({ email: "alex@example.com" });
  });

  it("applies per-app sender branding on agent-native.com deployments", async () => {
    vi.stubEnv("SENDGRID_API_KEY", "sendgrid-example-key");
    vi.stubEnv("EMAIL_FROM", "Agent Native <noreply@agent-native.com>");
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({
      to: "reader@example.com",
      subject: "Verify your email",
      html: "<p>hi</p>",
      appSender: {
        name: "Agent-Native Clips",
        slug: "clips",
        replyTo: "agent-native@builder.io",
      },
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.from).toEqual({
      name: "Agent-Native Clips",
      email: "clips@agent-native.com",
    });
    expect(body.reply_to).toEqual({ email: "agent-native@builder.io" });
  });

  it("keeps the branded address intact when APP_NAME contains header specials", async () => {
    vi.stubEnv("SENDGRID_API_KEY", "sendgrid-example-key");
    vi.stubEnv("EMAIL_FROM", "Agent Native <noreply@agent-native.com>");
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({
      to: "reader@example.com",
      subject: "Verify your email",
      html: "<p>hi</p>",
      appSender: {
        name: "Agent-Native Acme <Support>, Inc.",
        slug: "clips",
        replyTo: "agent-native@builder.io",
      },
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.from).toEqual({
      name: "Agent-Native Acme Support , Inc.",
      email: "clips@agent-native.com",
    });
  });

  it("keeps a self-hosted verified sender and reply-to untouched", async () => {
    vi.stubEnv("SENDGRID_API_KEY", "sendgrid-example-key");
    vi.stubEnv("EMAIL_FROM", "Acme <noreply@acme.com>");
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({
      to: "reader@example.com",
      subject: "Verify your email",
      html: "<p>hi</p>",
      appSender: {
        name: "Agent-Native Clips",
        slug: "clips",
        replyTo: "agent-native@builder.io",
      },
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.from).toEqual({ name: "Acme", email: "noreply@acme.com" });
    expect(body.reply_to).toBeUndefined();
  });

  it("warns once without leaking the tenant sender into logs", async () => {
    // Fresh module: the suppression notice is process-scoped by design.
    vi.resetModules();
    const { sendEmail: freshSendEmail } = await import("./email");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SENDGRID_API_KEY", "sendgrid-example-key");

    const send = async () =>
      freshSendEmail({
        to: "reader@example.com",
        subject: "Verify your email",
        html: "<p>hi</p>",
        appSender: { name: "Agent-Native Clips", slug: "clips" },
      });

    vi.stubEnv("EMAIL_FROM", "Tenant <ceo@tenant-one.example>");
    await send();
    vi.stubEnv("EMAIL_FROM", "Other <owner@tenant-two.example>");
    await send();

    expect(warn).toHaveBeenCalledTimes(1);
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(logged).not.toContain("tenant-one.example");
    expect(logged).not.toContain("tenant-two.example");
    expect(logged).toContain("agent-native.com");

    warn.mockRestore();
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

  it("applies fromName as a display name over the verified address", async () => {
    vi.stubEnv("RESEND_API_KEY", "resend-example-key");
    vi.stubEnv("EMAIL_FROM", "Clips <notifications@example.com>");
    const fetchMock = vi.fn(async () => Response.json({ id: "email_123" }));
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({
      to: "reader@example.com",
      subject: "Shared",
      html: "<p>Shared</p>",
      fromName: "alice@builder.io via Clips",
      replyTo: "alice@builder.io",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.from).toBe(
      '"alice@builder.io via Clips" <notifications@example.com>',
    );
    expect(body.reply_to).toBe("alice@builder.io");
  });

  it("strips header-injection characters from fromName", async () => {
    vi.stubEnv("RESEND_API_KEY", "resend-example-key");
    vi.stubEnv("EMAIL_FROM", "Clips <notifications@example.com>");
    const fetchMock = vi.fn(async () => Response.json({ id: "email_123" }));
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({
      to: "reader@example.com",
      subject: "Shared",
      html: "<p>Shared</p>",
      fromName: 'Evil"\r\nBcc: victim@example.com',
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.from).toBe(
      '"Evil Bcc: victim@example.com" <notifications@example.com>',
    );
    expect(body.from).not.toContain("\n");
  });

  it("carries branded sender and reply-to through the Resend payload", async () => {
    vi.stubEnv("RESEND_API_KEY", "resend-example-key");
    vi.stubEnv("EMAIL_FROM", "Agent Native <noreply@agent-native.com>");
    const fetchMock = vi.fn(async () => Response.json({ id: "email_123" }));
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({
      to: "reader@example.com",
      subject: "Verify your email",
      html: "<p>hi</p>",
      appSender: {
        name: "Agent-Native Clips",
        slug: "clips",
        replyTo: "agent-native@builder.io",
      },
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.from).toBe('"Agent-Native Clips" <clips@agent-native.com>');
    expect(body.reply_to).toBe("agent-native@builder.io");
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

  it("sends fromName as an unquoted display name to SendGrid", async () => {
    vi.stubEnv("SENDGRID_API_KEY", "sendgrid-example-key");
    vi.stubEnv("EMAIL_FROM", "Clips <notifications@example.com>");
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({
      to: "reader@example.com",
      subject: "Shared",
      html: "<p>Shared</p>",
      fromName: "Alice via Clips",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.from).toEqual({
      name: "Alice via Clips",
      email: "notifications@example.com",
    });
  });

  it("keeps an explicit from address over fromName", async () => {
    vi.stubEnv("RESEND_API_KEY", "resend-example-key");
    vi.stubEnv("EMAIL_FROM", "Clips <notifications@example.com>");
    const fetchMock = vi.fn(async () => Response.json({ id: "email_123" }));
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({
      to: "reader@example.com",
      subject: "Invoice",
      html: "<p>Invoice</p>",
      from: "Billing <billing@example.com>",
      fromName: "Alice",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.from).toBe("Billing <billing@example.com>");
  });
});

describe("getEmailReadiness", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports Resend as ready without requiring EMAIL_FROM", async () => {
    vi.stubEnv("RESEND_API_KEY", "resend-example-key");

    await expect(getEmailReadiness()).resolves.toEqual({
      status: "ready",
      provider: "resend",
    });
  });

  it("reports SendGrid without EMAIL_FROM as misconfigured", async () => {
    vi.stubEnv("SENDGRID_API_KEY", "sendgrid-example-key");

    await expect(getEmailReadiness()).resolves.toEqual({
      status: "misconfigured",
      provider: "sendgrid",
    });
  });

  it("distinguishes an unconfigured transport from a ready one", async () => {
    await expect(getEmailReadiness()).resolves.toEqual({
      status: "not-configured",
      provider: "dev",
    });
  });
});
