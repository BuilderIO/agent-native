// @vitest-environment happy-dom

import { appPath } from "@agent-native/core/client/api-path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, type ReactNode } from "react";
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
vi.mock("@agent-native/core/client/sharing", () => ({
  ShareButton: ({
    quickCopy,
    agentTabContent,
  }: {
    quickCopy: { label: string; onCopy: () => Promise<boolean | void> };
    agentTabContent: ReactNode;
  }) =>
    createElement(
      "div",
      null,
      createElement(
        "button",
        { onClick: () => void quickCopy.onCopy() },
        quickCopy.label,
      ),
      agentTabContent,
    ),
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

  async function copyFromShare(label: string) {
    const trigger = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) =>
      candidate.textContent?.includes("editor.toolbar.share"),
    );
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger!.click();
    });

    const item = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent?.includes(label));
    expect(item).not.toBeUndefined();
    await act(async () => item!.click());
  }

  it("copies the canonical page URL before reporting success", async () => {
    mocks.copy.mockResolvedValue(true);

    await copyFromShare("editor.toolbar.copyPageLink");

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

  it("offers the joined quick-copy action before the Share panel loads", async () => {
    mocks.copy.mockResolvedValue(true);
    const quickCopy = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find(
      (candidate) =>
        candidate.getAttribute("aria-label") === "editor.toolbar.copyPageLink",
    );
    expect(quickCopy).toBeDefined();
    await act(async () => quickCopy!.click());
    expect(mocks.copy).toHaveBeenCalledWith(
      `${window.location.origin}${appPath("/p/clipboard-fixture")}`,
    );
    expect(container.textContent).not.toContain(
      "editor.toolbar.copyAgentPrompt",
    );
  });

  it("reports failure without a success toast or analytics", async () => {
    mocks.copy.mockResolvedValue(false);

    await copyFromShare("editor.toolbar.copyPageLink");

    expect(mocks.error).toHaveBeenCalledWith(
      "editor.toolbar.couldNotCopyLink",
      { description: "editor.toolbar.clipboardAccessUnavailable" },
    );
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("copies an agent request without creating a share grant", async () => {
    mocks.copy.mockResolvedValue(true);

    await copyFromShare("editor.toolbar.copyAgentPrompt");

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

    await copyFromShare("editor.toolbar.copyAgentPrompt");

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

    const trigger = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) =>
      candidate.textContent?.includes("editor.toolbar.share"),
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
    const copyItem = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((candidate) =>
      candidate.textContent?.includes("editor.toolbar.copyPageLink"),
    );
    expect(copyItem).not.toBeUndefined();
    await act(async () => copyItem!.click());

    expect(mocks.copy).toHaveBeenCalledWith(
      `${window.location.origin}${appPath("/page/clipboard-fixture")}`,
    );
    expect(mocks.track).not.toHaveBeenCalled();
    expect(
      container.querySelector('[aria-label="editor.toolbar.copyLink"]'),
    ).toBeNull();
  });
});
