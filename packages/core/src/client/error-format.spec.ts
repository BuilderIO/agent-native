import { describe, expect, it } from "vitest";
import {
  BUILDER_SPACE_SETTINGS_URL,
  formatChatErrorText,
} from "./error-format.js";

describe("formatChatErrorText", () => {
  it("adds a Builder space settings CTA for disabled gateway errors", () => {
    expect(
      formatChatErrorText(
        "This space has not enabled the LLM gateway. A space admin can enable it in Account settings.",
        undefined,
        "gateway_not_enabled",
      ),
    ).toBe(
      `Error: This space has not enabled the LLM gateway. A space admin can enable it in Account settings.\n\n[Open Builder space settings](${BUILDER_SPACE_SETTINGS_URL})`,
    );
  });

  it("adds the settings CTA when the code is missing but the message matches", () => {
    expect(
      formatChatErrorText(
        "This space has not enabled the LLM gateway. A space admin can enable it in Account settings.",
      ),
    ).toContain(`[Open Builder space settings](${BUILDER_SPACE_SETTINGS_URL})`);
  });

  it("keeps quota errors on the billing CTA", () => {
    expect(
      formatChatErrorText(
        "Monthly credits limit reached.",
        "https://builder.io/account/billing",
        "credits-limit-monthly",
      ),
    ).toBe(
      "Error: Monthly credits limit reached.\n\n[Upgrade at builder.io](https://builder.io/account/billing)",
    );
  });
});
