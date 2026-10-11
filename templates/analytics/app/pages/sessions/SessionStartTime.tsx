import { useFormatters } from "@agent-native/core/client/i18n";

export function sessionStartFormat(
  startedAt: Date,
  now: Date,
  showTimeZone: boolean,
): Intl.DateTimeFormatOptions {
  return {
    year: startedAt.getFullYear() === now.getFullYear() ? undefined : "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: showTimeZone ? "short" : undefined,
  };
}

/** When a session started, in the viewer's locale and timezone. */
export function SessionStartTime({
  startedAt,
  showTimeZone = false,
}: {
  startedAt: string;
  showTimeZone?: boolean;
}) {
  const { formatDate } = useFormatters();
  const date = new Date(startedAt);
  // An unparseable value shows as stored rather than as a plausible time.
  if (!Number.isFinite(date.getTime())) return <>{startedAt}</>;
  return (
    <time dateTime={date.toISOString()}>
      {formatDate(date, sessionStartFormat(date, new Date(), showTimeZone))}
    </time>
  );
}
