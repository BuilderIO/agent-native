import {
  CHAT_FIRST_SURFACE_CATALOG,
  type ChatFirstSurfaceKind,
  type ChatFirstSurfaceTab,
} from "@agent-native/core/client/agent-chat";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@agent-native/toolkit/ui";
import {
  IconFiles,
  IconGitCompare,
  IconMessageCircle,
  IconTerminal2,
  IconUsersGroup,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import type { ComponentType } from "react";

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

export default function DesktopChatFirstSurfaceTabs({
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
  return (
    <TooltipProvider delayDuration={400}>
      <div className="desktop-chat-first-surface-tabs">
        {tabs.length > 0 ? (
          <div
            className="desktop-chat-first-surface-tabs__list"
            role="tablist"
            aria-label="Open side surfaces"
          >
            {tabs.map((tab, index) => (
              <ContextMenu key={tab.id}>
                <ContextMenuTrigger asChild>
                  <div
                    role="tab"
                    tabIndex={activeTabId === tab.id ? 0 : -1}
                    aria-selected={activeTabId === tab.id}
                    className="desktop-chat-first-surface-tab"
                    data-active={activeTabId === tab.id ? "true" : "false"}
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
                            `[data-desktop-surface-tab-id="${CSS.escape(tabs[nextIndex].id)}"]`,
                          )
                          ?.focus();
                      });
                    }}
                    data-desktop-surface-tab-id={tab.id}
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
                      className="desktop-chat-first-surface-tab__main"
                      onClick={() => onActivate(tab)}
                      tabIndex={-1}
                    >
                      <SurfaceIcon kind={tab.kind} />
                      <span>{tab.title}</span>
                    </button>
                    <button
                      type="button"
                      className="desktop-chat-first-surface-tab__close"
                      aria-label={`Close ${tab.title}`}
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
                    Close
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={tabs.length < 2}
                    onSelect={() => onCloseOthers(tab)}
                  >
                    Close others
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={tabs[tabs.length - 1]?.id === tab.id}
                    onSelect={() => onCloseToRight(tab)}
                  >
                    Close to the right
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={onCloseAll}>
                    Close all
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        ) : (
          <div
            className="desktop-chat-first-surface-empty"
            data-surface-empty-state
          >
            {CHAT_FIRST_SURFACE_CATALOG.map((surface) => {
              const isDeferred = surface.availability === "deferred";
              const reason =
                surface.disabledReason ??
                "Ask the agent to open this surface when it is available.";
              const row = (
                <div
                  className={`desktop-chat-first-surface-empty__row${isDeferred ? " desktop-chat-first-surface-empty__row--deferred" : ""}`}
                  title={!isDeferred ? reason : undefined}
                  aria-label={`${surface.label}: ${reason}`}
                >
                  <SurfaceIcon kind={surface.kind} />
                  <span>{surface.label}</span>
                  {isDeferred ? (
                    <small
                      className="desktop-chat-first-surface-empty__status"
                      data-surface-availability="deferred"
                      aria-label="Deferred"
                    />
                  ) : null}
                </div>
              );
              if (surface.kind === "agents" && onOpenSurface) {
                return (
                  <button
                    key={surface.kind}
                    type="button"
                    className="desktop-chat-first-surface-empty__action"
                    aria-label="Open activity"
                    title="Open activity"
                    onClick={() => onOpenSurface(surface.kind)}
                  >
                    {row}
                  </button>
                );
              }
              if (!isDeferred) return <div key={surface.kind}>{row}</div>;
              return (
                <Tooltip key={surface.kind}>
                  <TooltipTrigger asChild>
                    <div>{row}</div>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-72">
                    {reason}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
