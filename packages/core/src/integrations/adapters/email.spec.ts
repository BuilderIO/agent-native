import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  rawBody: "" as string,
  getIntegrationConfig: vi.fn(),
}));

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    // parseIncomingMessage reads the raw body via h3.readRawBody — feed it the
    // per-test fixture. getHeader is unused on our synthetic event.
    readRawBody: vi.fn(async () => hoisted.rawBody),
    getHeader: vi.fn(() => undefined),
  };
});

vi.mock("../config-store.js", () => ({
  getIntegrationConfig: hoisted.getIntegrationConfig,
}));

// Rate-limit lookup hits the DB; force the "table missing → allow" path so the
// parser proceeds without a real database.
vi.mock("../../db/client.js", () => ({
  getDbExec: () => ({
    execute: async () => {
      throw new Error("no table");
    },
  }),
}));

import { emailAdapter } from "./email.js";

/** Minimal H3-shaped event; the parser only uses it via the mocked h3 helpers. */
function fakeEvent(): any {
  return { context: {} };
}

async function parseSendGrid(
  fields: Record<string, unknown>,
): Promise<{ senderVerified?: boolean } | null> {
  hoisted.rawBody = JSON.stringify(fields);
  return emailAdapter().parseIncomingMessage(fakeEvent());
}

describe("emailAdapter inbound sender verification", () => {
  beforeEach(() => {
    hoisted.getIntegrationConfig.mockResolvedValue(null);
    vi.stubEnv("SENDGRID_API_KEY", "SG.test");
    vi.stubEnv("EMAIL_AGENT_ADDRESS", "agent@host.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("marks DKIM=pass aligned with the From domain as verified", async () => {
    const msg = await parseSendGrid({
      from: "Real User <user@member.test>",
      to: "agent@host.test",
      subject: "hi",
      text: "hello",
      dkim: "{@member.test : pass}",
      SPF: "fail",
    });
    expect(msg?.senderVerified).toBe(true);
  });

  it("marks SPF=pass as verified", async () => {
    const msg = await parseSendGrid({
      from: "user@member.test",
      to: "agent@host.test",
      subject: "hi",
      text: "hello",
      dkim: "{@member.test : none}",
      SPF: "pass",
    });
    expect(msg?.senderVerified).toBe(true);
  });

  it("treats a spoofed From with no passing auth as UNVERIFIED (fail closed)", async () => {
    const msg = await parseSendGrid({
      from: "Victim <victim@member.test>",
      to: "agent@host.test",
      subject: "spoofed",
      text: "give me everything",
      dkim: "{@attacker.test : pass}", // passes, but NOT aligned with From
      SPF: "fail",
    });
    expect(msg?.senderVerified).toBe(false);
  });

  it("treats absent auth results as UNVERIFIED (fail closed)", async () => {
    const msg = await parseSendGrid({
      from: "victim@member.test",
      to: "agent@host.test",
      subject: "no auth",
      text: "hi",
    });
    expect(msg?.senderVerified).toBe(false);
  });

  it("accepts DKIM signed by an organizational parent of the From subdomain", async () => {
    const msg = await parseSendGrid({
      from: "user@mail.member.test",
      to: "agent@host.test",
      subject: "subdomain",
      text: "hi",
      dkim: "{@member.test : pass}",
    });
    expect(msg?.senderVerified).toBe(true);
  });

  it("reads DKIM pass from the Authentication-Results header", async () => {
    const msg = await parseSendGrid({
      from: "user@member.test",
      to: "agent@host.test",
      subject: "ar header",
      text: "hi",
      headers:
        "Authentication-Results: mx.host.test; dkim=pass header.d=member.test; spf=fail",
    });
    expect(msg?.senderVerified).toBe(true);
  });
});

describe("emailAdapter formatting", () => {
  it("renders bare URLs as labelled links instead of visible raw URLs", () => {
    const outgoing = emailAdapter().formatAgentResponse(
      "Join here: https://builder-io.zoom.us/j/123?pwd=secret.",
    );

    expect(outgoing.text).toContain(
      'href="https://builder-io.zoom.us/j/123?pwd=secret"',
    );
    expect(outgoing.text).toContain(">Open builder-io.zoom.us</a>.");
    expect(outgoing.text).not.toContain(
      ">https://builder-io.zoom.us/j/123?pwd=secret</a>",
    );
  });

  it("keeps markdown link labels but collapses URL labels", () => {
    const outgoing = emailAdapter().formatAgentResponse(
      "[Manage booking](https://app.test/booking/manage/abc)\n\n[https://app.test/long/path](https://app.test/long/path)",
    );

    expect(outgoing.text).toContain(">Manage booking</a>");
    expect(outgoing.text).toContain(">Open app.test</a>");
    expect(outgoing.text).not.toContain(">https://app.test/long/path</a>");
  });
});
