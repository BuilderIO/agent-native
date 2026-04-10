import { useState, useMemo } from "react";
import { IconCheck, IconSelector, IconLoader2 } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { usePropertyValues } from "../use-dynamic-schema";

interface PropertyValueComboboxProps {
  property: string;
  value: string;
  onChange: (value: string) => void;
}

export function PropertyValueCombobox({
  property,
  value,
  onChange,
}: PropertyValueComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { values, isLoading, error } = usePropertyValues(property);

  const handleSelect = (v: string) => {
    onChange(v);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="justify-between font-normal text-xs h-7 px-2 w-28"
          size="sm"
        >
          <span className="truncate">{value || "value"}</span>
          {isLoading && !value ? (
            <IconLoader2 className="ml-1 h-3 w-3 shrink-0 animate-spin opacity-50" />
          ) : (
            <IconSelector className="ml-1 h-3 w-3 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0" align="start">
        <Command shouldFilter={true}>
          <CommandInput
            placeholder="Search or type value..."
            value={search}
            onValueChange={setSearch}
            onKeyDown={(e) => {
              if (e.key === "Enter" && search.trim()) {
                handleSelect(search.trim());
              }
            }}
          />
          <CommandList className="max-h-[280px]">
            <CommandEmpty>
              {isLoading ? (
                <div className="space-y-1.5 p-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-7 w-full rounded-sm" />
                  ))}
                </div>
              ) : search.trim() ? (
                <button
                  className="w-full text-left px-2 py-1.5 text-sm hover:bg-accent rounded cursor-pointer"
                  onClick={() => handleSelect(search.trim())}
                >
                  Use "<strong>{search.trim()}</strong>"
                </button>
              ) : error ? (
                <span className="text-xs text-destructive px-2">{error}</span>
              ) : (
                "No values found."
              )}
            </CommandEmpty>
            {values.length > 0 && (
              <CommandGroup heading={`Top values for ${property}`}>
                {values.map((v) => (
                  <CommandItem
                    key={v.value}
                    value={v.value}
                    onSelect={handleSelect}
                  >
                    <IconCheck
                      className={cn(
                        "mr-2 h-3 w-3 shrink-0",
                        value === v.value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{v.value}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {v.count.toLocaleString()}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {isLoading && values.length === 0 && (
              <CommandGroup>
                <div className="space-y-1.5 p-1">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-7 w-full rounded-sm" />
                  ))}
                </div>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
