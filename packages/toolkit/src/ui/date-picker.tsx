import { IconCalendar } from "@tabler/icons-react";
import { format, parse, isValid } from "date-fns";
import { useEffect, useState } from "react";

import { cn } from "../utils.js";
import { Button } from "./button.js";
import { Calendar } from "./calendar.js";
import { Popover, PopoverContent, PopoverTrigger } from "./popover.js";

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
}

export function DatePicker({
  value,
  onChange,
  className,
  placeholder = "Pick a date",
  disabled = false,
  onCloseAutoFocus,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const date = value ? parse(value, "yyyy-MM-dd", new Date()) : undefined;
  const validDate = date && isValid(date) ? date : undefined;

  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(nextOpen) => setOpen(nextOpen && !disabled)}
    >
      <PopoverTrigger asChild>
        <Button
          disabled={disabled}
          variant="outline"
          className={cn(
            "h-8 justify-start text-start font-normal text-xs gap-2 px-2.5",
            !validDate && "text-muted-foreground",
            className,
          )}
        >
          <IconCalendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {validDate ? (
            format(validDate, "MMM d, yyyy")
          ) : (
            <span>{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        hidden={disabled}
        inert={disabled}
        className="w-auto max-w-[calc(100vw-2rem)] p-0"
        align="start"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <Calendar
          mode="single"
          selected={validDate}
          onSelect={(day) => {
            if (day) {
              onChange(format(day, "yyyy-MM-dd"));
              setOpen(false);
            }
          }}
          defaultMonth={validDate}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
