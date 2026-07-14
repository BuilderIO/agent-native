import { describe, expect, it } from "vitest";

import {
  SLACK_AGENT_BOT_EVENTS,
  buildSlackAgentManifest,
} from "./slack-manifest.js";

describe("Slack Agent Native app manifest", () => {
  it("enables Agent View and writable direct messages", () => {
    const manifest = buildSlackAgentManifest({
      oauthRedirectUrl:
        "https://app.example.com/_agent-native/integrations/slack/oauth/callback",
      eventsRequestUrl:
        "https://app.example.com/_agent-native/integrations/slack/webhook",
      interactivityRequestUrl:
        "https://app.example.com/_agent-native/integrations/slack/interactions",
    });

    expect(manifest.display_information.name).toBe("Agent Native");
    expect(manifest.features.agent_view.agent_description).toBeTruthy();
    expect(manifest.features.app_home).toEqual({
      home_tab_enabled: false,
      messages_tab_enabled: true,
      messages_tab_read_only_enabled: false,
    });
    expect(manifest.oauth_config.scopes.bot).toEqual(
      expect.arrayContaining([
        "assistant:write",
        "channels:read",
        "chat:write",
        "groups:read",
        "im:history",
        "mpim:read",
        "pins:read",
        "users:read.email",
      ]),
    );
    expect(manifest.settings.event_subscriptions.bot_events).toEqual(
      expect.arrayContaining([
        "app_home_opened",
        "app_context_changed",
        "message.im",
      ]),
    );
    expect(manifest.settings.event_subscriptions.bot_events).toEqual([
      ...SLACK_AGENT_BOT_EVENTS,
    ]);
  });

  it("uses only the supplied deployment URLs", () => {
    const urls = {
      oauthRedirectUrl: "https://workspace.example.com/base/slack/callback",
      eventsRequestUrl: "https://workspace.example.com/base/slack/events",
      interactivityRequestUrl:
        "https://workspace.example.com/base/slack/interactions",
    };
    const serialized = JSON.stringify(buildSlackAgentManifest(urls));

    for (const url of Object.values(urls)) expect(serialized).toContain(url);
    expect(serialized).not.toContain("your-app.example.com");
  });
});
