import { useT } from "@agent-native/core/client/i18n";
import { IconChevronDown } from "@tabler/icons-react";

import type { Period } from "@/components/forms/insights";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Translate } from "@/lib/translate";

const PERIODS: Period[] = [
  "all",
  "today",
  "yesterday",
  "24h",
  "7d",
  "30d",
  "3m",
  "6m",
  "12m",
];

function periodLabel(t: Translate, period: Period): string {
  switch (period) {
    case "all":
      return t("forms.insights.period.all");
    case "today":
      return t("forms.insights.period.today");
    case "yesterday":
      return t("forms.insights.period.yesterday");
    case "24h":
      return t("forms.insights.period.last24Hours");
    case "7d":
      return t("forms.insights.period.last7Days");
    case "30d":
      return t("forms.insights.period.last30Days");
    case "3m":
      return t("forms.insights.period.last3Months");
    case "6m":
      return t("forms.insights.period.last6Months");
    case "12m":
      return t("forms.insights.period.last12Months");
  }
}

export function PeriodMenu({
  period,
  onChange,
}: {
  period: Period;
  onChange: (period: Period) => void;
}) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-[30px] items-center gap-1 rounded-full px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {periodLabel(t, period)}
          <IconChevronDown className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={period}
          onValueChange={(value) => onChange(value as Period)}
        >
          {PERIODS.map((key) => (
            <DropdownMenuRadioItem key={key} value={key}>
              {periodLabel(t, key)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
