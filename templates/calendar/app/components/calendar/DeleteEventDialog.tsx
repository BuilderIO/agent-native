import { useEffect, useMemo, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { CalendarEvent, DeleteEventScope } from "@shared/api";
import { getGuestAttendeeCount } from "@/components/calendar/GuestNotificationDialog";

interface DeleteEventDialogProps {
  event: CalendarEvent | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (options: {
    scope: DeleteEventScope;
    sendUpdates: "all" | "none";
    notificationMessage?: string;
    removeOnly: boolean;
  }) => void;
}

export function DeleteEventDialog({
  event,
  open,
  onClose,
  onConfirm,
}: DeleteEventDialogProps) {
  const [scope, setScope] = useState<DeleteEventScope>("single");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!event || !open) return;
    setScope("single");
    setMessage("");
  }, [event, open]);

  const isRecurring = !!(event?.recurringEventId || event?.recurrence?.length);
  const guestCount = event ? getGuestAttendeeCount(event) : 0;
  const isRemoveOnly = event ? getIsRemoveOnly(event) : false;
  const canNotifyGuests = guestCount > 0 && !isRemoveOnly;

  const copy = useMemo(() => {
    if (!event) {
      return {
        title: "Delete event?",
        description: "This event will be deleted.",
        action: "delete",
      };
    }
    const action = getIsRemoveOnly(event) ? "remove" : "delete";
    return {
      title: isRecurring
        ? `This is a recurring event`
        : `${action === "remove" ? "Remove" : "Delete"} event?`,
      description: isRecurring
        ? `Choose how much of the series to ${action}.`
        : canNotifyGuests
          ? `You can notify guests with an optional note.`
          : `This event will be ${action}d.`,
      action,
    };
  }, [canNotifyGuests, event, isRecurring]);

  if (!event || !open) return null;

  function handleConfirm(sendUpdates: "all" | "none") {
    onConfirm({
      scope,
      sendUpdates,
      notificationMessage:
        canNotifyGuests && sendUpdates === "all"
          ? message.trim() || undefined
          : undefined,
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
      <AlertDialogContent className="max-w-[420px]" onKeyDown={handleKeyDown}>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm">{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.description}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          {isRecurring && (
            <RadioGroup
              value={scope}
              onValueChange={(value) => setScope(value as DeleteEventScope)}
              className="gap-2"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem id="delete-scope-single" value="single" />
                <Label htmlFor="delete-scope-single">This event</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  id="delete-scope-following"
                  value="thisAndFollowing"
                />
                <Label htmlFor="delete-scope-following">
                  This and following events
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="delete-scope-all" value="all" />
                <Label htmlFor="delete-scope-all">All events</Label>
              </div>
            </RadioGroup>
          )}

          {canNotifyGuests && (
            <div className="space-y-2">
              <Label htmlFor="delete-notification-message">
                Add a cancellation note
              </Label>
              <Textarea
                id="delete-notification-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Why the event is being cancelled..."
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                {guestCount} {guestCount === 1 ? "guest" : "guests"}
              </p>
            </div>
          )}
        </div>

        <AlertDialogFooter className="gap-2 sm:gap-0">
          <AlertDialogCancel data-cancel>Cancel</AlertDialogCancel>
          {canNotifyGuests && (
            <Button variant="outline" onClick={() => handleConfirm("none")}>
              Don't notify
            </Button>
          )}
          <Button
            variant="destructive"
            onClick={() => handleConfirm(canNotifyGuests ? "all" : "none")}
          >
            {canNotifyGuests
              ? "Send cancellation"
              : isRemoveOnly
                ? "Remove event"
                : "Delete event"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function getIsRemoveOnly(event: CalendarEvent): boolean {
  const isOrganizer = getIsOrganizer(event);
  const hasOtherAttendees =
    event.attendees && event.attendees.filter((a) => !a.self).length > 0;
  return !isOrganizer && !!hasOtherAttendees;
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
