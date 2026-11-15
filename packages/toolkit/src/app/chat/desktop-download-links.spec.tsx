// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DESKTOP_DOWNLOAD_URL } from "../desktop-download.js";
import { AgentPanel } from "./AgentPanel.js";
import { CodeRequiredDialog } from "./components/CodeRequiredDialog.js";

vi.mock("./MultiTabAssistantChat.js", () => ({
  MultiTabAssistantChat: () => null,
}));
vi.mock("../sharing/index.js", () => ({ ShareButton: () => null }));

function hrefsOf(root: ParentNode, label: string): string[] {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>("a"))
    .filter((link) => link.textContent?.includes(label))
    .map((link) => link.getAttribute("href") ?? "");
}

describe("desktop download prompts", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              configured: true,
              builderEnabled: false,
              connectUrl: "/_agent-native/builder/connect?_an_connect=signed",
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("points the code-required dialog desktop option at the shared URL", async () => {
    await act(async () => {
      root.render(<CodeRequiredDialog open onClose={() => {}} />);
    });
    const links = Array.from(
      document.body.querySelectorAll<HTMLAnchorElement>("a"),
    ).map((link) => link.getAttribute("href"));
    expect(links).toContain(DESKTOP_DOWNLOAD_URL);
  });

  it("falls back to the shared URL for the agent panel's code-access CTA", async () => {
    localStorage.setItem("agent-native-panel-mode", "cli");
    await act(async () => {
      root.render(
        <MemoryRouter>
          <AgentPanel
            agentChatSurface="desktop"
            codeAccess={{ enabled: false }}
          />
        </MemoryRouter>,
      );
    });
    expect(hrefsOf(container, "Download")).toContain(DESKTOP_DOWNLOAD_URL);
  });
});
