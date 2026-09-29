import { IconPlug } from "@tabler/icons-react";
import { describe, expect, it } from "vitest";

import { listBuiltInChannelIntegrations } from "../../integrations/catalog.js";
import {
  getChannelSettingsExtensions,
  registerChannelSettingsExtensions,
} from "./channel-extensions.js";
import {
  channelConnectionState,
  channelIcon,
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

  it("has an icon for every catalog channel", () => {
    for (const entry of listBuiltInChannelIntegrations()) {
      expect(channelIcon(entry.iconKey)).not.toBe(IconPlug);
    }
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

describe("channel settings extensions", () => {
  const Empty = () => null;

  it("replaces an extension registered again with the same id", () => {
    const first = registerChannelSettingsExtensions([
      { id: "previews", platform: "slack", component: Empty, order: 2 },
      { id: "other", platform: "slack", component: Empty, order: 1 },
    ]);
    const replacement = { id: "previews", platform: "slack", component: Empty };
    const second = registerChannelSettingsExtensions([replacement]);

    expect(
      getChannelSettingsExtensions("slack").map((extension) => extension.id),
    ).toEqual(["previews", "other"]);
    expect(getChannelSettingsExtensions("slack")[0]).toBe(replacement);
    expect(getChannelSettingsExtensions("telegram")).toEqual([]);

    second();
    first();
    expect(getChannelSettingsExtensions("slack")).toEqual([]);
  });
});
