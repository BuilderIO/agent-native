/**
 * Framework-owned integration taxonomy and metadata.
 *
 * This module deliberately describes integrations without implementing them.
 * Runtime behavior stays in adapters and plugins; consumers must use
 * availability and support maturity before offering a connection flow.
 */

export const INTEGRATION_CATEGORIES = [
  "channel",
  "provider",
  "automation",
  "agent-runtime",
  "tool-protocol",
] as const;

export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number];

export type IntegrationAvailability =
  | "available"
  | "preview"
  | "planned"
  | "unavailable";

export type IntegrationSupportMaturity =
  | "built-in"
  | "blueprint"
  | "experimental";

export type IntegrationIconKey =
  | "slack"
  | "telegram"
  | "whatsapp"
  | "microsoft-teams"
  | "discord"
  | "email"
  | "n8n"
  | "zapier";

export interface IntegrationCredentialRequirement {
  /** Stable runtime key; this is a name only, never a credential value. */
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly helpText?: string;
  /**
   * Credential groups model alternatives such as Resend or SendGrid. At least
   * one credential in a group must be configured when `required` is true.
   */
  readonly alternativeGroup?: string;
}

export interface ChannelCapabilities {
  readonly inboundText: boolean;
  readonly replyText: boolean;
  readonly proactiveMessages: boolean;
  readonly directMessages?: boolean;
  readonly mentions?: boolean;
  readonly nativeThreads?: boolean;
  readonly contextualReplies?: boolean;
  readonly interactionOnly?: boolean;
  readonly webhookSetup?: "automatic" | "manual";
}

export interface AutomationCapabilities {
  /**
   * `configured-webhook` uses the generic automation runtime after an app
   * owner supplies a workflow URL and credentials. `blueprint-only` has no
   * generic execution path in Agent Native.
   */
  readonly runtime: "configured-webhook" | "blueprint-only";
  readonly invokeWorkflow: boolean;
  readonly receiveCallback: boolean;
  readonly responseModes: readonly ("synchronous" | "asynchronous")[];
  readonly idempotency: boolean;
}

export interface IntegrationCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly categories: readonly IntegrationCategory[];
  readonly availability: IntegrationAvailability;
  readonly supportMaturity: IntegrationSupportMaturity;
  /** A semantic key for consumers to map to their own icon library or asset. */
  readonly iconKey: IntegrationIconKey;
  readonly description: string;
  readonly caveats: readonly string[];
  readonly documentation: {
    readonly href: string;
    readonly externalHref?: string;
    readonly externalLabel?: string;
  };
  readonly setup: {
    readonly steps: readonly string[];
  };
  readonly credentialRequirements: readonly IntegrationCredentialRequirement[];
  readonly channelCapabilities?: ChannelCapabilities;
  readonly automationCapabilities?: AutomationCapabilities;
}

export type BuiltInChannelId =
  | "slack"
  | "microsoft-teams"
  | "discord"
  | "telegram"
  | "whatsapp"
  | "email";

const BUILT_IN_CHANNEL_CATALOG = [
  {
    id: "slack",
    name: "Slack",
    categories: ["channel"],
    availability: "available",
    supportMaturity: "built-in",
    iconKey: "slack",
    description:
      "Install managed Slack workspaces with channel identities, contextual threads, native progress, and governance.",
    caveats: [
      "Replies stay in Slack's native message thread when a thread timestamp is available.",
      "Managed installations select encrypted credentials by workspace; legacy manual installs should use SLACK_ALLOWED_TEAM_IDS.",
    ],
    documentation: {
      href: "/docs/messaging#slack",
      externalHref: "https://api.slack.com/apps",
      externalLabel: "Open Slack apps",
    },
    setup: {
      steps: [
        "Create or open a Slack app at api.slack.com/apps.",
        "Apply the Agent Native Slack manifest to enable Agent View and writable direct messages.",
        "Configure the OAuth client id, client secret, and signing secret.",
        "Enable Event Subscriptions and Interactivity with the documented URLs.",
        "Subscribe to app_home_opened, app_context_changed, app_mention, and message.im/channels/groups, then use Add to Slack.",
      ],
    },
    credentialRequirements: [
      {
        key: "SLACK_BOT_TOKEN",
        label: "Slack Bot Token (legacy)",
        required: false,
        helpText:
          "Legacy single-workspace fallback only. For new setups, install Slack from Settings → Messaging; managed OAuth stores each workspace token automatically.",
      },
      {
        key: "SLACK_CLIENT_ID",
        label: "Slack OAuth Client ID",
        required: true,
        helpText: "Basic Information → App Credentials → Client ID.",
      },
      {
        key: "SLACK_CLIENT_SECRET",
        label: "Slack OAuth Client Secret",
        required: true,
        helpText: "Basic Information → App Credentials → Client Secret.",
      },
      {
        key: "SLACK_SIGNING_SECRET",
        label: "Slack Signing Secret",
        required: true,
        helpText: "Basic Information → App Credentials → Signing Secret.",
      },
    ],
    channelCapabilities: {
      inboundText: true,
      replyText: true,
      proactiveMessages: true,
      directMessages: true,
      mentions: true,
      nativeThreads: true,
      webhookSetup: "manual",
    },
  },
  {
    id: "microsoft-teams",
    name: "Microsoft Teams",
    categories: ["channel"],
    availability: "available",
    supportMaturity: "built-in",
    iconKey: "microsoft-teams",
    description:
      "Receive Bot Framework messages from Microsoft Teams and reply in the originating conversation.",
    caveats: [
      "Inbound JWTs are validated with Microsoft's Bot Framework connector, including issuer, audience, service URL, and channel endorsement checks.",
      "Production deployments must allowlist Microsoft Entra tenant IDs; proactive messaging without an inbound conversation reference is not implemented.",
    ],
    documentation: {
      href: "/docs/messaging#microsoft-teams",
      externalHref: "https://dev.botframework.com/",
      externalLabel: "Open Bot Framework",
    },
    setup: {
      steps: [
        "Create an Azure Bot resource and Microsoft Entra app registration.",
        "Configure the app ID, client secret, and allowed tenant IDs.",
        "Set the bot messaging endpoint to the provided webhook URL.",
        "Add the Microsoft Teams channel and install the bot in an allowed tenant.",
      ],
    },
    credentialRequirements: [
      {
        key: "MICROSOFT_TEAMS_APP_ID",
        label: "Microsoft Bot App ID",
        required: true,
      },
      {
        key: "MICROSOFT_TEAMS_APP_PASSWORD",
        label: "Microsoft Bot Client Secret",
        required: true,
      },
      {
        key: "MICROSOFT_TEAMS_APP_TENANT_ID",
        label: "Microsoft Bot Tenant ID",
        required: false,
        helpText: "Required for single-tenant bot registrations.",
      },
      {
        key: "MICROSOFT_TEAMS_ALLOWED_TENANT_IDS",
        label: "Allowed Microsoft Teams Tenant IDs",
        required: true,
        helpText:
          "Comma-separated Entra tenant IDs that may invoke this deployment.",
      },
    ],
    channelCapabilities: {
      inboundText: true,
      replyText: true,
      proactiveMessages: false,
      directMessages: true,
      mentions: true,
      nativeThreads: true,
      contextualReplies: true,
      webhookSetup: "manual",
    },
  },
  {
    id: "discord",
    name: "Discord",
    categories: ["channel"],
    availability: "available",
    supportMaturity: "built-in",
    iconKey: "discord",
    description:
      "Run the agent from Discord slash-command interactions with deferred replies.",
    caveats: [
      "This adapter receives HTTP interactions only. It does not ingest ordinary server or direct messages, which require a persistent Gateway connection.",
      "Interaction tokens are retained only while the queued task is active and normally expire after 15 minutes.",
    ],
    documentation: {
      href: "/docs/messaging#discord",
      externalHref: "https://discord.com/developers/applications",
      externalLabel: "Open Discord applications",
    },
    setup: {
      steps: [
        "Create or open a Discord application.",
        "Configure its application ID and public key.",
        "Paste the webhook URL into Interactions Endpoint URL.",
        "Register a chat-input command with a string prompt option.",
      ],
    },
    credentialRequirements: [
      {
        key: "DISCORD_APPLICATION_ID",
        label: "Discord Application ID",
        required: true,
      },
      {
        key: "DISCORD_PUBLIC_KEY",
        label: "Discord Public Key",
        required: true,
        helpText:
          "Discord uses this Ed25519 public key to sign interaction webhooks.",
      },
    ],
    channelCapabilities: {
      inboundText: true,
      replyText: true,
      proactiveMessages: false,
      directMessages: true,
      nativeThreads: false,
      contextualReplies: false,
      interactionOnly: true,
      webhookSetup: "manual",
    },
  },
  {
    id: "telegram",
    name: "Telegram",
    categories: ["channel"],
    availability: "available",
    supportMaturity: "built-in",
    iconKey: "telegram",
    description: "Receive and reply to text messages through a Telegram bot.",
    caveats: [
      "Forum topics and private-chat topics use message_thread_id as part of the canonical conversation identity.",
      "Webhook verification requires TELEGRAM_WEBHOOK_SECRET for production-safe setup.",
    ],
    documentation: {
      href: "/docs/messaging#telegram",
      externalHref: "https://t.me/BotFather",
      externalLabel: "Open BotFather",
    },
    setup: {
      steps: [
        "Create a bot with @BotFather.",
        "Configure the bot token and webhook secret.",
        "Register the webhook from the setup control.",
        "Send the bot a text message to test.",
      ],
    },
    credentialRequirements: [
      {
        key: "TELEGRAM_BOT_TOKEN",
        label: "Telegram Bot Token",
        required: true,
        helpText: "The token provided by @BotFather after `/newbot`.",
      },
      {
        key: "TELEGRAM_WEBHOOK_SECRET",
        label: "Telegram Webhook Secret",
        required: true,
        helpText:
          "Telegram echoes this value on webhook requests for verification.",
      },
    ],
    channelCapabilities: {
      inboundText: true,
      replyText: true,
      proactiveMessages: true,
      directMessages: true,
      nativeThreads: true,
      contextualReplies: true,
      webhookSetup: "automatic",
    },
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    categories: ["channel"],
    availability: "available",
    supportMaturity: "built-in",
    iconKey: "whatsapp",
    description: "Receive and reply to WhatsApp Cloud API text messages.",
    caveats: [
      "This adapter uses the Meta-managed WhatsApp Cloud API, not personal WhatsApp accounts.",
      "Meta pricing and the customer-service conversation window can limit replies; template-message flows are not implemented by this adapter.",
    ],
    documentation: {
      href: "/docs/messaging#whatsapp",
      externalHref: "https://developers.facebook.com/apps",
      externalLabel: "Open Meta developer console",
    },
    setup: {
      steps: [
        "Create a Meta app and add the WhatsApp product.",
        "Configure the access token, verify token, and phone number ID.",
        "Paste the webhook URL and verify token into Meta.",
        "Subscribe to the messages webhook field.",
      ],
    },
    credentialRequirements: [
      {
        key: "WHATSAPP_ACCESS_TOKEN",
        label: "WhatsApp Access Token",
        required: true,
      },
      {
        key: "WHATSAPP_VERIFY_TOKEN",
        label: "WhatsApp Verify Token",
        required: true,
      },
      {
        key: "WHATSAPP_PHONE_NUMBER_ID",
        label: "WhatsApp Phone Number ID",
        required: true,
      },
      {
        key: "WHATSAPP_APP_SECRET",
        label: "WhatsApp App Secret",
        required: true,
        helpText: "Verifies inbound webhooks with Meta's HMAC signature.",
      },
    ],
    channelCapabilities: {
      inboundText: true,
      replyText: true,
      proactiveMessages: false,
      directMessages: true,
      contextualReplies: true,
      webhookSetup: "manual",
    },
  },
  {
    id: "email",
    name: "Email",
    categories: ["channel", "provider"],
    availability: "available",
    supportMaturity: "built-in",
    iconKey: "email",
    description:
      "Receive provider webhooks and reply by email through Resend or SendGrid.",
    caveats: [
      "This is a webhook-provider adapter for Resend or SendGrid, not a generic SMTP or IMAP connector.",
      "Email replies preserve RFC email threads and reply-all when the agent was CC'd.",
    ],
    documentation: {
      href: "/docs/messaging#email",
      externalHref: "https://resend.com/webhooks",
      externalLabel: "Open Resend webhooks",
    },
    setup: {
      steps: [
        "Choose Resend or SendGrid for inbound and outbound mail.",
        "Configure the agent address and one provider API key.",
        "Register the provider's inbound webhook URL.",
        "Configure a webhook signing secret in production.",
      ],
    },
    credentialRequirements: [
      {
        key: "EMAIL_AGENT_ADDRESS",
        label: "Agent Email Address",
        required: true,
      },
      {
        key: "RESEND_API_KEY",
        label: "Resend API Key",
        required: true,
        alternativeGroup: "email-provider",
      },
      {
        key: "SENDGRID_API_KEY",
        label: "SendGrid API Key",
        required: true,
        alternativeGroup: "email-provider",
      },
      {
        key: "EMAIL_INBOUND_WEBHOOK_SECRET",
        label: "Inbound Webhook Secret",
        required: false,
      },
    ],
    channelCapabilities: {
      inboundText: true,
      replyText: true,
      proactiveMessages: true,
      nativeThreads: true,
      webhookSetup: "manual",
    },
  },
] as const satisfies readonly IntegrationCatalogEntry[];

const AUTOMATION_CATALOG = [
  {
    id: "n8n",
    name: "n8n",
    categories: ["automation"],
    availability: "available",
    supportMaturity: "built-in",
    iconKey: "n8n",
    description:
      "Invoke configured n8n Webhook workflows or receive authenticated n8n callbacks through the automation runtime.",
    caveats: [
      "n8n must be deployed and configured by the workspace owner; Agent Native does not provision or host n8n.",
      "Configure n8n Webhook authentication and an explicit response mode. Synchronous responses depend on the workflow's Webhook or Respond to Webhook node.",
      "Use a configured webhook URL or n8n credential; never put an n8n URL or credential in an agent prompt.",
    ],
    documentation: {
      href: "/docs/automation-connectors#n8n",
      externalHref:
        "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/",
      externalLabel: "Open n8n Webhook docs",
    },
    setup: {
      steps: [
        "Deploy or select an n8n instance and publish a Webhook workflow.",
        "Choose Header, Basic, or JWT authentication in n8n and save the matching credential in Agent Native.",
        "Register the static webhook path and allow-listed n8n origin in the app's automation configuration.",
        "Choose immediate, final-node, or Respond to Webhook behavior and test with a fake event ID.",
      ],
    },
    credentialRequirements: [
      {
        key: "N8N_WEBHOOK_CREDENTIAL",
        label: "n8n Webhook Credential",
        required: true,
        helpText:
          "A header, basic, or JWT credential matching the configured n8n Webhook node.",
      },
    ],
    automationCapabilities: {
      runtime: "configured-webhook",
      invokeWorkflow: true,
      receiveCallback: true,
      responseModes: ["synchronous", "asynchronous"],
      idempotency: true,
    },
  },
  {
    id: "zapier",
    name: "Zapier",
    categories: ["automation", "tool-protocol"],
    availability: "available",
    supportMaturity: "blueprint",
    iconKey: "zapier",
    description:
      "Blueprint guidance for Zapier webhooks and Zapier MCP; there is no generic Zapier workflow execution runtime in Agent Native.",
    caveats: [
      "Zapier is not a chat channel and is not exposed through provider-api.",
      "Zapier REST Hook triggers require an app-owned subscribe and unsubscribe API; a static incoming webhook is not supported for public integrations.",
      "Zapier MCP is a separately configured remote MCP connection with its own account and authorization flow.",
    ],
    documentation: {
      href: "/docs/automation-connectors#zapier",
      externalHref: "https://docs.zapier.com/mcp/home",
      externalLabel: "Open Zapier MCP docs",
    },
    setup: {
      steps: [
        "Choose either an app-owned Zapier REST Hook integration or a separately configured Zapier MCP server.",
        "For REST Hooks, implement durable subscribe and unsubscribe endpoints before publishing an app integration.",
        "For MCP, complete Zapier's account authorization flow; do not treat an MCP server as a webhook credential.",
      ],
    },
    credentialRequirements: [],
    automationCapabilities: {
      runtime: "blueprint-only",
      invokeWorkflow: false,
      receiveCallback: false,
      responseModes: [],
      idempotency: false,
    },
  },
] as const satisfies readonly IntegrationCatalogEntry[];

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

export const BUILT_IN_INTEGRATION_CATALOG: readonly IntegrationCatalogEntry[] =
  deepFreeze([...BUILT_IN_CHANNEL_CATALOG, ...AUTOMATION_CATALOG]);

export function listIntegrationCatalog(
  category?: IntegrationCategory,
): readonly IntegrationCatalogEntry[] {
  if (!category) return BUILT_IN_INTEGRATION_CATALOG;
  return BUILT_IN_INTEGRATION_CATALOG.filter((entry) =>
    entry.categories.includes(category),
  );
}

export function getIntegrationCatalogEntry(
  id: string,
): IntegrationCatalogEntry | undefined {
  return BUILT_IN_INTEGRATION_CATALOG.find((entry) => entry.id === id);
}

export function listBuiltInChannelIntegrations(): readonly IntegrationCatalogEntry[] {
  return listIntegrationCatalog("channel").filter(
    (entry) =>
      entry.availability === "available" &&
      entry.supportMaturity === "built-in",
  );
}
