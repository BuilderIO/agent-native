import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/credential-provider.js", () => ({
  resolveSecret: vi.fn(async () => undefined),
}));

import { emailAdapter } from "./email.js";
import { telegramAdapter } from "./telegram.js";

describe("proactive delivery", () => {
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
});
