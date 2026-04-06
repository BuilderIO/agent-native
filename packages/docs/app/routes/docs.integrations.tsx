import DocsLayout from "../components/DocsLayout";
import CodeBlock from "../components/CodeBlock";

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "how-it-works", label: "How It Works" },
  { id: "setup", label: "Setup" },
  { id: "slack", label: "Slack" },
  { id: "telegram", label: "Telegram" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "configuration", label: "Configuration" },
  { id: "thread-continuity", label: "Thread Continuity" },
  { id: "custom-adapters", label: "Custom Adapters" },
  { id: "security", label: "Security" },
];

export const meta = () => [
  { title: "Integrations — Agent-Native" },
  {
    name: "description",
    content:
      "Connect your agent to Slack, Telegram, WhatsApp, and other messaging platforms.",
  },
];

export default function IntegrationsDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">
        Integrations
      </h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        Connect your agent to messaging platforms so you can chat with it from
        Slack, Telegram, WhatsApp, and more. Same agent, same tools, same thread
        history.
      </p>

      <h2 id="overview">Overview</h2>
      <p>
        Messaging integrations let users talk to their agent from the platforms
        they already use. Instead of opening the web UI, you send a message in
        Slack or Telegram and the agent responds right there. It has access to
        the same actions, the same database, and the same conversation history
        as the web chat.
      </p>
      <p>
        Each integration works through webhooks. The messaging platform sends
        incoming messages to your app, the agent processes them, and the
        response is posted back. No polling, no long-lived connections — just
        standard HTTP webhooks.
      </p>

      <h2 id="how-it-works">How it works</h2>
      <p>The flow for every platform follows the same pattern:</p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          A user sends a message on the external platform (Slack, Telegram,
          etc.)
        </li>
        <li>
          The platform delivers the message to your app via a webhook at{" "}
          <code>/_agent-native/integrations/&lt;platform&gt;/webhook</code>
        </li>
        <li>
          The integrations plugin validates the request, extracts the message
          text and thread context, and maps it to an internal conversation
          thread
        </li>
        <li>
          The agent processes the message in the background using the same
          pipeline as the web chat — same system prompt, same actions, same
          tools
        </li>
        <li>
          The response is posted back to the external platform in the same
          thread
        </li>
      </ol>
      <div className="my-6 overflow-hidden rounded-xl border border-[var(--border)]">
        <div className="p-5">
          <code className="text-sm">
            User (Slack/Telegram/WhatsApp) &rarr; Webhook &rarr; Agent
            Processing &rarr; Response posted back
          </code>
        </div>
      </div>

      <h2 id="setup">Setup</h2>
      <p>
        The integrations plugin auto-mounts when no custom version exists in
        your template. To customize it, create a plugin file:
      </p>
      <CodeBlock
        code={`// server/plugins/integrations.ts
import { createIntegrationsPlugin } from "@agent-native/core/server";
import { scriptRegistry } from "../../agent.config";

export default createIntegrationsPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
});`}
      />
      <p>
        The plugin registers webhook routes for each enabled platform under{" "}
        <code>/_agent-native/integrations/</code>. Which platforms are active
        depends on which environment variables are configured.
      </p>

      <h2 id="slack">Slack</h2>
      <h3>1. Create a Slack app</h3>
      <p>
        Go to{" "}
        <a
          href="https://api.slack.com/apps"
          target="_blank"
          rel="noopener noreferrer"
        >
          api.slack.com/apps
        </a>{" "}
        and create a new app. Under <strong>OAuth &amp; Permissions</strong>,
        add the following bot token scopes:
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <code>chat:write</code> — send messages
        </li>
        <li>
          <code>app_mentions:read</code> — receive @-mentions (optional)
        </li>
      </ul>

      <h3>2. Enable Event Subscriptions</h3>
      <p>
        Under <strong>Event Subscriptions</strong>, set the Request URL to:
      </p>
      <CodeBlock
        code={`https://your-app.example.com/_agent-native/integrations/slack/webhook`}
        lang="text"
      />
      <p>
        Subscribe to the <code>message.im</code> bot event (and optionally{" "}
        <code>app_mention</code> for channel mentions).
      </p>

      <h3>3. Set environment variables</h3>
      <CodeBlock
        code={`SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret`}
      />
      <p>
        The bot token is found under <strong>OAuth &amp; Permissions</strong>{" "}
        after installing the app to your workspace. The signing secret is under{" "}
        <strong>Basic Information</strong>.
      </p>

      <h2 id="telegram">Telegram</h2>
      <h3>1. Create a bot</h3>
      <p>
        Message{" "}
        <a
          href="https://t.me/BotFather"
          target="_blank"
          rel="noopener noreferrer"
        >
          @BotFather
        </a>{" "}
        on Telegram and use the <code>/newbot</code> command. You will receive a
        bot token.
      </p>

      <h3>2. Set environment variables</h3>
      <CodeBlock code={`TELEGRAM_BOT_TOKEN=your-bot-token`} />

      <h3>3. Register the webhook</h3>
      <p>
        After deploying your app, call the setup endpoint to register the
        webhook with Telegram:
      </p>
      <CodeBlock
        code={`// The integrations plugin exposes a setup endpoint
POST /_agent-native/integrations/telegram/setup

// This calls Telegram's setWebhook API pointing to:
// https://your-app.example.com/_agent-native/integrations/telegram/webhook`}
        lang="text"
      />
      <p>
        You can also register the webhook manually using the Telegram Bot API if
        you prefer.
      </p>

      <h2 id="whatsapp">WhatsApp</h2>
      <h3>1. Set up the WhatsApp Cloud API</h3>
      <p>
        Go to the{" "}
        <a
          href="https://developers.facebook.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Meta Developer Portal
        </a>
        , create an app, and enable the WhatsApp product. Configure a phone
        number for your business.
      </p>

      <h3>2. Set environment variables</h3>
      <CodeBlock
        code={`WHATSAPP_ACCESS_TOKEN=your-access-token
WHATSAPP_VERIFY_TOKEN=your-verify-token
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id`}
      />
      <p>
        The verify token is a string you choose — Meta uses it during webhook
        verification. The access token and phone number ID come from the Meta
        Developer Portal.
      </p>

      <h3>3. Configure the webhook</h3>
      <p>In the Meta Developer Portal, set the webhook URL to:</p>
      <CodeBlock
        code={`https://your-app.example.com/_agent-native/integrations/whatsapp/webhook`}
        lang="text"
      />
      <p>
        Subscribe to the <code>messages</code> webhook field.
      </p>

      <h2 id="configuration">Configuration</h2>
      <p>
        Integrations can be managed from the settings UI in the sidebar. Each
        platform shows its connection status and webhook URL. You can
        enable/disable individual integrations without removing environment
        variables.
      </p>
      <p>The webhook URLs follow a consistent pattern:</p>
      <CodeBlock
        code={`/_agent-native/integrations/<platform>/webhook

# Examples:
/_agent-native/integrations/slack/webhook
/_agent-native/integrations/telegram/webhook
/_agent-native/integrations/whatsapp/webhook`}
        lang="text"
      />

      <h2 id="thread-continuity">Thread continuity</h2>
      <p>
        Conversations from external platforms are mapped to internal threads.
        Each Slack DM, Telegram chat, or WhatsApp conversation becomes a
        persistent thread in the agent-native database. This means:
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          The agent retains context across messages in the same external
          conversation
        </li>
        <li>
          External conversations appear in the web UI alongside web-originated
          threads, tagged with their source platform
        </li>
        <li>
          You can continue a conversation that started in Slack from the web UI,
          or vice versa
        </li>
      </ul>

      <h2 id="custom-adapters">Custom adapters</h2>
      <p>
        To add support for a new messaging platform, implement the{" "}
        <code>PlatformAdapter</code> interface:
      </p>
      <CodeBlock
        code={`import type { PlatformAdapter } from "@agent-native/core/server";

const myAdapter: PlatformAdapter = {
  platform: "discord",

  // Verify the incoming webhook request is authentic
  verifyRequest(request: Request): Promise<boolean> {
    // Validate signature headers
  },

  // Extract the message text and thread context from the webhook payload
  parseMessage(body: unknown): Promise<{
    text: string;
    threadId: string;
    senderId: string;
    metadata?: Record<string, unknown>;
  }> {
    // Parse platform-specific payload
  },

  // Send the agent's response back to the platform
  sendResponse(threadId: string, text: string): Promise<void> {
    // Call the platform's API to post the message
  },
};`}
      />
      <p>Register your adapter in the integrations plugin config:</p>
      <CodeBlock
        code={`export default createIntegrationsPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
  adapters: [myAdapter],
});`}
      />

      <h2 id="security">Security</h2>
      <p>Every incoming webhook is verified before processing:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Slack</strong> — HMAC-SHA256 signature verification using{" "}
          <code>SLACK_SIGNING_SECRET</code>. The <code>X-Slack-Signature</code>{" "}
          header is checked against the request body.
        </li>
        <li>
          <strong>Telegram</strong> — requests are validated by checking the
          secret token set during webhook registration via the Telegram Bot API.
        </li>
        <li>
          <strong>WhatsApp</strong> — Meta's webhook verification challenge
          (using <code>WHATSAPP_VERIFY_TOKEN</code>) and payload signature
          validation.
        </li>
      </ul>
      <p>
        All platform credentials (tokens, secrets) are stored as environment
        variables and never persisted in the database or source code. Use the
        settings UI or your deployment platform's env var management to
        configure them.
      </p>
    </DocsLayout>
  );
}
