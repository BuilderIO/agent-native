import { IconArrowsSort, IconCheck } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type SortKey = "recent" | "views" | "oldest";

const LABELS: Record<SortKey, string> = {
  recent: "Most recent",
  views: "Most viewed",
  oldest: "Oldest first",
};

interface SortMenuProps {
  value: SortKey;
  onChange: (value: SortKey) => void;
}

export function SortMenu({ value, onChange }: SortMenuProps) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              aria-label={LABELS[value]}
            >
              <IconArrowsSort className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{LABELS[value]}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-44">
        {(Object.keys(LABELS) as SortKey[]).map((key) => (
          <DropdownMenuItem
            key={key}
            onSelect={() => onChange(key)}
            className="flex items-center justify-between"
          >
            <span className="text-xs">{LABELS[key]}</span>
            {value === key && <IconCheck className="h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
