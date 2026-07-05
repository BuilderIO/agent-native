import { useT } from "@agent-native/core/client";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from "@agent-native/toolkit/ui/drawer";
import { Switch } from "@agent-native/toolkit/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import type { MobileActionId } from "@shared/types";
import {
  IconArchive,
  IconTrash,
  IconStarFilled,
  IconStar,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconMail,
  IconChevronUp,
  IconChevronDown,
  IconSettings,
} from "@tabler/icons-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

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

/** Metadata for each action: stable id plus icon SVG. */
const ACTION_META: Record<
  MobileActionId,
  {
    labelKey: string;
    icon: (active?: boolean) => React.ReactNode;
  }
> = {
  archive: {
    labelKey: "mail.mobileActions.archive",
    icon: () => <IconArchive className="h-5 w-5" />,
  },
  trash: {
    labelKey: "mail.mobileActions.trash",
    icon: () => <IconTrash className="h-5 w-5" />,
  },
  star: {
    labelKey: "mail.mobileActions.star",
    icon: (active) =>
      active ? (
        <IconStarFilled className="h-5 w-5 text-yellow-500" />
      ) : (
        <IconStar className="h-5 w-5" />
      ),
  },
  reply: {
    labelKey: "mail.mobileActions.reply",
    icon: () => <IconArrowBackUp className="h-5 w-5 rtl:-scale-x-100" />,
  },
  replyAll: {
    labelKey: "mail.mobileActions.replyAll",
    icon: () => <IconArrowBackUp className="h-5 w-5 rtl:-scale-x-100" />,
  },
  forward: {
    labelKey: "mail.mobileActions.forward",
    icon: () => <IconArrowForwardUp className="h-5 w-5 rtl:-scale-x-100" />,
  },
  markUnread: {
    labelKey: "mail.mobileActions.unread",
    icon: () => <IconMail className="h-5 w-5" />,
  },
  prev: {
    labelKey: "mail.mobileActions.prev",
    icon: () => <IconChevronUp className="h-5 w-5" />,
  },
  next: {
    labelKey: "mail.mobileActions.next",
    icon: () => <IconChevronDown className="h-5 w-5" />,
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
  const t = useT();

  return (
    <>
      <div className="shrink-0 border-t border-border bg-background px-1 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center overflow-x-auto">
          {onUpdateActions && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setCustomizeOpen(true)}
                  className={cn(
                    "flex shrink-0 flex-col items-center justify-center gap-0.5 py-2 px-3 min-w-[44px] min-h-[44px]",
                    "text-muted-foreground active:text-foreground active:bg-accent/50 rounded-lg",
                  )}
                >
                  <IconSettings className="h-5 w-5" />
                  <span className="text-[10px] leading-tight">
                    {t("mail.mobileActions.settings")}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {t("mail.mobileActions.customize")}
              </TooltipContent>
            </Tooltip>
          )}
          {actions.map((id) => {
            const meta = ACTION_META[id];
            if (!meta) return null;
            const label = t(meta.labelKey);
            return (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onAction(id)}
                    className={cn(
                      "flex shrink-0 flex-col items-center justify-center gap-0.5 py-2 px-3 min-w-[44px] min-h-[44px]",
                      "text-muted-foreground active:text-foreground active:bg-accent/50 rounded-lg",
                    )}
                  >
                    {meta.icon(id === "star" ? isStarred : false)}
                    <span className="text-[10px] leading-tight">{label}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>

      {onUpdateActions && (
        <Drawer open={customizeOpen} onOpenChange={setCustomizeOpen}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>
                {t("mail.mobileActions.customizeActions")}
              </DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pb-6 space-y-1">
              {ALL_MOBILE_ACTIONS.map((id) => {
                const meta = ACTION_META[id];
                if (!meta) return null;
                const enabled = actions.includes(id);
                const label = t(meta.labelKey);
                return (
                  <div
                    key={id}
                    className="flex items-center justify-between py-3 px-2 rounded-lg active:bg-accent/50"
                    onClick={() => {
                      const next = enabled
                        ? actions.filter((a) => a !== id)
                        : [...actions, id];
                      // Maintain canonical order
                      const ordered = ALL_MOBILE_ACTIONS.filter((a) =>
                        next.includes(a),
                      );
                      onUpdateActions(ordered);
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground">
                        {meta.icon(false)}
                      </span>
                      <span className="text-sm font-medium">{label}</span>
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
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                );
              })}
            </div>
            <div className="px-4 pb-6">
              <DrawerClose asChild>
                <button className="w-full rounded-lg bg-accent py-2.5 text-sm font-medium">
                  {t("mail.mobileActions.close")}
                </button>
              </DrawerClose>
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </>
  );
}
