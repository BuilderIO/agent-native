import {
  CHAT_FIRST_SURFACE_CATALOG,
  type ChatFirstSurfaceKind,
  type ChatFirstSurfaceTab,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconFiles,
  IconGitCompare,
  IconMessageCircle,
  IconTerminal2,
  IconUsersGroup,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import type { ComponentType, ReactNode } from "react";

import { cn } from "../../lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";

const ICONS: Record<ChatFirstSurfaceKind, ComponentType<{ size?: number }>> = {
  app: IconFiles,
  browser: IconWorld,
  terminal: IconTerminal2,
  diff: IconGitCompare,
  files: IconFiles,
  "side-chat": IconMessageCircle,
  agents: IconUsersGroup,
};

function SurfaceIcon({ kind }: { kind: ChatFirstSurfaceKind }) {
  const Icon = ICONS[kind];
  return <Icon size={14} aria-hidden="true" />;
}

export function ChatFirstSurfaceTabs({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  onOpenSurface,
}: {
  tabs: ChatFirstSurfaceTab[];
  activeTabId: string | null;
  onActivate: (tab: ChatFirstSurfaceTab) => void;
  onClose: (tab: ChatFirstSurfaceTab) => void;
  onCloseOthers: (tab: ChatFirstSurfaceTab) => void;
  onCloseToRight: (tab: ChatFirstSurfaceTab) => void;
  onCloseAll: () => void;
  onOpenSurface?: (kind: ChatFirstSurfaceKind) => void;
}) {
  const t = useT();
  return (
    <div
      data-dispatch-chat-first-tabs
      className="dispatch-chat-first-surface-tabs shrink-0 border-b border-border bg-card"
    >
      {tabs.length > 0 ? (
        <div
          className="flex min-w-0 items-center gap-1 overflow-x-auto px-2 py-1.5"
          role="tablist"
          aria-label={t("dispatch.pages.chatFirstOpenSideSurfaces")}
        >
          {tabs.map((tab, index) => (
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger asChild>
                <div
                  role="tab"
                  tabIndex={activeTabId === tab.id ? 0 : -1}
                  aria-selected={activeTabId === tab.id}
                  data-surface-tab-id={tab.id}
                  data-active={activeTabId === tab.id ? "true" : "false"}
                  className="group flex h-8 min-w-0 max-w-48 shrink-0 items-center rounded-md text-xs transition-colors"
                  onKeyDown={(event) => {
                    const nextIndex =
                      event.key === "ArrowRight"
                        ? (index + 1) % tabs.length
                        : event.key === "ArrowLeft"
                          ? (index - 1 + tabs.length) % tabs.length
                          : event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? tabs.length - 1
                              : -1;
                    if (nextIndex < 0) return;
                    event.preventDefault();
                    onActivate(tabs[nextIndex]);
                    requestAnimationFrame(() => {
                      document
                        .querySelector<HTMLElement>(
                          `[data-surface-tab-id="${CSS.escape(tabs[nextIndex].id)}"]`,
                        )
                        ?.focus();
                    });
                  }}
                  onMouseDown={(event) => {
                    if (event.button === 1) {
                      event.preventDefault();
                      onClose(tab);
                    }
                  }}
                  title={tab.title}
                >
                  <button
                    type="button"
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-1.5 rounded-s-md px-2 text-start",
                      activeTabId === tab.id
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                    onClick={() => onActivate(tab)}
                    tabIndex={-1}
                  >
                    <SurfaceIcon kind={tab.kind} />
                    <span className="truncate">{tab.title}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={t("dispatch.pages.chatFirstCloseTab", {
                      name: tab.title,
                    })}
                    className="me-1 flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-background/60 group-hover:opacity-100 focus:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      onClose(tab);
                    }}
                  >
                    <IconX size={12} aria-hidden="true" />
                  </button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => onClose(tab)}>
                  {t("dispatch.pages.chatFirstClose")}
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={tabs.length < 2}
                  onSelect={() => onCloseOthers(tab)}
                >
                  {t("dispatch.pages.chatFirstCloseOthers")}
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={tabs[tabs.length - 1]?.id === tab.id}
                  onSelect={() => onCloseToRight(tab)}
                >
                  {t("dispatch.pages.chatFirstCloseToRight")}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  disabled={tabs.length === 0}
                  onSelect={onCloseAll}
                >
                  {t("dispatch.pages.chatFirstCloseAll")}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </div>
      ) : (
        <SurfaceEmptyState onOpenSurface={onOpenSurface} />
      )}
    </div>
  );
}

function SurfaceEmptyState({
  onOpenSurface,
}: {
  onOpenSurface?: (kind: ChatFirstSurfaceKind) => void;
}) {
  const t = useT();
  const surfaceCopy: Record<
    ChatFirstSurfaceKind,
    { label: string; description: string; reason?: string }
  > = {
    app: {
      label: t("dispatch.pages.chatFirstWorkspaceApps"),
      description: t("dispatch.pages.chatFirstWorkspaceApps"),
    },
    browser: {
      label: t("dispatch.pages.chatFirstSurfaceBrowserLabel"),
      description: t("dispatch.pages.chatFirstSurfaceBrowserDescription"),
      reason: t("dispatch.pages.chatFirstSurfaceBrowserReason"),
    },
    terminal: {
      label: t("dispatch.pages.chatFirstSurfaceTerminalLabel"),
      description: t("dispatch.pages.chatFirstSurfaceTerminalDescription"),
      reason: t("dispatch.pages.chatFirstSurfaceTerminalReason"),
    },
    files: {
      label: t("dispatch.pages.chatFirstSurfaceFilesLabel"),
      description: t("dispatch.pages.chatFirstSurfaceFilesDescription"),
      reason: t("dispatch.pages.chatFirstSurfaceFilesReason"),
    },
    diff: {
      label: t("dispatch.pages.chatFirstSurfaceDiffLabel"),
      description: t("dispatch.pages.chatFirstSurfaceDiffDescription"),
      reason: t("dispatch.pages.chatFirstSurfaceDiffReason"),
    },
    "side-chat": {
      label: t("dispatch.pages.chatFirstSurfaceSideChatLabel"),
      description: t("dispatch.pages.chatFirstSurfaceSideChatDescription"),
      reason: t("dispatch.pages.chatFirstSurfaceSideChatReason"),
    },
    agents: {
      label: t("dispatch.pages.chatFirstSurfaceAgentsLabel"),
      description: t("dispatch.pages.chatFirstSurfaceAgentsDescription"),
      reason: t("dispatch.pages.chatFirstSurfaceAgentsReason"),
    },
  };
  return (
    <div className="grid grid-cols-2 gap-2 p-3" data-surface-empty-state>
      {CHAT_FIRST_SURFACE_CATALOG.map((surface) => {
        const copy = surfaceCopy[surface.kind];
        const disabledReason =
          copy.reason ?? t("dispatch.pages.chatFirstUnavailable");
        return (
          <div
            key={surface.kind}
            className="group rounded-lg border border-border bg-background p-3"
            title={disabledReason}
          >
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <SurfaceIcon kind={surface.kind} />
              <span>{copy.label}</span>
              {surface.availability === "deferred" ? (
                <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("dispatch.pages.chatFirstDeferred")}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              {copy.description}
            </p>
            <p className="mt-2 text-[10px] leading-snug text-muted-foreground/70">
              {disabledReason}
            </p>
            {surface.kind === "agents" && onOpenSurface ? (
              <button
                type="button"
                className="mt-3 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
                onClick={() => onOpenSurface(surface.kind)}
              >
                {t("dispatch.pages.chatFirstOpenActivity")}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function ChatFirstSurfaceContent({ children }: { children: ReactNode }) {
  return (
    <div className="dispatch-chat-first-surface-content min-h-0 flex-1 overflow-hidden">
      {children}
    </div>
  );
}
