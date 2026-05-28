import {
  IconFolder,
  IconGitBranch,
  IconSearch,
  IconGitPullRequest,
  IconSettings,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type ActivityId =
  | "explorer"
  | "changes"
  | "search"
  | "source-control"
  | "settings";

interface ActivityBarProps {
  activity: ActivityId;
  onActivityChange: (next: ActivityId) => void;
  /** When false, the Settings gear at the bottom is hidden. */
  showSettings?: boolean;
}

interface ActivityItem {
  id: ActivityId;
  label: string;
  icon: typeof IconFolder;
}

const MAIN_ACTIVITIES: ActivityItem[] = [
  { id: "explorer", label: "Explorer", icon: IconFolder },
  { id: "changes", label: "Changes", icon: IconGitBranch },
  { id: "search", label: "Search", icon: IconSearch },
  { id: "source-control", label: "Source Control", icon: IconGitPullRequest },
];

/**
 * 48px-wide vertical icon strip on the far left of the Code Room.
 * Click an icon -> the matching panel renders in the sidebar to the right.
 * The Settings gear at the bottom swaps the sidebar to the
 * `CodeSettingsPanel` for managing workspaces.
 */
export function ActivityBar({
  activity,
  onActivityChange,
  showSettings = true,
}: ActivityBarProps) {
  return (
    <nav
      aria-label="Code Room activities"
      className="flex h-full w-12 shrink-0 flex-col items-center justify-between border-r border-border bg-background py-2"
    >
      <ul className="flex flex-col gap-1">
        {MAIN_ACTIVITIES.map((item) => (
          <li key={item.id}>
            <ActivityIcon
              item={item}
              active={activity === item.id}
              onClick={() => onActivityChange(item.id)}
            />
          </li>
        ))}
      </ul>
      {showSettings ? (
        <ActivityIcon
          item={{
            id: "settings",
            label: "Workspace settings",
            icon: IconSettings,
          }}
          active={activity === "settings"}
          onClick={() => onActivityChange("settings")}
        />
      ) : null}
    </nav>
  );
}

function ActivityIcon({
  item,
  active,
  onClick,
}: {
  item: ActivityItem;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "size-9 cursor-pointer rounded-md",
            active
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
          onClick={onClick}
          aria-label={item.label}
          aria-pressed={active}
        >
          <Icon size={18} aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}
