// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WORKSPACE_SETTINGS_SECTIONS } from "./agent-settings-search.js";
import {
  AgentSettingsContent,
  ConnectionsSettingsContent,
} from "./SettingsPanel.js";

// The integrations panel that owns the Builder row is behind
// `<Suspense><lazy(IntegrationsPanel)/></Suspense>` — its dynamic import
// needs real macrotask ticks to settle (more on a cold module cache), not
// just queued microtasks.
async function flushLazyImport(isReady: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (isReady()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

describe("ConnectionsSettingsContent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("leads with the merged integrations panel", () => {
    const content = ConnectionsSettingsContent({
      settingsPanelProps: {
        isDevMode: false,
        onToggleDevMode: vi.fn(),
        showDevToggle: false,
      },
    });
    const child = content.props.children as React.ReactElement<
      Record<string, unknown>
    >;

    expect(content.props.className).toBe("w-full");
    expect(child.type).toBe(Suspense);
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
    const queryClient = new QueryClient();

    await act(async () => {
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <ConnectionsSettingsContent
              settingsPanelProps={{
                isDevMode: false,
                onToggleDevMode: vi.fn(),
                showDevToggle: false,
              }}
            />
          </QueryClientProvider>
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushLazyImport(
      () =>
        builderStatusRequests.length === 1 &&
        container.textContent?.includes(
          "Builder callback could not save credentials",
        ) === true,
    );

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
    const queryClient = new QueryClient();

    await act(async () => {
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <ConnectionsSettingsContent
              settingsPanelProps={{
                isDevMode: false,
                onToggleDevMode: vi.fn(),
                showDevToggle: false,
              }}
            />
          </QueryClientProvider>
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushLazyImport(
      () => container.textContent?.includes("Ready to connect") === true,
    );

    const connectButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Connect Builder"),
    );
    expect(container.textContent).toContain("Ready to connect");
    expect(connectButton?.disabled).toBe(false);

    act(() => root.unmount());
  });

  it("does not flash workspace Builder actions while status loads", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let releaseStatus!: () => void;
    const statusReady = new Promise<void>((resolve) => {
      releaseStatus = resolve;
    });
    const builderStatus = {
      configured: false,
      builderEnabled: true,
      envManaged: false,
      orgName: null,
      connectUrl: "/_agent-native/builder/connect?_an_connect=test",
      appHost: "https://builder.io",
      apiHost: "https://api.builder.io",
      publicKeyConfigured: false,
      privateKeyConfigured: false,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/_agent-native/connection-status/builder")) {
          await statusReady;
          return new Response(JSON.stringify(builderStatus), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/_agent-native/agent-chat/mode")) {
          return new Response(
            JSON.stringify({ devMode: false, canToggle: false }),
            {
              headers: { "Content-Type": "application/json" },
            },
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
          <AgentSettingsContent
            sections={[...WORKSPACE_SETTINGS_SECTIONS, "background"]}
          />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      Array.from(container.querySelectorAll("button")).filter((button) =>
        button.textContent?.includes("Connect Builder"),
      ),
    ).toHaveLength(0);

    await act(async () => {
      releaseStatus();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      Array.from(container.querySelectorAll("button")).filter((button) =>
        button.textContent?.includes("Connect Builder"),
      ),
    ).toHaveLength(5);

    act(() => root.unmount());
  });
});
