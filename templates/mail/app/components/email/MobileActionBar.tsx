import { useState } from "react";
import { cn } from "@/lib/utils";
import type { MobileActionId } from "@shared/types";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from "@/components/ui/drawer";
import { Switch } from "@/components/ui/switch";

export const ALL_MOBILE_ACTIONS: MobileActionId[] = [
  "archive",
  "trash",
  "star",
  "reply",
  "replyAll",
  "forward",
  "markUnread",
  "prev",
  "next",
];

export const DEFAULT_MOBILE_ACTIONS: MobileActionId[] = [
  "archive",
  "trash",
  "star",
  "reply",
  "replyAll",
  "forward",
  "markUnread",
  "prev",
  "next",
];

/** Metadata for each action: icon SVG, label */
const ACTION_META: Record<
  MobileActionId,
  {
    label: string;
    icon: (active?: boolean) => React.ReactNode;
  }
> = {
  archive: {
    label: "Done",
    icon: () => (
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-5 w-5">
        <path
          fillRule="evenodd"
          d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  trash: {
    label: "Trash",
    icon: () => (
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-5 w-5">
        <path
          fillRule="evenodd"
          d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5zM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5A.75.75 0 0 1 9.95 6z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  star: {
    label: "Star",
    icon: (active) =>
      active ? (
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className="h-5 w-5 text-yellow-500"
        >
          <path
            fillRule="evenodd"
            d="M8 1.75a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 13.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 7.874a.75.75 0 0 1 .416-1.28l4.21-.611L7.327 2.17A.75.75 0 0 1 8 1.75z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          className="h-5 w-5"
        >
          <path d="M8 1.75l1.882 3.815 4.21.612-3.046 2.97.719 4.192L8 11.36l-3.766 1.98.72-4.194L1.907 6.177l4.21-.611z" />
        </svg>
      ),
  },
  reply: {
    label: "Reply",
    icon: () => (
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-5 w-5">
        <path
          fillRule="evenodd"
          d="M7.28 1.22a.75.75 0 0 1 0 1.06L4.56 5H8.5a5.5 5.5 0 0 1 0 11H6a.75.75 0 0 1 0-1.5h2.5a4 4 0 0 0 0-8H4.56l2.72 2.72a.75.75 0 1 1-1.06 1.06l-4-4a.75.75 0 0 1 0-1.06l4-4a.75.75 0 0 1 1.06 0z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  replyAll: {
    label: "Reply All",
    icon: () => (
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-5 w-5">
        <path d="M3.28 1.22a.75.75 0 0 0-1.06 0l-2 2a.75.75 0 0 0 0 1.06l2 2a.75.75 0 0 0 1.06-1.06L2.06 4l1.22-1.22a.75.75 0 0 0 0-1.06z" />
        <path
          fillRule="evenodd"
          d="M9.28 1.22a.75.75 0 0 1 0 1.06L6.56 5H10.5a5.5 5.5 0 0 1 0 11H8a.75.75 0 0 1 0-1.5h2.5a4 4 0 0 0 0-8H6.56l2.72 2.72a.75.75 0 1 1-1.06 1.06l-4-4a.75.75 0 0 1 0-1.06l4-4a.75.75 0 0 1 1.06 0z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  forward: {
    label: "Forward",
    icon: () => (
      <svg
        viewBox="0 0 16 16"
        fill="currentColor"
        className="h-5 w-5 scale-x-[-1]"
      >
        <path
          fillRule="evenodd"
          d="M7.28 1.22a.75.75 0 0 1 0 1.06L4.56 5H8.5a5.5 5.5 0 0 1 0 11H6a.75.75 0 0 1 0-1.5h2.5a4 4 0 0 0 0-8H4.56l2.72 2.72a.75.75 0 1 1-1.06 1.06l-4-4a.75.75 0 0 1 0-1.06l4-4a.75.75 0 0 1 1.06 0z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  markUnread: {
    label: "Unread",
    icon: () => (
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-5 w-5">
        <path d="M2.5 3A1.5 1.5 0 0 0 1 4.5v.793c.026.009.051.02.076.032L7.674 8.51c.206.1.446.1.652 0l6.598-3.185A.755.755 0 0 1 15 5.293V4.5A1.5 1.5 0 0 0 13.5 3h-11z" />
        <path d="M15 6.954 8.978 9.86a2.25 2.25 0 0 1-1.956 0L1 6.954V11.5A1.5 1.5 0 0 0 2.5 13h11a1.5 1.5 0 0 0 1.5-1.5V6.954z" />
      </svg>
    ),
  },
  prev: {
    label: "Prev",
    icon: () => (
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-5 w-5">
        <path
          fillRule="evenodd"
          d="M11.78 9.78a.75.75 0 0 1-1.06 0L8 7.06 5.28 9.78a.75.75 0 0 1-1.06-1.06l3.25-3.25a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  next: {
    label: "Next",
    icon: () => (
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-5 w-5">
        <path
          fillRule="evenodd"
          d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
};

export type MobileActionBarProps = {
  actions: MobileActionId[];
  isStarred?: boolean;
  onAction: (action: MobileActionId) => void;
  onUpdateActions?: (actions: MobileActionId[]) => void;
};

export function MobileActionBar({
  actions,
  isStarred,
  onAction,
  onUpdateActions,
}: MobileActionBarProps) {
  const [customizeOpen, setCustomizeOpen] = useState(false);

  return (
    <>
      <div className="shrink-0 border-t border-border bg-background px-1 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-around">
          {actions.map((id) => {
            const meta = ACTION_META[id];
            if (!meta) return null;
            return (
              <button
                key={id}
                onClick={() => onAction(id)}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 py-2 px-3 min-w-[44px] min-h-[44px]",
                  "text-muted-foreground active:text-foreground active:bg-accent/50 rounded-lg",
                )}
                title={meta.label}
              >
                {meta.icon(id === "star" ? isStarred : false)}
                <span className="text-[10px] leading-tight">{meta.label}</span>
              </button>
            );
          })}
          {onUpdateActions && (
            <button
              onClick={() => setCustomizeOpen(true)}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 py-2 px-3 min-w-[44px] min-h-[44px]",
                "text-muted-foreground active:text-foreground active:bg-accent/50 rounded-lg",
              )}
              title="Customize"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="h-5 w-5">
                <path d="M6.5 2.25a.75.75 0 0 0-1.5 0v3a.75.75 0 0 0 1.5 0V4.5h7.75a.75.75 0 0 0 0-1.5H6.5V2.25zM1.75 3a.75.75 0 0 0 0 1.5h1.5a.75.75 0 0 0 0-1.5h-1.5zM4.75 7.25a.75.75 0 0 0-.75.75v.5H1.75a.75.75 0 0 0 0 1.5H4v.5a.75.75 0 0 0 1.5 0v-3a.75.75 0 0 0-.75-.75zm2.5 1.5a.75.75 0 0 0 0 1.5h7a.75.75 0 0 0 0-1.5h-7zm-5.5 4a.75.75 0 0 0 0 1.5h7.5a.75.75 0 0 0 0-1.5h-7.5zm10.25-.75a.75.75 0 0 0-.75.75v3a.75.75 0 0 0 1.5 0v-.5h1.5a.75.75 0 0 0 0-1.5h-1.5V12a.75.75 0 0 0-.75-.75z" />
              </svg>
              <span className="text-[10px] leading-tight">More</span>
            </button>
          )}
        </div>
      </div>

      {onUpdateActions && (
        <Drawer open={customizeOpen} onOpenChange={setCustomizeOpen}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Customize Actions</DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pb-6 space-y-1">
              {ALL_MOBILE_ACTIONS.map((id) => {
                const meta = ACTION_META[id];
                if (!meta) return null;
                const enabled = actions.includes(id);
                return (
                  <label
                    key={id}
                    className="flex items-center justify-between py-3 px-2 rounded-lg active:bg-accent/50"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground">
                        {meta.icon(false)}
                      </span>
                      <span className="text-sm font-medium">{meta.label}</span>
                    </div>
                    <Switch
                      checked={enabled}
                      onCheckedChange={(checked) => {
                        const next = checked
                          ? [...actions, id]
                          : actions.filter((a) => a !== id);
                        // Maintain canonical order
                        const ordered = ALL_MOBILE_ACTIONS.filter((a) =>
                          next.includes(a),
                        );
                        onUpdateActions(ordered);
                      }}
                    />
                  </label>
                );
              })}
            </div>
            <div className="px-4 pb-6">
              <DrawerClose asChild>
                <button className="w-full rounded-lg bg-accent py-2.5 text-sm font-medium">
                  Done
                </button>
              </DrawerClose>
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </>
  );
}
