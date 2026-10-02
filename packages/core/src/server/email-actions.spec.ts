import { describe, expect, it, vi } from "vitest";

const sendEmail = vi.hoisted(() => vi.fn());
vi.mock("./email.js", () => ({ sendEmail }));

import { createCoreEmailActionEntries } from "./email-actions.js";

describe("core-send-email action guidance", () => {
  it("keeps interactive email sends draft-first", () => {
    const description =
      createCoreEmailActionEntries()["core-send-email"].tool.description;

    expect(description).toContain("DRAFT-FIRST SAFETY RULE");
    expect(description).not.toContain("unattended automation run");
  });

  it("authorizes delivery for unattended automation runs", () => {
    const description = createCoreEmailActionEntries({ unattended: true })[
      "core-send-email"
    ].tool.description;

    expect(description).toContain(
      "explicitly authorized unattended automation",
    );
    expect(description).toContain(
      "without asking for an interactive confirmation",
    );
    expect(description).not.toContain("DRAFT-FIRST SAFETY RULE");
  });
});

describe("core-send-email delivery outcome", () => {
  it("tells the agent a test-identity send was suppressed, not sent", async () => {
    sendEmail.mockResolvedValueOnce({
      status: "suppressed",
      reason: "test-identity",
    });
    const result = await createCoreEmailActionEntries()["core-send-email"].run({
      to: "qa-owner@example.test",
      subject: "Hi",
      body: "Hello",
    });
    expect(result).toContain("Not sent");
    expect(result).not.toContain("Email sent");
  });

  it("forwards bcc and names the test identities that were skipped", async () => {
    sendEmail.mockResolvedValueOnce({
      status: "sent",
      provider: "resend",
      suppressed: ["qa-auditor@example.test"],
    });
    const result = await createCoreEmailActionEntries()["core-send-email"].run({
      to: "reader@example.com",
      bcc: "qa-auditor@example.test",
      subject: "Hi",
      body: "Hello",
    });
    expect(sendEmail).toHaveBeenLastCalledWith(
      expect.objectContaining({ bcc: "qa-auditor@example.test" }),
    );
    expect(result).toContain("qa-auditor@example.test");
    expect(result).toMatch(/test identit/i);
  });
});
