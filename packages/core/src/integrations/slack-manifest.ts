import { SLACK_AGENT_BOT_SCOPES } from "./slack-oauth.js";

export const SLACK_AGENT_BOT_EVENTS = [
  "app_home_opened",
  "app_context_changed",
  "app_mention",
  "message.channels",
  "message.groups",
  "message.im",
  "message.mpim",
] as const;

export interface SlackAgentManifestUrls {
  oauthRedirectUrl: string;
  eventsRequestUrl: string;
  interactivityRequestUrl: string;
}

/**
 * Build the canonical Slack app manifest for Agent Native.
 *
 * Slack app capabilities are controlled by the app configuration, not by an
 * individual workspace's OAuth install. Keeping this manifest in core gives
 * self-hosted apps one exact, versioned configuration for Agent View, writable
 * DMs, channel mentions, contextual messages, and interactive run controls.
 */
export function buildSlackAgentManifest(urls: SlackAgentManifestUrls) {
  return {
    _metadata: { major_version: 2, minor_version: 1 },
    display_information: {
      name: "Agent Native",
      description: "Delegate work to your Agent Native apps from Slack.",
      background_color: "#0f172a",
    },
    features: {
      bot_user: {
        display_name: "agent-native",
        always_online: false,
      },
      app_home: {
        home_tab_enabled: false,
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
      agent_view: {
        agent_description:
          "Delegate work to your Agent Native apps from Slack.",
        suggested_prompts: [
          {
            title: "Start a task",
            message: "What can you help me accomplish?",
          },
          {
            title: "Check work",
            message: "What work is currently in progress?",
          },
        ],
      },
    },
    oauth_config: {
      redirect_urls: [urls.oauthRedirectUrl],
      scopes: { bot: [...SLACK_AGENT_BOT_SCOPES] },
    },
    settings: {
      event_subscriptions: {
        request_url: urls.eventsRequestUrl,
        bot_events: [...SLACK_AGENT_BOT_EVENTS],
      },
      interactivity: {
        is_enabled: true,
        request_url: urls.interactivityRequestUrl,
      },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  } as const;
}
