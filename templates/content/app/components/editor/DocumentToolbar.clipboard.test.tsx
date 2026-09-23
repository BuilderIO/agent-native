// @vitest-environment happy-dom

import { appPath } from "@agent-native/core/client/api-path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const mocks = vi.hoisted(() => ({
  copy: vi.fn<(text: string) => Promise<boolean>>(),
  error: vi.fn(),
  success: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@agent-native/core/client/clipboard", () => ({
  writeClipboardText: mocks.copy,
}));
vi.mock("@agent-native/core/client/analytics", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/analytics")
  >()),
  trackEvent: mocks.track,
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: {
    error: mocks.error,
    success: mocks.success,
  },
}));

import { DocumentToolbar } from "./DocumentToolbar";

describe("DocumentToolbar clipboard behavior", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(
            TooltipProvider,
            null,
            createElement(
              QueryClientProvider,
              { client: queryClient },
              createElement(DocumentToolbar, {
                documentId: "clipboard-fixture",
                utilityPanel: null,
                onUtilityPanelChange: () => {},
              }),
            ),
          ),
        ),
      );
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  async function copyFromLinkMenu(label: string) {
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="editor.toolbar.copyLink"]',
    );
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger!.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
    });

    const item = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((candidate) => candidate.textContent?.includes(label));
    expect(item).not.toBeUndefined();
    await act(async () => item!.click());
  }

  it("copies the canonical page URL before reporting success", async () => {
    mocks.copy.mockResolvedValue(true);

    await copyFromLinkMenu("editor.toolbar.copyForPeople");

    expect(mocks.copy).toHaveBeenCalledWith(
      `${window.location.origin}${appPath("/p/clipboard-fixture")}`,
    );
    expect(mocks.success).toHaveBeenCalledWith("editor.toolbar.copiedPageLink");
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.track).toHaveBeenCalledWith("share_link_copied", {
      resource_type: "document",
      resource_id: "clipboard-fixture",
      link_type: "share",
    });
  });

  it("reports failure without a success toast or analytics", async () => {
    mocks.copy.mockResolvedValue(false);

    await copyFromLinkMenu("editor.toolbar.copyForPeople");

    expect(mocks.error).toHaveBeenCalledWith(
      "editor.toolbar.couldNotCopyLink",
      { description: "editor.toolbar.clipboardAccessUnavailable" },
    );
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("copies an agent request without creating a share grant", async () => {
    mocks.copy.mockResolvedValue(true);

    await copyFromLinkMenu("editor.toolbar.copyForAgents");

    expect(mocks.copy).toHaveBeenCalledWith("editor.toolbar.agentPrompt");
    expect(mocks.success).toHaveBeenCalledWith(
      "editor.toolbar.copiedAgentPrompt",
    );
    expect(mocks.track).toHaveBeenCalledWith("share_link_copied", {
      resource_type: "document",
      resource_id: "clipboard-fixture",
      link_type: "agent_prompt",
    });
  });

  it("does not report an agent copy when clipboard access fails", async () => {
    mocks.copy.mockResolvedValue(false);

    await copyFromLinkMenu("editor.toolbar.copyForAgents");

    expect(mocks.error).toHaveBeenCalledWith(
      "editor.toolbar.couldNotCopyAgentPrompt",
      { description: "editor.toolbar.clipboardAccessUnavailable" },
    );
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("keeps local-file documents on their local page link", async () => {
    mocks.copy.mockResolvedValue(true);
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(
            TooltipProvider,
            null,
            createElement(
              QueryClientProvider,
              { client: queryClient },
              createElement(DocumentToolbar, {
                documentId: "clipboard-fixture",
                source: { mode: "local-files", path: "notes/example.md" },
                utilityPanel: null,
                onUtilityPanelChange: () => {},
              }),
            ),
          ),
        ),
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="editor.toolbar.copyLink"]',
    );
    expect(trigger).not.toBeNull();
    await act(async () => trigger!.click());

    expect(mocks.copy).toHaveBeenCalledWith(
      `${window.location.origin}${appPath("/page/clipboard-fixture")}`,
    );
    expect(mocks.track).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="menuitem"]')).toBeNull();
  });
});
