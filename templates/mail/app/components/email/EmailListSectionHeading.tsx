import { useFormatters } from "@agent-native/core/client/i18n";

export function EmailListSectionHeading({
  title,
  count,
}: {
  title: string;
  count: number;
}) {
  const { formatNumber } = useFormatters();
  return (
    <h2 className="flex items-center gap-2 px-4 pb-1.5 pt-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
      {title}
      <span className="tabular-nums text-muted-foreground/60">
        {formatNumber(count)}
      </span>
    </h2>
  );
}
