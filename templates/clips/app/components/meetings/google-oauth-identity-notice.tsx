import { useT } from "@agent-native/core/client/i18n";
import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function GoogleOAuthIdentityNotice({
  className,
}: {
  className?: string;
}) {
  const t = useT();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-auto gap-1 px-0 py-0 text-[11px] font-normal text-muted-foreground/70 hover:bg-transparent hover:text-muted-foreground",
            className,
          )}
        >
          <IconInfoCircle className="size-3" />
          {t("meetingsRoute.googleMayShowWarning")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-start">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-300">
            <IconAlertTriangle className="size-3.5" />
          </div>
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium text-foreground">
              {t("meetingsRoute.googleNotVerifiedTitle")}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("meetingsRoute.googleWarningBeforeAdvanced")}
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
