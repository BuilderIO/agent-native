import { useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@agent-native/toolkit/ui/radio-group";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import type { CalendarEvent, UpdateEventScope } from "@shared/api";
import { useCallback, useEffect, useMemo, useState } from "react";

type GuestNotificationAction = "update" | "cancellation";

export interface GuestNotificationOptions {
  sendUpdates: "all" | "none";
  notificationMessage?: string;
  scope?: UpdateEventScope;
}

type GuestPromptUpdates = Partial<CalendarEvent> & {
  addGoogleMeet?: boolean;
  addZoom?: boolean;
};

interface RecurrenceScopeOptions {
  enabled: boolean;
  defaultScope?: UpdateEventScope;
}

interface PromptRequest {
  event: CalendarEvent;
  action: GuestNotificationAction;
  updates?: GuestPromptUpdates;
  recurrenceScope?: RecurrenceScopeOptions;
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

function actionText(
  t: ReturnType<typeof useT>,
  action: GuestNotificationAction,
  options: { showRecurrenceScope: boolean; canNotifyGuests: boolean },
) {
  if (options.showRecurrenceScope) {
    if (action === "cancellation") {
      return {
        title: t("eventForm.cancelRecurringEventQuestion"),
        description: options.canNotifyGuests
          ? t("eventForm.cancelRecurringNotifyDescription")
          : t("eventForm.cancelRecurringDescription"),
        sendLabel: t("deleteEvent.sendCancellation"),
        skipLabel: t("deleteEvent.dontNotify"),
        confirmLabel: t("eventForm.cancelEvent"),
        textarea: t("deleteEvent.cancellationNote"),
        placeholder: t("deleteEvent.cancellationPlaceholder"),
      };
    }

    return {
      title: t("eventForm.updateRecurringEventQuestion"),
      description: options.canNotifyGuests
        ? t("eventForm.updateRecurringNotifyDescription")
        : t("eventForm.updateRecurringDescription"),
      sendLabel: t("eventForm.sendUpdate"),
      skipLabel: t("deleteEvent.dontNotify"),
      confirmLabel: t("eventForm.updateEvent"),
      textarea: t("eventForm.addUpdateNote"),
      placeholder: t("eventForm.updateNotePlaceholder"),
    };
  }

  return action === "cancellation"
    ? {
        title: t("eventForm.notifyGuestsQuestion"),
        description: t("eventForm.sendCancellationDescription"),
        sendLabel: t("deleteEvent.sendCancellation"),
        skipLabel: t("deleteEvent.dontNotify"),
        confirmLabel: t("eventForm.cancelEvent"),
        textarea: t("deleteEvent.cancellationNote"),
        placeholder: t("deleteEvent.cancellationPlaceholder"),
      }
    : {
        title: t("eventForm.notifyGuestsQuestion"),
        description: t("eventForm.sendUpdateDescription"),
        sendLabel: t("eventForm.sendUpdate"),
        skipLabel: t("deleteEvent.dontNotify"),
        confirmLabel: t("eventForm.updateEvent"),
        textarea: t("eventForm.addUpdateNote"),
        placeholder: t("eventForm.updateNotePlaceholder"),
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
  const t = useT();
  const [message, setMessage] = useState("");
  const [scope, setScope] = useState<UpdateEventScope>("single");
  const guestCount = request
    ? getGuestAttendeeCount(request.event, request.updates?.attendees)
    : 0;
  const showRecurrenceScope = Boolean(request?.recurrenceScope?.enabled);
  const canNotifyGuests = guestCount > 0;
  const copy = useMemo(
    () =>
      actionText(t, request?.action ?? "update", {
        showRecurrenceScope,
        canNotifyGuests,
      }),
    [canNotifyGuests, request?.action, showRecurrenceScope, t],
  );

  useEffect(() => {
    if (!request) return;
    setMessage("");
    setScope(request.recurrenceScope?.defaultScope ?? "single");
  }, [request]);

  function buildChoice(sendUpdates: "all" | "none"): GuestNotificationOptions {
    return {
      sendUpdates,
      ...(canNotifyGuests && sendUpdates === "all" && message.trim()
        ? { notificationMessage: message.trim() }
        : {}),
      ...(showRecurrenceScope ? { scope } : {}),
    };
  }

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {showRecurrenceScope && (
            <div className="space-y-2">
              <Label>{t("eventForm.applyChangesTo")}</Label>
              <RadioGroup
                value={scope}
                onValueChange={(value) => setScope(value as UpdateEventScope)}
                className="gap-2"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    id="guest-update-scope-single"
                    value="single"
                  />
                  <Label htmlFor="guest-update-scope-single">
                    {t("eventForm.thisEvent")}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="guest-update-scope-all" value="all" />
                  <Label htmlFor="guest-update-scope-all">
                    {t("eventForm.allEvents")}
                  </Label>
                </div>
              </RadioGroup>
            </div>
          )}

          {canNotifyGuests && (
            <div className="space-y-2">
              <Label htmlFor="guest-notification-message">
                {copy.textarea}
              </Label>
              <Textarea
                id="guest-notification-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={copy.placeholder}
                rows={4}
                autoFocus={!showRecurrenceScope}
              />
              <p className="text-xs text-muted-foreground">
                {t("deleteEvent.guest", { count: guestCount })}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("eventForm.cancel")}
          </Button>
          {canNotifyGuests ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => onConfirm(buildChoice("none"))}
              >
                {copy.skipLabel}
              </Button>
              <Button
                type="button"
                onClick={() => onConfirm(buildChoice("all"))}
              >
                {copy.sendLabel}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              onClick={() => onConfirm(buildChoice("none"))}
            >
              {copy.confirmLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function normalizeRecurrenceScope(
  recurrenceScope: boolean | RecurrenceScopeOptions | undefined,
): RecurrenceScopeOptions | undefined {
  if (recurrenceScope === true) return { enabled: true };
  return recurrenceScope || undefined;
}

export function shouldOpenGuestNotificationPrompt(args: {
  event: CalendarEvent;
  updates?: GuestPromptUpdates;
  recurrenceScope?: RecurrenceScopeOptions;
}): boolean {
  return (
    shouldPromptGuests(args.event, args.updates) ||
    Boolean(args.recurrenceScope?.enabled)
  );
}

export function useGuestNotificationPrompt() {
  const [request, setRequest] = useState<PromptRequest | null>(null);

  const promptGuestNotification = useCallback(
    (args: {
      event: CalendarEvent;
      action: GuestNotificationAction;
      updates?: GuestPromptUpdates;
      recurrenceScope?: boolean | RecurrenceScopeOptions;
    }) => {
      const recurrenceScope = normalizeRecurrenceScope(args.recurrenceScope);
      if (
        !shouldOpenGuestNotificationPrompt({
          event: args.event,
          updates: args.updates,
          recurrenceScope,
        })
      ) {
        return Promise.resolve<GuestNotificationOptions | null>({
          sendUpdates: "none",
        });
      }
      return new Promise<GuestNotificationOptions | null>((resolve) => {
        setRequest({
          event: args.event,
          action: args.action,
          updates: args.updates,
          recurrenceScope,
          resolve,
        });
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
