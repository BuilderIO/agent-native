import { useT } from "@agent-native/core/client";
import { ExtensionSlot } from "@agent-native/core/client/extensions";
import type { CalendarEvent } from "@shared/api";
import {
  IconX,
  IconClock,
  IconMapPin,
  IconTrash,
  IconLayoutSidebarRightCollapse,
  IconExternalLink,
  IconFileText,
  IconAlignLeft,
  IconVideo,
} from "@tabler/icons-react";
import { format, parseISO, differenceInMinutes } from "date-fns";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";

import { ResearchMeetingButton } from "@/components/calendar/ApolloPanel";
import { EventAttendeesSection } from "@/components/calendar/EventAttendeesSection";
import {
  RenderedDescription,
  AutoGrowTextarea,
} from "@/components/calendar/EventDescription";
import { useGuestNotificationPrompt } from "@/components/calendar/GuestNotificationDialog";
import { WorkingLocationEditor } from "@/components/calendar/WorkingLocationEditor";
import { useCalendarContext } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { useUpdateEvent } from "@/hooks/use-events";
import { useViewPreferences } from "@/hooks/use-view-preferences";
import { isOutOfOfficeEvent } from "@/lib/out-of-office";
import { cn } from "@/lib/utils";
import {
  buildWorkingLocationUpdate,
  createWorkingLocationDisplayLabels,
  getWorkingLocationTitle,
  isWorkingLocationEvent,
  type WorkingLocationSelection,
} from "@/lib/working-location";

function buildEventDetailSlotContext(event: CalendarEvent) {
  return {
    eventId: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    startTimeZone: event.startTimeZone,
    endTimeZone: event.endTimeZone,
    location: event.location,
    accountEmail: event.accountEmail,
    attendees: (event.attendees ?? []).map((attendee) => ({
      email: attendee.email,
      displayName: attendee.displayName,
      responseStatus: attendee.responseStatus,
      organizer: attendee.organizer,
      optional: attendee.optional,
      timeZone: attendee.timeZone,
      self: attendee.self,
    })),
  };
}

interface EventDetailPanelProps {
  event: CalendarEvent | null;
  onClose: () => void;
  onDelete: (eventId: string) => void;
  onTitleSave?: (eventId: string, title: string, accountEmail?: string) => void;
}

function formatDuration(start: string, end: string): string {
  const totalMinutes = differenceInMinutes(parseISO(end), parseISO(start));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Returns the URL only when it parses cleanly and uses http: or https:.
 * Defends against `javascript:` / `data:` / `vbscript:` URLs in
 * Google-Calendar-supplied attachment metadata reaching `<a href>` /
 * `<img src>` (audit 03 medium).
 */
function safeUrl(u: string | undefined): string {
  if (!u) return "#";
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:" ? u : "#";
  } catch {
    return "#";
  }
}

function extractMeetingLink(event: CalendarEvent): string | null {
  const videoEntry = event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === "video",
  );
  if (videoEntry?.uri) return videoEntry.uri;
  if (event.hangoutLink) return event.hangoutLink;
  const text = `${event.location || ""} ${event.description || ""}`;
  return (
    text.match(/https?:\/\/[^\s]*zoom\.us\/j\/[^\s)"]*/i)?.[0] ||
    text.match(/https?:\/\/meet\.google\.com\/[^\s)"]*/i)?.[0] ||
    text.match(/https?:\/\/teams\.microsoft\.com\/[^\s)"]*/i)?.[0] ||
    null
  );
}

export function EventDetailPanel({
  event,
  onClose,
  onDelete,
  onTitleSave,
}: EventDetailPanelProps) {
  const t = useT();
  const workingLocationLabels = createWorkingLocationDisplayLabels(t);
  const { setEventDetailSidebar } = useCalendarContext();
  useViewPreferences();
  const isOpen = event !== null;
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitle, setEditingTitle] = useState("");
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editDescription, setEditDescription] = useState(
    event?.description || "",
  );
  const titleInputRef = useRef<HTMLInputElement>(null);
  const updateEvent = useUpdateEvent();
  const { promptGuestNotification, guestNotificationDialog } =
    useGuestNotificationPrompt();
  const isOverlay = !!event?.overlayEmail;
  const isWorkingLocation = event ? isWorkingLocationEvent(event) : false;
  const isOutOfOffice = event ? isOutOfOfficeEvent(event) : false;
  const isRecurringEvent = !!(
    event?.recurringEventId || event?.recurrence?.length
  );
  const lastSavedDescriptionRef = useRef(event?.description || "");
  const meetingLink = event ? extractMeetingLink(event) : null;
  const ownerLabel = event?.ownerName || event?.overlayEmail;
  const eventDetailSlotContext = useMemo(
    () => (event ? buildEventDetailSlotContext(event) : null),
    [event],
  );

  // Reset editing state when event changes
  useEffect(() => {
    setIsEditingTitle(false);
    setIsEditingDescription(false);
    setEditDescription(event?.description || "");
    lastSavedDescriptionRef.current = event?.description || "";
  }, [event?.id]);

  useEffect(() => {
    if (isEditingTitle) {
      requestAnimationFrame(() => titleInputRef.current?.focus());
    }
  }, [isEditingTitle]);

  const handleSaveDescription = useCallback(() => {
    if (!event) return;
    const trimmed = editDescription.trim();
    if (trimmed !== lastSavedDescriptionRef.current.trim()) {
      const prev = lastSavedDescriptionRef.current;
      lastSavedDescriptionRef.current = trimmed;
      void (async () => {
        const updates = { description: trimmed };
        const guestNotification = await promptGuestNotification({
          event,
          action: "update",
          updates,
        });
        if (!guestNotification) {
          lastSavedDescriptionRef.current = prev;
          return;
        }
        updateEvent.mutate(
          {
            id: event.id,
            accountEmail: event.accountEmail,
            ...updates,
            ...guestNotification,
          },
          {
            onError: () => {
              lastSavedDescriptionRef.current = prev;
            },
          },
        );
      })();
    }
    setIsEditingDescription(false);
  }, [editDescription, event, promptGuestNotification, updateEvent]);

  const handleUnpin = () => {
    setEventDetailSidebar(false);
    onClose();
  };

  const handleAddGoogleMeet = useCallback(() => {
    if (!event || updateEvent.isPending) return;
    void (async () => {
      const updates = { addGoogleMeet: true };
      const guestNotification = await promptGuestNotification({
        event,
        action: "update",
        updates,
      });
      if (!guestNotification) return;
      updateEvent.mutate(
        {
          id: event.id,
          accountEmail: event.accountEmail,
          ...updates,
          ...guestNotification,
        },
        {
          onSuccess: () => toast(t("eventForm.googleMeetAdded")),
          onError: () => toast.error(t("eventForm.googleMeetAddFailed")),
        },
      );
    })();
  }, [event, promptGuestNotification, updateEvent]);

  const handleToggleAttendeeOptional = useCallback(
    (email: string, optional: boolean) => {
      if (!event || updateEvent.isPending) return;
      const existing = event.attendees || [];
      const key = email.trim().toLowerCase();
      if (!existing.some((attendee) => attendee.email.toLowerCase() === key)) {
        return;
      }
      const attendees = existing.map((attendee) =>
        attendee.email.toLowerCase() === key
          ? {
              ...attendee,
              optional: optional ? true : undefined,
            }
          : attendee,
      );
      void (async () => {
        const updates = { attendees };
        const guestNotification = await promptGuestNotification({
          event,
          action: "update",
          updates,
        });
        if (!guestNotification) return;
        updateEvent.mutate({
          id: event.id,
          accountEmail: event.accountEmail,
          ...updates,
          ...guestNotification,
        });
      })();
    },
    [event, promptGuestNotification, updateEvent],
  );

  const handleSaveWorkingLocation = useCallback(
    (selection: WorkingLocationSelection) => {
      if (!event) return;
      updateEvent.mutate(buildWorkingLocationUpdate(event, selection), {
        onError: () => toast.error(t("calendarView.failedUpdateEvent")),
      });
    },
    [event, t, updateEvent],
  );

  return (
    <TooltipProvider>
      {isOpen && (
        <div
          className="calendar-event-detail-backdrop fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />
      )}
      <div
        className={cn(
          "calendar-event-detail-panel fixed inset-y-0 right-0 z-50 w-full max-w-sm overflow-hidden",
          isOpen ? "calendar-event-detail-panel-open" : "w-0",
          !isOpen && "pointer-events-none",
        )}
      >
        <div className="calendar-event-detail-panel-inner flex h-full w-full flex-col border-l border-border bg-card">
          {event && (
            <>
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {isWorkingLocation
                    ? t("eventForm.workingLocation")
                    : isOutOfOffice
                      ? t("eventForm.outOfOffice")
                      : t("eventForm.event")}
                </span>
                <div className="flex items-center gap-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={handleUnpin}
                      >
                        <IconLayoutSidebarRightCollapse className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p>{t("eventForm.usePopoverInstead")}</p>
                    </TooltipContent>
                  </Tooltip>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={onClose}
                  >
                    <IconX className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {/* Title — click to edit */}
                {isEditingTitle && !isWorkingLocation ? (
                  <input
                    ref={titleInputRef}
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const trimmed = editingTitle.trim();
                        if (trimmed && trimmed !== event.title) {
                          onTitleSave?.(event.id, trimmed, event.accountEmail);
                        }
                        setIsEditingTitle(false);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setIsEditingTitle(false);
                      }
                      e.stopPropagation();
                    }}
                    onBlur={() => {
                      const trimmed = editingTitle.trim();
                      if (trimmed && trimmed !== event.title) {
                        onTitleSave?.(event.id, trimmed, event.accountEmail);
                      }
                      setIsEditingTitle(false);
                    }}
                    placeholder={t("eventForm.addTitle")}
                    className="w-full text-lg font-semibold text-foreground leading-tight bg-transparent border-none outline-none placeholder:text-muted-foreground/50 focus:ring-0"
                  />
                ) : (
                  <h2
                    className={cn(
                      "-mx-0.5 rounded px-0.5 text-lg font-semibold leading-tight text-foreground",
                      !isWorkingLocation && "cursor-text hover:bg-muted/50",
                    )}
                    onClick={() => {
                      if (isWorkingLocation) return;
                      setEditingTitle(event.title);
                      setIsEditingTitle(true);
                    }}
                  >
                    {getWorkingLocationTitle(event, workingLocationLabels)}
                  </h2>
                )}

                {/* Time */}
                <div className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <IconClock className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    {event.allDay ? (
                      <span>
                        {t("eventForm.allDay")} &middot;{" "}
                        {format(parseISO(event.start), "MMMM d, yyyy")}
                      </span>
                    ) : (
                      <>
                        <span className="text-foreground">
                          {format(parseISO(event.start), "h:mm a")}
                          {" → "}
                          {format(parseISO(event.end), "h:mm a")}
                        </span>
                        <span className="ml-2 text-muted-foreground/70">
                          {formatDuration(event.start, event.end)}
                        </span>
                        <div className="mt-0.5 text-muted-foreground">
                          {format(parseISO(event.start), "EEE MMM d")}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {isWorkingLocation ? (
                  <WorkingLocationEditor
                    event={event}
                    isRecurring={isRecurringEvent}
                    readOnly={isOverlay}
                    disabled={updateEvent.isPending}
                    onSave={handleSaveWorkingLocation}
                  />
                ) : event.location ? (
                  <div className="flex items-start gap-2.5 text-sm text-muted-foreground">
                    <IconMapPin className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{event.location}</span>
                  </div>
                ) : null}

                {event.overlayEmail && ownerLabel && (
                  <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                    <span
                      aria-hidden="true"
                      className="ml-0.5 size-2 shrink-0 rounded-full ring-1 ring-border"
                      style={{ backgroundColor: event.ownerColor }}
                    />
                    <span>
                      {t("eventForm.viewingOwnerCalendar", {
                        owner: ownerLabel,
                      })}
                    </span>
                  </div>
                )}

                {!isWorkingLocation &&
                  (meetingLink ? (
                    <a
                      href={safeUrl(meetingLink)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center rounded-lg bg-[#4965E0] px-3 py-2 text-sm font-semibold text-white hover:bg-[#5A75F0]"
                    >
                      <IconVideo className="mr-2 h-4 w-4 opacity-80" />
                      {t("eventForm.joinMeeting")}
                    </a>
                  ) : !isOverlay ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full justify-center gap-1.5"
                      disabled={updateEvent.isPending}
                      onClick={handleAddGoogleMeet}
                    >
                      <IconVideo className="h-4 w-4" />
                      {t("eventForm.googleMeet")}
                    </Button>
                  ) : null)}

                {/* Description — always shown, editable; hidden for overlay events with no description */}
                {!isWorkingLocation && (!isOverlay || event.description) && (
                  <div className="flex items-start gap-2.5">
                    <IconAlignLeft className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    {isOverlay ? (
                      event.description ? (
                        <RenderedDescription description={event.description} />
                      ) : null
                    ) : isEditingDescription || !event.description ? (
                      <AutoGrowTextarea
                        value={editDescription}
                        onChange={setEditDescription}
                        onBlur={handleSaveDescription}
                        onSubmit={handleSaveDescription}
                        onEscape={() => {
                          setEditDescription(lastSavedDescriptionRef.current);
                          setIsEditingDescription(false);
                        }}
                        autoFocus={isEditingDescription}
                      />
                    ) : (
                      <RenderedDescription
                        description={event.description}
                        editable
                        onClick={() => setIsEditingDescription(true)}
                      />
                    )}
                  </div>
                )}

                {/* Attachments */}
                {!isWorkingLocation &&
                  event.attachments &&
                  event.attachments.length > 0 && (
                    <div className="space-y-1">
                      {event.attachments.map((att, i) => (
                        <a
                          key={i}
                          href={safeUrl(att.fileUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50 group"
                        >
                          {att.iconLink ? (
                            <img
                              src={safeUrl(att.iconLink)}
                              alt=""
                              className="h-4 w-4 shrink-0"
                            />
                          ) : (
                            <IconFileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="truncate text-foreground">
                            {att.title}
                          </span>
                          <IconExternalLink className="ml-auto h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
                        </a>
                      ))}
                    </div>
                  )}

                {/* Attendees */}
                {!isWorkingLocation &&
                  event.attendees &&
                  event.attendees.length > 0 && (
                    <EventAttendeesSection
                      event={event}
                      canEditOptional={!isOverlay}
                      onToggleOptional={handleToggleAttendeeOptional}
                    />
                  )}

                {/* Research Meeting */}
                {!isWorkingLocation &&
                  event.attendees &&
                  event.attendees.length > 0 && (
                    <ResearchMeetingButton event={event} />
                  )}

                {!isWorkingLocation && eventDetailSlotContext && (
                  <ExtensionSlot
                    id="calendar.event-detail.bottom"
                    context={eventDetailSlotContext}
                    showEmptyAffordance
                  />
                )}
              </div>

              {/* Actions */}
              {!isOverlay && (
                <div className="shrink-0 border-t border-border px-4 py-3 flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => onDelete(event.id)}
                  >
                    <IconTrash className="mr-1.5 h-3.5 w-3.5" />
                    {t("eventForm.delete")}
                  </Button>
                  {event.htmlLink && (
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="ml-auto"
                    >
                      <a
                        href={safeUrl(event.htmlLink)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <IconExternalLink className="mr-1.5 h-3.5 w-3.5" />
                        {t("eventForm.googleCalendar")}
                      </a>
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {guestNotificationDialog}
    </TooltipProvider>
  );
}
