import { useT } from "@agent-native/core/client/i18n";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function UnpublishedBadge({ id }: { id?: string }) {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          id={id}
          className="rounded-full bg-[hsl(var(--forms-badge))] px-1.5 text-xs font-medium text-[hsl(var(--forms-badge-foreground))]"
        >
          {t("forms.blocks.unpublished")}
        </span>
      </TooltipTrigger>
      <TooltipContent>{t("forms.blocks.unpublishedTooltip")}</TooltipContent>
    </Tooltip>
  );
}
