// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";

const mocks = vi.hoisted(() => ({
  utilityPanelChange: vi.fn(),
}));

vi.mock("@agent-native/toolkit/clipboard", () => ({
  writeClipboardText: vi.fn(async () => true),
}));
vi.mock("@agent-native/core/client/analytics", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/analytics")
  >()),
  trackEvent: vi.fn(),
}));
vi.mock("@agent-native/core/client/mcp-app-host", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/mcp-app-host")
  >()),
  useIsMcpAppWidgetEmbed: () => false,
  useIsMcpDirectoryWidgetReadOnlyEmbed: () => false,
  useIsMcpDirectoryWidgetWriteEmbed: () => false,
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string, options?: { count?: number }) =>
    options?.count === undefined ? key : `${key}:${options.count}`,
}));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@agent-native/toolkit/app/sharing", () => ({
  ShareButton: () => null,
}));

import { DocumentToolbar } from "./DocumentToolbar";
import { PreviewControlsContext } from "./preview-controls";

describe("DocumentToolbar in a row preview", () => {
  let container: HTMLDivElement;
  let slot: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  async function renderPreviewToolbar(
    controls: { discussionInMenu?: boolean; rowMenu?: boolean } = {},
    props: Partial<ComponentProps<typeof DocumentToolbar>> = {},
  ) {
    await act(async () =>
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
              createElement(
                PreviewControlsContext.Provider,
                {
                  value: {
                    slot,
                    rowMenu:
                      controls.rowMenu === false
                        ? null
                        : createElement(
                            DropdownMenuItem,
                            null,
                            "Duplicate row",
                          ),
                    touch: false,
                    discussionInMenu: controls.discussionInMenu === true,
                  },
                },
                createElement(DocumentToolbar, {
                  compact: true,
                  pageEditorOwner: "row-owner",
                  documentId: "row-page",
                  utilityPanel: null,
                  onUtilityPanelChange: mocks.utilityPanelChange,
                  ...props,
                }),
              ),
            ),
          ),
        ),
      ),
    );
  }

  function slotButton(label: string) {
    return slot.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
  }

  async function openMore() {
    const more = slotButton("editor.toolbar.morePageActions");
    if (!more) throw new Error("The group has no More.");
    await act(async () => {
      more.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
    });
    return Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).map((item) => item.textContent.trim());
  }

  async function selectMenuItem(text: string) {
    const item = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((candidate) => candidate.textContent.trim() === text);
    if (!item) throw new Error(`More has no ${text}.`);
    await act(async () => item.click());
  }

  beforeEach(() => {
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
    slot = document.createElement("div");
    document.body.append(container, slot);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    slot.remove();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("draws Discussion, Share and More into the preview's group, in that order", async () => {
    await renderPreviewToolbar();

    expect(container.querySelector("button")).toBeNull();
    const buttons = Array.from(slot.querySelectorAll("button"));
    const at = (label: string) =>
      buttons.findIndex(
        (button) => button.getAttribute("aria-label") === label,
      );
    expect(at("comments.discussion")).toBeGreaterThanOrEqual(0);
    expect(at("comments.discussion")).toBeLessThan(at("editor.toolbar.share"));
    expect(at("editor.toolbar.share")).toBeLessThan(
      at("editor.toolbar.morePageActions"),
    );
    expect(slotButton("editor.toolbar.info")).toBeNull();
    expect(slot.querySelector("[data-document-toolbar-divider]")).toBeNull();
    expect(
      slot.querySelector('[data-page-editor-owner="row-owner"]'),
    ).not.toBeNull();
  });

  it("lists the row's actions first in More, then Info and Copy page link", async () => {
    await renderPreviewToolbar();

    const items = await openMore();
    expect(items.slice(0, 3)).toEqual([
      "Duplicate row",
      "editor.toolbar.info",
      "editor.toolbar.copyPageLink",
    ]);
    expect(items).not.toContain("comments.discussion");
  });

  it("opens Info from More with focus moving into it", async () => {
    await renderPreviewToolbar({ rowMenu: false });

    const items = await openMore();
    expect(items[0]).toBe("editor.toolbar.info");
    await selectMenuItem("editor.toolbar.info");
    expect(mocks.utilityPanelChange).toHaveBeenLastCalledWith("info", true);
  });

  it("moves Discussion into More when the group has no room for it", async () => {
    await renderPreviewToolbar({ discussionInMenu: true });

    expect(slotButton("comments.discussion")).toBeNull();
    const items = await openMore();
    expect(items.slice(0, 3)).toEqual([
      "Duplicate row",
      "comments.discussion",
      "editor.toolbar.info",
    ]);
    await selectMenuItem("comments.discussion");
    expect(mocks.utilityPanelChange).toHaveBeenLastCalledWith("comments", true);
  });

  it("holds the group's controls inert while the page is read", async () => {
    await renderPreviewToolbar({}, { inert: true });

    const more = slotButton("editor.toolbar.morePageActions");
    expect(more?.closest("[inert]")).not.toBeNull();
  });
});
