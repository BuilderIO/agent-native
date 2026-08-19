// @vitest-environment happy-dom

import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDesktopChatRelayFetch } from "../lib/desktop-chat-relay.js";
import DesktopAppChatShell from "./DesktopAppChatShell.js";

vi.mock("@agent-native/core/client/agent-chat", () => ({
  AgentChatMemoryRouter: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  AgentSidebar: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

const APP_URLS: Record<string, string> = {
  mail: "http://127.0.0.1:43101/desktop-chat/mail-secret/mail/_agent-native/agent-chat",
  calendar:
    "http://127.0.0.1:43102/desktop-chat/calendar-secret/calendar/_agent-native/agent-chat",
};

const requested: string[] = [];
const netFetch = vi.fn(async (input: RequestInfo | URL) => {
  requested.push(input instanceof Request ? input.url : String(input));
  return new Response("{}", { status: 200 });
});

// The relay patches window.fetch once per module load, so the recorder has to
// be in place before the first shell mounts and must survive later stubbing.
window.fetch = netFetch as unknown as typeof window.fetch;

const shellFetches = new Map<string, typeof fetch>();

function RelayProbe({ appId }: { appId: string }) {
  const relayFetch = useDesktopChatRelayFetch();
  useEffect(() => {
    shellFetches.set(appId, relayFetch);
  });
  return null;
}

describe("desktop app chat shell relay attribution", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("electronAPI", {
      desktopChat: { getApiUrl: async (appId: string) => APP_URLS[appId] },
      codeAgents: { listModels: async () => ({ models: [] }) },
      appConfig: {},
    });
    requested.length = 0;
    shellFetches.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function mountShells(appIds: readonly string[]) {
    await act(async () => {
      root.render(
        <>
          {appIds.map((appId) => (
            <DesktopAppChatShell key={appId} appId={appId} appName={appId}>
              <RelayProbe appId={appId} />
            </DesktopAppChatShell>
          ))}
        </>,
      );
    });
  }

  it("sends each mounted shell's framework requests to its own app base", async () => {
    await mountShells(["mail", "calendar"]);

    await act(async () => {
      await shellFetches.get("mail")!("/_agent-native/actions/list-messages");
      await shellFetches.get("calendar")!("/_agent-native/actions/list-events");
    });

    expect(requested).toEqual([
      "http://127.0.0.1:43101/desktop-chat/mail-secret/mail/_agent-native/actions/list-messages",
      "http://127.0.0.1:43102/desktop-chat/calendar-secret/calendar/_agent-native/actions/list-events",
    ]);
  });

  it("refuses to guess an app for an unattributed framework request", async () => {
    await mountShells(["mail", "calendar"]);

    expect(() => window.fetch("/_agent-native/poll")).toThrow(
      /Unattributed .*mail, calendar/,
    );
    expect(requested).toEqual([]);
  });

  it("still relays unattributed requests while a single shell is mounted", async () => {
    await mountShells(["mail"]);

    await act(async () => {
      await window.fetch("/_agent-native/poll");
    });

    expect(requested).toEqual([
      "http://127.0.0.1:43101/desktop-chat/mail-secret/mail/_agent-native/poll",
    ]);
  });
});
