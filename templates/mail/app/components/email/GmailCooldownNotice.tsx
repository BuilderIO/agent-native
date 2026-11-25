import { useFormatters, useT } from "@agent-native/core/client/i18n";
import type { GmailReadState } from "@shared/gmail-freshness";
import { IconAlertCircle } from "@tabler/icons-react";
import { isToday } from "date-fns";
import { useEffect, useRef, useState } from "react";

export function GmailCooldownNotice({
  read,
  onRetry,
}: {
  read: GmailReadState;
  onRetry?: () => unknown;
}) {
  const t = useT();
  const { formatDate } = useFormatters();
  const retryRef = useRef(onRetry);
  retryRef.current = onRetry;
  const { cooldownUntil, staleSince } = read;
  const [now, setNow] = useState(() => Date.now());
  const remainingSeconds =
    cooldownUntil === undefined
      ? 0
      : Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  useEffect(() => {
    if (cooldownUntil === undefined) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    // Ask for live rows once Gmail says it is ready; a renewed cooldown comes
    // back with its own `cooldownUntil` and re-arms this.
    const retry = setTimeout(
      () => void retryRef.current?.(),
      Math.max(0, cooldownUntil - Date.now()) + 500,
    );
    return () => {
      clearInterval(tick);
      clearTimeout(retry);
    };
  }, [cooldownUntil]);

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-b border-border/30 bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground"
    >
      <IconAlertCircle className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        {staleSince === undefined
          ? t("mail.error.limitedList")
          : t("mail.error.limitedListFrom", {
              time: formatDate(
                staleSince,
                isToday(staleSince)
                  ? { timeStyle: "short" }
                  : {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    },
              ),
            })}{" "}
        {remainingSeconds > 0 && (
          <span className="whitespace-nowrap tabular-nums">
            {t("mail.error.tryAgainIn", { seconds: remainingSeconds })}
          </span>
        )}
      </span>
    </div>
  );
}
