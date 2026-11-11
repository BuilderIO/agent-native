import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { hasSessionHint } from "@agent-native/core/client/use-session";
import {
  CommandMenu,
  submitToAgent,
  type AppCommand,
  type AppCommandGroup,
} from "@agent-native/toolkit/app/shared";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import { useIsMobile } from "@agent-native/toolkit/hooks/use-mobile";
import {
  contentRecentHref,
  type ContentRecentResult,
} from "@shared/content-personal-navigation";
import { IconX } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { contentDocumentIdFromPathname } from "@/hooks/content-action-refresh";
import { useContentRecent } from "@/hooks/use-content-recent";
import { useContentSpaces } from "@/hooks/use-content-spaces";
import { useCreatePage } from "@/hooks/use-create-page";
import {
  prefetchDocumentTitles,
  useDocument,
  useDocumentTitles,
  useUpdateDocument,
} from "@/hooks/use-documents";
import { useLocalStorage } from "@/hooks/use-local-storage";
import type { DocumentTitleEntry } from "@/lib/content-command-search";

import changelog from "../../CHANGELOG.md?raw";
import {
  ContentCommandSearchResults,
  focusSearchInput,
  THIS_PAGE_SCOPE,
} from "./ContentCommandSearch";
import {
  contentSpaceForStoredSelection,
  SELECTED_CONTENT_SPACE_STORAGE_KEY,
} from "./sidebar/select-content-space";
import { sidebarPageLinks } from "./sidebar/SidebarRowActions";
import { useMovePageDialog } from "./sidebar/use-move-page-dialog";

const TITLE_PREFETCH_DELAY_MS = 4000;
const RECENT_COMMAND_LIMIT = 5;

// At rest the menu is a compact list of commands for the open page, recent
// pages and app actions. Typing widens it into search, with filters and a
// preview of the highlighted row. Both sizes keep the search field in place.
const COMPACT_MENU_CLASS =
  "w-[calc(100vw-1rem)] max-w-xl [&_[cmdk-list]]:max-h-[min(28rem,calc(85vh-7rem))]";
const WIDE_MENU_CLASS =
  "h-[min(680px,calc(85vh-1rem))] w-[calc(100vw-1rem)] max-w-5xl [&_[cmdk-list]]:min-h-0 [&_[cmdk-list]]:max-h-none [&_[cmdk-list]]:flex-1 [&_[cmdk-root]]:h-full";

const THEME_PREFERENCE_STORAGE_KEY = "content-theme-preference";

type ThemeOption = "system" | "light" | "dark";

const NEXT_THEME: Record<ThemeOption, ThemeOption> = {
  system: "light",
  light: "dark",
  dark: "system",
};

function isThemeOption(value: string | null | undefined): value is ThemeOption {
  return value === "light" || value === "system" || value === "dark";
}

function readStoredThemePreference(): ThemeOption {
  if (typeof window === "undefined") return "system";

  try {
    const storedTheme = window.localStorage.getItem(
      THEME_PREFERENCE_STORAGE_KEY,
    );
    if (storedTheme === "auto") return "system";
    return isThemeOption(storedTheme) ? storedTheme : "system";
  } catch {
    return "system";
  }
}

function writeStoredThemePreference(theme: ThemeOption) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, theme);
    // coercion-ok: blocked storage only loses the saved choice for next visit.
  } catch {
    // next-themes still updates the page.
  }
}

function nextTheme(theme: ThemeOption): ThemeOption {
  return NEXT_THEME[theme];
}

function useThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [selectedTheme, setSelectedTheme] = useState<ThemeOption>("system");

  useEffect(() => {
    setSelectedTheme(readStoredThemePreference());
  }, [theme]);

  const toggle = useCallback(() => {
    const next = nextTheme(selectedTheme);
    setSelectedTheme(next);
    writeStoredThemePreference(next);
    setTheme(next);
  }, [selectedTheme, setTheme]);

  return { theme: selectedTheme, toggle };
}

function isLocalFileDocumentId(documentId: string) {
  return (
    documentId.startsWith("local-file:") ||
    documentId.startsWith("local-folder:")
  );
}

function recentCommandId(entry: ContentRecentResult) {
  const { documentId, databaseId, viewId } = entry.target;
  return [databaseId ?? documentId, viewId].filter(Boolean).join(":");
}

export interface ContentCommandGroupsInput {
  t: (key: string, options?: Record<string, unknown>) => string;
  formatDate: (date: string) => string;
  search: string;
  /** The open page, if any. */
  page: {
    id: string;
    /** Undefined while the title is still loading. */
    title: string | undefined;
    /** Undefined until the page's own record is loaded. */
    isFavorite: boolean | undefined;
    canEdit: boolean;
    /** The page's record says it comes from a local folder. */
    localSource?: boolean;
    scoped: boolean;
  } | null;
  recent: ContentRecentResult[];
  titleById: ReadonlyMap<string, DocumentTitleEntry>;
  theme: ThemeOption;
  actions: {
    searchInPage: () => void;
    copyPageLink: (documentId: string) => void;
    setPinned: (documentId: string, pinned: boolean) => void;
    movePage: (documentId: string) => void;
    createPage: (parentId?: string) => void;
    openRecent: (entry: ContentRecentResult) => void;
    openAgent: () => void;
    toggleTheme: () => void;
    askAgent: (query: string) => void;
  };
}

/**
 * The command menu's groups, in order: the open page, recent pages, create,
 * app actions, and, while typing, asking the agent. Page results from search
 * come before all of them.
 */
export function contentCommandGroups({
  t,
  formatDate,
  search,
  page,
  recent,
  titleById,
  theme,
  actions,
}: ContentCommandGroupsInput): AppCommandGroup[] {
  const groups: AppCommandGroup[] = [];
  const query = search.trim();

  if (page) {
    const title = page.title || t("sidebar.untitled");
    const commands: AppCommand[] = [];
    if (!page.scoped) {
      commands.push({
        id: "search-in-page",
        order: 1,
        label: t("root.commandSearchInPage"),
        description: t("root.commandSearchInPageDescription"),
        keywords: ["scope", "find", "inside"],
        shortcutHint: "Tab",
        closeOnSelect: false,
        onSelect: actions.searchInPage,
      });
    }
    commands.push({
      id: "copy-link",
      order: 2,
      label: t("sidebar.copyLink"),
      keywords: ["share", "url"],
      deferSelect: false,
      onSelect: () => actions.copyPageLink(page.id),
    });
    // Changing the page waits for its record, which says whether the reader
    // may edit it and whether it is pinned.
    const editable = page.canEdit && page.isFavorite !== undefined;
    if (editable) {
      const pinned = Boolean(page.isFavorite);
      commands.push({
        id: "pin",
        order: 3,
        label: pinned
          ? t("sidebar.removeFromFavorites")
          : t("sidebar.pinToSidebar"),
        keywords: ["favorite", "pin", "sidebar"],
        onSelect: () => actions.setPinned(page.id, !pinned),
      });
    }
    // Pages from a local folder can't be moved or hold sub-pages, as in the
    // sidebar. Imported ones keep ordinary IDs, so their record says so.
    const localFile =
      page.localSource === true || isLocalFileDocumentId(page.id);
    if (editable && !localFile) {
      commands.push({
        id: "move",
        order: 4,
        label: t("sidebar.moveTo"),
        keywords: ["parent", "folder", "workspace"],
        onSelect: () => actions.movePage(page.id),
      });
      commands.push({
        id: "add-sub-page",
        order: 5,
        label: t("sidebar.addSubPage"),
        keywords: ["new", "create", "child", "inside"],
        onSelect: () => actions.createPage(page.id),
      });
    }
    groups.push({
      id: "page",
      order: 10,
      heading:
        page.title === undefined
          ? t("root.searchThisPage")
          : t("root.commandOnPage", { title }),
      commands,
    });
  }

  const recentRows = recent
    .filter((entry) => entry.target.documentId !== page?.id)
    .slice(0, RECENT_COMMAND_LIMIT);
  if (!query && recentRows.length > 0) {
    groups.push({
      id: "recent",
      order: 20,
      heading: t("sidebar.recent"),
      commands: recentRows.map((entry, index) => {
        const known = titleById.get(entry.target.documentId);
        const parentTitle = known?.parentId
          ? titleById.get(known.parentId)?.title
          : undefined;
        const description = [parentTitle, entry.viewName]
          .filter(Boolean)
          .join(" · ");
        return {
          id: recentCommandId(entry),
          order: index,
          label: entry.title || t("sidebar.untitled"),
          ...(description ? { description } : {}),
          ...(known?.updatedAt
            ? {
                metadata: t("root.searchModified", {
                  date: formatDate(known.updatedAt),
                }),
              }
            : {}),
          deferSelect: false,
          onSelect: () => actions.openRecent(entry),
        };
      }),
    });
  }

  groups.push({
    id: "create",
    order: 30,
    heading: t("sidebar.new"),
    commands: [
      {
        id: "new-page",
        order: 1,
        label: t("sidebar.newPage"),
        keywords: ["create", "add", "document"],
        onSelect: () => actions.createPage(),
      },
    ],
  });

  groups.push({
    id: "app",
    order: 40,
    heading: t("root.commandContent"),
    commands: [
      {
        id: "open-agent",
        order: 1,
        label: t("root.openAgent"),
        keywords: ["agent", "ai", "settings"],
        onSelect: actions.openAgent,
      },
      {
        id: "toggle-theme",
        order: 2,
        label: t("root.toggleTheme"),
        keywords: ["theme", "dark", "light", "system", "mode", "appearance"],
        metadata: t(`theme.${theme}`),
        onSelect: actions.toggleTheme,
      },
    ],
  });

  if (query) {
    // Its label holds the query, so it matches whatever is typed and stays
    // last: a way forward when no page or action fits.
    groups.push({
      id: "agent",
      order: 50,
      commands: [
        {
          id: "ask-agent",
          order: 1,
          label: t("root.commandAskAgent", { query }),
          description: t("root.commandAskAgentDescription"),
          onSelect: () => actions.askAgent(query),
        },
      ],
    });
  }

  return groups;
}

function ScopeChip({
  label,
  clearLabel,
  onClear,
}: {
  label: string;
  clearLabel: string;
  onClear: () => void;
}) {
  return (
    <span
      data-testid="content-command-scope"
      className="me-2 inline-flex min-w-0 max-w-[45%] shrink-0 items-center gap-0.5 rounded-md bg-muted py-0.5 ps-2 pe-0.5 text-xs font-medium text-foreground"
    >
      <span className="truncate">{label}</span>
      <button
        type="button"
        aria-label={clearLabel}
        title={clearLabel}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onMouseDown={(event) => event.preventDefault()}
        // Enter would otherwise reach the menu and open the highlighted row.
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.stopPropagation();
          }
        }}
        onClick={(event) => {
          focusSearchInput(event.currentTarget);
          onClear();
        }}
      >
        <IconX size={12} />
      </button>
    </span>
  );
}

function KeyHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <kbd className="rounded border border-border bg-muted px-1 font-sans text-[10px] leading-4 text-muted-foreground">
        {keys}
      </kbd>
      {label}
    </span>
  );
}

function CommandRowPreview({ command }: { command: AppCommand }) {
  return (
    <div className="space-y-2">
      <p className="font-medium leading-snug">{command.label}</p>
      {command.description ? (
        <p className="text-sm text-muted-foreground">{command.description}</p>
      ) : null}
      {command.metadata ? (
        <p className="text-xs text-muted-foreground">{command.metadata}</p>
      ) : null}
      {command.shortcutHint ? (
        <kbd className="inline-block rounded border border-border bg-muted px-1.5 font-sans text-xs text-muted-foreground">
          {command.shortcutHint}
        </kbd>
      ) : null}
    </div>
  );
}

export function ContentCommandMenu({
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const t = useT();
  const { formatDate } = useFormatters();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // The first search of a visit ranks titles at once only if they're here
  // before it. Waits for the page to settle, so opening a page never pays.
  useEffect(() => {
    if (!hasSessionHint()) return;
    const timer = window.setTimeout(() => {
      void prefetchDocumentTitles(queryClient);
    }, TITLE_PREFETCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [queryClient]);

  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<string | null>(null);
  useEffect(() => {
    if (!open) setScope(null);
  }, [open]);

  const location = useLocation();
  const currentPageId = contentDocumentIdFromPathname(location.pathname);
  // Reads the open page's record from the editor's cache, without a
  // request. A page opened from a collection is cached under that collection.
  const routeParams = new URLSearchParams(location.search);
  const currentDocument = useDocument(
    currentPageId ?? null,
    {
      databaseId: routeParams.get("databaseId"),
      databaseDocumentId: routeParams.get("databaseDocumentId"),
    },
    { enabled: false },
  ).data;
  const spaces = useContentSpaces();
  const localFileMode = spaces.data?.sourceMode === "local-files";
  const titles = useDocumentTitles({
    enabled: open && Boolean(spaces.data) && !localFileMode,
  }).data?.documents;
  const titleById = useMemo(
    () => new Map((titles ?? []).map((entry) => [entry.id, entry])),
    [titles],
  );
  const [storedSpaceId] = useLocalStorage<string | null>(
    SELECTED_CONTENT_SPACE_STORAGE_KEY,
    null,
  );
  const selectedSpace = contentSpaceForStoredSelection({
    spaces: spaces.data?.spaces ?? [],
    storedSpaceId,
  });
  const recent = useContentRecent(selectedSpace?.id, {
    enabled: open && Boolean(selectedSpace),
  });

  const createPage = useCreatePage();
  const updateDocument = useUpdateDocument();
  const { startMove, dialog: movePageDialog } = useMovePageDialog();
  const themeToggle = useThemeToggle();

  const pageTitle = currentPageId
    ? currentDocument && currentDocument.id === currentPageId
      ? currentDocument.title
      : titleById.get(currentPageId)?.title
    : undefined;
  const scopedToPage = scope === THIS_PAGE_SCOPE && Boolean(currentPageId);

  const groups = contentCommandGroups({
    t,
    formatDate,
    search,
    page: currentPageId
      ? {
          id: currentPageId,
          title: pageTitle,
          isFavorite:
            currentDocument?.id === currentPageId
              ? currentDocument.isFavorite
              : undefined,
          canEdit: currentDocument?.canEdit !== false,
          localSource:
            currentDocument?.id === currentPageId &&
            currentDocument.source?.mode === "local-files",
          scoped: scopedToPage,
        }
      : null,
    recent: recent.data?.entries ?? [],
    titleById,
    theme: themeToggle.theme,
    actions: {
      searchInPage: () => setScope(THIS_PAGE_SCOPE),
      copyPageLink: (documentId) => {
        const { shareLink } = sidebarPageLinks(documentId, {
          localFile: isLocalFileDocumentId(documentId),
        });
        void writeClipboardText(shareLink).then((copied) => {
          if (copied) {
            toast.success(t("editor.toolbar.copiedPageLink"));
          } else {
            toast.error(t("editor.toolbar.couldNotCopyLink"), {
              description: t("editor.toolbar.clipboardAccessUnavailable"),
            });
          }
        });
      },
      setPinned: (documentId, pinned) => {
        updateDocument.mutate(
          { id: documentId, isFavorite: pinned },
          {
            onError: (error) => {
              toast.error(t("sidebar.failedUpdateFavorite"), {
                description:
                  error instanceof Error
                    ? error.message
                    : t("empty.genericError"),
              });
            },
          },
        );
      },
      movePage: (documentId) =>
        startMove({
          documentId,
          title: pageTitle || t("sidebar.untitled"),
          spaceId:
            currentDocument?.spaceId ??
            titleById.get(documentId)?.spaceId ??
            selectedSpace?.id ??
            null,
        }),
      createPage: (parentId) => void createPage(parentId),
      openRecent: (entry) => void navigate(contentRecentHref(entry.target)),
      openAgent: () => void navigate("/settings/agent"),
      toggleTheme: themeToggle.toggle,
      askAgent: (query) => submitToAgent(query),
    },
  });
  const commandsByValue = new Map<string, AppCommand>();
  for (const group of groups) {
    for (const command of group.commands) {
      commandsByValue.set(`app-command:${group.id}:${command.id}`, command);
    }
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const plain =
      !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
    // Once there's a query the filters show, and Tab moves to them; their
    // Scope picker can still choose this page.
    if (
      event.key === "Tab" &&
      plain &&
      currentPageId &&
      !scopedToPage &&
      event.currentTarget.value.trim() === ""
    ) {
      event.preventDefault();
      setScope(THIS_PAGE_SCOPE);
      return;
    }
    if (
      event.key === "Backspace" &&
      plain &&
      scopedToPage &&
      event.currentTarget.value === ""
    ) {
      event.preventDefault();
      setScope(null);
    }
  };

  const isMobile = useIsMobile();
  const wide = search.trim().length > 0;
  const footer: ReactNode = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <KeyHint keys="↑↓" label={t("root.commandHintNavigate")} />
      <KeyHint keys="↵" label={t("root.commandHintOpen")} />
      {/* Both keys act on the scope only while the field is empty. */}
      {currentPageId && !wide ? (
        scopedToPage ? (
          <KeyHint keys="⌫" label={t("root.commandClearScope")} />
        ) : (
          <KeyHint keys="Tab" label={t("root.commandSearchInPage")} />
        )
      ) : null}
      <KeyHint keys="Esc" label={t("root.commandHintClose")} />
    </div>
  );

  return (
    <>
      <CommandMenu
        open={open}
        onOpenChange={onOpenChange}
        onCloseAutoFocus={onCloseAutoFocus}
        placeholder={t("root.commandSearchPlaceholder")}
        inputLabel={t("root.commandSearchDocuments")}
        className={wide ? WIDE_MENU_CLASS : COMPACT_MENU_CLASS}
        showAgentFallback={false}
        changelog={changelog}
        changelogKey="content"
        appCommandGroups={groups}
        onSearchChange={setSearch}
        inputAdornment={
          scopedToPage ? (
            <ScopeChip
              label={t("root.commandScopeChip", {
                title: pageTitle || t("sidebar.untitled"),
              })}
              clearLabel={t("root.commandClearScope")}
              onClear={() => setScope(null)}
            />
          ) : undefined
        }
        onInputKeyDown={handleInputKeyDown}
        footerSlot={isMobile ? undefined : footer}
        renderContent={({ search: query, renderList, selectedValue }) => (
          <ContentCommandSearchResults
            query={query}
            onOpenChange={onOpenChange}
            renderList={renderList}
            staticItems={null}
            scope={scope}
            onScopeChange={setScope}
            selectedValue={selectedValue}
            commandPreview={(value) => {
              const command = commandsByValue.get(value);
              return command ? <CommandRowPreview command={command} /> : null;
            }}
          />
        )}
      >
        {null}
      </CommandMenu>
      {movePageDialog}
    </>
  );
}
