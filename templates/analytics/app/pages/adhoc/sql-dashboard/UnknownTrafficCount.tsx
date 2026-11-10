import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const ONE_HOUR_MS = 60 * 60 * 1_000;

/** Events counted as production only because nothing says otherwise. */
export function UnknownTrafficCount() {
  const t = useT();
  const { data, isError } = useActionQuery(
    "get-traffic-counts",
    {},
    { staleTime: ONE_HOUR_MS, retry: false },
  );
  const unavailable = isError;
  if (!unavailable && !data?.unknown) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="self-end pb-1.5 text-xs text-muted-foreground"
        >
          {unavailable
            ? t("sqlDashboard.unknownTrafficUnavailable")
            : t("sqlDashboard.unknownTraffic", {
                count: data.unknown.toLocaleString(),
              })}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {t("sqlDashboard.unknownTrafficTip", { days: data?.days ?? 7 })}
      </TooltipContent>
    </Tooltip>
  );
}
