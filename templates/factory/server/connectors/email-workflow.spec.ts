import { beforeEach, describe, expect, it, vi } from "vitest";

const sendEmailMock = vi.hoisted(() => vi.fn());
const readinessMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  sendEmail: sendEmailMock,
  getEmailReadiness: readinessMock,
}));

import {
  assertEmailReady,
  parseEmailAddresses,
  renderEmailBody,
  sendWorkflowEmail,
} from "./email-workflow.js";

const identity = {
  orgId: "org-1",
  factoryId: "factory-1",
  automationId: "job-1",
  runId: "run-1",
};

function providerError(status: number) {
  return Object.assign(new Error(`provider said ${status}`), {
    name: "EmailProviderError",
    responseStatus: status,
  });
}

const message = {
  to: ["ada@example.test"],
  cc: [],
  subject: "Hello",
  body: "Hi **Ada**",
  identity,
};

describe("renderEmailBody", () => {
  it("escapes markup in the text, then renders the markdown subset", () => {
    const { html, text } = renderEmailBody(
      "<script>alert(1)</script> **bold** [docs](https://example.test/a?b=1&c=2)\nnext line\n\n- one\n- two",
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain(
      '<a href="https://example.test/a?b=1&amp;c=2">docs</a>',
    );
    expect(html).toContain("<br>next line");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(text).toContain("**bold**");
  });

  it("does not turn a javascript: link into a link", () => {
    expect(renderEmailBody("[x](javascript:alert(1))").html).not.toContain(
      "<a ",
    );
  });
});

describe("parseEmailAddresses", () => {
  it("splits, trims and de-duplicates a list", () => {
    expect(
      parseEmailAddresses(
        "a@example.test, B@example.test;a@example.test",
        "to",
      ),
    ).toEqual(["a@example.test", "B@example.test"]);
    expect(parseEmailAddresses(undefined, "cc")).toEqual([]);
  });

  it("refuses an entry that is not an address, and a list that is too long", () => {
    expect(() => parseEmailAddresses("not-an-address", "to")).toThrow(
      /not an email address/,
    );
    expect(() =>
      parseEmailAddresses(
        Array.from({ length: 11 }, (_, index) => `u${index}@example.test`).join(
          ",",
        ),
        "to",
      ),
    ).toThrow(/the most is 10/);
  });
});

describe("assertEmailReady", () => {
  it("passes when a sender is configured", async () => {
    readinessMock.mockResolvedValue({ status: "ready", provider: "resend" });

    await expect(assertEmailReady()).resolves.toBeUndefined();
  });

  it("names what is missing when no sender is configured", async () => {
    readinessMock.mockResolvedValue({
      status: "not-configured",
      provider: "dev",
    });

    await expect(assertEmailReady()).rejects.toMatchObject({
      errorCode: "email_not_configured",
      statusCode: 412,
      details: { missing: ["RESEND_API_KEY", "SENDGRID_API_KEY"] },
    });
  });

  it("names EMAIL_FROM for a SendGrid setup that lacks it", async () => {
    readinessMock.mockResolvedValue({
      status: "misconfigured",
      provider: "sendgrid",
    });

    await expect(assertEmailReady()).rejects.toMatchObject({
      errorCode: "email_not_configured",
      details: { missing: ["EMAIL_FROM"] },
    });
  });

  it("keeps unreadable credentials apart from missing ones", async () => {
    readinessMock.mockResolvedValue({
      status: "unavailable",
      provider: "unknown",
    });

    await expect(assertEmailReady()).rejects.toMatchObject({
      errorCode: "email_credentials_unreadable",
      retryable: true,
    });
  });
});

describe("sendWorkflowEmail", () => {
  beforeEach(() => {
    sendEmailMock
      .mockReset()
      .mockResolvedValue({ status: "sent", provider: "resend" });
  });

  it("sends with a key scoped to the run, and returns that key as the reference", async () => {
    const first = await sendWorkflowEmail(message);
    const again = await sendWorkflowEmail(message);
    const nextRun = await sendWorkflowEmail({
      ...message,
      identity: { ...identity, runId: "run-2" },
    });

    expect(first).toMatchObject({
      provider: "resend",
      recipients: ["ada@example.test"],
      suppressed: [],
    });
    expect(first.messageRef).toMatch(/^factory-email-[0-9a-f]{40}$/);
    expect(again.messageRef).toBe(first.messageRef);
    expect(nextRun.messageRef).not.toBe(first.messageRef);
    expect(sendEmailMock.mock.calls[0]?.[0]).toMatchObject({
      to: "ada@example.test",
      subject: "Hello",
      idempotencyKey: `${first.messageRef}-0`,
    });
    expect(sendEmailMock.mock.calls[0]?.[0].html).toContain(
      "<strong>Ada</strong>",
    );
  });

  it("keeps two identical emails of one run apart when they are two calls, and one email when it is a retry of one call", async () => {
    const call = (callId: string) => ({
      ...message,
      identity: { ...identity, callId },
    });
    const first = await sendWorkflowEmail(call("wf:item-1:mail:0"));
    const otherItem = await sendWorkflowEmail(call("wf:item-2:mail:0"));
    const otherNode = await sendWorkflowEmail(call("wf:item-1:mail2:0"));
    const retry = await sendWorkflowEmail(call("wf:item-1:mail:0"));

    expect(
      new Set([first, otherItem, otherNode].map((r) => r.messageRef)).size,
    ).toBe(3);
    expect(retry.messageRef).toBe(first.messageRef);
    const keys = sendEmailMock.mock.calls.map(([sent]) => sent.idempotencyKey);
    expect(keys[0]).toBe(keys[3]);
    expect(new Set(keys.slice(0, 3)).size).toBe(3);
  });

  it("sends one message per address", async () => {
    const result = await sendWorkflowEmail({
      ...message,
      to: ["a@example.test", "b@example.test"],
    });

    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    expect(result.recipients).toEqual(["a@example.test", "b@example.test"]);
    const keys = sendEmailMock.mock.calls.map(([call]) => call.idempotencyKey);
    expect(new Set(keys).size).toBe(2);
  });

  it("sends no key, and returns a fresh reference, when there is no run", async () => {
    const result = await sendWorkflowEmail({
      ...message,
      identity: { orgId: "org-1", factoryId: "factory-1" },
    });

    expect(sendEmailMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "idempotencyKey",
    );
    expect(result.messageRef).toMatch(/^factory-email-/);
  });

  it("fails, with nothing sent, when every recipient is a test identity", async () => {
    sendEmailMock.mockResolvedValue({
      status: "suppressed",
      reason: "test-identity",
    });

    await expect(sendWorkflowEmail(message)).rejects.toMatchObject({
      errorCode: "email_recipient_suppressed",
    });
  });

  it("reports a rejection as safe to retry and a server error as unknown", async () => {
    sendEmailMock.mockRejectedValueOnce(providerError(422));
    await expect(sendWorkflowEmail(message)).rejects.toMatchObject({
      errorCode: "email_rejected",
      sideEffect: "none",
    });

    sendEmailMock.mockRejectedValueOnce(providerError(429));
    await expect(sendWorkflowEmail(message)).rejects.toMatchObject({
      errorCode: "email_rate_limited",
      retryable: true,
    });

    sendEmailMock.mockRejectedValueOnce(providerError(503));
    await expect(sendWorkflowEmail(message)).rejects.toMatchObject({
      errorCode: "email_outcome_unknown",
      sideEffect: "maybe",
    });

    sendEmailMock.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(sendWorkflowEmail(message)).rejects.toMatchObject({
      errorCode: "email_outcome_unknown",
    });
  });

  it("says it is unknown, and who got it, when a later recipient fails", async () => {
    sendEmailMock
      .mockResolvedValueOnce({ status: "sent", provider: "resend" })
      .mockRejectedValueOnce(providerError(422));

    await expect(
      sendWorkflowEmail({
        ...message,
        to: ["a@example.test", "b@example.test"],
      }),
    ).rejects.toMatchObject({
      errorCode: "email_outcome_unknown",
      sideEffect: "maybe",
      details: { sentTo: ["a@example.test"] },
    });
  });
});
