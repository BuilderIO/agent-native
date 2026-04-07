import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { useQueryClient } from "@tanstack/react-query";
import type { CalendarEvent } from "@shared/api";

interface QuickEditPopoverProps {
  eventId: string;
  onSave: (eventId: string, title: string) => void;
  onCancel: (eventId: string) => void;
  children: ReactNode;
}

export function QuickEditPopover({
  eventId,
  onSave,
  onCancel,
  children,
}: QuickEditPopoverProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Update the event title in the cache so the event block shows it live
  function updateCacheTitle(title: string) {
    queryClient.setQueriesData<CalendarEvent[]>(
      { queryKey: ["events"] },
      (old) =>
        old?.map((e) =>
          e.id === eventId ? { ...e, title: title || "(No title)" } : e,
        ),
    );
  }

  function handleSave() {
    if (value.trim()) {
      updateCacheTitle(value.trim());
      onSave(eventId, value);
    } else {
      onCancel(eventId);
    }
  }

  return (
    <Popover open modal={false}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        className="w-[280px] p-3"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        onInteractOutside={() => handleSave()}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          onCancel(eventId);
        }}
      >
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            updateCacheTitle(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSave();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel(eventId);
            }
            e.stopPropagation();
          }}
          placeholder="Event title"
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
        />
      </PopoverContent>
    </Popover>
  );
}
