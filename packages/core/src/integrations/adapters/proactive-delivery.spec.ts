import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/credential-provider.js", () => ({
  resolveSecret: vi.fn(async () => undefined),
}));

vi.mock("../../server/email.js", () => ({
  sendEmail: vi.fn(),
  isEmailConfigured: vi.fn(),
  getEmailProvider: vi.fn(),
}));

vi.mock("../config-store.js", () => ({
  getIntegrationConfig: vi.fn(async () => null),
}));

import { resolveSecret } from "../../server/credential-provider.js";
import { sendEmail } from "../../server/email.js";
import { emailAdapter } from "./email.js";
import { telegramAdapter } from "./telegram.js";

describe("proactive delivery", () => {
  beforeEach(() => {
    vi.mocked(resolveSecret).mockResolvedValue(undefined);
  });
  it.each([emailAdapter, telegramAdapter])(
    "rejects missing send credentials",
    async (adapter) => {
      await expect(
        adapter().sendMessageToTarget!(
          { text: "Digest", platformContext: {} },
          { destination: "example-target" },
        ),
      ).rejects.toThrow("not configured");
    },
  );

  it.each([
    { status: "suppressed", reason: "test-identity" } as const,
    { status: "sent", provider: "dev" } as const,
  ])("rejects email without provider delivery: %j", async (outcome) => {
    vi.mocked(resolveSecret).mockResolvedValue("agent@example.test");
    vi.mocked(sendEmail).mockResolvedValueOnce(outcome);
    await expect(
      emailAdapter().sendMessageToTarget!(
        { text: "Digest", platformContext: {} },
        { destination: "recipient@example.test" },
      ),
    ).rejects.toMatchObject({ errorCode: "email_delivery_not_sent" });
  });

  it("accepts email delivered by a provider", async () => {
    vi.mocked(resolveSecret).mockResolvedValue("agent@example.test");
    vi.mocked(sendEmail).mockResolvedValueOnce({
      status: "sent",
      provider: "resend",
    });
    await expect(
      emailAdapter().sendMessageToTarget!(
        { text: "Digest", platformContext: {} },
        { destination: "recipient@example.test" },
      ),
    ).resolves.toBeUndefined();
  });
});
