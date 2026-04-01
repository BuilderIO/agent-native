import {
  IconMail,
  IconCalendar,
  IconFileText,
  IconChartBar,
  IconLayoutGrid,
  IconStack2,
  IconVideo,
  IconCircleDot,
  IconClipboardList,
  IconUsers,
  IconCode,
  IconX,
  IconPlus,
} from "@tabler/icons-react";
import type { Tab } from "../App.js";

const ICON_MAP: Record<string, React.ComponentType<Record<string, unknown>>> = {
  IconMail,
  IconCalendar,
  IconFileText,
  IconChartBar,
  IconLayoutGrid,
  IconStack2,
  IconVideo,
  IconCircleDot,
  IconClipboardList,
  IconUsers,
  IconCode,
};

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: () => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onNewTab,
}: TabBarProps) {
  return (
    <div className="tabbar">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;

        return (
          <button
            key={tab.id}
            className={`tab${isActive ? " tab--active" : ""}`}
            onClick={() => onTabSelect(tab.id)}
            onMouseDown={(e) => {
              // Middle-click to close
              if (e.button === 1) {
                e.preventDefault();
                onTabClose(tab.id);
              }
            }}
            title={tab.title}
          >
            <span className="tab-label">{tab.title}</span>
            <span
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(tab.id);
              }}
              role="button"
              tabIndex={-1}
            >
              <IconX size={10} strokeWidth={2} />
            </span>
          </button>
        );
      })}
      <button className="tab-new" onClick={onNewTab} title="New tab">
        <IconPlus size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}
