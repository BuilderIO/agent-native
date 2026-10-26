import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import {
  getChangelogLatestId,
  useChangelogSeen,
} from "@agent-native/core/client/changelog/use-changelog-seen";
import { useT } from "@agent-native/core/client/i18n";
import {
  signOut,
  SIGN_OUT_SEARCH_TERMS,
} from "@agent-native/core/client/sign-out";
import { useAgentEngineConfigured } from "@agent-native/core/client/use-agent-engine-configured";
import {
  chatModelSelectionStorageKey,
  useChatModels,
} from "@agent-native/core/client/use-chat-models";
import {
  getSettingsShortcutHint,
  openSettingsPage,
} from "@agent-native/core/client/use-settings-shortcut";
import { isLocalRuntimeEngine } from "@agent-native/toolkit/composer";
import {
  Command as CommandPrimitive,
  CommandGroup as CommandGroupPrimitive,
  CommandInput as CommandInputPrimitive,
  CommandItem as CommandItemPrimitive,
  CommandList as CommandListPrimitive,
  CommandSeparator as CommandSeparatorPrimitive,
  CommandShortcut as CommandShortcutPrimitive,
} from "@agent-native/toolkit/ui/command";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import { cn } from "@agent-native/toolkit/utils";
import { IconExternalLink } from "@tabler/icons-react";
import { useCommandState } from "cmdk";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

import { AboutAgentNativeDialog } from "./AboutAgentNativeDialog.js";
import { LazyChunkErrorBoundary } from "./LazyChunkErrorBoundary.js";

const LazyChangelogDialog = lazy(async () => {
  const { ChangelogDialog } =
    await import("@agent-native/toolkit/app/changelog");
  return { default: ChangelogDialog };
});

interface CommandMenuContextValue {
  search: string;
  onOpenChange: (open: boolean) => void;
  registerNestedDialog: (dismiss: () => void) => () => void;
  selectionEnabled: boolean;
}

function CommandSelectionTracker({
  onChange,
}: {
  onChange: (value: string) => void;
}) {
  const value = useCommandState((state) => state.value);

  useEffect(() => onChange(value), [onChange, value]);
  return null;
}

function stopCommandNavigation(event: React.KeyboardEvent<HTMLDivElement>) {
  const key = event.key.toLowerCase();
  if (
    ["arrowdown", "arrowup", "home", "end", "enter"].includes(key) ||
    (event.ctrlKey && ["n", "j", "p", "k"].includes(key))
  ) {
    event.stopPropagation();
  }
}

const CommandMenuContext = createContext<CommandMenuContextValue | null>(null);

function useCommandMenuContext() {
  const ctx = useContext(CommandMenuContext);
  if (!ctx) throw new Error("CommandMenu.* must be used inside <CommandMenu>");
  return ctx;
}

export function useCommandMenuNestedDialog(dismiss: (() => void) | null) {
  const { registerNestedDialog } = useCommandMenuContext();
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  useEffect(() => {
    if (!dismiss) return;
    return registerNestedDialog(() => dismissRef.current?.());
  }, [dismiss !== null, registerNestedDialog]);
}

export function openAgentSidebar() {
  window.dispatchEvent(new Event("agent-panel:open"));
}

export function openAgentSettings(
  section?: string | { section?: string | null },
) {
  if (typeof window === "undefined") return;

  const normalizedSection =
    typeof section === "string" ? section : section?.section;

  const secretHash = normalizedSection?.replace(/^#/, "");
  if (secretHash?.toLowerCase().startsWith("secrets:")) {
    window.location.hash = `#${secretHash}`;
  }

  openAgentSidebar();
  const dispatchSettings = () => {
    window.dispatchEvent(
      new CustomEvent("agent-panel:open-settings", {
        detail: normalizedSection ? { section: normalizedSection } : undefined,
      }),
    );
  };
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(dispatchSettings);
  } else {
    window.setTimeout(dispatchSettings, 0);
  }
}

export function focusAgentChat() {
  window.dispatchEvent(
    new CustomEvent("agent-panel:set-mode", {
      detail: { mode: "chat" },
    }),
  );
  openAgentSidebar();
}

export function submitToAgent(message: string) {
  focusAgentChat();
  sendToAgentChat({ message, submit: true });
}

interface CommandGroupProps {
  heading?: string;
  children: ReactNode;
}

function CommandGroup({ heading, children }: CommandGroupProps) {
  return (
    <CommandGroupPrimitive heading={heading}>{children}</CommandGroupPrimitive>
  );
}

type CommandItemProps = {
  onSelect: () => void;
  children: ReactNode;
  keywords?: string[];
  disabled?: boolean;
  className?: string;
  deferSelect?: boolean;
  /**
   * Stable identity for keyboard selection. Without it, the selection is keyed
   * by the item's text, so an item whose text changes while it is shown (for
   * example a search result gaining a snippet) loses the highlight.
   */
  value?: string;
} & (
  | { preview?: never }
  | {
      /** Content shown in the selected row; provide a stable value to keep it out of search text. */
      preview: ReactNode;
      value: string;
    }
);

function CommandItem({
  onSelect,
  children,
  keywords: _keywords,
  className,
  deferSelect = true,
  value,
  disabled = false,
  preview,
}: CommandItemProps) {
  const { onOpenChange, selectionEnabled } = useCommandMenuContext();
  const selectedValue = useCommandState((state) => state.value);

  const handleSelect = () => {
    if (!deferSelect) {
      onSelect();
      onOpenChange(false);
      return;
    }

    onOpenChange(false);
    setTimeout(onSelect, 50);
  };

  return (
    <CommandItemPrimitive
      className={cn("min-h-8 cursor-pointer gap-2", className)}
      onSelect={handleSelect}
      value={value}
      disabled={disabled || !selectionEnabled}
    >
      {children}
      {preview !== undefined && selectedValue === value ? (
        <div
          data-testid="command-menu-item-preview"
          className="ms-auto min-w-0"
        >
          {preview}
        </div>
      ) : null}
    </CommandItemPrimitive>
  );
}

interface CommandShortcutProps {
  children: ReactNode;
  className?: string;
}

function CommandShortcut({ children, className }: CommandShortcutProps) {
  return (
    <CommandShortcutPrimitive className={className}>
      {children}
    </CommandShortcutPrimitive>
  );
}

function CommandSeparator({ className }: { className?: string }) {
  return <CommandSeparatorPrimitive className={cn("my-1", className)} />;
}

export interface CommandMenuDoc {
  title: string;
  href: string;
  description?: string;
  keywords?: string[];
}

export interface CommandMenuItemMatchContext {
  query: string;
  label: string;
  value?: string;
  keywords: readonly string[];
}

export type CommandMenuItemMatcher = (
  item: CommandMenuItemMatchContext,
) => boolean;

export interface AppCommandContext<TAppContext = unknown> {
  search: string;
  appContext: TAppContext | undefined;
  close: () => void;
}

export interface AppCommandPage<TAppContext = unknown> {
  id: string;
  title: string;
  groups: AppCommandGroup<TAppContext>[];
}

export interface AppCommandGroup<TAppContext = unknown> {
  id: string;
  order: number;
  heading?: string;
  keywords?: string[];
  visibleWhen?: (context: AppCommandContext<TAppContext>) => boolean;
  commands: AppCommand<TAppContext>[];
}

interface AppCommandBase<TAppContext> {
  id: string;
  order: number;
  label: string;
  keywords?: string[];
  shortcutHint?: string;
  description?: string;
  metadata?: ReactNode;
  /** @deprecated Command rows are text-only; this is no longer rendered. */
  icon?: ReactNode;
  preview?:
    | ReactNode
    | ((context: AppCommandContext<TAppContext>) => ReactNode);
  /** Content rendered at the end of this command's selected row. */
  inlinePreview?:
    | ReactNode
    | ((context: AppCommandContext<TAppContext>) => ReactNode);
  visibleWhen?: (context: AppCommandContext<TAppContext>) => boolean;
  enabledWhen?: (context: AppCommandContext<TAppContext>) => boolean;
  deferSelect?: boolean;
}

export type AppCommand<TAppContext = unknown> =
  | (AppCommandBase<TAppContext> & {
      onSelect: (context: AppCommandContext<TAppContext>) => void;
      page?: never;
    })
  | (AppCommandBase<TAppContext> & {
      page: AppCommandPage<TAppContext>;
      onSelect?: never;
    });

interface OrderedAppCommandGroup<TAppContext> {
  group: AppCommandGroup<TAppContext>;
  commands: AppCommand<TAppContext>[];
}

interface AppCommandEntry<TAppContext> {
  group: AppCommandGroup<TAppContext>;
  command: AppCommand<TAppContext>;
  value: string;
}

function ordered<T extends { order: number }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.order - b.item.order || a.index - b.index)
    .map(({ item }) => item);
}

function appCommandSearchText<TAppContext>(
  command: AppCommand<TAppContext>,
): string {
  return [command.label, command.description]
    .concat(command.keywords ?? [])
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function findAppCommandPage<TAppContext>(
  groups: AppCommandGroup<TAppContext>[],
  pageId: string,
): AppCommandPage<TAppContext> | undefined {
  for (const group of groups) {
    for (const command of group.commands) {
      if (!("page" in command) || !command.page) continue;
      if (command.page.id === pageId) return command.page;
      const nestedPage = findAppCommandPage(command.page.groups, pageId);
      if (nestedPage) return nestedPage;
    }
  }
  return undefined;
}

function filterAppCommandGroups<TAppContext>(
  groups: AppCommandGroup<TAppContext>[],
  search: string,
  context: AppCommandContext<TAppContext>,
  itemMatcher?: CommandMenuItemMatcher,
): OrderedAppCommandGroup<TAppContext>[] {
  const searchLower = search.trim().toLowerCase();
  return ordered(groups)
    .filter((group) => group.visibleWhen?.(context) ?? true)
    .map((group) => {
      const groupMatches =
        searchLower.length > 0 &&
        [group.heading, ...(group.keywords ?? [])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(searchLower);
      const commands = ordered(group.commands).filter((command) => {
        if (!(command.visibleWhen?.(context) ?? true)) return false;
        if (!searchLower) return true;
        if (itemMatcher) {
          return itemMatcher({
            query: search,
            label: command.label,
            value: command.id,
            keywords: command.keywords ?? [],
          });
        }
        return (
          groupMatches || appCommandSearchText(command).includes(searchLower)
        );
      });
      return { group, commands };
    })
    .filter(({ commands }) => commands.length > 0);
}

interface CommandDocsGroupProps {
  docs: CommandMenuDoc[];
  heading?: string;
}

function commandDocSearchText(doc: CommandMenuDoc): string {
  return [doc.title, doc.description, ...(doc.keywords ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function filterCommandDocs(docs: CommandMenuDoc[], search: string) {
  const searchLower = search.trim().toLowerCase();
  if (!searchLower) return docs;
  return docs.filter((doc) => commandDocSearchText(doc).includes(searchLower));
}

function openDocsHref(href: string) {
  if (/^https?:\/\//i.test(href)) {
    window.open(href, "_blank", "noopener,noreferrer");
    return;
  }
  window.location.assign(href);
}

function CommandDocsGroup({ docs, heading = "Docs" }: CommandDocsGroupProps) {
  if (docs.length === 0) return null;

  return (
    <CommandGroup heading={heading}>
      {docs.map((doc) => (
        <CommandItem
          key={doc.href}
          onSelect={() => openDocsHref(doc.href)}
          keywords={[doc.title, doc.description ?? "", ...(doc.keywords ?? [])]}
          deferSelect={false}
          className="items-start"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{doc.title}</span>
            {doc.description ? (
              <span className="mt-0.5 block line-clamp-2 text-xs leading-snug text-muted-foreground">
                {doc.description}
              </span>
            ) : null}
          </span>
          <IconExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

function hasCommandItems(children: ReactNode): boolean {
  return React.Children.toArray(children).some((child) => {
    if (!React.isValidElement(child)) return false;
    if (child.type === CommandItem || child.type === CommandItemPrimitive) {
      return true;
    }
    if (child.type === React.Fragment || child.type === CommandGroup) {
      return hasCommandItems(
        (child.props as { children?: ReactNode }).children,
      );
    }
    if (child.type === CommandDocsGroup) {
      const docs = (child.props as CommandDocsGroupProps).docs;
      return docs.length > 0;
    }
    if (typeof child.type !== "string") return true;
    return hasCommandItems((child.props as { children?: ReactNode }).children);
  });
}

const SETTINGS_SEARCH_TERMS = [
  "settings",
  "preferences",
  "account",
  "profile",
  "integrations",
];
const NO_COMMAND_SELECTION = "\u0000";

function isApplePlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent)
  );
}

export interface CommandMenuProps<TAppContext = unknown> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  renderResults?: (search: string) => ReactNode;
  /** Reports whether default `renderResults` output has selectable rows; required with `emptyState` when results use opaque components. */
  renderResultsHasItems?: (search: string) => boolean;
  renderResultsPosition?: "before" | "after";
  renderContent?: (options: {
    search: string;
    renderList: (
      results?: ReactNode,
      options?: {
        /** Reports rows inside an opaque custom results component. */
        hasSelectableItems?: boolean;
      },
    ) => ReactNode;
  }) => ReactNode;
  placeholder?: string;
  inputLabel?: string;
  emptyText?: string;
  emptyState?: ReactNode;
  /** App suggestions shown only when a non-empty query has no selectable results. */
  noMatchSuggestionsSlot?: (search: string) => ReactNode;
  initialSelection?: "first" | "none";
  container?: HTMLElement;
  onSearchChange?: (search: string) => void;
  itemMatcher?: CommandMenuItemMatcher;
  showAgentFallback?: boolean;
  chatStorageKey?: string;
  clearSearchOnEscape?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
  /** Shared dialog width; `wide` is opt-in for palettes with denser app results. */
  size?: "default" | "wide";
  className?: string;
  changelog?: string;
  changelogLabel?: string;
  changelogKey?: string;
  showAbout?: boolean;
  showSettingsCommand?: boolean;
  showSignOutCommand?: boolean;
  /** App-owned entries are additive; shortcut hints are display-only. */
  appCommandGroups?: AppCommandGroup<TAppContext>[];
  /** State read by visibility and enabled predicates for app commands. */
  commandContext?: TAppContext;
  /** Optional app-owned filter controls shown between the search field and results. */
  filterLauncherSlot?: (context: AppCommandContext<TAppContext>) => ReactNode;
  /** Optional app chat surface rendered beneath the command results. */
  embeddedChatSlot?: (context: AppCommandContext<TAppContext>) => ReactNode;
  /** Content shown below the results with shared spacing and note semantics. */
  footerSlot?: ReactNode;
}

export function CommandMenu<TAppContext = unknown>({
  open,
  onOpenChange,
  children,
  renderResults,
  renderResultsHasItems,
  renderResultsPosition = "before",
  renderContent,
  placeholder = "Type a command or ask AI...",
  inputLabel = placeholder,
  emptyText: _emptyText = "No commands found.",
  emptyState,
  noMatchSuggestionsSlot,
  initialSelection,
  container,
  onSearchChange,
  itemMatcher,
  showAgentFallback = true,
  chatStorageKey,
  clearSearchOnEscape = false,
  onCloseAutoFocus,
  size = "default",
  className,
  changelog,
  changelogLabel = "What's new",
  changelogKey,
  showAbout: showAboutProp,
  showSettingsCommand = true,
  showSignOutCommand = true,
  appCommandGroups,
  commandContext,
  filterLauncherSlot,
  embeddedChatSlot,
  footerSlot,
}: CommandMenuProps<TAppContext>) {
  const [search, setSearch] = useState("");
  const [appPageStack, setAppPageStack] = useState<
    Array<{ pageId: string; parentSearch: string }>
  >([]);
  const [selectedCommandValue, setSelectedCommandValue] = useState("");
  const models = useChatModels({
    enabled: open && showAgentFallback,
    storageKey: chatModelSelectionStorageKey(chatStorageKey),
  });
  const shouldCheckProviderStatus =
    showAgentFallback && !isLocalRuntimeEngine(models.selectedEngine);
  const agentEngineConfigured = useAgentEngineConfigured(
    shouldCheckProviderStatus,
  );
  const providerStatus = shouldCheckProviderStatus
    ? agentEngineConfigured.state
    : "configured";
  const chatReady = providerStatus === "configured";
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchValueRef = useRef("");
  const selectionEnabledRef = useRef(false);
  const [selectionEnabled, setSelectionEnabled] = useState(false);
  const selectionResetRef = useRef(0);
  const nextEmptySelectionValue = useCallback(
    () => `${NO_COMMAND_SELECTION}${++selectionResetRef.current}`,
    [],
  );
  const onSearchChangeRef = useRef(onSearchChange);
  onSearchChangeRef.current = onSearchChange;
  const updateSearch = useCallback((value: string) => {
    if (searchValueRef.current === value) return;
    searchValueRef.current = value;
    setSearch(value);
    onSearchChangeRef.current?.(value);
  }, []);
  const nestedDialogsRef = useRef<Array<() => void>>([]);
  const t = useT();
  const registerNestedDialog = useCallback((dismiss: () => void) => {
    nestedDialogsRef.current.push(dismiss);
    return () => {
      nestedDialogsRef.current = nestedDialogsRef.current.filter(
        (registered) => registered !== dismiss,
      );
    };
  }, []);

  const [changelogOpen, setChangelogOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const hasChangelog =
    typeof changelog === "string" && changelog.trim().length > 0;
  const showAbout = showAboutProp ?? hasChangelog;
  const latestChangelogId = getChangelogLatestId(changelog);
  const { unseen: changelogUnseen, markSeen: markChangelogSeen } =
    useChangelogSeen(changelogKey ?? "app", latestChangelogId);
  const closeMenu = useCallback(() => onOpenChange(false), [onOpenChange]);
  const appCommandContext: AppCommandContext<TAppContext> = {
    search,
    appContext: commandContext,
    close: closeMenu,
  };

  const resetSelection = useCallback(() => {
    selectionEnabledRef.current = false;
    setSelectionEnabled(false);
    setSelectedCommandValue(
      initialSelection === "none" ? nextEmptySelectionValue() : "",
    );
  }, [initialSelection, nextEmptySelectionValue]);
  const enableSelection = useCallback(() => {
    if (selectionEnabledRef.current) return;
    selectionEnabledRef.current = true;
    flushSync(() => setSelectionEnabled(true));
  }, []);

  const openChangelog = useCallback(() => {
    onOpenChange(false);
    markChangelogSeen();
    setTimeout(() => setChangelogOpen(true), 50);
  }, [onOpenChange, markChangelogSeen]);

  const openAbout = useCallback(() => {
    onOpenChange(false);
    setTimeout(() => setAboutOpen(true), 50);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) {
      updateSearch("");
      setAppPageStack([]);
      resetSelection();
      return;
    }

    if (open) {
      updateSearch("");
      setAppPageStack([]);
      resetSelection();
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open, resetSelection, updateSearch]);

  const handleCommandValueChange = useCallback(
    (value: string) => {
      if (initialSelection === "none" && !selectionEnabledRef.current) {
        return;
      }
      setSelectedCommandValue(value);
    },
    [initialSelection],
  );

  const handleSubmitToAgent = useCallback(() => {
    if (!search.trim()) {
      onOpenChange(false);
      focusAgentChat();
      return;
    }
    if (!chatReady) return;
    onOpenChange(false);
    submitToAgent(search.trim());
  }, [chatReady, search, onOpenChange]);
  const retryProviderStatus = useCallback(() => {
    window.dispatchEvent(new Event("agent-engine:configured-changed"));
  }, []);

  const changelogRowMatches =
    !search ||
    [
      changelogLabel,
      "changelog",
      "what's new",
      "whats new",
      "updates",
      "release notes",
      "changes",
    ]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase());
  const showChangelogRow = hasChangelog && changelogRowMatches;
  const aboutLabel = t("agentChat.aboutAgentNative.title", {
    defaultValue: "About Agent-Native",
  });
  const aboutVersionLabel = t("agentChat.aboutAgentNative.version", {
    defaultValue: "Version",
  });
  const aboutEnvironmentLabel = t("agentChat.aboutAgentNative.environment", {
    defaultValue: "Environment",
  });
  const aboutBuildLabel = t("agentChat.aboutAgentNative.build", {
    defaultValue: "Build",
  });
  const aboutDiagnosticsLabel = t(
    "agentChat.aboutAgentNative.copyDiagnostics",
    {
      defaultValue: "Copy diagnostics",
    },
  );
  const aboutRowMatches =
    !search ||
    [
      aboutLabel,
      "agent-native",
      aboutVersionLabel,
      "versions",
      "package",
      aboutEnvironmentLabel,
      aboutBuildLabel,
      aboutDiagnosticsLabel,
    ]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase());
  const showAboutRow = showAbout && aboutRowMatches;
  const settingsLabel = t("settingsShortcut.command");
  const showSettingsRow =
    showSettingsCommand &&
    (!search ||
      [settingsLabel, ...SETTINGS_SEARCH_TERMS]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()));
  const handleOpenSettings = useCallback(() => {
    onOpenChange(false);
    openSettingsPage();
  }, [onOpenChange]);
  const signOutLabel = t("agentChat.auth.logOut");
  const showSignOutRow =
    showSignOutCommand &&
    (!search ||
      [signOutLabel, ...SIGN_OUT_SEARCH_TERMS]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()));
  const handleSignOut = useCallback(() => {
    onOpenChange(false);
    void signOut();
  }, [onOpenChange]);

  const filterChildren = (nodes: ReactNode): ReactNode => {
    return React.Children.map(nodes, (child) => {
      if (!React.isValidElement(child)) return child;
      const props = child.props as Record<string, unknown>;

      if (child.type === React.Fragment) {
        const fragmentChildren = filterChildren(props.children as ReactNode);
        if (React.Children.count(fragmentChildren) === 0) return null;
        return React.cloneElement(child, {
          ...props,
          children: fragmentChildren,
        } as Record<string, unknown>);
      }

      if (child.type === CommandGroup) {
        const groupChildren = filterChildren(props.children as ReactNode);
        const hasChildren = React.Children.count(groupChildren) > 0;
        if (!hasChildren) return null;
        return React.cloneElement(child, {
          ...props,
          children: groupChildren,
        } as Record<string, unknown>);
      }

      if (child.type === CommandDocsGroup) {
        const docs = Array.isArray(props.docs)
          ? (props.docs as CommandMenuDoc[])
          : [];
        const filteredDocs = filterCommandDocs(docs, search);
        if (filteredDocs.length === 0) return null;
        return React.cloneElement(child, {
          ...props,
          docs: filteredDocs,
        } as Record<string, unknown>);
      }

      if (child.type === CommandItem) {
        if (!search) return child;
        const label = getTextContent(props.children as ReactNode);
        const value = typeof props.value === "string" ? props.value : undefined;
        const keywords = Array.isArray(props.keywords)
          ? props.keywords.filter(
              (keyword): keyword is string => typeof keyword === "string",
            )
          : [];
        const searchLower = search.toLowerCase();
        const matches = itemMatcher
          ? itemMatcher({ query: search, label, value, keywords })
          : label.toLowerCase().includes(searchLower) ||
            keywords.join(" ").toLowerCase().includes(searchLower);
        if (matches) {
          return child;
        }
        return null;
      }

      if (child.type === CommandSeparator) {
        return search ? null : child;
      }

      return child;
    });
  };

  const activePageId = appPageStack.at(-1)?.pageId;
  const activeAppPage = activePageId
    ? findAppCommandPage(appCommandGroups ?? [], activePageId)
    : undefined;
  const currentAppGroups = activeAppPage?.groups ?? appCommandGroups ?? [];
  const filteredAppGroups = filterAppCommandGroups(
    currentAppGroups,
    search,
    appCommandContext,
    itemMatcher,
  );
  const appCommandEntries: AppCommandEntry<TAppContext>[] =
    filteredAppGroups.flatMap(({ group, commands }) =>
      commands.map((command) => ({
        group,
        command,
        value: `app-command:${group.id}:${command.id}`,
      })),
    );
  const selectedAppCommand = appCommandEntries.find(
    (entry) => entry.value === selectedCommandValue,
  );
  const firstEnabledAppCommand = appCommandEntries.find(
    ({ command }) => command.enabledWhen?.(appCommandContext) ?? true,
  );
  const commandMenuValue =
    initialSelection === "none"
      ? selectedCommandValue
      : activeAppPage
        ? (selectedAppCommand?.value ??
          firstEnabledAppCommand?.value ??
          NO_COMMAND_SELECTION)
        : undefined;
  const selectedAppCommandValue = commandMenuValue ?? selectedCommandValue;
  const previewAppCommand =
    appCommandEntries.find(
      (entry) => entry.value === selectedAppCommandValue,
    ) ?? selectedAppCommand;
  const appPreview = previewAppCommand?.command.preview;
  const renderedAppPreview =
    typeof appPreview === "function"
      ? appPreview(appCommandContext)
      : appPreview;
  const filteredChildren = activeAppPage ? null : filterChildren(children);
  const hasAppCommandResults = filteredAppGroups.length > 0;
  const hasChildrenResults = hasCommandItems(filteredChildren);
  const hasCommandResults = hasChildrenResults || hasAppCommandResults;
  const dynamicResults =
    open && !activeAppPage ? renderResults?.(search) : null;

  const goBackToAppPage = useCallback(() => {
    const currentPage = appPageStack.at(-1);
    if (!currentPage) return;
    setAppPageStack((stack) => stack.slice(0, -1));
    updateSearch(currentPage.parentSearch);
    resetSelection();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [appPageStack, resetSelection, updateSearch]);

  const openAppPage = (page: AppCommandPage<TAppContext>) => {
    setAppPageStack((stack) => [
      ...stack,
      { pageId: page.id, parentSearch: search },
    ]);
    updateSearch("");
    resetSelection();
  };

  const selectAppCommand = (command: AppCommand<TAppContext>) => {
    if ("page" in command && command.page) {
      openAppPage(command.page);
      return;
    }
    if (!("onSelect" in command) || !command.onSelect) return;
    if (command.enabledWhen && !command.enabledWhen(appCommandContext)) return;
    if (command.deferSelect === false) {
      command.onSelect(appCommandContext);
      closeMenu();
      return;
    }
    closeMenu();
    setTimeout(() => command.onSelect?.(appCommandContext), 50);
  };

  const renderList = (
    results?: ReactNode,
    options?: {
      hasSelectableItems?: boolean;
    },
  ) => {
    const usesDefaultResults = results === undefined;
    const renderedResults = usesDefaultResults ? dynamicResults : results;
    const hasDynamicItems =
      options?.hasSelectableItems ??
      (usesDefaultResults && !activeAppPage
        ? (renderResultsHasItems?.(search) ?? hasCommandItems(renderedResults))
        : hasCommandItems(renderedResults));
    const hasResults = hasCommandResults || hasDynamicItems;
    const noMatchSuggestions =
      !hasResults && search.trim() ? noMatchSuggestionsSlot?.(search) : null;
    const list = (
      <CommandListPrimitive>
        {activeAppPage ? (
          <CommandGroup heading={activeAppPage.title}>
            <button
              type="button"
              aria-label={t("onboarding.back")}
              data-testid="command-menu-page-back"
              className="flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
              onClick={goBackToAppPage}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.stopPropagation();
                }
              }}
            >
              <span>{t("onboarding.back")}</span>
              <CommandShortcutPrimitive>Esc</CommandShortcutPrimitive>
            </button>
          </CommandGroup>
        ) : null}

        {renderResultsPosition === "before" ? renderedResults : null}

        {filteredAppGroups.map(({ group, commands }) => (
          <CommandGroup key={group.id} heading={group.heading}>
            {commands.map((command) => {
              const value = `app-command:${group.id}:${command.id}`;
              const enabled = command.enabledWhen?.(appCommandContext) ?? true;
              const inlinePreview =
                value === selectedAppCommandValue
                  ? typeof command.inlinePreview === "function"
                    ? command.inlinePreview(appCommandContext)
                    : command.inlinePreview
                  : null;
              return (
                <CommandItemPrimitive
                  key={command.id}
                  value={value}
                  disabled={
                    !enabled ||
                    (initialSelection === "none" && !selectionEnabled)
                  }
                  className="min-h-8 cursor-pointer gap-2"
                  onSelect={() => selectAppCommand(command)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{command.label}</span>
                    {command.description ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {command.description}
                      </span>
                    ) : null}
                  </span>
                  {command.metadata ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {command.metadata}
                    </span>
                  ) : null}
                  {command.shortcutHint ? (
                    <CommandShortcutPrimitive>
                      {command.shortcutHint}
                    </CommandShortcutPrimitive>
                  ) : null}
                  {inlinePreview != null ? (
                    <div
                      data-testid="command-menu-app-command-preview"
                      className="ms-auto min-w-0"
                    >
                      {inlinePreview}
                    </div>
                  ) : null}
                </CommandItemPrimitive>
              );
            })}
          </CommandGroup>
        ))}

        {hasChildrenResults && filteredChildren}

        {renderResultsPosition === "after" ? renderedResults : null}

        {!hasResults && (emptyState != null || noMatchSuggestions != null) ? (
          <div
            role="status"
            aria-live="polite"
            className="px-3 py-6 text-center text-sm text-muted-foreground"
          >
            {emptyState}
            {noMatchSuggestions != null ? (
              <div className="mt-3">{noMatchSuggestions}</div>
            ) : null}
          </div>
        ) : null}

        {!activeAppPage && (
          <>
            {showSettingsRow && (
              <>
                {hasResults && <CommandSeparator />}
                <div className="p-1">
                  <CommandItemPrimitive
                    className="min-h-8 cursor-pointer gap-2"
                    disabled={initialSelection === "none" && !selectionEnabled}
                    onSelect={handleOpenSettings}
                  >
                    <span>{settingsLabel}</span>
                    <CommandShortcutPrimitive>
                      {getSettingsShortcutHint(isApplePlatform())}
                    </CommandShortcutPrimitive>
                  </CommandItemPrimitive>
                </div>
              </>
            )}

            {showChangelogRow && (
              <>
                {(hasResults || showSettingsRow) && <CommandSeparator />}
                <div className="p-1">
                  <CommandItemPrimitive
                    className="min-h-8 cursor-pointer gap-2"
                    disabled={initialSelection === "none" && !selectionEnabled}
                    onSelect={openChangelog}
                  >
                    <span>{changelogLabel}</span>
                    {changelogUnseen && (
                      <span
                        className="ms-auto h-2 w-2 rounded-full bg-primary"
                        aria-label="New updates available"
                      />
                    )}
                  </CommandItemPrimitive>
                </div>
              </>
            )}

            {showAboutRow && (
              <>
                {(hasResults || showSettingsRow || showChangelogRow) && (
                  <CommandSeparator />
                )}
                <div className="p-1">
                  <CommandItemPrimitive
                    className="min-h-8 cursor-pointer gap-2"
                    disabled={initialSelection === "none" && !selectionEnabled}
                    onSelect={openAbout}
                  >
                    <span>{aboutLabel}</span>
                  </CommandItemPrimitive>
                </div>
              </>
            )}

            {showSignOutRow && (
              <>
                {(hasResults ||
                  showSettingsRow ||
                  showChangelogRow ||
                  showAboutRow) && <CommandSeparator />}
                <div className="p-1">
                  <CommandItemPrimitive
                    className="min-h-8 cursor-pointer gap-2"
                    disabled={initialSelection === "none" && !selectionEnabled}
                    onSelect={handleSignOut}
                  >
                    <span>{signOutLabel}</span>
                  </CommandItemPrimitive>
                </div>
              </>
            )}

            {showAgentFallback && (
              <>
                {(hasResults ||
                  showSettingsRow ||
                  showChangelogRow ||
                  showAboutRow ||
                  showSignOutRow) && <CommandSeparator />}
                <div className="p-1">
                  {providerStatus === "unavailable" ? (
                    <div
                      className="mb-1 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
                      role="status"
                    >
                      <span>
                        {t("agentChat.setup.providerStatusUnavailable")}
                      </span>
                      {providerStatus === "unavailable" ? (
                        <button
                          type="button"
                          className="shrink-0 font-medium text-foreground underline-offset-4 hover:underline"
                          onClick={retryProviderStatus}
                        >
                          {t("agentChat.common.retry")}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <CommandItemPrimitive
                    className={cn(
                      "min-h-8 gap-2",
                      chatReady
                        ? "cursor-pointer"
                        : "cursor-not-allowed opacity-50",
                    )}
                    disabled={
                      !chatReady ||
                      (initialSelection === "none" && !selectionEnabled)
                    }
                    onSelect={handleSubmitToAgent}
                  >
                    <span>
                      {search.trim() ? (
                        <>
                          Ask AI:{" "}
                          <span className="text-muted-foreground">
                            "{search}"
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">
                          Ask AI anything...
                        </span>
                      )}
                    </span>
                    {search.trim() && (
                      <span className="ms-auto text-xs text-muted-foreground">
                        ↵
                      </span>
                    )}
                  </CommandItemPrimitive>
                </div>
              </>
            )}
          </>
        )}
      </CommandListPrimitive>
    );

    if (!activeAppPage && appCommandGroups === undefined && !embeddedChatSlot) {
      return list;
    }

    return (
      <>
        {list}
        {renderedAppPreview ? (
          <div
            data-testid="command-menu-inline-preview"
            role="region"
            aria-label={previewAppCommand?.command.label}
            className="border-t border-border p-3"
          >
            {renderedAppPreview}
          </div>
        ) : null}
        {embeddedChatSlot ? (
          <div
            data-testid="command-menu-embedded-chat"
            onKeyDown={stopCommandNavigation}
          >
            {embeddedChatSlot(appCommandContext)}
          </div>
        ) : null}
      </>
    );
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && nestedDialogsRef.current.length > 0) return;
          onOpenChange(nextOpen);
        }}
      >
        <DialogContent
          ref={containerRef}
          container={container}
          aria-describedby={undefined}
          onPointerDownCapture={(event) => {
            if (
              initialSelection === "none" &&
              (event.target as HTMLElement).closest?.("[cmdk-item]")
            ) {
              enableSelection();
            }
          }}
          onPointerMoveCapture={(event) => {
            if (
              initialSelection === "none" &&
              (event.target as HTMLElement).closest?.("[cmdk-item]")
            ) {
              enableSelection();
            }
          }}
          onEscapeKeyDown={(event) => {
            const dismissNested = nestedDialogsRef.current.at(-1);
            if (dismissNested) {
              event.preventDefault();
              queueMicrotask(dismissNested);
              return;
            }
            if (appPageStack.length > 0) {
              event.preventDefault();
              goBackToAppPage();
              return;
            }
            if (clearSearchOnEscape && search.length > 0) {
              event.preventDefault();
              updateSearch("");
            }
          }}
          hideClose
          motion="instant"
          overlayClassName="fixed inset-0 backdrop-blur-none transition-none"
          overlayStyle={{
            backgroundColor: "rgb(0 0 0 / 0.5)",
            backdropFilter: "none",
            animation: "none",
            transition: "none",
          }}
          className={cn(
            "fixed left-1/2 top-[15vh] !max-h-none -translate-x-1/2 !translate-y-0 !gap-0 w-full",
            size === "wide" ? "max-w-3xl" : "max-w-lg",
            "rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-lg",
            className,
          )}
          onCloseAutoFocus={onCloseAutoFocus}
          style={{
            animation: "none",
            transition: "none",
          }}
        >
          <DialogTitle className="sr-only">{placeholder}</DialogTitle>
          <CommandPrimitive
            loop
            shouldFilter={false}
            className="h-auto rounded-lg"
            value={commandMenuValue}
          >
            <CommandMenuContext.Provider
              value={{
                search,
                onOpenChange,
                registerNestedDialog,
                selectionEnabled:
                  initialSelection !== "none" || selectionEnabled,
              }}
            >
              {(appCommandGroups !== undefined ||
                embeddedChatSlot ||
                initialSelection !== undefined) && (
                <CommandSelectionTracker onChange={handleCommandValueChange} />
              )}
              {/* Search input */}
              <CommandInputPrimitive
                ref={inputRef}
                value={search}
                onValueChange={(value) => {
                  updateSearch(value);
                  selectionEnabledRef.current = false;
                  if (initialSelection === "none") {
                    setSelectionEnabled(false);
                    setSelectedCommandValue(nextEmptySelectionValue());
                  }
                }}
                onKeyDown={(event) => {
                  if (
                    initialSelection === "none" &&
                    (event.key === "ArrowDown" || event.key === "ArrowUp")
                  ) {
                    enableSelection();
                  }
                }}
                placeholder={placeholder}
                aria-label={inputLabel}
              />

              {open && filterLauncherSlot ? (
                <div
                  data-testid="command-menu-filter-launchers"
                  className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2"
                  onKeyDown={stopCommandNavigation}
                >
                  {filterLauncherSlot(appCommandContext)}
                </div>
              ) : null}

              {open && renderContent
                ? renderContent({ search, renderList })
                : open && renderList()}
              {open && footerSlot != null ? (
                <div
                  role="note"
                  className="border-t border-border px-3 py-2 text-xs text-muted-foreground"
                >
                  {footerSlot}
                </div>
              ) : null}
            </CommandMenuContext.Provider>
          </CommandPrimitive>
        </DialogContent>
      </Dialog>

      {hasChangelog && changelogOpen && (
        <LazyChunkErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <LazyChangelogDialog
              open
              onOpenChange={setChangelogOpen}
              markdown={changelog as string}
              title={changelogLabel}
            />
          </Suspense>
        </LazyChunkErrorBoundary>
      )}

      {showAbout && (
        <AboutAgentNativeDialog open={aboutOpen} onOpenChange={setAboutOpen} />
      )}
    </>
  );
}

function getTextContent(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (!children) return "";
  if (Array.isArray(children)) {
    return children.map(getTextContent).join(" ");
  }
  if (
    React.isValidElement(children) &&
    (children.props as Record<string, unknown>).children
  ) {
    return getTextContent(
      (children.props as Record<string, unknown>).children as ReactNode,
    );
  }
  return "";
}

CommandMenu.Group = CommandGroup;
CommandMenu.Item = CommandItem;
CommandMenu.DocsGroup = CommandDocsGroup;
CommandMenu.Shortcut = CommandShortcut;
CommandMenu.Separator = CommandSeparator;

export const COMMAND_MENU_OPEN_EVENT = "agent-native:open-command-menu";

const AGENT_COMPOSER_SELECTOR = '[data-agent-composer-slot="root"]';

export function openCommandMenu() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(COMMAND_MENU_OPEN_EVENT));
  }
}

export function useCommandMenuShortcut(
  onOpen: () => void,
  options: {
    allowContentEditable?: boolean;
    shouldHandleContentEditable?: (event: KeyboardEvent) => boolean;
  } = {},
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "k"
      ) {
        const target = e.target instanceof HTMLElement ? e.target : null;
        const isContentEditable = target?.isContentEditable;
        if (
          isContentEditable &&
          options.allowContentEditable &&
          options.shouldHandleContentEditable &&
          !options.shouldHandleContentEditable(e)
        ) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        if (
          target?.tagName === "INPUT" ||
          target?.tagName === "TEXTAREA" ||
          target?.tagName === "SELECT" ||
          (!options.allowContentEditable && isContentEditable)
        ) {
          return;
        }
        onOpen();
      }
    };
    // The agent composer autofocuses on load in every app, so without this an
    // app that did not opt into `allowContentEditable` swallowed the chord
    // (preventDefault, no open) for as long as the composer held focus.
    const handleComposerKeyDown = (e: KeyboardEvent) => {
      if (options.allowContentEditable) return;
      if (
        !(e.metaKey || e.ctrlKey) ||
        e.altKey ||
        e.shiftKey ||
        e.key.toLowerCase() !== "k"
      ) {
        return;
      }
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (
        !target?.isContentEditable ||
        !target.closest(AGENT_COMPOSER_SELECTOR)
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onOpen();
    };
    const handleOpenRequest = () => onOpen();
    const useCapture = Boolean(options.allowContentEditable);
    document.addEventListener("keydown", handleKeyDown, useCapture);
    document.addEventListener("keydown", handleComposerKeyDown, true);
    window.addEventListener(COMMAND_MENU_OPEN_EVENT, handleOpenRequest);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, useCapture);
      document.removeEventListener("keydown", handleComposerKeyDown, true);
      window.removeEventListener(COMMAND_MENU_OPEN_EVENT, handleOpenRequest);
    };
  }, [
    onOpen,
    options.allowContentEditable,
    options.shouldHandleContentEditable,
  ]);
}

export type {
  CommandDocsGroupProps,
  CommandGroupProps,
  CommandItemProps,
  CommandShortcutProps,
};
