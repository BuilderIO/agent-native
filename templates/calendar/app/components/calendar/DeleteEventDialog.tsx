import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
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
}

export function DeleteEventDialog({
  event,
  open,
  onClose,
  onConfirm,
}: DeleteEventDialogProps) {
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

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>(
        "button:not([data-cancel])",
      ),
    );
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      buttons[(idx + 1) % buttons.length]?.focus();
    } else {
      buttons[(idx - 1 + buttons.length) % buttons.length]?.focus();
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AlertDialogContent className="max-w-[340px]" onKeyDown={handleKeyDown}>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm">
            This is a recurring event
          </AlertDialogTitle>
          <AlertDialogDescription>
            Would you like to {isRemoveOnly ? "remove" : "delete"} just this
            event, this and all following events, or all events in the series?
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-1.5">
          <Button
            variant="outline"
            className="w-full justify-center"
            onClick={() => handleScopeClick("single")}
            autoFocus
          >
            This event
          </Button>
          <Button
            variant="outline"
            className="w-full justify-center"
            onClick={() => handleScopeClick("thisAndFollowing")}
          >
            This and following events
          </Button>
          <Button
            variant="outline"
            className="w-full justify-center"
            onClick={() => handleScopeClick("all")}
          >
            All events
          </Button>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel data-cancel>Cancel</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
