// @vitest-environment happy-dom

import { appPath } from "@agent-native/core/client/api-path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarTriggerContext } from "@/components/layout/sidebar-trigger";
import { TooltipProvider } from "@/components/ui/tooltip";

const mocks = vi.hoisted(() => ({
  copy: vi.fn<(text: string) => Promise<boolean>>(),
  utilityPanelChange: vi.fn(),
  suggestingChange: vi.fn(),
}));

vi.mock("@agent-native/toolkit/clipboard", () => ({
  writeClipboardText: mocks.copy,
}));
vi.mock("@agent-native/core/client/analytics", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/analytics")
  >()),
  trackEvent: vi.fn(),
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@agent-native/toolkit/app/sharing", () => ({
  ShareButton: (props: {
    defaultOpen?: boolean;
    hideTrigger?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) =>
    createElement(
      "div",
      {
        "data-share-open": String(props.defaultOpen),
        "data-share-trigger-hidden": String(props.hideTrigger),
      },
      props.defaultOpen
        ? createElement(
            "button",
            {
              type: "button",
              "data-share-close": "",
              onClick: () => props.onOpenChange?.(false),
            },
            "Close sharing",
          )
        : null,
    ),
}));

import { DocumentToolbar, toolbarFoldLevel } from "./DocumentToolbar";

describe("toolbarFoldLevel", () => {
  it("folds one step at each room for the controls", () => {
    expect(
      [384, 383, 320, 319, 260, 259, 152, 151, 112, 111].map((width) =>
        toolbarFoldLevel(width, 0),
      ),
    ).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
  });

  it("leaves the controls what the trigger and breadcrumb do not keep", () => {
    // A phone's preview keeps only padding; its page keeps the trigger and
    // the breadcrumb, and a nested page its "…" too.
    expect(toolbarFoldLevel(390, 32)).toBe(1);
    expect(toolbarFoldLevel(390, 192)).toBe(3);
    expect(toolbarFoldLevel(390, 236)).toBe(3);
    expect(toolbarFoldLevel(320, 236)).toBe(5);
  });
});

describe("DocumentToolbar at narrow widths", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  async function renderToolbar(
    width: number,
    props: Partial<ComponentProps<typeof DocumentToolbar>> = {},
    sidebarTrigger: ReactNode = null,
  ) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ width, height: 48 }),
    );
    // A mounted toolbar measures again on resize.
    await act(async () => window.dispatchEvent(new Event("resize")));
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
                SidebarTriggerContext.Provider,
                { value: sidebarTrigger },
                createElement(DocumentToolbar, {
                  documentId: "fold-fixture",
                  utilityPanel: null,
                  onUtilityPanelChange: mocks.utilityPanelChange,
                  onSuggestingChange: mocks.suggestingChange,
                  ...props,
                }),
              ),
            ),
          ),
        ),
      ),
    );
  }

  function toolbarButton(label: string) {
    return container.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
  }

  function shareTrigger() {
    return Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("editor.toolbar.share"),
    );
  }

  async function openPageActions() {
    const trigger = toolbarButton("editor.toolbar.morePageActions");
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
    return Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );
  }

  function menuItem(items: HTMLElement[], label: string) {
    return items.find((item) => item.textContent?.includes(label));
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
    document.body.append(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  // Without a trigger, a top-level page keeps 140px: padding, the page title
  // and a gap.
  it("keeps Comments and Suggesting in the toolbar while it has room", async () => {
    await renderToolbar(800, { suggesting: true });

    expect(toolbarButton("comments.title")).not.toBeNull();
    expect(toolbarButton("editor.toolbar.stopSuggesting")).not.toBeNull();
    expect(shareTrigger()).toBeDefined();
    const items = await openPageActions();
    expect(menuItem(items, "comments.title")).toBeUndefined();
    expect(menuItem(items, "editor.toolbar.copyPageLink")).toBeUndefined();
  });

  it("keeps inline Stop suggesting as the Escape focus target while page actions are visible", async () => {
    const escapeTarget = { current: null as HTMLButtonElement | null };
    await renderToolbar(560, {
      suggesting: true,
      editorEscapeTargetRef: escapeTarget,
    });

    expect(toolbarButton("editor.toolbar.stopSuggesting")).not.toBeNull();
    expect(escapeTarget.current).toBe(
      toolbarButton("editor.toolbar.stopSuggesting"),
    );
    expect(toolbarButton("editor.toolbar.morePageActions")).not.toBeNull();
  });

  it("moves Stop suggesting into page actions before Comments", async () => {
    const escapeTarget = { current: null as HTMLButtonElement | null };
    await renderToolbar(400, {
      suggesting: true,
      editorEscapeTargetRef: escapeTarget,
    });

    expect(toolbarButton("editor.toolbar.stopSuggesting")).toBeNull();
    expect(toolbarButton("comments.title")).not.toBeNull();
    expect(escapeTarget.current).toBe(
      toolbarButton("editor.toolbar.morePageActions"),
    );

    const items = await openPageActions();
    expect(menuItem(items, "comments.title")).toBeUndefined();
    await act(async () =>
      menuItem(items, "editor.toolbar.stopSuggesting")!.click(),
    );
    expect(mocks.suggestingChange).toHaveBeenCalledWith(false);
  });

  it("moves Comments into page actions and keeps Share", async () => {
    await renderToolbar(280);

    expect(toolbarButton("comments.title")).toBeNull();
    expect(shareTrigger()).toBeDefined();

    const items = await openPageActions();
    expect(menuItem(items, "editor.toolbar.copyPageLink")).toBeUndefined();
    await act(async () => menuItem(items, "comments.title")!.click());
    expect(mocks.utilityPanelChange).toHaveBeenCalledWith("comments");
  });

  it("folds by the room the trigger and breadcrumb leave, at the same width", async () => {
    await renderToolbar(380, { compact: true });
    expect(toolbarButton("comments.title")).not.toBeNull();

    await renderToolbar(
      380,
      {
        breadcrumbItems: [
          { id: "parent", title: "Parent" },
          { id: "fold-fixture", title: "Page" },
        ],
      },
      createElement("button", { type: "button" }, "sidebar"),
    );
    expect(toolbarButton("comments.title")).toBeNull();
    expect(shareTrigger()).toBeDefined();
  });

  it("keeps only the breadcrumb and page actions on the narrowest page", async () => {
    mocks.copy.mockResolvedValue(true);
    await renderToolbar(118);

    expect(shareTrigger()).toBeUndefined();
    expect(toolbarButton("editor.toolbar.copyPageLink")).toBeNull();
    expect(toolbarButton("comments.title")).toBeNull();

    const items = await openPageActions();
    expect(menuItem(items, "editor.toolbar.share")).toBeDefined();
    await act(async () => menuItem(items, "editor.toolbar.share")!.click());
    await act(async () => Promise.resolve());
    expect(container.querySelector('[data-share-open="true"]')).not.toBeNull();
    expect(
      container.querySelector('[data-share-trigger-hidden="true"]'),
    ).not.toBeNull();
  });

  it("restores focus to Page actions after closing folded Share", async () => {
    await renderToolbar(118);
    const items = await openPageActions();
    await act(async () => menuItem(items, "editor.toolbar.share")!.click());
    const close =
      container.querySelector<HTMLButtonElement>("[data-share-close]");
    expect(close).not.toBeNull();

    await act(async () => close!.click());
    await act(
      async () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
    expect(document.activeElement).toBe(
      toolbarButton("editor.toolbar.morePageActions"),
    );
  });

  it("keeps the existing clipboard action in page actions", async () => {
    mocks.copy.mockResolvedValue(true);
    await renderToolbar(118);
    const items = await openPageActions();
    await act(async () =>
      menuItem(items, "editor.toolbar.copyPageLink")!.click(),
    );
    expect(mocks.copy).toHaveBeenCalledWith(
      `${window.location.origin}${appPath("/p/fold-fixture")}`,
    );
  });

  it("folds a local file's Share menu into page actions", async () => {
    await renderToolbar(280, {
      source: { mode: "local-files", path: "notes/example.md" },
    });
    expect(shareTrigger()?.getAttribute("aria-label")).toBe(
      "editor.toolbar.share",
    );

    await renderToolbar(118, {
      source: { mode: "local-files", path: "notes/example.md" },
    });
    expect(shareTrigger()).toBeUndefined();
    const items = await openPageActions();
    expect(menuItem(items, "editor.toolbar.copyPageLink")).toBeDefined();
    expect(menuItem(items, "editor.toolbar.createShareableCopy")).toBeDefined();
  });
});
