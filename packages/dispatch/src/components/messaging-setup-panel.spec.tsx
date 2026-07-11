// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessagingSetupPanel } from "./messaging-setup-panel";
import { TooltipProvider } from "./ui/tooltip";

const clientState = vi.hoisted(() => ({
  statuses: [] as any[],
  envStatuses: [] as any[],
}));

vi.mock("@agent-native/core/client", () => ({
  disconnectManagedIntegrationInstallation: vi.fn(() => Promise.resolve()),
  listManagedIntegrationBudgets: vi.fn(() => Promise.resolve([])),
  listManagedIntegrationInstallations: vi.fn(() => Promise.resolve([])),
  listManagedIntegrationScopes: vi.fn(() => Promise.resolve([])),
  listIntegrationStatuses: vi.fn(() => Promise.resolve(clientState.statuses)),
  listIntegrationEnvStatuses: vi.fn(() =>
    Promise.resolve(clientState.envStatuses),
  ),
  managedIntegrationOAuthUrl: vi.fn(
    (platform: string) => `/_agent-native/integrations/${platform}/oauth/start`,
  ),
  managedSlackAgentManifestUrl: vi.fn(
    () => "/_agent-native/integrations/slack/manifest",
  ),
  saveIntegrationEnvVars: vi.fn(),
  saveManagedIntegrationBudget: vi.fn(() => Promise.resolve()),
  saveManagedIntegrationScope: vi.fn(() => Promise.resolve()),
  setIntegrationEnabled: vi.fn(),
  setupIntegration: vi.fn(),
  testManagedIntegrationInstallation: vi.fn(() => Promise.resolve()),
  useFormatters: () => ({
    formatDate: (value: Date | number | string) =>
      new Date(value).toLocaleDateString("en-US"),
  }),
  useT: () => (key: string) =>
    (
      ({
        "messaging.managed.agentManifest": "Agent manifest",
        "messaging.managed.agentManifestDescription":
          "The Agent manifest enables Slack's Agent view and direct messages.",
        "messaging.managed.addToSlack": "Add to Slack",
        "messaging.managed.requiredCredentials":
          "Save the required Slack app credentials below to enable Add to Slack.",
      }) as Record<string, string>
    )[key] ?? key,
}));

vi.mock("@agent-native/core/integrations", () => ({
  listBuiltInChannelIntegrations: () => [
    {
      id: "slack",
      name: "Slack",
      iconKey: "slack",
      description: "Slack description",
      documentation: { href: "/docs/messaging#slack" },
      setup: { steps: ["Create a Slack app."] },
      credentialRequirements: [
        {
          key: "SLACK_BOT_TOKEN",
          label: "Slack Bot Token (legacy)",
          required: false,
        },
        {
          key: "SLACK_CLIENT_ID",
          label: "Slack OAuth Client ID",
          required: true,
        },
      ],
    },
    {
      id: "email",
      name: "Email",
      iconKey: "email",
      description: "Email description",
      documentation: { href: "/docs/messaging#email" },
      setup: { steps: ["Choose a provider."] },
      credentialRequirements: [
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
      ],
    },
  ],
}));

describe("MessagingSetupPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    clientState.statuses = [];
    clientState.envStatuses = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders catalog-backed channel cards", async () => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <MessagingSetupPanel />
        </TooltipProvider>,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Slack");
    expect(container.textContent).toContain("Slack description");
    expect(container.textContent).toContain("Email");
    expect(container.textContent).toContain("Email description");
    expect(container.textContent).not.toContain("Discord");
    expect(
      container.querySelector(
        'a[href="/_agent-native/integrations/slack/manifest"]',
      )?.textContent,
    ).toContain("Agent manifest");
    expect(container.textContent).toContain(
      "enables Slack's Agent view and direct messages",
    );
    expect(
      container.querySelector(
        'a[href="/_agent-native/integrations/slack/oauth/start"]',
      ),
    ).toBeNull();
    expect(
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Add to Slack"),
      )?.disabled,
    ).toBe(true);
    expect(container.textContent).toContain(
      "Save the required Slack app credentials below",
    );
    expect(container.textContent).toContain("Slack Bot Token (legacy)");
  });

  it("shows connected and alternative credential states", async () => {
    clientState.statuses = [
      { platform: "slack", label: "Slack", configured: true, enabled: true },
    ];
    clientState.envStatuses = [
      {
        key: "SLACK_BOT_TOKEN",
        label: "Slack Bot Token",
        required: true,
        configured: true,
      },
      {
        key: "SLACK_CLIENT_ID",
        label: "Slack OAuth Client ID",
        required: true,
        configured: true,
      },
      {
        key: "RESEND_API_KEY",
        label: "Resend API Key",
        required: true,
        configured: true,
      },
      {
        key: "SENDGRID_API_KEY",
        label: "SendGrid API Key",
        required: true,
        configured: false,
      },
    ];

    await act(async () => {
      root.render(
        <TooltipProvider>
          <MessagingSetupPanel />
        </TooltipProvider>,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Connected");
    expect(container.textContent).toContain("Saved");
    expect(
      container.querySelector(
        'a[href="/_agent-native/integrations/slack/oauth/start"]',
      ),
    ).not.toBeNull();
    expect(container.querySelectorAll("button").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("Save credentials");
  });
});
