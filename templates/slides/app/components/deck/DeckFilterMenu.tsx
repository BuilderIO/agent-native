import { useT } from "@agent-native/core/client/i18n";
import { IconChevronDown } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DeckFilter } from "@/lib/deck-filter";

export function DeckFilterMenu({
  value,
  onChange,
}: {
  value: DeckFilter;
  onChange: (value: DeckFilter) => void;
}) {
  const t = useT();
  const optionLabels: Record<DeckFilter, string> = {
    all: t("home.ownedByAnyone"),
    mine: t("home.ownedByMe"),
    "not-mine": t("home.sharedWithMe"),
  };
  const label = optionLabels[value];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={label}
          className="h-9 shrink-0 gap-2"
        >
          <span className="grid">
            {Object.entries(optionLabels).map(([filter, option]) => (
              <span
                key={filter}
                aria-hidden="true"
                className="invisible col-start-1 row-start-1 whitespace-nowrap"
              >
                {option}
              </span>
            ))}
            <span className="col-start-1 row-start-1 whitespace-nowrap">
              {label}
            </span>
          </span>
          <IconChevronDown className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(nextValue) => {
            if (
              nextValue === "mine" ||
              nextValue === "all" ||
              nextValue === "not-mine"
            ) {
              onChange(nextValue);
            }
          }}
        >
          <DropdownMenuRadioItem value="all" indicator="check">
            {t("home.ownedByAnyone")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="mine" indicator="check">
            {t("home.ownedByMe")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="not-mine" indicator="check">
            {t("home.sharedWithMe")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default DeckFilterMenu;
