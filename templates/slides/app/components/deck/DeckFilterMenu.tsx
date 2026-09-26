import { useT } from "@agent-native/core/client/i18n";
import { IconFilter } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilterTriggerIndicator } from "@/components/ui/filter-trigger";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DeckFilter } from "@/lib/deck-filter";
import { cn } from "@/lib/utils";

export function DeckFilterMenu({
  value,
  onChange,
}: {
  value: DeckFilter;
  onChange: (value: DeckFilter) => void;
}) {
  const t = useT();
  const filtered = value === "mine";
  const label = filtered ? t("home.showMineDecks") : t("home.showAllDecks");
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={label}
              className={cn(
                "size-9 shrink-0 p-0",
                filtered && "border border-primary/40 text-primary",
              )}
            >
              <FilterTriggerIndicator active={filtered}>
                <IconFilter className="size-3.5" aria-hidden="true" />
              </FilterTriggerIndicator>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(nextValue) => {
            if (nextValue === "mine" || nextValue === "all") {
              onChange(nextValue);
            }
          }}
        >
          <DropdownMenuRadioItem value="mine">
            {t("home.mine")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="all">
            {t("home.all")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default DeckFilterMenu;
