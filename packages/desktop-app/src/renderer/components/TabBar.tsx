import {
  IconMail,
  IconCalendar,
  IconFileText,
  IconChartBar,
  IconLayoutGrid,
  IconStack2,
  IconVideo,
  IconBrandJira,
  IconClipboardList,
  IconUsers,
  IconCode,
  IconX,
  IconPlus,
  IconScreenShare,
  IconBrush,
} from "@tabler/icons-react";
import type { Tab } from "../App.js";

const ICON_MAP: Record<string, React.ComponentType<Record<string, unknown>>> = {
  Mail: IconMail,
  CalendarDays: IconCalendar,
  FileText: IconFileText,
  BarChart2: IconChartBar,
  GalleryHorizontal: IconLayoutGrid,
  Code: IconCode,
  Video: IconVideo,
  BrandJira: IconBrandJira,
  ClipboardList: IconClipboardList,
  Users: IconUsers,
  ScreenShare: IconScreenShare,
  Brush: IconBrush,
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
            tabIndex={-1}
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
      <button
        className="tab-new"
        tabIndex={-1}
        onClick={onNewTab}
        title="New tab"
      >
        <IconPlus size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}
