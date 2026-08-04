// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BuilderConnectCard } from "../setup-connections/BuilderConnectCard.js";
import { ConnectionsSettingsContent } from "./SettingsPanel.js";

describe("ConnectionsSettingsContent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("leads with the integrations gallery before setup sections", () => {
    const content = ConnectionsSettingsContent({
      settingsPanelProps: {
        isDevMode: false,
        onToggleDevMode: vi.fn(),
        showDevToggle: false,
      },
    });
    const children = React.Children.toArray(content.props.children) as Array<
      React.ReactElement<Record<string, unknown>>
    >;

    expect(content.props.className).toContain("w-full");
    expect(children).toHaveLength(3);
    expect(children[1]?.type).toBe(BuilderConnectCard);
    expect(children[1]?.props.trackingSource).toBe("settings_connections");
    expect(children[2]?.props.surface).toBe("page");
    expect(children[2]?.props.showCapabilityStrip).toBe(false);
    expect(children[2]?.props.builderConnectionOwnedExternally).toBe(true);
  });

  it("has one Builder status owner and preserves its one-shot connect error", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const builderStatusRequests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/_agent-native/connection-status/builder")) {
          builderStatusRequests.push(url);
          return new Response(
            JSON.stringify({
              configured: false,
              builderEnabled: true,
              envManaged: false,
              orgName: null,
              connectUrl: "/_agent-native/builder/connect?_an_connect=test",
              appHost: "https://builder.io",
              apiHost: "https://api.builder.io",
              publicKeyConfigured: false,
              privateKeyConfigured: false,
              connectError: {
                message: "Builder callback could not save credentials",
                at: Date.now(),
              },
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/_agent-native/usage")) {
          return new Response(
            JSON.stringify({
              billing: {
                unit: "usd",
                label: "Estimated spend",
                shortLabel: "Cost",
                source: "estimated-provider-cost",
              },
              totalCost: {
                status: "known",
                knownCents: 0,
                unavailableCalls: 0,
              },
              totalCalls: 0,
              totalInputTokens: 0,
              totalOutputTokens: 0,
              totalCacheReadTokens: 0,
              totalCacheWriteTokens: 0,
              byLabel: [],
              byModel: [],
              byApp: [],
              byDay: [],
              recent: [],
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify([]), {
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ConnectionsSettingsContent
            settingsPanelProps={{
              isDevMode: false,
              onToggleDevMode: vi.fn(),
              showDevToggle: false,
            }}
          />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(builderStatusRequests).toHaveLength(1);
    expect(container.textContent).toContain(
      "Builder callback could not save credentials",
    );
    expect(container.querySelector('a[href="/agent#connections"]')).toBe(null);

    act(() => root.unmount());
  });

  it("keeps Builder account connection available without a branch project", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/_agent-native/connection-status/builder")) {
          return new Response(
            JSON.stringify({
              configured: false,
              builderEnabled: false,
              envManaged: false,
              orgName: null,
              connectUrl: "/_agent-native/builder/connect?_an_connect=test",
              appHost: "https://builder.io",
              apiHost: "https://api.builder.io",
              publicKeyConfigured: false,
              privateKeyConfigured: false,
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/_agent-native/usage")) {
          return new Response(
            JSON.stringify({
              billing: {
                unit: "usd",
                label: "Estimated spend",
                shortLabel: "Cost",
                source: "estimated-provider-cost",
              },
              totalCost: {
                status: "known",
                knownCents: 0,
                unavailableCalls: 0,
              },
              totalCalls: 0,
              totalInputTokens: 0,
              totalOutputTokens: 0,
              totalCacheReadTokens: 0,
              totalCacheWriteTokens: 0,
              byLabel: [],
              byModel: [],
              byApp: [],
              byDay: [],
              recent: [],
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify([]), {
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ConnectionsSettingsContent
            settingsPanelProps={{
              isDevMode: false,
              onToggleDevMode: vi.fn(),
              showDevToggle: false,
            }}
          />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const connectButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Connect Builder"),
    );
    expect(container.textContent).toContain("Ready to connect");
    expect(connectButton?.disabled).toBe(false);

    act(() => root.unmount());
  });
});
