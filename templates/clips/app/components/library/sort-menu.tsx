import { IconArrowsSort, IconCheck } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

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
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 h-8">
          <IconArrowsSort className="h-3.5 w-3.5" />
          <span className="text-xs">{LABELS[value]}</span>
        </Button>
      </DropdownMenuTrigger>
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
