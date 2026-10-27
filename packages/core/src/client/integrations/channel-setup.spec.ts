import { describe, expect, it } from "vitest";

import {
  channelConnectionState,
  hasMissingRequiredCredentials,
  listChannelsForSettings,
} from "./channel-setup.js";

describe("channel setup helpers", () => {
  it("lists the seven channels in the Channels page order", () => {
    expect(listChannelsForSettings().map((entry) => entry.id)).toEqual([
      "slack",
      "google-docs",
      "telegram",
      "whatsapp",
      "discord",
      "microsoft-teams",
      "email",
    ]);
  });

  it("needs one key of a required alternative group", () => {
    const credentials = [
      { key: "EMAIL_AGENT_ADDRESS", required: true },
      { key: "RESEND_API_KEY", required: true, alternativeGroup: "provider" },
      { key: "SENDGRID_API_KEY", required: true, alternativeGroup: "provider" },
      { key: "EMAIL_INBOUND_WEBHOOK_SECRET", required: false },
    ];
    const configured = (keys: string[]) => (key: string) => keys.includes(key);

    expect(
      hasMissingRequiredCredentials(
        credentials,
        configured(["EMAIL_AGENT_ADDRESS"]),
      ),
    ).toBe(true);
    expect(
      hasMissingRequiredCredentials(
        credentials,
        configured(["EMAIL_AGENT_ADDRESS", "SENDGRID_API_KEY"]),
      ),
    ).toBe(false);
    expect(
      hasMissingRequiredCredentials(
        credentials,
        configured(["RESEND_API_KEY"]),
      ),
    ).toBe(true);
  });

  it("is on only when enabled and configured", () => {
    expect(channelConnectionState({ configured: true, enabled: true })).toBe(
      "on",
    );
    expect(channelConnectionState({ configured: true, enabled: false })).toBe(
      "off",
    );
    expect(channelConnectionState({ configured: false, enabled: true })).toBe(
      "not-set-up",
    );
  });
});
