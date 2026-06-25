import { IconX, IconPlus, IconReload } from "@tabler/icons-react";

import type { Tab } from "../App.js";
import { shouldReserveMacOSWindowControlsSpace } from "../lib/platform.js";
import { getTabDisplayTitle } from "../lib/tab-title.js";

const reserveMacOSWindowControlsSpace = shouldReserveMacOSWindowControlsSpace();

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  appName: string;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabRefresh: (tabId: string) => void;
  onNewTab: () => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  appName,
  onTabSelect,
  onTabClose,
  onTabRefresh,
  onNewTab,
}: TabBarProps) {
  return (
    <div className="tabbar">
      {reserveMacOSWindowControlsSpace && (
        <div className="tabbar-window-spacer" aria-hidden="true" />
      )}
      <div className="tabbar-strip">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const title = getTabDisplayTitle(tab.title, appName);

          return (
            <button
              key={tab.id}
              className={`tab${isActive ? " tab--active" : ""}`}
              tabIndex={-1}
              onClick={() => onTabSelect(tab.id)}
              onMouseDown={(e) => {
                // Middle-click to close
                if (e.button === 1) {
                  e.preventDefault();
                  onTabClose(tab.id);
                }
              }}
              title={title}
            >
              <span className="tab-label">{title}</span>
              <span
                className="tab-refresh"
                onClick={(e) => {
                  e.stopPropagation();
                  onTabRefresh(tab.id);
                }}
                role="button"
                tabIndex={-1}
                title="Reload tab"
              >
                <IconReload size={11} strokeWidth={2} />
              </span>
              <span
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  onTabClose(tab.id);
                }}
                role="button"
                tabIndex={-1}
                title="Close tab"
              >
                <IconX size={10} strokeWidth={2} />
              </span>
            </button>
          );
        })}
        <button
          className="tab-new"
          tabIndex={-1}
          onClick={onNewTab}
          title="New tab"
        >
          <IconPlus size={14} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
