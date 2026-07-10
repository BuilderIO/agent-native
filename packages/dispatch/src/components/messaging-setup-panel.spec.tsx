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
  listIntegrationStatuses: vi.fn(() => Promise.resolve(clientState.statuses)),
  listIntegrationEnvStatuses: vi.fn(() =>
    Promise.resolve(clientState.envStatuses),
  ),
  saveIntegrationEnvVars: vi.fn(),
  setIntegrationEnabled: vi.fn(),
  setupIntegration: vi.fn(),
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
        { key: "SLACK_BOT_TOKEN", label: "Slack Bot Token", required: true },
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
    expect(container.querySelectorAll("button").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("Save credentials");
  });
});
