// @vitest-environment happy-dom

import type { ContentRecentResult } from "@shared/content-personal-navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DocumentTitleEntry } from "@/lib/content-command-search";

const pageDocument = vi.hoisted(() => ({
  context: undefined as unknown,
  current: {
    id: "page-1",
    title: "Roadmap",
    isFavorite: false,
    canEdit: true,
    spaceId: "space-1",
  } as Record<string, unknown> | undefined,
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal()),
  useT: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key} ${JSON.stringify(options)}` : key,
  useFormatters: () => ({ formatDate: (date: unknown) => String(date) }),
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal()),
  useActionQuery: () => ({
    data: { documents: [], pagination: { hasMore: false } },
    isFetching: false,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-documents", () => ({
  prefetchDocumentTitles: vi.fn(),
  useDocument: (_id: string | null, context: unknown) => {
    pageDocument.context = context;
    return { data: pageDocument.current };
  },
  useDocuments: () => ({ data: undefined }),
  useDocumentTitles: () => ({
    data: {
      documents: [
        {
          id: "page-1",
          title: "Roadmap",
          parentId: null,
          spaceId: "space-1",
          updatedAt: "2026-11-01",
        },
      ],
    },
  }),
  useUpdateDocument: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/use-content-spaces", () => ({
  useContentSpaces: () => ({
    data: {
      spaces: [{ id: "space-1", name: "Personal", kind: "personal" }],
      sourceMode: "database",
    },
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@/hooks/use-content-recent", () => ({
  useContentRecent: () => ({ data: { entries: [] } }),
}));
vi.mock("@/hooks/use-create-page", () => ({
  useCreatePage: () => vi.fn(),
}));
vi.mock("./sidebar/use-move-page-dialog", () => ({
  useMovePageDialog: () => ({ startMove: vi.fn(), dialog: null }),
}));

import {
  ContentCommandMenu,
  contentCommandGroups,
  type ContentCommandGroupsInput,
} from "./ContentCommandMenu";

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key;

function required<T>(element: T | null | undefined): T {
  if (!element) throw new Error("Expected the command menu to render it");
  return element;
}

function at<T>(list: readonly T[], index: number): T {
  return required(list[index]);
}

function recentEntry(documentId: string, title: string): ContentRecentResult {
  return {
    target: { documentId },
    visitedAt: "2026-11-02T00:00:00.000Z",
    title,
    icon: null,
    viewName: null,
  };
}

function groupsFor(overrides: Partial<ContentCommandGroupsInput> = {}) {
  const noop = () => undefined;
  return contentCommandGroups({
    t,
    formatDate: (date) => date,
    search: "",
    page: {
      id: "page-1",
      title: "Roadmap",
      isFavorite: false,
      canEdit: true,
      scoped: false,
    },
    recent: [],
    titleById: new Map(),
    theme: "system",
    actions: {
      searchInPage: noop,
      copyPageLink: noop,
      setPinned: noop,
      movePage: noop,
      createPage: noop,
      openRecent: noop,
      openAgent: noop,
      toggleTheme: noop,
      askAgent: noop,
    },
    ...overrides,
  });
}

function commandIds(groupId: string, groups = groupsFor()) {
  return groups
    .find((group) => group.id === groupId)
    ?.commands.map((command) => command.id);
}

describe("contentCommandGroups", () => {
  it("leads with commands for the open page, then create and app actions", () => {
    const groups = groupsFor();
    expect(groups.map((group) => group.id)).toEqual(["page", "create", "app"]);
    expect(at(groups, 0).heading).toBe(
      'root.commandOnPage {"title":"Roadmap"}',
    );
    expect(commandIds("page", groups)).toEqual([
      "search-in-page",
      "copy-link",
      "pin",
      "move",
      "add-sub-page",
    ]);
    const searchInPage = at(at(groups, 0).commands, 0);
    expect(searchInPage.shortcutHint).toBe("Tab");
    expect(searchInPage.closeOnSelect).toBe(false);
  });

  it("offers unpinning for a pinned page", () => {
    const groups = groupsFor({
      page: {
        id: "page-1",
        title: "Roadmap",
        isFavorite: true,
        canEdit: true,
        scoped: false,
      },
    });
    const pin = at(groups, 0).commands.find((command) => command.id === "pin");
    expect(pin?.label).toBe("sidebar.removeFromFavorites");
  });

  it("drops Search in this page once the search is scoped to it", () => {
    expect(
      commandIds(
        "page",
        groupsFor({
          page: {
            id: "page-1",
            title: "Roadmap",
            isFavorite: false,
            canEdit: true,
            scoped: true,
          },
        }),
      ),
    ).not.toContain("search-in-page");
  });

  it("waits for the page record before offering changes to the page", () => {
    const groups = groupsFor({
      page: {
        id: "page-1",
        title: undefined,
        isFavorite: undefined,
        canEdit: true,
        scoped: false,
      },
    });
    expect(at(groups, 0).heading).toBe("root.searchThisPage");
    expect(commandIds("page", groups)).toEqual(["search-in-page", "copy-link"]);
  });

  it("offers only searching and copying a link on a page the reader can't edit", () => {
    expect(
      commandIds(
        "page",
        groupsFor({
          page: {
            id: "page-1",
            title: "Roadmap",
            isFavorite: false,
            canEdit: false,
            scoped: false,
          },
        }),
      ),
    ).toEqual(["search-in-page", "copy-link"]);
  });

  it("does not offer moving a local file", () => {
    expect(
      commandIds(
        "page",
        groupsFor({
          page: {
            id: "local-file:notes/today.md",
            title: "today",
            isFavorite: false,
            canEdit: true,
            scoped: false,
          },
        }),
      ),
    ).not.toContain("move");
  });

  it("lists up to five recent pages other than the open one, with where they live", () => {
    const titleById = new Map<string, DocumentTitleEntry>([
      [
        "child",
        {
          id: "child",
          title: "Child",
          parentId: "parent",
          updatedAt: "2026-11-03",
        } as DocumentTitleEntry,
      ],
      [
        "parent",
        { id: "parent", title: "Parent", parentId: null } as DocumentTitleEntry,
      ],
    ]);
    const groups = groupsFor({
      titleById,
      recent: [
        recentEntry("page-1", "Roadmap"),
        recentEntry("child", "Child"),
        ...["a", "b", "c", "d", "e"].map((id) => recentEntry(id, id)),
      ],
    });
    const recent = groups.find((group) => group.id === "recent");
    expect(recent?.commands.map((command) => command.label)).toEqual([
      "Child",
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(at(required(recent).commands, 0).description).toBe("Parent");
    expect(at(required(recent).commands, 0).metadata).toBe(
      'root.searchModified {"date":"2026-11-03"}',
    );
  });

  it("hides recent pages while typing and ends with asking the agent", () => {
    const groups = groupsFor({
      search: " launch plan ",
      recent: [recentEntry("child", "Child")],
    });
    expect(groups.map((group) => group.id)).toEqual([
      "page",
      "create",
      "app",
      "agent",
    ]);
    const ask = at(at(groups, groups.length - 1).commands, 0);
    expect(ask.label).toBe('root.commandAskAgent {"query":"launch plan"}');
  });

  it("has no page group away from a page", () => {
    expect(groupsFor({ page: null }).map((group) => group.id)).toEqual([
      "create",
      "app",
    ]);
  });
});

describe("ContentCommandMenu", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    document.body.innerHTML = "";
    pageDocument.current = {
      id: "page-1",
      title: "Roadmap",
      isFavorite: false,
      canEdit: true,
      spaceId: "space-1",
    };
  });

  async function renderMenu(path = "/page/page-1") {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const menuRoot = createRoot(host);
    container = host;
    root = menuRoot;
    const queryClient = new QueryClient();
    await act(async () =>
      menuRoot.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[path]}>
            <ContentCommandMenu
              open
              onOpenChange={vi.fn()}
              onCloseAutoFocus={vi.fn()}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
    return required(document.querySelector<HTMLInputElement>("[cmdk-input]"));
  }

  function press(input: HTMLInputElement, key: string) {
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });
  }

  function type(input: HTMLInputElement, value: string) {
    act(() => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  const dialog = () => required(document.querySelector('[role="dialog"]'));
  const chip = () =>
    document.querySelector('[data-testid="content-command-scope"]');

  it("opens compact, with the open page's commands and no filters", async () => {
    await renderMenu();
    expect(dialog().className).toContain("max-w-xl");
    expect(document.body.textContent).toContain(
      'root.commandOnPage {"title":"Roadmap"}',
    );
    expect(document.body.textContent).toContain("sidebar.pinToSidebar");
    expect(
      document.querySelector('[aria-label="root.searchScope"]'),
    ).toBeNull();
  });

  it("scopes the search to the open page with Tab and clears it with Backspace", async () => {
    const input = await renderMenu();
    expect(chip()).toBeNull();

    press(input, "Tab");
    expect(chip()?.textContent).toContain(
      'root.commandScopeChip {"title":"Roadmap"}',
    );
    expect(document.body.textContent).not.toContain("root.commandSearchInPage");

    press(input, "Backspace");
    expect(chip()).toBeNull();
  });

  it("keeps the scope while Backspace deletes typed text", async () => {
    const input = await renderMenu();
    press(input, "Tab");
    type(input, "x");
    press(input, "Backspace");
    expect(chip()).not.toBeNull();
  });

  it("widens into search with filters, a preview pane and the agent last", async () => {
    const input = await renderMenu();
    type(input, "road");
    expect(dialog().className).toContain("max-w-5xl");
    expect(
      document.querySelector('[aria-label="root.searchScope"]'),
    ).not.toBeNull();
    const preview = document.querySelector(
      '[data-testid="content-command-preview"]',
    );
    expect(preview?.textContent).toContain("Roadmap");
    const rows = [...document.querySelectorAll("[cmdk-item]")];
    expect(rows[0]?.getAttribute("data-value")).toBe("document:page-1");
    const appRows = rows
      .map((row) => row.getAttribute("data-value") ?? "")
      .filter((value) => value.startsWith("app-command:"));
    expect(appRows[appRows.length - 1]).toBe("app-command:agent:ask-agent");
  });

  it("clears the scope from the chip without opening the highlighted row", async () => {
    const input = await renderMenu();
    press(input, "Tab");
    const clear = required(
      document.querySelector<HTMLButtonElement>(
        '[aria-label="root.commandClearScope"]',
      ),
    );

    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      clear.dispatchEvent(enter);
    });
    expect(enter.defaultPrevented).toBe(false);
    expect(chip()).not.toBeNull();

    act(() => clear.click());
    expect(chip()).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it("reads a page opened from a collection under that collection", async () => {
    await renderMenu("/page/page-1?databaseId=db-1&databaseDocumentId=doc-db");
    expect(pageDocument.context).toEqual({
      databaseId: "db-1",
      databaseDocumentId: "doc-db",
    });
  });

  it("keeps the preview beside the list when no page matches", async () => {
    const input = await renderMenu();
    type(input, "zzqx");
    const preview = document.querySelector(
      '[data-testid="content-command-preview"]',
    );
    expect(preview?.textContent).toContain(
      'root.commandAskAgent {"query":"zzqx"}',
    );
  });
});
