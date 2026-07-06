import { useT } from "@agent-native/core/client";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Button } from "@agent-native/toolkit/ui/button";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@agent-native/toolkit/ui/radio-group";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import type { CalendarEvent, DeleteEventScope } from "@shared/api";
import { useEffect, useMemo, useState } from "react";

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
  const t = useT();
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
        title: t("deleteEvent.title"),
        description: t("deleteEvent.fallbackDescription"),
        action: t("deleteEvent.deleteAction"),
      };
    }
    const action = getIsRemoveOnly(event)
      ? t("deleteEvent.removeAction")
      : t("deleteEvent.deleteAction");
    return {
      title: isRecurring
        ? t("deleteEvent.recurringTitle")
        : getIsRemoveOnly(event)
          ? t("deleteEvent.removeTitle")
          : t("deleteEvent.title"),
      description: isRecurring
        ? t("deleteEvent.chooseScope", { action })
        : canNotifyGuests
          ? t("deleteEvent.notifyGuests")
          : t("deleteEvent.willBeActioned", { action }),
      action,
    };
  }, [canNotifyGuests, event, isRecurring, t]);

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
                <Label htmlFor="delete-scope-single">
                  {t("deleteEvent.thisEvent")}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  id="delete-scope-following"
                  value="thisAndFollowing"
                />
                <Label htmlFor="delete-scope-following">
                  {t("deleteEvent.thisAndFollowing")}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="delete-scope-all" value="all" />
                <Label htmlFor="delete-scope-all">
                  {t("deleteEvent.allEvents")}
                </Label>
              </div>
            </RadioGroup>
          )}

          {canNotifyGuests && (
            <div className="space-y-2">
              <Label htmlFor="delete-notification-message">
                {t("deleteEvent.cancellationNote")}
              </Label>
              <Textarea
                id="delete-notification-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={t("deleteEvent.cancellationPlaceholder")}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                {t("deleteEvent.guest", { count: guestCount })}
              </p>
            </div>
          )}
        </div>

        <AlertDialogFooter className="gap-2 sm:gap-0">
          <AlertDialogCancel data-cancel>
            {t("deleteEvent.cancel")}
          </AlertDialogCancel>
          {canNotifyGuests && (
            <Button variant="outline" onClick={() => handleConfirm("none")}>
              {t("deleteEvent.dontNotify")}
            </Button>
          )}
          <Button
            variant="destructive"
            onClick={() => handleConfirm(canNotifyGuests ? "all" : "none")}
          >
            {canNotifyGuests
              ? t("deleteEvent.sendCancellation")
              : isRemoveOnly
                ? t("deleteEvent.removeEvent")
                : t("deleteEvent.deleteEvent")}
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
