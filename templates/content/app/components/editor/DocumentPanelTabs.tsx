import { useT } from "@agent-native/core/client/i18n";
import {
  IconBolt,
  IconInfoCircle,
  IconMessageCircle,
} from "@tabler/icons-react";
import { type KeyboardEvent, type Ref, useRef, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isApplePlatform } from "@/lib/platform";
import { cn } from "@/lib/utils";

import {
  type DocumentPagePanelTab,
  firstFocusableIn,
  leaveEscapeToPagePanel,
} from "./document-page-panel-state";

export const DOCUMENT_PAGE_PANEL_ID = "document-page-panel";

const TOOLTIP_DELAY_MS = 500;
const TAB_KEYS: Record<DocumentPagePanelTab, string> = {
  agent: "J",
  comments: "M",
  info: "I",
};
const TAB_ICONS = {
  agent: IconBolt,
  comments: IconMessageCircle,
  info: IconInfoCircle,
};

function tabShortcut(tab: DocumentPagePanelTab) {
  const key = TAB_KEYS[tab];
  return isApplePlatform()
    ? { hint: `⇧⌘${key}`, aria: `Meta+Shift+${key}` }
    : { hint: `Ctrl+Shift+${key}`, aria: `Control+Shift+${key}` };
}

export function DocumentPanelTabs({
  tabs,
  activeTab,
  openCommentCount = 0,
  plain = false,
  panelId = DOCUMENT_PAGE_PANEL_ID,
  commentsTriggerRef,
  onTabChange,
}: {
  tabs: DocumentPagePanelTab[];
  activeTab: DocumentPagePanelTab | null;
  openCommentCount?: number;
  /** A phone's header: plain 44 px buttons without the track. */
  plain?: boolean;
  panelId?: string | undefined;
  commentsTriggerRef?: Ref<HTMLButtonElement> | undefined;
  onTabChange: (tab: DocumentPagePanelTab | null) => void;
}) {
  const t = useT();
  const buttons = useRef(new Map<DocumentPagePanelTab, HTMLButtonElement>());
  const [tooltipTab, setTooltipTab] = useState<DocumentPagePanelTab | null>(
    null,
  );
  // A tab that was just clicked or tapped, or that took focus without the
  // keyboard, keeps its tooltip hidden until the pointer next crosses it.
  const [quietTab, setQuietTab] = useState<DocumentPagePanelTab | null>(null);
  const tabLabels: Record<DocumentPagePanelTab, string> = {
    agent: t("navigation.agent"),
    comments: t("comments.discussion"),
    info: t("editor.toolbar.info"),
  };
  const countLabel = openCommentCount > 99 ? "99+" : String(openCommentCount);
  // One tab stop for the whole list; the arrow keys move inside it.
  const tabStop = activeTab && tabs.includes(activeTab) ? activeTab : tabs[0];

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    tab: DocumentPagePanelTab,
  ) => {
    const index = tabs.indexOf(tab);
    const move = (next: number) => {
      event.preventDefault();
      const position = (next + tabs.length) % tabs.length;
      const target = tabs.find((_, index) => index === position);
      if (target) buttons.current.get(target)?.focus();
    };
    if (event.key === "ArrowRight") move(index + 1);
    else if (event.key === "ArrowLeft") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(tabs.length - 1);
    else if (event.key === "Tab" && !event.shiftKey && tab === activeTab) {
      // The panel comes after the whole header in the page, so Tab goes there
      // directly from the tab that opened it. A panel still on its way in can't
      // take focus yet, and then Tab carries on as usual.
      const target = firstFocusableIn(document.getElementById(panelId));
      target?.focus();
      if (target && document.activeElement === target) event.preventDefault();
    }
  };

  return (
    <div
      role="tablist"
      aria-label={t("comments.panelTabs")}
      className={cn(
        "flex shrink-0 items-center",
        plain ? "" : "gap-0.5 rounded-lg bg-muted p-0.5",
      )}
      data-document-panel-tabs
    >
      {tabs.map((tab) => {
        const Icon = TAB_ICONS[tab];
        const active = tab === activeTab;
        const shortcut = tabShortcut(tab);
        const showCount = tab === "comments" && openCommentCount > 0;
        return (
          <Tooltip
            key={tab}
            delayDuration={TOOLTIP_DELAY_MS}
            open={tooltipTab === tab && quietTab !== tab}
            onOpenChange={(open) =>
              setTooltipTab((current) =>
                open ? tab : current === tab ? null : current,
              )
            }
          >
            <TooltipTrigger asChild>
              <button
                ref={(element) => {
                  if (element) buttons.current.set(tab, element);
                  else buttons.current.delete(tab);
                  if (tab !== "comments" || !commentsTriggerRef) return;
                  if (typeof commentsTriggerRef === "function") {
                    commentsTriggerRef(element);
                  } else {
                    commentsTriggerRef.current = element;
                  }
                }}
                type="button"
                role="tab"
                tabIndex={tab === tabStop ? 0 : -1}
                aria-selected={active}
                aria-controls={panelId}
                aria-keyshortcuts={shortcut.aria}
                aria-label={
                  showCount
                    ? t("comments.discussionOpenCount", {
                        count: openCommentCount,
                      })
                    : tabLabels[tab]
                }
                data-document-panel-tab={tab}
                data-comments-history-trigger={
                  tab === "comments" ? "" : undefined
                }
                data-open-comment-count={
                  tab === "comments" ? openCommentCount || undefined : undefined
                }
                className={cn(
                  "flex items-center justify-center gap-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  plain
                    ? "h-11 min-w-11 rounded-lg px-1.5"
                    : "h-[30px] min-w-[38px] rounded-md px-2",
                  active &&
                    (plain
                      ? "bg-muted text-foreground"
                      : "bg-background text-foreground shadow-sm"),
                )}
                onClick={() => onTabChange(active ? null : tab)}
                onKeyDown={(event) => handleKeyDown(event, tab)}
                onPointerDown={() => setQuietTab(tab)}
                onPointerEnter={() => setQuietTab(null)}
                onPointerLeave={() => {
                  setQuietTab(null);
                  setTooltipTab(null);
                }}
                onFocus={(event) => {
                  if (!event.currentTarget.matches(":focus-visible")) {
                    setQuietTab(tab);
                  }
                }}
                onBlur={() => setQuietTab(null)}
              >
                <Icon size={16} aria-hidden="true" />
                {showCount ? (
                  <span
                    aria-hidden="true"
                    className="text-xs font-semibold tabular-nums leading-none"
                  >
                    {countLabel}
                  </span>
                ) : null}
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              onEscapeKeyDown={leaveEscapeToPagePanel}
            >
              {tabLabels[tab]}
              <kbd className="ms-2 font-sans text-xs opacity-70">
                {shortcut.hint}
              </kbd>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
