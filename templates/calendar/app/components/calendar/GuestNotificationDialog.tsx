import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CalendarEvent } from "@shared/api";

type GuestNotificationAction = "update" | "cancellation";

export interface GuestNotificationOptions {
  sendUpdates: "all" | "none";
  notificationMessage?: string;
}

type GuestPromptUpdates = Partial<CalendarEvent> & {
  addGoogleMeet?: boolean;
  addZoom?: boolean;
};

interface PromptRequest {
  event: CalendarEvent;
  action: GuestNotificationAction;
  resolve: (choice: GuestNotificationOptions | null) => void;
}

export function getGuestAttendeeCount(
  event: CalendarEvent,
  attendees = event.attendees,
): number {
  return (attendees ?? []).filter((attendee) => !attendee.self).length;
}

export function shouldPromptGuests(
  event: CalendarEvent,
  updates?: GuestPromptUpdates,
): boolean {
  if (getGuestAttendeeCount(event) > 0) return true;
  if (updates && "attendees" in updates) {
    return getGuestAttendeeCount(event, updates.attendees) > 0;
  }
  return false;
}

function actionText(action: GuestNotificationAction) {
  return action === "cancellation"
    ? {
        title: "Notify guests?",
        description: "Send a cancellation to guests with an optional note.",
        sendLabel: "Send cancellation",
        skipLabel: "Don't notify",
        textarea: "Add a cancellation note",
        placeholder: "Why the event is being cancelled...",
      }
    : {
        title: "Notify guests?",
        description: "Send an update to guests with an optional note.",
        sendLabel: "Send update",
        skipLabel: "Don't notify",
        textarea: "Add an update note",
        placeholder: "What changed or what guests should know...",
      };
}

function GuestNotificationDialog({
  request,
  onCancel,
  onConfirm,
}: {
  request: PromptRequest | null;
  onCancel: () => void;
  onConfirm: (choice: GuestNotificationOptions) => void;
}) {
  const [message, setMessage] = useState("");
  const copy = useMemo(
    () => actionText(request?.action ?? "update"),
    [request?.action],
  );
  const guestCount = request ? getGuestAttendeeCount(request.event) : 0;

  useEffect(() => {
    if (request) setMessage("");
  }, [request]);

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="guest-notification-message">{copy.textarea}</Label>
          <Textarea
            id="guest-notification-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={copy.placeholder}
            rows={4}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            {guestCount} {guestCount === 1 ? "guest" : "guests"}
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onConfirm({ sendUpdates: "none" })}
          >
            {copy.skipLabel}
          </Button>
          <Button
            type="button"
            onClick={() =>
              onConfirm({
                sendUpdates: "all",
                notificationMessage: message.trim() || undefined,
              })
            }
          >
            {copy.sendLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useGuestNotificationPrompt() {
  const [request, setRequest] = useState<PromptRequest | null>(null);

  const promptGuestNotification = useCallback(
    (args: {
      event: CalendarEvent;
      action: GuestNotificationAction;
      updates?: GuestPromptUpdates;
    }) => {
      if (!shouldPromptGuests(args.event, args.updates)) {
        return Promise.resolve<GuestNotificationOptions | null>({
          sendUpdates: "none",
        });
      }
      return new Promise<GuestNotificationOptions | null>((resolve) => {
        setRequest({ event: args.event, action: args.action, resolve });
      });
    },
    [],
  );

  const onCancel = useCallback(() => {
    setRequest((current) => {
      current?.resolve(null);
      return null;
    });
  }, []);

  const onConfirm = useCallback((choice: GuestNotificationOptions) => {
    setRequest((current) => {
      current?.resolve(choice);
      return null;
    });
  }, []);

  const guestNotificationDialog = (
    <GuestNotificationDialog
      request={request}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );

  return { promptGuestNotification, guestNotificationDialog };
}
