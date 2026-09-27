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
  captureSelection: vi.fn(),
  preserveSelection: vi.fn(),
  restoreSelection: vi.fn(),
  suggestingChange: vi.fn(),
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
                canSuggest: true,
                onCaptureEditorSelection: mocks.captureSelection,
                onPreserveEditorSelection: mocks.preserveSelection,
                onRestoreEditorSelection: mocks.restoreSelection,
                onSuggestingChange: mocks.suggestingChange,
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
  it("captures the editor selection before pointer-opening Suggest edits", async () => {
    const editor = document.createElement("div");
    editor.tabIndex = 0;
    document.body.append(editor);
    editor.focus();

    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="editor.toolbar.morePageActions"]',
    )!;
    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
    });

    expect(mocks.captureSelection).toHaveBeenCalledWith(false);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(mocks.preserveSelection).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull();

    const item = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((candidate) =>
      candidate.textContent?.includes("editor.toolbar.suggestEdits"),
    );
    expect(item).not.toBeUndefined();
    await act(async () => item!.click());
    expect(mocks.suggestingChange).toHaveBeenCalledWith(true);
    expect(mocks.restoreSelection).toHaveBeenCalledTimes(1);

    editor.remove();
  });

  it("captures the editor selection before keyboard-opening page actions", async () => {
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="editor.toolbar.morePageActions"]',
    )!;
    trigger.focus();

    await act(async () => {
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ArrowDown",
        }),
      );
    });

    expect(mocks.captureSelection).toHaveBeenCalledTimes(1);
    expect(mocks.captureSelection).toHaveBeenCalledWith(true);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(mocks.preserveSelection).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
  });

  it("retains the captured selection when the trigger closes page actions", async () => {
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="editor.toolbar.morePageActions"]',
    )!;
    const pointerDown = () =>
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );

    await act(async () => pointerDown());
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
    expect(mocks.captureSelection).toHaveBeenCalledTimes(1);

    await act(async () => pointerDown());
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(mocks.captureSelection).toHaveBeenCalledTimes(1);
    expect(mocks.restoreSelection).toHaveBeenCalledTimes(1);
  });

  it("restores before recapturing when the trigger rapidly reopens", async () => {
    const pendingFrames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      nextFrame += 1;
      pendingFrames.set(nextFrame, callback);
      return nextFrame;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((frame) => {
      pendingFrames.delete(frame);
    });
    const runPendingFrames = () => {
      const callbacks = [...pendingFrames.values()];
      pendingFrames.clear();
      for (const callback of callbacks) callback(performance.now());
    };
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="editor.toolbar.morePageActions"]',
    )!;
    const pointerDown = () =>
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );

    await act(async () => pointerDown());
    runPendingFrames();
    await act(async () => pointerDown());
    await act(async () => pointerDown());

    expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
    expect(mocks.restoreSelection).toHaveBeenCalledTimes(1);
    expect(mocks.captureSelection).toHaveBeenCalledTimes(2);
  });

  it("cancels deferred selection preservation when page actions closes immediately", async () => {
    const pendingFrames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      nextFrame += 1;
      pendingFrames.set(nextFrame, callback);
      return nextFrame;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((frame) => {
      pendingFrames.delete(frame);
    });
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="editor.toolbar.morePageActions"]',
    )!;

    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
    });
    const item = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((candidate) =>
      candidate.textContent?.includes("editor.toolbar.suggestEdits"),
    );
    expect(item).not.toBeUndefined();
    await act(async () => item!.click());
    for (const callback of pendingFrames.values()) callback(performance.now());

    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(mocks.preserveSelection).not.toHaveBeenCalled();
    expect(mocks.restoreSelection).toHaveBeenCalledTimes(1);
  });
});
