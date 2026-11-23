import {
  IconCommand,
  IconBox,
  IconFileText,
  IconPackage,
  IconDatabase,
  IconHelp,
  IconHistory,
  IconList,
  IconSearch,
  IconVariable,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

import { secondaryFeaturesEnabled } from "@/components/shell/secondary-features";

import type { NotebookToolRailItem } from "./types";

const ITEMS: ReadonlyArray<{
  id: NotebookToolRailItem;
  label: string;
  icon: ReactNode;
}> = [
  {
    id: "variables",
    label: "Variables",
    icon: <IconVariable size={16} aria-hidden="true" />,
  },
  {
    id: "components",
    label: "Components",
    icon: <IconBox size={16} aria-hidden="true" />,
    // Backed by the workspace's own component registry (manage-component).
  },
  {
    id: "environment",
    label: "Environment",
    icon: <IconPackage size={16} aria-hidden="true" />,
    // Backed by the runtime's own package list (list-environment-packages).
  },
  {
    id: "files",
    label: "Files",
    icon: <IconFileText size={16} aria-hidden="true" />,
  },
  {
    id: "find",
    label: "Find",
    icon: <IconSearch size={16} aria-hidden="true" />,
  },
  {
    id: "data-browser",
    label: "Data browser",
    icon: <IconDatabase size={16} aria-hidden="true" />,
  },
  {
    id: "toc",
    label: "Table of contents",
    icon: <IconList size={16} aria-hidden="true" />,
  },
  {
    id: "help",
    label: "Help & support",
    icon: <IconHelp size={16} aria-hidden="true" />,
  },
  {
    id: "history",
    label: "History & versions",
    icon: <IconHistory size={16} aria-hidden="true" />,
  },
];

export function ToolRail({
  canBrowseData = true,
  onSelect,
  onOpenCommandPalette,
}: {
  canBrowseData?: boolean;
  onOpenCommandPalette?: (() => void) | undefined;
  onSelect?: ((item: NotebookToolRailItem) => Promise<void> | void) | undefined;
}) {
  return (
    <nav className="nb-tool-rail" aria-label="Workspace tools">
      {onOpenCommandPalette ? (
        <button
          type="button"
          className="nb-tool-rail-button"
          aria-label="Command palette"
          title="Command palette"
          onClick={onOpenCommandPalette}
        >
          <IconCommand size={16} aria-hidden="true" />
        </button>
      ) : null}
      {ITEMS.filter(
        (item) =>
          (item.id !== "data-browser" || canBrowseData) &&
          (item.id !== "components" || secondaryFeaturesEnabled()),
      ).map((item) => (
        <button
          key={item.id}
          type="button"
          className="nb-tool-rail-button"
          aria-label={item.label}
          title={item.label}
          onClick={() => void onSelect?.(item.id)}
        >
          {item.icon}
        </button>
      ))}
    </nav>
  );
}
