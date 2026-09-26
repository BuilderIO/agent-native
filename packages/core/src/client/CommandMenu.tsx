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
  IconBook2,
  IconExternalLink,
  IconInfoCircle,
  IconMessage,
  IconHistory,
  IconLogout,
} from "@tabler/icons-react";
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

import { AboutAgentNativeDialog } from "./AboutAgentNativeDialog.js";
import { sendToAgentChat } from "./agent-chat.js";
import {
  getChangelogLatestId,
  useChangelogSeen,
} from "./changelog/use-changelog-seen.js";
import { BuilderSetupCard } from "./chat/run-recovery.js";
import { Dialog, DialogContent, DialogTitle } from "./components/ui/dialog.js";
import { useT } from "./i18n.js";
import { LazyChunkErrorBoundary } from "./lazy-chunk-error-boundary.js";
import { signOut, SIGN_OUT_SEARCH_TERMS } from "./sign-out.js";
import { useAgentEngineConfigured } from "./use-agent-engine-configured.js";
import {
  chatModelSelectionStorageKey,
  useChatModels,
} from "./use-chat-models.js";
import { cn } from "./utils.js";

const LazyChangelogDialog = lazy(async () => {
  const { ChangelogDialog } = await import("./changelog/Changelog.js");
  return { default: ChangelogDialog };
});

interface CommandMenuContextValue {
  search: string;
  onOpenChange: (open: boolean) => void;
  registerNestedDialog: (dismiss: () => void) => () => void;
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

interface CommandItemProps {
  onSelect: () => void;
  children: ReactNode;
  keywords?: string[];
  className?: string;
  deferSelect?: boolean;
}

function CommandItem({
  onSelect,
  children,
  keywords: _keywords,
  className,
  deferSelect = true,
}: CommandItemProps) {
  const { onOpenChange } = useCommandMenuContext();

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
      className={cn("cursor-pointer gap-2", className)}
      onSelect={handleSelect}
    >
      {children}
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
          className="items-start py-2"
        >
          <IconBook2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
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

export interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  renderResults?: (search: string) => ReactNode;
  renderContent?: (options: {
    search: string;
    renderList: (results?: ReactNode) => ReactNode;
  }) => ReactNode;
  placeholder?: string;
  inputLabel?: string;
  emptyText?: string;
  showAgentFallback?: boolean;
  chatStorageKey?: string;
  clearSearchOnEscape?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
  className?: string;
  changelog?: string;
  changelogLabel?: string;
  changelogKey?: string;
  showAbout?: boolean;
}

export function CommandMenu({
  open,
  onOpenChange,
  children,
  renderResults,
  renderContent,
  placeholder = "Type a command or ask AI...",
  inputLabel = placeholder,
  emptyText: _emptyText = "No commands found.",
  showAgentFallback = true,
  chatStorageKey,
  clearSearchOnEscape = false,
  onCloseAutoFocus,
  className,
  changelog,
  changelogLabel = "What's new",
  changelogKey,
  showAbout: showAboutProp,
}: CommandMenuProps) {
  const [search, setSearch] = useState("");
  const models = useChatModels({
    enabled: false,
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
      setSearch("");
      return;
    }

    if (open) {
      setSearch("");
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

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
  const signOutLabel = t("agentChat.auth.logOut");
  const showSignOutRow =
    !search ||
    [signOutLabel, ...SIGN_OUT_SEARCH_TERMS]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase());
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
        const text = getTextContent(props.children as ReactNode).toLowerCase();
        const keywords = ((props.keywords as string[]) || [])
          .join(" ")
          .toLowerCase();
        const searchLower = search.toLowerCase();
        if (text.includes(searchLower) || keywords.includes(searchLower)) {
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

  const filteredChildren = filterChildren(children);
  const hasResults = React.Children.toArray(filteredChildren).some(
    (child) =>
      React.isValidElement(child) &&
      (child.type === CommandGroup || child.type === CommandDocsGroup),
  );
  const dynamicResults = open ? renderResults?.(search) : null;

  const renderList = (results: ReactNode = dynamicResults) => (
    <CommandListPrimitive>
      {results}
      {hasResults && filteredChildren}

      {showChangelogRow && (
        <>
          {hasResults && <CommandSeparator />}
          <div className="p-1">
            <CommandItemPrimitive
              className="cursor-pointer gap-2 py-2"
              onSelect={openChangelog}
            >
              <IconHistory className="h-4 w-4 text-muted-foreground" />
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
          {(hasResults || showChangelogRow) && <CommandSeparator />}
          <div className="p-1">
            <CommandItemPrimitive
              className="cursor-pointer gap-2 py-2"
              onSelect={openAbout}
            >
              <IconInfoCircle className="h-4 w-4 text-muted-foreground" />
              <span>{aboutLabel}</span>
            </CommandItemPrimitive>
          </div>
        </>
      )}

      {showSignOutRow && (
        <>
          {(hasResults || showChangelogRow || showAboutRow) && (
            <CommandSeparator />
          )}
          <div className="p-1">
            <CommandItemPrimitive
              className="cursor-pointer gap-2 py-2"
              onSelect={handleSignOut}
            >
              <IconLogout className="h-4 w-4 text-muted-foreground rtl:-scale-x-100" />
              <span>{signOutLabel}</span>
            </CommandItemPrimitive>
          </div>
        </>
      )}

      {showAgentFallback && (
        <>
          {(hasResults ||
            showChangelogRow ||
            showAboutRow ||
            showSignOutRow ||
            Boolean(results)) && <CommandSeparator />}
          <div className="p-1">
            {providerStatus === "missing" ? (
              <BuilderSetupCard attached fullWidth layout="sidebar" />
            ) : providerStatus === "unknown" ||
              providerStatus === "unavailable" ? (
              <div
                className="mb-1 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
                role="status"
              >
                <span>
                  {providerStatus === "unknown"
                    ? t("agentChat.setup.checkingProvider")
                    : t("agentChat.setup.providerStatusUnavailable")}
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
                "gap-2 py-2",
                chatReady ? "cursor-pointer" : "cursor-not-allowed opacity-50",
              )}
              disabled={!chatReady}
              onSelect={handleSubmitToAgent}
            >
              <IconMessage className="h-4 w-4 text-muted-foreground" />
              <span>
                {search.trim() ? (
                  <>
                    Ask AI:{" "}
                    <span className="text-muted-foreground">"{search}"</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    Ask AI anything...
                  </span>
                )}
              </span>
              {search.trim() && (
                <span className="ms-auto text-xs text-muted-foreground">↵</span>
              )}
            </CommandItemPrimitive>
          </div>
        </>
      )}
    </CommandListPrimitive>
  );

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
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            const dismissNested = nestedDialogsRef.current.at(-1);
            if (dismissNested) {
              event.preventDefault();
              queueMicrotask(dismissNested);
              return;
            }
            if (clearSearchOnEscape && search.length > 0) {
              event.preventDefault();
              setSearch("");
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
            "fixed left-1/2 top-[15vh] !max-h-none -translate-x-1/2 !translate-y-0 !gap-0 w-full max-w-lg",
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
          >
            <CommandMenuContext.Provider
              value={{ search, onOpenChange, registerNestedDialog }}
            >
              {/* Search input */}
              <CommandInputPrimitive
                ref={inputRef}
                value={search}
                onValueChange={setSearch}
                placeholder={placeholder}
                aria-label={inputLabel}
              />

              {open && renderContent
                ? renderContent({ search, renderList })
                : open && renderList()}
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
    const handleOpenRequest = () => onOpen();
    const useCapture = Boolean(options.allowContentEditable);
    document.addEventListener("keydown", handleKeyDown, useCapture);
    window.addEventListener(COMMAND_MENU_OPEN_EVENT, handleOpenRequest);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, useCapture);
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
