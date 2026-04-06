import { useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import type { CalendarEvent, DeleteEventScope } from "@shared/api";

interface DeleteEventDialogProps {
  event: CalendarEvent | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (options: {
    scope: DeleteEventScope;
    sendUpdates: "all" | "none";
    removeOnly: boolean;
  }) => void;
  isPending?: boolean;
}

export function DeleteEventDialog({
  event,
  open,
  onClose,
  onConfirm,
  isPending,
}: DeleteEventDialogProps) {
  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (open) {
      window.addEventListener("keydown", handleKeyDown, true);
      return () => window.removeEventListener("keydown", handleKeyDown, true);
    }
  }, [open, handleKeyDown]);

  if (!event || !open) return null;

  const isOrganizer = getIsOrganizer(event);
  const hasOtherAttendees =
    event.attendees && event.attendees.filter((a) => !a.self).length > 0;
  const isRemoveOnly = !isOrganizer && !!hasOtherAttendees;

  function handleScopeClick(scope: DeleteEventScope) {
    onConfirm({
      scope,
      sendUpdates: "none",
      removeOnly: isRemoveOnly,
    });
  }

  return (
    <>
      {/* Transparent backdrop — click to dismiss */}
      <div className="fixed inset-0 z-50" onClick={onClose} />

      {/* Popover card */}
      <div className="fixed left-1/2 top-1/2 z-50 w-[340px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover p-5 shadow-xl animate-in fade-in-0 zoom-in-95">
        <p className="mb-1 text-sm font-semibold text-foreground">
          This is a recurring event
        </p>
        <p className="mb-4 text-sm text-muted-foreground">
          Would you like to {isRemoveOnly ? "remove" : "delete"} just this
          event, this and all following events, or all events in the series?
        </p>

        <div className="space-y-1.5">
          <Button
            variant="outline"
            className="w-full justify-center"
            disabled={isPending}
            onClick={() => handleScopeClick("single")}
          >
            This event
          </Button>
          <Button
            variant="outline"
            className="w-full justify-center"
            disabled={isPending}
            onClick={() => handleScopeClick("thisAndFollowing")}
          >
            This and following events
          </Button>
          <Button
            variant="outline"
            className="w-full justify-center"
            disabled={isPending}
            onClick={() => handleScopeClick("all")}
          >
            All events
          </Button>
        </div>
      </div>
    </>
  );
}

function getIsOrganizer(event: CalendarEvent): boolean {
  if (event.organizer?.self) return true;
  if (event.attendees) {
    const selfAttendee = event.attendees.find((a) => a.self);
    if (selfAttendee?.organizer) return true;
  }
  if (!event.attendees || event.attendees.length === 0) return true;
  return false;
}
