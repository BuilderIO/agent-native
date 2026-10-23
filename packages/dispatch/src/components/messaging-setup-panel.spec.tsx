// @vitest-environment happy-dom
import {
  saveIntegrationEnvVars,
  saveManagedIntegrationScope,
  type ClientIntegrationScope,
} from "@agent-native/core/client/integrations";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessagingSetupPanel } from "./messaging-setup-panel";
import { TooltipProvider } from "./ui/tooltip";

const clientState = vi.hoisted(() => ({
  statuses: [] as any[],
  envStatuses: [] as any[],
  scopes: [] as (Omit<ClientIntegrationScope, "allowedAgentIds"> & {
    allowedAgentIds?: string[];
  })[],
  agents: [] as { id: string; name: string }[],
  resources: [] as { id: string; name: string; path: string }[],
  agentsLoading: false,
  agentsError: null as Error | null,
  resourcesError: null as Error | null,
  refetchAgents: vi.fn(),
  refetchResources: vi.fn(),
}));

const saveScope = vi.hoisted(() => ({
  scope: "user" as "user" | "org" | null,
  canChoose: false,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) =>
    error instanceof Error &&
    "actionMessage" in error &&
    typeof error.actionMessage === "string"
      ? error.actionMessage
      : undefined,
  useActionQuery: (name: string) => ({
    data:
      name === "list-integration-scopes"
        ? { scopes: clientState.scopes }
        : name === "list-connected-agents"
          ? clientState.agents
          : clientState.resources,
    isLoading: name === "list-connected-agents" && clientState.agentsLoading,
    error:
      name === "list-connected-agents"
        ? clientState.agentsError
        : clientState.resourcesError,
    refetch:
      name === "list-connected-agents"
        ? clientState.refetchAgents
        : clientState.refetchResources,
  }),
}));
vi.mock("@agent-native/toolkit/app/settings", () => ({
  useCredentialSaveScope: () => ({
    ...saveScope,
    setScope: () => {},
    orgName: "",
    roleUnavailable: false,
    retry: () => {},
  }),
  WhoField: ({ scope }: { scope: string }) =>
    React.createElement("div", { "data-who-field": scope }),
}));

vi.mock("@agent-native/core/client/integrations", async () => ({
  // The shared channel helpers are real; only the network calls are faked.
  ...(await vi.importActual<
    typeof import("@agent-native/core/client/integrations")
  >("@agent-native/core/client/integrations")),
  disconnectManagedIntegrationInstallation: vi.fn(() => Promise.resolve()),
  listManagedIntegrationBudgets: vi.fn(() => Promise.resolve([])),
  listManagedIntegrationInstallations: vi.fn(() => Promise.resolve([])),
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
  saveManagedIntegrationScope: vi.fn((input) => {
    clientState.scopes = clientState.scopes.map((scope) =>
      scope.conversationId === input.conversationId
        ? { ...scope, ...input }
        : scope,
    );
    return Promise.resolve(
      clientState.scopes.find(
        (scope) => scope.conversationId === input.conversationId,
      ),
    );
  }),
  setIntegrationEnabled: vi.fn(),
  setupIntegration: vi.fn(),
  testManagedIntegrationInstallation: vi.fn(() => Promise.resolve()),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useFormatters: () => ({
    formatDate: (value: Date | number | string) =>
      new Date(value).toLocaleDateString("en-US"),
  }),
  useT: () => (key: string) =>
    (
      ({
        "messaging.managed.title": "Managed Slack workspaces",
        "messaging.managed.description":
          "Install managed Slack workspaces with channel identities.",
        "messaging.managed.agentManifest": "Agent manifest",
        "messaging.managed.agentManifestDescription":
          "The Agent manifest enables Slack's Agent view and direct messages.",
        "messaging.managed.addToSlack": "Add to Slack",
        "messaging.managed.requiredCredentials":
          "Save the required Slack app credentials below to enable Add to Slack.",
      }) as Record<string, string>
    )[key] ?? key,
}));

vi.mock("@agent-native/core/integrations/catalog", () => ({
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
    clientState.scopes = [];
    clientState.agents = [{ id: "analytics", name: "Analytics" }];
    clientState.resources = [
      { id: "resource-1", name: "Research", path: "agents/research.md" },
    ];
    clientState.agentsLoading = false;
    clientState.agentsError = null;
    clientState.resourcesError = null;
    clientState.refetchAgents.mockClear();
    clientState.refetchResources.mockClear();
    vi.mocked(saveManagedIntegrationScope).mockClear();
    saveScope.scope = "user";
    saveScope.canChoose = false;
    vi.mocked(saveIntegrationEnvVars).mockClear();
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
      ),
    ).toBeNull();
    const slackTrigger = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Slack"),
    );
    expect(slackTrigger).toBeDefined();
    await act(async () => {
      slackTrigger?.click();
      await Promise.resolve();
    });
    const managedTrigger = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Managed Slack workspaces"),
    );
    await act(async () => {
      managedTrigger?.click();
      await Promise.resolve();
    });
    const credentialsTrigger = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Credentials"),
    );
    await act(async () => {
      credentialsTrigger?.click();
      await Promise.resolve();
    });
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
    const slackTrigger = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Slack"),
    );
    await act(async () => {
      slackTrigger?.click();
      await Promise.resolve();
    });
    const managedTrigger = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Managed Slack workspaces"),
    );
    await act(async () => {
      managedTrigger?.click();
      await Promise.resolve();
    });
    const credentialsTrigger = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Credentials"),
    );
    await act(async () => {
      credentialsTrigger?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Saved");
    expect(
      container.querySelector(
        'a[href="/_agent-native/integrations/slack/oauth/start"]',
      ),
    ).not.toBeNull();
    expect(container.querySelectorAll("button").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("Save credentials");
  });
  async function openSlackCredentials() {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <MessagingSetupPanel />
        </TooltipProvider>,
      );
      await Promise.resolve();
    });
    for (const label of ["Slack", "Credentials"]) {
      const trigger = [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes(label),
      );
      await act(async () => {
        trigger?.click();
        await Promise.resolve();
      });
    }
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Enter Slack OAuth Client ID"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "client-id");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Save credentials",
    )!;
  }

  it("saves an owner's or admin's channel credentials for the organization", async () => {
    saveScope.scope = "org";
    saveScope.canChoose = true;
    const save = await openSlackCredentials();

    expect(container.querySelector('[data-who-field="org"]')).not.toBeNull();
    await act(async () => {
      save.click();
      await Promise.resolve();
    });

    expect(saveIntegrationEnvVars).toHaveBeenCalledWith(
      [{ key: "SLACK_CLIENT_ID", value: "client-id" }],
      { scope: "org" },
    );
  });

  it("saves a member's channel credentials personally with no picker", async () => {
    const save = await openSlackCredentials();

    expect(container.querySelector("[data-who-field]")).toBeNull();
    await act(async () => {
      save.click();
      await Promise.resolve();
    });

    expect(saveIntegrationEnvVars).toHaveBeenCalledWith(
      [{ key: "SLACK_CLIENT_ID", value: "client-id" }],
      { scope: "user" },
    );
  });

  it("keeps Save off until the role is read", async () => {
    saveScope.scope = null;
    const save = await openSlackCredentials();

    expect(save.disabled).toBe(true);
  });

  async function openConversation(
    conversationId = "C123",
    conversationType: ClientIntegrationScope["conversationType"] = "channel",
    allowedAgentIds?: string[],
  ) {
    clientState.scopes = [
      {
        id: "scope-1",
        platform: "slack",
        tenantId: "T123",
        conversationId,
        conversationType,
        trust: "trusted",
        orgId: "org-1",
        serviceOwnerEmail: "slack-channel@example.com",
        defaultModel: null,
        updatedAt: 1,
        allowedAgentIds,
        policy: {
          requireMention: true,
          allowDirectMessages: false,
          allowGuests: false,
          allowExternalShared: false,
          allowUnknownTrust: false,
        },
      },
    ];
    await act(async () => {
      root.render(
        <TooltipProvider>
          <MessagingSetupPanel />
        </TooltipProvider>,
      );
    });
    for (const label of [
      "Slack",
      "messaging.managed.channelAccessTitle",
      conversationId,
    ]) {
      const trigger = [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes(label),
      );
      expect(trigger).toBeDefined();
      await act(async () => {
        trigger!.click();
      });
    }
  }

  function profileCheckbox(name: string) {
    return [
      ...container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]'),
    ].find((checkbox) =>
      checkbox.closest("label")?.textContent?.includes(name),
    )!;
  }

  it.each([
    ["C123", "channel"],
    ["D123", "direct_message"],
  ] as const)(
    "grants canonical profiles and revokes all grants for %s",
    async (conversationId, conversationType) => {
      await openConversation(conversationId, conversationType);
      expect(profileCheckbox("Analytics").getAttribute("aria-checked")).toBe(
        "false",
      );
      await act(async () => {
        profileCheckbox("Analytics").click();
      });
      expect(saveManagedIntegrationScope).toHaveBeenLastCalledWith(
        expect.objectContaining({
          conversationId,
          conversationType,
          allowedAgentIds: ["analytics"],
        }),
      );
      expect(profileCheckbox("Analytics").getAttribute("aria-checked")).toBe(
        "true",
      );
      await act(async () => {
        profileCheckbox("Research").click();
      });
      expect(saveManagedIntegrationScope).toHaveBeenLastCalledWith(
        expect.objectContaining({
          allowedAgentIds: ["analytics", "agents/research.md"],
        }),
      );
      const policySwitch =
        container.querySelector<HTMLButtonElement>('[role="switch"]')!;
      await act(async () => {
        policySwitch.click();
      });
      expect(saveManagedIntegrationScope).toHaveBeenLastCalledWith(
        expect.objectContaining({
          allowedAgentIds: ["analytics", "agents/research.md"],
          policy: expect.objectContaining({ requireMention: false }),
        }),
      );
      await act(async () => {
        profileCheckbox("Analytics").click();
      });
      await act(async () => {
        profileCheckbox("Research").click();
      });
      expect(saveManagedIntegrationScope).toHaveBeenLastCalledWith(
        expect.objectContaining({
          allowedAgentIds: [],
        }),
      );
      expect(profileCheckbox("Analytics").getAttribute("aria-checked")).toBe(
        "false",
      );
      expect(profileCheckbox("Research").getAttribute("aria-checked")).toBe(
        "false",
      );
    },
  );

  it("shows loading and query failures without treating them as an empty profile list", async () => {
    clientState.agentsLoading = true;
    await openConversation();
    expect(
      container.querySelector('[role="status"]')?.getAttribute("aria-label"),
    ).toBe("messaging.managed.profilesLoading");
    clientState.agentsLoading = false;
    clientState.agentsError = new Error("Discovery unavailable");
    await act(async () => {
      root.render(
        <TooltipProvider>
          <MessagingSetupPanel />
        </TooltipProvider>,
      );
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "messaging.managed.profilesLoadFailed",
    );
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "messaging.managed.profilesRetry",
    );
    await act(async () => {
      retry!.click();
    });
    expect(clientState.refetchAgents).toHaveBeenCalledOnce();
    expect(clientState.refetchResources).toHaveBeenCalledOnce();
  });

  it("keeps rejected grants unchecked and allows another attempt", async () => {
    vi.mocked(saveManagedIntegrationScope).mockRejectedValueOnce(
      new Error("Not authorized"),
    );
    await openConversation();
    await act(async () => {
      profileCheckbox("Analytics").click();
    });
    expect(profileCheckbox("Analytics").getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(profileCheckbox("Analytics").disabled).toBe(false);
    await act(async () => {
      profileCheckbox("Analytics").click();
    });
    expect(profileCheckbox("Analytics").getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("allows revoking an existing grant even when its profile is no longer discoverable", async () => {
    await openConversation("D123", "direct_message", ["agents/removed.md"]);
    expect(
      profileCheckbox("agents/removed.md").getAttribute("aria-checked"),
    ).toBe("true");
    await act(async () => {
      profileCheckbox("agents/removed.md").click();
    });
    expect(saveManagedIntegrationScope).toHaveBeenLastCalledWith(
      expect.objectContaining({
        allowedAgentIds: [],
      }),
    );
    expect(container.textContent).not.toContain("agents/removed.md");
  });

  it("shows a real empty state when both profile catalogs are empty", async () => {
    clientState.agents = [];
    clientState.resources = [];
    await openConversation();
    expect(container.textContent).toContain("messaging.managed.profilesEmpty");
    expect(container.querySelector('[role="checkbox"]')).toBeNull();
  });
});
