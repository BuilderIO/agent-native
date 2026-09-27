// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clipboardMock = vi.hoisted(() => ({
  writeClipboardText: vi.fn(),
}));

const referralInfoQueryMock = vi.hoisted(() => ({ data: null as unknown }));

vi.mock("../use-action.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../use-action.js")>();
  return { ...actual, useActionQuery: () => referralInfoQueryMock };
});

const agentEngineKeyMock = vi.hoisted(() => ({
  saveAgentEngineApiKey: vi.fn(),
  saveAgentEngineProviderSettings: vi.fn(),
  setAgentEngineProvider: vi.fn(),
}));

const deferredUiModuleLoads = vi.hoisted(() => ({
  builderConnectPopover: false,
}));

vi.mock("../clipboard.js", () => ({
  writeClipboardText: clipboardMock.writeClipboardText,
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    Link: ({
      to,
      children,
      ...props
    }: {
      to: string;
      children: React.ReactNode;
      className?: string;
    }) =>
      actual.useInRouterContext()
        ? React.createElement(actual.Link, { to, children, ...props })
        : React.createElement("a", { ...props, href: to }, children),
  };
});

vi.mock("../agent-engine-key.js", () => ({
  saveAgentEngineApiKey: agentEngineKeyMock.saveAgentEngineApiKey,
  saveAgentEngineProviderSettings:
    agentEngineKeyMock.saveAgentEngineProviderSettings,
  setAgentEngineProvider: agentEngineKeyMock.setAgentEngineProvider,
}));

const i18nMock = vi.hoisted(() => ({
  locale: "en-US",
}));

vi.mock("../i18n.js", () => ({
  AgentNativeI18nProvider: ({
    children,
    initialLocale,
  }: {
    children: React.ReactNode;
    initialLocale?: string;
  }) => {
    i18nMock.locale = initialLocale ?? "en-US";
    return React.createElement(React.Fragment, null, children);
  },
  useFormatters: () => ({
    formatNumber: (value: number) =>
      new Intl.NumberFormat(i18nMock.locale).format(value),
  }),
  useT: () => (key: string, options?: Record<string, unknown>) => {
    const translations: Record<string, Record<string, string>> = {
      "en-US": {
        "agentChat.setup.connectBuilder": "Connect Builder.io",
        "agentPanel.connectAi": "Connect AI",
        "agentPanel.builderOrOwnKeys": "Choose Builder.io or custom keys.",
        "agentPanel.addOwnKeys": "Custom keys",
        "agentChat.common.waiting": "Waiting",
        "agentChat.common.connect": "Connect",
        "agentChat.common.continue": "Continue",
        "agentChat.common.retry": "Retry",
        "agentChat.common.details": "Details",
        "agentChat.common.dismiss": "Dismiss",
        "agentChat.common.copied": "Copied",
        "agentChat.usage.inviteFriends": "Invite friends",
        "agentChat.usage.inviteCredits":
          "Earn {{amount}} Builder credits when a friend subscribes.",
        "agentChat.usage.copyInviteLink": "Copy invite link",
        "agentChat.usage.inviteLinkCopied": "Invite link copied",
        "agentChat.recovery.copyDebug": "Copy debug info",
        "agentChat.recovery.copyFailed": "Copy failed",
        "agentChat.recovery.credentialRejected":
          "The provider rejected the credential used for this request; it is skipped on the next attempt. Retry, or update your provider key if it keeps failing.",
        "agentChat.recovery.newChatHint":
          "This run can be continued in a new chat.",
        "agentChat.recovery.reconnectBuilder": "Reconnect Builder.io",
        "agentChat.recovery.connectingBuilder": "Connecting Builder.io",
        "agentChat.error.stopped": "The agent stopped before finishing",
        "agentChat.error.failed": "The agent hit an error",
        "agentChat.limit.reached": "Step limit reached",
        "agentChat.limit.descriptionWithCount":
          "{{formattedCount}} steps remain for {{scope}}.",
        "agentChat.limit.descriptionAll": "More steps remain for {{scope}}.",
        "agentChat.limit.namedOrganization": "{{organization}}",
        "agentChat.limit.organization": "your organization",
        "agentChat.limit.account": "your account",
        "agentChat.limit.maxSteps": "Max steps",
        "agentChat.limit.saveAndContinue": "Save and continue",
        "agentChat.limit.keepGoing": "Keep going",
        "agentChat.limit.ownerOnly": "Only the owner can change this.",
        "agentChat.common.save": "Save",
        "agentChat.common.settings": "Settings",
        "agentChat.tabs.newChat": "New chat",
        "agentChat.message.forkChat": "Fork chat",
        "agentChat.recovery.forkDescription": "Fork this chat",
        "agentChat.recovery.forkFailed": "Fork failed",
        "agentChat.recovery.forking": "Forking",
      },
      "de-DE": {
        "agentChat.error.stopped": "The agent stopped before finishing",
        "agentChat.error.failed": "The agent hit an error",
        "agentChat.recovery.copyDebug": "Debug-Informationen kopieren",
        "agentChat.recovery.copyFailed": "Kopieren fehlgeschlagen",
        "agentChat.common.copied": "Kopiert",
        "agentChat.common.details": "Details",
        "agentChat.common.dismiss": "Schließen",
        "agentChat.common.retry": "Retry",
        "agentChat.errorMessages.providerAuthentication":
          "Der Modellanbieter hat den gespeicherten API-Schlüssel abgelehnt.",
        "agentChat.limit.descriptionWithCount":
          "{{formattedCount}} Schritte bleiben für {{scope}}.",
      },
    };
    const table =
      translations[i18nMock.locale as keyof typeof translations] ??
      translations["en-US"];
    const template =
      table[key] ?? (options?.defaultValue as string | undefined) ?? key;
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
      String(options?.[name] ?? ""),
    );
  },
}));

vi.mock("../settings/BuilderConnectPopover.js", () => {
  deferredUiModuleLoads.builderConnectPopover = true;
  return {
    BuilderConnectPopover: ({ children }: { children: React.ReactNode }) =>
      children,
  };
});

vi.mock("../settings/useBuilderStatus.js", () => ({
  useBuilderConnectFlow: () => ({
    configured: false,
    connecting: false,
    error: null,
    hasFetchedStatus: true,
    start: vi.fn(),
  }),
}));

import { AgentNativeI18nProvider } from "../i18n.js";
import {
  BuilderSetupCard,
  BuilderSetupContent,
  LoopLimitContinueCard,
  RunErrorRecoveryCard,
} from "./run-recovery.js";

describe("run recovery surfaces", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    clipboardMock.writeClipboardText.mockReset();
    referralInfoQueryMock.data = null;
    agentEngineKeyMock.saveAgentEngineApiKey.mockReset();
    agentEngineKeyMock.saveAgentEngineProviderSettings.mockReset();
    agentEngineKeyMock.setAgentEngineProvider.mockReset();
    agentEngineKeyMock.saveAgentEngineApiKey.mockResolvedValue(undefined);
    agentEngineKeyMock.saveAgentEngineProviderSettings.mockResolvedValue(
      undefined,
    );
    agentEngineKeyMock.setAgentEngineProvider.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    window.history.replaceState(null, "", "/");
  });

  it("offers the Builder subscription link for credit limits only", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message: "You've reached your AI credits limit.",
              errorCode: "credits-limit-daily",
            }}
            onContinue={vi.fn()}
            onRetry={vi.fn()}
            onDismiss={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });

    const upgradeLink = container.querySelector<HTMLAnchorElement>(
      'a[href^="https://builder.io/account/subscription"]',
    );
    expect(container.textContent).toContain(
      "You've reached your AI credits limit.",
    );
    expect(container.textContent).not.toMatch(/error/i);
    expect(container.firstElementChild?.className).toContain("bg-card");
    expect(container.firstElementChild?.className).not.toContain("amber");
    expect(upgradeLink?.textContent).toContain("Add credits in Builder");
    expect(upgradeLink?.target).toBe("_blank");
    expect(new URL(upgradeLink!.href).searchParams.get("utm_content")).toBe(
      "chat_credit_limit",
    );

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message: "The provider is busy.",
              errorCode: "provider_rate_limited",
            }}
            onContinue={vi.fn()}
            onRetry={vi.fn()}
            onDismiss={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });
    expect(
      container.querySelector(
        'a[href^="https://builder.io/account/subscription"]',
      ),
    ).toBeNull();
  });

  it("offers the eligible Builder referral link from the credit-limit card", async () => {
    const inviteUrl = `https://builder.io/signup?fus_ref=${"a".repeat(32)}`;
    referralInfoQueryMock.data = {
      eligible: true,
      inviteUrl,
      creditsPerReferral: 200,
      completedReferrals: 1,
      pendingReferrals: 0,
      creditsEarned: 200,
    };
    clipboardMock.writeClipboardText.mockResolvedValue(true);

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message: "You've reached your AI credits limit.",
              errorCode: "credits-limit-monthly",
            }}
            onContinue={vi.fn()}
            onRetry={vi.fn()}
            onDismiss={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.textContent).toContain(
      "Earn 200 Builder credits when a friend subscribes.",
    );
    const copyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy invite link"]',
    );
    expect(copyButton?.textContent).toContain("Copy invite link");

    await act(async () => {
      copyButton?.click();
      await Promise.resolve();
    });

    expect(clipboardMock.writeClipboardText).toHaveBeenCalledWith(inviteUrl);
    expect(
      container.querySelector('button[aria-label="Invite link copied"]'),
    ).not.toBeNull();
  });

  it("loads Builder connect UI only when a setup surface is reached", async () => {
    expect(deferredUiModuleLoads.builderConnectPopover).toBe(false);

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message: "The agent connection was interrupted.",
              errorCode: "connection_error",
              recoverable: true,
            }}
            onContinue={vi.fn()}
            onRetry={vi.fn()}
            onDismiss={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(deferredUiModuleLoads.builderConnectPopover).toBe(false);

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <BuilderSetupContent />
        </AgentNativeI18nProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(deferredUiModuleLoads.builderConnectPopover).toBe(true);
    });
    expect(
      container.querySelector('a[href="/settings/keys"]')?.textContent,
    ).toBe("Custom keys");
  });

  it("shows an explicit failure state when Copy debug cannot write clipboard", async () => {
    clipboardMock.writeClipboardText.mockResolvedValue(false);

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="de-DE"
          initialPreference="de-DE"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message: "The agent connection was interrupted.",
              errorCode: "connection_error",
              runId: "run-123",
              details: "attempted_runs: run-1, run-2",
              recoverable: true,
            }}
            onContinue={vi.fn()}
            onRetry={vi.fn()}
            onDismiss={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Debug-Informationen kopieren");
    });
    const copyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Debug-Informationen kopieren"),
    );

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(clipboardMock.writeClipboardText).toHaveBeenCalledWith(
      expect.stringContaining("attempted_runs: run-1, run-2"),
    );
    expect(container.textContent).toContain("Kopieren fehlgeschlagen");
  });

  it("keeps recovery actions compact in a narrow chat panel", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message: "The agent connection was interrupted.",
              errorCode: "connection_error",
              runId: "run-123",
              recoverable: true,
            }}
            onContinue={vi.fn()}
            onRetry={vi.fn()}
            onDismiss={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });

    const retryButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Retry"]',
    );
    const newChatButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="New chat"]',
    );
    const copyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy debug info"]',
    );

    expect(retryButton).toBeTruthy();
    expect(newChatButton).toBeTruthy();
    expect(copyButton).toBeTruthy();
    expect(retryButton?.title).toBe("Retry");
    expect(newChatButton?.title).toBe("New chat");
    expect(copyButton?.title).toBe("Copy debug info");
    expect(retryButton?.textContent).toBe("");
    expect(newChatButton?.textContent).toBe("");
  });

  it("gives Continue vertical padding and leaves icon actions unframed", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message: "The agent connection was interrupted.",
              errorCode: "connection_error",
              runId: "run-123",
              recoverable: true,
            }}
            onContinue={vi.fn()}
            onRetry={vi.fn()}
            onDismiss={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });

    const continueButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.trim() === "Continue");
    const actionGroup = continueButton?.nextElementSibling;
    const actionClasses = actionGroup?.className.split(/\s+/) ?? [];

    expect(continueButton?.className).toContain("py-2");
    expect(actionClasses).toEqual(
      expect.arrayContaining(["flex", "shrink-0", "items-center"]),
    );
    expect(actionClasses).not.toContain("border");
    expect(actionClasses).not.toContain("bg-background/60");
    expect(actionClasses).not.toContain("p-0.5");
    expect(actionGroup?.querySelectorAll("button")).toHaveLength(3);
  });

  it("shows Connect AI instead of recovery warnings for desktop relay failures", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message: "Desktop app chat relay failed",
              errorCode: "connection_error",
              runId: "run-123",
              recoverable: true,
            }}
            onContinue={vi.fn()}
            onRetry={vi.fn()}
            onDismiss={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.textContent).toContain("Connect AI");
    expect(container.textContent).toContain("Connect Builder.io");
    expect(container.textContent).toContain("Custom keys");
    expect(container.textContent).not.toContain(
      "The agent stopped before finishing",
    );
    expect(container.querySelector('button[aria-label="Retry"]')).toBeNull();
    expect(container.querySelector('button[aria-label="New chat"]')).toBeNull();
    expect(
      container.querySelector('button[aria-label="Copy debug info"]'),
    ).toBeNull();
  });

  it("keeps Builder credential failures in reconnect recovery", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message: "Invalid token",
              errorCode: "authentication_error",
            }}
            onContinue={vi.fn()}
            onRetry={vi.fn()}
            onDismiss={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.textContent).toContain("Reconnect Builder.io");
    expect(container.textContent).not.toContain("Connect AI");
    expect(container.textContent).not.toContain("Custom keys");
  });

  it("links custom keys to API settings without expanding an inline form", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <BuilderSetupContent />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.textContent).toContain("Connect AI");
    expect(container.textContent).toContain("Connect Builder.io");

    const customKeysLink = container.querySelector<HTMLAnchorElement>(
      'a[href="/settings/keys"]',
    );
    expect(customKeysLink?.textContent).toBe("Custom keys");
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.textContent).not.toContain("Choose a provider");
  });

  it("keeps the Custom keys link within a mounted workspace app", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/ask",
          element: (
            <AgentNativeI18nProvider
              initialLocale="en-US"
              initialPreference="en-US"
              persistPreference={false}
            >
              <BuilderSetupContent />
            </AgentNativeI18nProvider>
          ),
        },
      ],
      { basename: "/dispatch", initialEntries: ["/dispatch/ask"] },
    );

    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });

    const customKeysLink = container.querySelector<HTMLAnchorElement>(
      'a[href="/dispatch/settings/keys"]',
    );
    expect(customKeysLink?.textContent).toBe("Custom keys");
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });

  it("keeps sidebar provider actions in a horizontal row", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <BuilderSetupContent layout="sidebar" />
        </AgentNativeI18nProvider>,
      );
    });

    const actions = container.querySelector(
      ".agent-builder-setup-card__actions",
    );
    expect(actions).not.toBeNull();
    expect(actions?.className).toContain("flex-row");
    expect(actions?.className).not.toContain("flex-col");
  });

  it("keeps retry available on the shared provider setup card", async () => {
    const onRetry = vi.fn();

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <BuilderSetupCard onRetry={onRetry} />
        </AgentNativeI18nProvider>,
      );
    });

    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Retry",
    );
    expect(retryButton).toBeTruthy();

    await act(async () => {
      retryButton?.click();
      retryButton?.click();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect((retryButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps provider setup dismissible when requested", async () => {
    const onDismiss = vi.fn();

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <BuilderSetupCard onDismiss={onDismiss} />
        </AgentNativeI18nProvider>,
      );
    });

    const dismissButton = container.querySelector(
      'button[aria-label="Dismiss"]',
    );
    expect(dismissButton).toBeTruthy();

    await act(async () => {
      dismissButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("formats the step limit with the selected locale", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="de-DE"
          initialPreference="de-DE"
          persistPreference={false}
        >
          <LoopLimitContinueCard
            info={{ maxIterations: 12_345 }}
            onContinue={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("12.345 Schritte");
    });
  });

  // Prod, 2026-08-26 (slides): this exact shape — a 401 whose body is the
  // gateway's absent-credential sentence — reached users whose own key was
  // fine, because the rejected credential belonged to the workspace. They got
  // a setup panel for a connection already marked good and no way forward. The
  // retry premise ("replays the same rejected credential") stopped being true
  // once a 401 started fingerprinting and skipping that credential, so the
  // setup flow and a retry now ship together.
  //
  // The setup state keeps the retry action available below the card.
  it("shows the AI setup flow AND a retry button for a rejected provider key", async () => {
    const onRetry = vi.fn();
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message: "Missing Authentication header",
              errorCode: "http_401",
              details: '401 {"error":{"type":"authentication_error"}}',
            }}
            onContinue={vi.fn()}
            onRetry={onRetry}
            onDismiss={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.textContent).toContain("Connect Builder.io");
    expect(container.textContent).toContain("Custom keys");

    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Retry",
    );
    expect(retryButton).toBeTruthy();
    await act(async () => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("offers retry on the missing-provider card without connecting first", async () => {
    const onRetry = vi.fn();

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message: "No LLM provider is connected.",
              errorCode: "missing_credentials",
            }}
            onContinue={vi.fn()}
            onRetry={onRetry}
            onDismiss={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });

    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Retry",
    );
    expect(retryButton).toBeTruthy();

    await act(async () => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onRetry).toHaveBeenCalledTimes(1);

    await act(async () => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("routes missing-provider errors to API settings and retries on click", async () => {
    const onRetry = vi.fn();

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message: "No LLM provider is connected.",
              errorCode: "missing_credentials",
            }}
            onContinue={vi.fn()}
            onRetry={onRetry}
            onDismiss={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.textContent).toContain("Connect AI");
    expect(container.textContent).not.toContain("The agent hit an error");
    expect(container.textContent).not.toContain(
      "No LLM provider is connected.",
    );
    expect(onRetry).not.toHaveBeenCalled();

    const customKeysLink = Array.from(container.querySelectorAll("a")).find(
      (link) => link.textContent?.includes("Custom keys"),
    );
    expect(customKeysLink?.getAttribute("href")).toBe("/settings/keys");
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.textContent).toContain("Retry");
    expect(onRetry).not.toHaveBeenCalled();

    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Retry",
    );
    await act(async () => {
      retryButton?.click();
      retryButton?.click();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect((retryButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("routes structured provider-key errors to inline setup recovery", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message: "ANTHROPIC_API_KEY is not set",
              errorCode: "missing_credentials",
            }}
            onContinue={vi.fn()}
            onRetry={vi.fn()}
            onDismiss={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.textContent).toContain("Connect AI");
    expect(container.textContent).not.toContain("The agent hit an error");
  });

  it("renders invalid provider keys as setup without the warning", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message: "Invalid API key",
              errorCode: "authentication_error",
            }}
            onContinue={vi.fn()}
            onRetry={vi.fn()}
            onDismiss={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.textContent).toContain("Connect AI");
    expect(container.textContent).toContain("Connect Builder.io");
    expect(container.textContent).not.toContain("The agent hit an error");
  });

  it("routes rejected provider keys to API settings without retrying or dismissing", async () => {
    const onDismiss = vi.fn();
    const onRetry = vi.fn();

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message:
                "The provider rejected the credential used for this request; it is skipped on the next attempt. Retry, or update your provider key if it keeps failing.",
              errorCode: "authentication_error",
            }}
            onContinue={vi.fn()}
            onRetry={onRetry}
            onDismiss={onDismiss}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.textContent).toContain("Connect AI");
    expect(container.textContent).not.toContain("The agent hit an error");

    const customKeysLink = Array.from(container.querySelectorAll("a")).find(
      (link) => link.textContent?.includes("Custom keys"),
    );
    expect(customKeysLink?.getAttribute("href")).toBe("/settings/keys");
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(
      agentEngineKeyMock.saveAgentEngineProviderSettings,
    ).not.toHaveBeenCalled();
    expect(agentEngineKeyMock.setAgentEngineProvider).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("wraps a long unbroken error message instead of overflowing the card", async () => {
    const longUnbrokenMessage =
      "400 " +
      JSON.stringify({
        type: "error",
        error: {
          type: "invalid_request_error",
          message:
            "messages.0.content.0.pdf.source.base64.data: The PDF specified is password protected.",
        },
        request_id:
          "req_011Cf4z4ndjZtcUm5pPTkjPAreallyreallyreallyreallyreallylongtoken",
      });

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message: longUnbrokenMessage,
              errorCode: "invalid_request_error",
              recoverable: false,
            }}
            onContinue={vi.fn()}
            onRetry={vi.fn()}
            onDismiss={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });

    const messageParagraph = Array.from(container.querySelectorAll("p")).find(
      (paragraph) => paragraph.textContent === longUnbrokenMessage,
    );

    expect(messageParagraph).toBeTruthy();
    expect(messageParagraph?.className).toContain("break-words");
  });
});
