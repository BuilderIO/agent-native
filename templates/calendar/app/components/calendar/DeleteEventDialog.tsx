import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { IconAlertTriangle } from "@tabler/icons-react";
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
  const [scope, setScope] = useState<DeleteEventScope>("single");
  const [notify, setNotify] = useState(false);

  // Reset state when dialog opens with a new event
  useEffect(() => {
    if (open) {
      setScope("single");
      setNotify(false);
    }
  }, [open, event?.id]);

  if (!event) return null;

  const isRecurring = !!(event.recurringEventId || event.recurrence?.length);
  const isOrganizer = getIsOrganizer(event);
  const hasOtherAttendees =
    event.attendees && event.attendees.filter((a) => !a.self).length > 0;

  function handleConfirm() {
    onConfirm({
      scope,
      sendUpdates: notify ? "all" : "none",
      removeOnly: !isOrganizer && !!hasOtherAttendees,
    });
  }

  // Title and description depend on whether user is organizer
  const isRemoveOnly = !isOrganizer && hasOtherAttendees;
  const title = isRemoveOnly ? "Remove from your calendar?" : "Delete event?";
  const actionLabel = isRemoveOnly ? "Remove" : "Delete";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {isRemoveOnly
              ? "Choose how to remove this event from your calendar"
              : "Choose how to delete this event"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Non-organizer warning */}
          {isRemoveOnly && (
            <div className="flex gap-3 rounded-lg bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
              <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span>
                You&apos;re not the organizer. This will only remove the event
                from <strong>your</strong> calendar &mdash; other guests won't
                be affected.
              </span>
            </div>
          )}

          {/* Recurring event scope */}
          {isRecurring && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {isRemoveOnly ? "Remove" : "Delete"}
              </Label>
              <RadioGroup
                value={scope}
                onValueChange={(v) => setScope(v as DeleteEventScope)}
                className="space-y-1.5"
              >
                <label className="flex items-center gap-2.5 rounded-md px-3 py-2 hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="single" />
                  <span className="text-sm">This event</span>
                </label>
                <label className="flex items-center gap-2.5 rounded-md px-3 py-2 hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="thisAndFollowing" />
                  <span className="text-sm">This and following events</span>
                </label>
                <label className="flex items-center gap-2.5 rounded-md px-3 py-2 hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="all" />
                  <span className="text-sm">All events in the series</span>
                </label>
              </RadioGroup>
            </div>
          )}

          {/* Notification option — only show when there are other attendees */}
          {hasOtherAttendees && (
            <label className="flex items-center gap-2.5 cursor-pointer">
              <Checkbox
                checked={notify}
                onCheckedChange={(v) => setNotify(v === true)}
              />
              <span className="text-sm">
                {isRemoveOnly ? "Notify organizer" : "Notify other guests"}
              </span>
            </label>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleConfirm}
            disabled={isPending}
          >
            {isPending
              ? `${actionLabel === "Remove" ? "Removing" : "Deleting"}…`
              : actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function getIsOrganizer(event: CalendarEvent): boolean {
  // Check the organizer field
  if (event.organizer?.self) return true;

  // Check attendees for self+organizer
  if (event.attendees) {
    const selfAttendee = event.attendees.find((a) => a.self);
    if (selfAttendee?.organizer) return true;
  }

  // If there are no attendees, it's your own event
  if (!event.attendees || event.attendees.length === 0) return true;

  return false;
}
