import { Skeleton } from "@agent-native/toolkit/ui/skeleton";

import { useT } from "../../i18n.js";
import { cn } from "../../utils.js";
import { SettingsSkeleton } from "../SettingsSkeleton.js";

const NAV_GROUPS = [3, 2, 6, 3, 4] as const;
const ITEM_WIDTHS = ["w-24", "w-20", "w-28", "w-16"] as const;

/** The Settings shell's geometry while the flag, role, or page is resolving. */
export function SettingsShellSkeleton({ className }: { className?: string }) {
  const t = useT();
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t("agentChat.settingsShell.loading")}
      className={cn(
        "flex h-full max-h-dvh min-h-0 w-full min-w-0 overflow-hidden bg-background",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="hidden w-[252px] shrink-0 flex-col gap-1 border-e border-sidebar-border bg-sidebar px-2.5 pt-3 min-[760px]:flex"
      >
        <Skeleton className="h-[30px] w-32" />
        <Skeleton className="mt-2 h-8 w-full" />
        {NAV_GROUPS.map((count, group) => (
          <div key={group} className="mt-4 flex flex-col gap-1">
            <Skeleton className="mx-2 mb-1 h-3 w-16" />
            {Array.from({ length: count }, (_, item) => (
              <div key={item} className="flex h-[30px] items-center gap-2 px-2">
                <Skeleton className="size-4 shrink-0" />
                <Skeleton
                  className={cn(
                    "h-3",
                    ITEM_WIDTHS[(group + item) % ITEM_WIDTHS.length],
                  )}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="mx-auto w-full max-w-[824px] px-4 min-[760px]:px-8">
          <div className="flex h-[60px] items-center" aria-hidden="true">
            <Skeleton className="h-4 w-28" />
          </div>
          <SettingsSkeleton lines={3} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
