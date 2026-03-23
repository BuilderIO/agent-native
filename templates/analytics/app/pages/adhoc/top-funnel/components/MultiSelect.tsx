import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface MultiSelectProps {
  label: string;
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
  isLoading?: boolean;
  className?: string;
}

export function MultiSelect({
  label,
  options,
  value,
  onChange,
  isLoading,
  className,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);

  const toggle = (item: string) => {
    if (value.includes(item)) {
      onChange(value.filter((v) => v !== item));
    } else {
      onChange([...value, item]);
    }
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label className="text-xs text-muted-foreground font-medium">
        {label}
      </label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 justify-between text-xs font-normal min-w-[140px]"
          >
            {value.length === 0 ? (
              <span className="text-muted-foreground">All</span>
            ) : (
              <span className="truncate max-w-[120px]">
                {value.length} selected
              </span>
            )}
            <div className="flex items-center gap-1 ml-1">
              {value.length > 0 && (
                <X
                  className="h-3 w-3 text-muted-foreground hover:text-foreground"
                  onClick={clear}
                />
              )}
              <ChevronsUpDown className="h-3 w-3 text-muted-foreground" />
            </div>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[220px] p-0" align="start">
          <Command>
            <CommandInput
              placeholder={`Search ${label.toLowerCase()}...`}
              className="h-9"
            />
            <CommandList>
              <CommandEmpty>
                {isLoading ? "Loading..." : "No results."}
              </CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option}
                    value={option}
                    onSelect={() => toggle(option)}
                  >
                    <div
                      className={cn(
                        "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                        value.includes(option)
                          ? "bg-primary text-primary-foreground"
                          : "opacity-50",
                      )}
                    >
                      {value.includes(option) && <Check className="h-3 w-3" />}
                    </div>
                    <span className="truncate text-xs">{option}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {value.slice(0, 3).map((v) => (
            <Badge
              key={v}
              variant="secondary"
              className="text-[10px] px-1.5 py-0 h-5 cursor-pointer"
              onClick={() => toggle(v)}
            >
              {v}
              <X className="h-2.5 w-2.5 ml-0.5" />
            </Badge>
          ))}
          {value.length > 3 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
              +{value.length - 3} more
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
