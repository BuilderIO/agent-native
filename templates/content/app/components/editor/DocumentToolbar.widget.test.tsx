// @vitest-environment happy-dom

import { appPath } from "@agent-native/core/client/api-path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarTriggerContext } from "@/components/layout/sidebar-trigger";
import { TooltipProvider } from "@/components/ui/tooltip";

const mocks = vi.hoisted(() => ({
  widget: { inWidget: true, write: true },
  openLink: vi.fn<(url: string) => Promise<boolean> | false>(),
  shareProps: [] as Array<Record<string, any>>,
  fetchUrls: [] as string[],
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
  openMcpAppHostLink: mocks.openLink,
  useIsMcpAppWidgetEmbed: () => mocks.widget.inWidget,
  useIsMcpDirectoryWidgetReadOnlyEmbed: () =>
    mocks.widget.inWidget && !mocks.widget.write,
  useIsMcpDirectoryWidgetWriteEmbed: () => mocks.widget.write,
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
  ShareButton: (props: Record<string, any>) => {
    mocks.shareProps.push(props);
    return createElement("div", {
      "data-share-open": String(props.defaultOpen),
    });
  },
}));

import { DocumentToolbar } from "./DocumentToolbar";

const PAGE_URL = `${window.location.origin}${appPath("/page/widget-fixture")}`;
// Layout reads the labs once for the whole page, in a widget too, and the
// toolbar shares that query, so it is not a request the toolbar adds.
const LABS_URL_SUFFIX = "/get-lab-states";
const AI_AGENT_LABEL = "AI agent";

describe("DocumentToolbar in an MCP App widget", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  async function renderToolbar(
    width: number,
    props: Partial<ComponentProps<typeof DocumentToolbar>> = {},
  ) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ width, height: 48 }),
    );
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
                { value: null },
                createElement(DocumentToolbar, {
                  documentId: "widget-fixture",
                  documentTitle: "Roadmap",
                  utilityPanel: null,
                  onUtilityPanelChange: vi.fn(),
                  // The document marks every widget read-only, whatever its
                  // grant; the toolbar reads the grant.
                  readOnly: true,
                  canEdit: true,
                  ...props,
                }),
              ),
            ),
          ),
        ),
      ),
    );
  }

  function requests() {
    return mocks.fetchUrls.filter((url) => !url.endsWith(LABS_URL_SUFFIX));
  }

  function byLabel<T extends HTMLElement>(label: string) {
    return container.querySelector<T>(`[aria-label="${label}"]`);
  }

  function openLink() {
    return byLabel<HTMLAnchorElement>("editor.toolbar.openInAgentNative");
  }

  async function openPageActions() {
    const trigger = byLabel<HTMLButtonElement>(
      "editor.toolbar.morePageActions",
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
    return Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );
  }

  // Records whether the component's own handler cancelled the click, then
  // cancels it so happy-dom does not navigate.
  function clickLink(link: Element) {
    let cancelledByHandler = false;
    const observe = (event: Event) => {
      cancelledByHandler = event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener("click", observe);
    link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    document.removeEventListener("click", observe);
    return cancelledByHandler;
  }

  beforeEach(() => {
    mocks.widget.inWidget = true;
    mocks.widget.write = true;
    mocks.shareProps.length = 0;
    mocks.fetchUrls.length = 0;
    mocks.openLink.mockReset();
    mocks.openLink.mockReturnValue(false);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        mocks.fetchUrls.push(String(input));
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
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
    vi.unstubAllGlobals();
  });

  it.each([360, 400, 620, 1040])(
    "keeps the page title and Share at %ipx",
    async (width) => {
      await renderToolbar(width);

      expect(byLabel("editor.toolbar.pageBreadcrumb")?.textContent).toContain(
        "Roadmap",
      );
      expect(byLabel("editor.toolbar.share")).not.toBeNull();
      expect(byLabel("editor.toolbar.copyPageLink")).not.toBeNull();
    },
  );

  it("lets the page title use the room the bar has, which the app caps at 14rem", async () => {
    await renderToolbar(1040);
    const widgetTitle = byLabel("editor.toolbar.pageBreadcrumb")?.querySelector(
      "span.truncate",
    );
    expect(widgetTitle?.textContent).toBe("Roadmap");
    expect(widgetTitle?.className).not.toContain("max-w-56");

    mocks.widget.inWidget = false;
    mocks.widget.write = false;
    await renderToolbar(1040);
    const appTitle = byLabel("editor.toolbar.pageBreadcrumb")?.querySelector(
      "span.truncate",
    );
    expect(appTitle?.textContent).toBe("Roadmap");
    expect(appTitle?.className).toContain("max-w-56");
  });

  it("shows Open inline from 480px and in the page-actions menu under it", async () => {
    for (const width of [1040, 620, 480]) {
      await renderToolbar(width);
      const link = openLink();
      expect(link?.getAttribute("href")).toBe(PAGE_URL);
      expect(link?.getAttribute("target")).toBe("_blank");
      expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
      expect(byLabel("editor.toolbar.morePageActions")).toBeNull();
    }

    for (const width of [479, 400, 360]) {
      await renderToolbar(width);
      expect(openLink()).toBeNull();
      const items = await openPageActions();
      // The menu holds the one item: nothing from the app's page actions.
      expect(items.map((item) => item.textContent)).toEqual([
        "editor.toolbar.openInAgentNative",
      ]);
      expect(items[0].getAttribute("href")).toBe(PAGE_URL);
      expect(byLabel("editor.toolbar.share")).not.toBeNull();
      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
    }
  });

  it("leaves out the app's navigation, agent, review, and page-action chrome", async () => {
    const onUndo = vi.fn();
    await renderToolbar(1040, {
      activeUsers: [
        { name: "Ada Lovelace", email: "ada@example.com", color: "#ff0000" },
      ],
      agentPresent: true,
      showCommentsControl: true,
      suggesting: true,
      canSuggest: true,
      canUndo: true,
      canRedo: true,
      onUndo,
      isFavorite: false,
      onToggleFavorite: vi.fn(),
      canDelete: true,
      onDelete: vi.fn(),
      databaseExportContext: null,
    });

    for (const label of [
      "agentPanel.toggleAgent",
      "comments.title",
      "editor.toolbar.stopSuggesting",
      "editor.toolbar.undo",
      "editor.toolbar.redo",
      "editor.toolbar.morePageActions",
      "navigation.openSidebar",
      AI_AGENT_LABEL,
      "Ada Lovelace (ada@example.com)",
    ]) {
      expect(byLabel(label), label).toBeNull();
    }
    expect(
      container.querySelector("[data-comments-history-trigger]"),
    ).toBeNull();
    expect(
      container.querySelector("[data-content-widget-editor-toolbar]"),
    ).toBeNull();
    expect(
      Array.from(container.querySelectorAll("button, a")).map(
        (element) =>
          element.getAttribute("aria-label") ?? element.textContent ?? "",
      ),
    ).toEqual([
      "editor.toolbar.share",
      "editor.toolbar.copyPageLink",
      "editor.toolbar.openInAgentNative",
    ]);
  });

  it("keeps the app's presence, agent toggle, and page actions outside a widget", async () => {
    mocks.widget.inWidget = false;
    mocks.widget.write = false;
    await renderToolbar(1040, {
      readOnly: false,
      agentPresent: true,
      showCommentsControl: true,
    });

    expect(byLabel(AI_AGENT_LABEL)).not.toBeNull();
    expect(byLabel("agentPanel.toggleAgent")).not.toBeNull();
    expect(byLabel("comments.title")).not.toBeNull();
    expect(byLabel("editor.toolbar.openInAgentNative")).toBeNull();
    const trigger = byLabel("editor.toolbar.morePageActions");
    expect(trigger?.className).toContain("h-9");
    expect(trigger?.className).toContain("w-9");
    expect(trigger?.className).not.toContain("size-11");
  });

  it("sizes every control in the bar for touch, and the bar stays 48px", async () => {
    await renderToolbar(1040);
    const bar = container.querySelector<HTMLElement>(
      "[data-editor-selection-continuation]",
    );
    expect(bar?.className).toContain("h-12");

    const group = byLabel("editor.toolbar.share")!.parentElement!;
    expect(group.className).toContain("[&>*]:h-11");
    expect(group.className).toContain("[&>*]:min-w-11");
    expect(group.className).not.toContain("[&>*]:h-9");
    expect(openLink()?.className).toContain("size-11");

    await renderToolbar(360);
    expect(byLabel("editor.toolbar.morePageActions")?.className).toContain(
      "size-11",
    );
    expect(byLabel("editor.toolbar.morePageActions")?.className).not.toContain(
      "h-9",
    );
  });

  describe("the Open link", () => {
    it("hands the page URL to the host and keeps the click from also opening a tab", async () => {
      mocks.openLink.mockReturnValue(Promise.resolve(true));
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      await renderToolbar(1040);

      expect(clickLink(openLink()!)).toBe(true);
      await act(async () => Promise.resolve());

      expect(mocks.openLink).toHaveBeenCalledExactlyOnceWith(PAGE_URL);
      expect(open).not.toHaveBeenCalled();
    });

    it("opens a tab itself when the host refuses", async () => {
      mocks.openLink.mockReturnValue(Promise.resolve(false));
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      await renderToolbar(1040);

      expect(clickLink(openLink()!)).toBe(true);
      await act(async () => Promise.resolve());

      expect(open).toHaveBeenCalledExactlyOnceWith(
        PAGE_URL,
        "_blank",
        "noopener,noreferrer",
      );
    });

    it("leaves the click to the anchor when there is no host", async () => {
      mocks.openLink.mockReturnValue(false);
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      await renderToolbar(1040);

      expect(clickLink(openLink()!)).toBe(false);

      expect(mocks.openLink).toHaveBeenCalledExactlyOnceWith(PAGE_URL);
      expect(open).not.toHaveBeenCalled();
    });

    it("works from the page-actions menu", async () => {
      mocks.openLink.mockReturnValue(Promise.resolve(true));
      await renderToolbar(360);

      const [item] = await openPageActions();

      expect(clickLink(item)).toBe(true);
      expect(mocks.openLink).toHaveBeenCalledExactlyOnceWith(PAGE_URL);
    });
  });

  describe("without a write grant", () => {
    it("gives a read-only widget the title and the Open link, without Share", async () => {
      mocks.widget.write = false;
      await renderToolbar(1040, { canEdit: false });

      expect(byLabel("editor.toolbar.pageBreadcrumb")?.textContent).toContain(
        "Roadmap",
      );
      expect(openLink()).not.toBeNull();
      expect(byLabel("editor.toolbar.share")).toBeNull();
      expect(byLabel("editor.toolbar.copyPageLink")).toBeNull();
    });

    it("gives a write widget no Share on a document its viewer cannot edit", async () => {
      await renderToolbar(1040, { canEdit: false, canShare: false });

      expect(openLink()).not.toBeNull();
      expect(byLabel("editor.toolbar.share")).toBeNull();
    });

    it("holds the Open link in the menu of a narrow read-only widget", async () => {
      mocks.widget.write = false;
      await renderToolbar(360, { canEdit: false });

      const items = await openPageActions();

      expect(items.map((item) => item.textContent)).toEqual([
        "editor.toolbar.openInAgentNative",
      ]);
      expect(byLabel("editor.toolbar.share")).toBeNull();
    });
  });

  describe("requests", () => {
    const ancestors = [
      {
        id: "workspace",
        title: "Workspace",
        filesDatabaseId: "files",
        siblings: { filesDatabaseId: "files", parentId: null },
      },
      {
        id: "parent",
        title: "Parent",
        filesDatabaseId: "files",
        siblings: { filesDatabaseId: "files", parentId: "workspace" },
      },
      {
        id: "widget-fixture",
        title: "Roadmap",
        filesDatabaseId: "files",
        siblings: { filesDatabaseId: "files", parentId: "parent" },
      },
    ];

    it.each([360, 1040])(
      "makes none when it mounts at %ipx, and shows only the page it holds",
      async (width) => {
        await renderToolbar(width, {
          breadcrumbItems: ancestors,
          documentUpdatedAt: new Date().toISOString(),
        });
        await act(async () => Promise.resolve());

        expect(requests()).toEqual([]);
        const breadcrumb = byLabel("editor.toolbar.pageBreadcrumb")!;
        expect(breadcrumb.textContent).toBe("Roadmap");
        expect(breadcrumb.querySelector("button")).toBeNull();
        expect(mocks.shareProps).toEqual([]);
      },
    );

    it("makes the app's Notion requests outside a widget", async () => {
      mocks.widget.inWidget = false;
      mocks.widget.write = false;
      await renderToolbar(1040, { readOnly: false });
      await act(async () => Promise.resolve());

      expect(
        mocks.fetchUrls.some((url) => url.includes("connect-notion-status")),
      ).toBe(true);
      expect(
        mocks.fetchUrls.some((url) =>
          url.includes("refresh-notion-sync-status"),
        ),
      ).toBe(true);
    });
  });

  describe("Share", () => {
    it("mounts the popover only when pressed, limited to the share actions", async () => {
      await renderToolbar(360);
      expect(mocks.shareProps).toEqual([]);

      await act(async () =>
        byLabel<HTMLButtonElement>("editor.toolbar.share")!.click(),
      );
      await act(async () => Promise.resolve());
      await act(async () => Promise.resolve());

      expect(
        container.querySelector('[data-share-open="true"]'),
      ).not.toBeNull();
      const props = mocks.shareProps[mocks.shareProps.length - 1];
      expect(props.resourceType).toBe("document");
      expect(props.resourceId).toBe("widget-fixture");
      expect(props.mobileSheet).toBe(true);
      expect(props.basicSharingOnly).toBe(true);
      // The widget's session cannot set discoverability, mint agent links,
      // or open the app's agent deep links.
      expect(props.hideInSearchControl).toBeUndefined();
      expect(props.agentTabContent).toBeUndefined();
      expect(props.shareTabs).toBeUndefined();
      expect(props.quickCopy.className).toContain("[&>*]:h-11");
      expect(requests()).toEqual([]);
    });

    it("keeps the app's Share tabs and discoverability outside a widget", async () => {
      mocks.widget.inWidget = false;
      mocks.widget.write = false;
      await renderToolbar(1040, { readOnly: false });
      await act(async () =>
        byLabel<HTMLButtonElement>("editor.toolbar.share")!.click(),
      );
      await act(async () => Promise.resolve());
      await act(async () => Promise.resolve());

      const props = mocks.shareProps[mocks.shareProps.length - 1];
      expect(props.basicSharingOnly).toBe(false);
      expect(props.hideInSearchControl).toBeDefined();
      expect(props.agentTabContent).toBeDefined();
      expect(props.quickCopy.className).toBeUndefined();
    });
  });
});
