import { useState, useEffect, useCallback } from "react";
import { format, parseISO, differenceInMinutes } from "date-fns";
import {
  IconX,
  IconClock,
  IconMapPin,
  IconUser,
  IconVideo,
  IconGlobe,
  IconRefresh,
  IconBell,
  IconChevronRight,
  IconLayoutSidebarRight,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import type { CalendarEvent } from "@shared/api";
import { ResearchMeetingButton } from "@/components/calendar/ApolloPanel";
import { EventAttendeesSection } from "@/components/calendar/EventAttendeesSection";
import { useCalendarContext } from "@/components/layout/AppLayout";

function formatDuration(start: string, end: string): string {
  const totalMinutes = differenceInMinutes(parseISO(end), parseISO(start));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}

function formatTimeShort(dateStr: string): string {
  const d = parseISO(dateStr);
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  if (m === 0) return `${hour12} ${period}`;
  return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
}

/** Sanitize HTML: strip script tags and on* event handlers */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<script[\s\S]*?>/gi, "")
    .replace(/\bon\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\bon\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\bon\w+\s*=\s*[^\s>]*/gi, "");
}

/**
 * Strip Google Calendar invitation boilerplate from event descriptions.
 * GCal embeds the full invitation HTML (guest list, RSVP buttons, "More options",
 * meeting details, "Invitation from Google Calendar" footer) into the description.
 * We render all of that natively, so strip it out to avoid ugly duplication.
 */
function stripGcalInviteHtml(html: string): string {
  let cleaned = html;

  // Remove "Reply for <email>" section with Yes/No/Maybe buttons
  // This covers the RSVP table/block that Google Calendar injects
  cleaned = cleaned.replace(
    /<(table|div)[^>]*>[\s\S]*?Reply\s+for[\s\S]*?<\/(table|div)>/gi,
    "",
  );

  // Remove standalone Yes/No/Maybe buttons (various Google formats)
  cleaned = cleaned.replace(
    /<(table|div)[^>]*>[\s\S]*?(?:>Yes<|>No<|>Maybe<)[\s\S]*?<\/(table|div)>/gi,
    "",
  );

  // Remove "More options" link/button
  cleaned = cleaned.replace(/<a[^>]*>[\s]*More\s+options[\s]*<\/a>/gi, "");
  cleaned = cleaned.replace(
    /<(table|div)[^>]*>[\s\S]*?More\s+options[\s\S]*?<\/(table|div)>/gi,
    "",
  );

  // Remove "Invitation from Google Calendar" footer
  cleaned = cleaned.replace(
    /Invitation\s+from\s+<a[^>]*>Google\s+Calendar<\/a>/gi,
    "",
  );
  cleaned = cleaned.replace(/Invitation\s+from\s+Google\s+Calendar/gi, "");

  // Remove "You are receiving this email" disclaimer
  cleaned = cleaned.replace(/You\s+are\s+receiving\s+this[\s\S]*?$/gi, "");

  // Remove "View all guest info" links
  cleaned = cleaned.replace(
    /<a[^>]*>[\s]*View\s+all\s+guest\s+info[\s]*<\/a>/gi,
    "",
  );

  // Remove the "When" / "Guests" sections that duplicate our native UI
  cleaned = cleaned.replace(
    /<b>When<\/b>[\s\S]*?(?=<b>|<hr|<br\s*\/?>[\s]*<br\s*\/?>|$)/gi,
    "",
  );

  // Remove "Join Zoom Meeting" / "Join by phone" blocks that duplicate our meeting link
  cleaned = cleaned.replace(
    /<b>Join\s+Zoom\s+Meeting<\/b>[\s\S]*?(?=<b>Joining\s+notes|<hr|<br\s*\/?>[\s]*<br\s*\/?>[\s]*<br|$)/gi,
    "",
  );
  cleaned = cleaned.replace(
    /<b>Join\s+by\s+phone<\/b>[\s\S]*?(?=<b>|<hr|$)/gi,
    "",
  );

  // Remove "Joining instructions" links
  cleaned = cleaned.replace(
    /<a[^>]*>[\s]*Joining\s+instructions[\s]*<\/a>/gi,
    "",
  );

  // Clean up leftover separators and whitespace
  cleaned = cleaned.replace(/(<hr\s*\/?>[\s]*){2,}/gi, "<hr/>");
  cleaned = cleaned.replace(/(<br\s*\/?>[\s]*){4,}/gi, "<br/><br/>");
  cleaned = cleaned.replace(/([-─]{5,}[\s]*){2,}/g, "");

  // Trim leading/trailing whitespace and empty elements
  cleaned = cleaned.replace(/^[\s<br\/>]*(<hr\s*\/?>)?[\s<br\/>]*/i, "");
  cleaned = cleaned.replace(/[\s<br\/>]*(<hr\s*\/?>)?[\s<br\/>]*$/i, "");

  return cleaned.trim();
}

/** Extract a Zoom/Meet/Teams link from location or description */
function extractMeetingLink(event: CalendarEvent): {
  url: string;
  type: "zoom" | "meet" | "teams" | "link";
  label?: string;
  pin?: string;
  passcode?: string;
} | null {
  // Check conferenceData first
  if (event.conferenceData?.entryPoints) {
    const videoEntry = event.conferenceData.entryPoints.find(
      (ep) => ep.entryPointType === "video",
    );
    if (videoEntry) {
      let type: "zoom" | "meet" | "teams" | "link" = "link";
      if (videoEntry.uri.includes("zoom.us")) type = "zoom";
      else if (videoEntry.uri.includes("meet.google.com")) type = "meet";
      else if (videoEntry.uri.includes("teams.microsoft.com")) type = "teams";
      return {
        url: videoEntry.uri,
        type,
        label: videoEntry.label || undefined,
        pin: videoEntry.pin || undefined,
        passcode: videoEntry.passcode || undefined,
      };
    }
  }

  // IconCheck hangoutLink
  if (event.hangoutLink) {
    return { url: event.hangoutLink, type: "meet" };
  }

  // Fall back to text matching
  const text = `${event.location || ""} ${event.description || ""}`;
  const zoom = text.match(/https?:\/\/[^\s]*zoom\.us\/j\/[^\s)"]*/i);
  if (zoom) return { url: zoom[0], type: "zoom" };
  const meet = text.match(/https?:\/\/meet\.google\.com\/[^\s)"]*/i);
  if (meet) return { url: meet[0], type: "meet" };
  const teams = text.match(/https?:\/\/teams\.microsoft\.com\/[^\s)"]*/i);
  if (teams) return { url: teams[0], type: "teams" };
  return null;
}

function getMeetingLabel(type: "zoom" | "meet" | "teams" | "link"): string {
  switch (type) {
    case "zoom":
      return "Join Zoom";
    case "meet":
      return "Join Meet";
    case "teams":
      return "Join Teams";
    default:
      return "Join Meeting";
  }
}

function formatReminderText(minutes: number): string {
  if (minutes < 60) return `${minutes}min before`;
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60);
    return `${h}h before`;
  }
  const d = Math.floor(minutes / 1440);
  return `${d}d before`;
}

function formatRecurrence(recurrence?: string[]): string | null {
  if (!recurrence || recurrence.length === 0) return null;
  const rule = recurrence.find((r) => r.startsWith("RRULE:"));
  if (!rule) return null;

  const freq = rule.match(/FREQ=(\w+)/)?.[1];
  const interval = parseInt(rule.match(/INTERVAL=(\d+)/)?.[1] || "1", 10);
  const byDay = rule.match(/BYDAY=([^;]+)/)?.[1];

  const dayMap: Record<string, string> = {
    MO: "Mon",
    TU: "Tue",
    WE: "Wed",
    TH: "Thu",
    FR: "Fri",
    SA: "Sat",
    SU: "Sun",
  };

  switch (freq) {
    case "DAILY":
      return interval === 1 ? "Every day" : `Every ${interval} days`;
    case "WEEKLY": {
      const days = byDay
        ?.split(",")
        .map((d) => dayMap[d] || d)
        .join(", ");
      if (interval === 1) return days ? `Every week on ${days}` : "Every week";
      return days
        ? `Every ${interval} weeks on ${days}`
        : `Every ${interval} weeks`;
    }
    case "MONTHLY":
      return interval === 1 ? "Every month" : `Every ${interval} months`;
    case "YEARLY":
      return interval === 1 ? "Every year" : `Every ${interval} years`;
    default:
      return null;
  }
}

/** Check if a string looks like a URL */
function isUrl(str: string): boolean {
  return /^https?:\/\//i.test(str.trim());
}

/** IconCheck if description contains HTML */
function isHtml(str: string): boolean {
  return /<[a-z][\s\S]*>/i.test(str);
}

interface EventDetailPopoverProps {
  event: CalendarEvent;
  children: React.ReactNode;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (eventId: string) => void;
}

export function EventDetailPopover({
  event,
  children,
  onEdit,
  onDelete,
}: EventDetailPopoverProps) {
  const [open, setOpen] = useState(false);
  const { eventDetailSidebar, setEventDetailSidebar, setSidebarEvent } =
    useCalendarContext();

  const meetingLink = extractMeetingLink(event);

  // If in sidebar mode, clicking the trigger opens the sidebar instead of popover
  const handleTriggerClick = useCallback(() => {
    if (eventDetailSidebar) {
      setSidebarEvent(event);
    }
  }, [eventDetailSidebar, event, setSidebarEvent]);

  const handlePinToSidebar = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Close popover first, then set sidebar state after a frame
      // so the popover unmount doesn't interfere with state updates
      setOpen(false);
      requestAnimationFrame(() => {
        setSidebarEvent(event);
        setEventDetailSidebar(true);
      });
    },
    [event, setEventDetailSidebar, setSidebarEvent],
  );

  // Keyboard shortcut: Cmd+J to join meeting when popover is open
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open || !meetingLink) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        window.open(meetingLink.url, "_blank");
      }
    },
    [open, meetingLink],
  );

  useEffect(() => {
    if (open) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [open, handleKeyDown]);

  const locationIsUrl = event.location ? isUrl(event.location) : false;
  const locationIsMeetingLink =
    meetingLink && event.location?.includes(meetingLink.url);
  const recurrenceText = formatRecurrence(event.recurrence);
  const descriptionIsHtml = event.description
    ? isHtml(event.description)
    : false;

  // Detect timezone from event start (offset-based)
  const startDate = parseISO(event.start);
  const offsetMinutes = -startDate.getTimezoneOffset();
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const tzLabel = `GMT${offsetSign}${offsetHours}`;

  return (
    <Popover open={eventDetailSidebar ? false : open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onClick={handleTriggerClick}>
        {children}
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        className="w-[420px] max-h-[90vh] p-0 overflow-hidden flex flex-col"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          // Don't close if clicking inside an Apollo popover (portaled to body)
          const target = e.target as HTMLElement;
          if (target.closest("[data-apollo-popover]")) {
            e.preventDefault();
          }
        }}
      >
        <TooltipProvider>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <span>Event</span>
              <IconChevronRight className="h-3 w-3" />
            </div>
            <div className="flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={handlePinToSidebar}
                  >
                    <IconLayoutSidebarRight className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>Open in sidebar</p>
                </TooltipContent>
              </Tooltip>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={() => setOpen(false)}
              >
                <IconX className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 pt-4 pb-1">
              {/* Title */}
              <h2 className="text-lg font-semibold text-foreground leading-tight mb-4">
                {event.title}
              </h2>
            </div>

            <div className="px-4 space-y-1">
              {/* Time */}
              <div className="flex items-start gap-3 py-1.5">
                <IconClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="text-sm">
                  {event.allDay ? (
                    <div>
                      <span className="text-foreground">All day</span>
                      <span className="text-muted-foreground ml-2 text-xs">
                        {format(parseISO(event.start), "EEE MMM d")}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-baseline gap-1">
                        <span className="text-foreground font-medium">
                          {formatTimeShort(event.start)}
                        </span>
                        <span className="text-muted-foreground/50 mx-0.5">
                          &rarr;
                        </span>
                        <span className="text-foreground font-medium">
                          {formatTimeShort(event.end)}
                        </span>
                        <span className="text-muted-foreground/50 text-xs ml-1">
                          {formatDuration(event.start, event.end)}
                        </span>
                      </div>
                      <div className="text-muted-foreground text-xs mt-0.5">
                        {format(parseISO(event.start), "EEE MMM d")}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Timezone */}
              <div className="flex items-center gap-3 py-1.5">
                <IconGlobe className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{tzLabel}</span>
              </div>

              {/* Recurrence */}
              {recurrenceText && (
                <div className="flex items-center gap-3 py-1.5">
                  <IconRefresh className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {recurrenceText}
                  </span>
                </div>
              )}
            </div>

            {/* Separator */}
            <div className="mx-4 my-2 border-t border-border/50" />

            {/* Attendees */}
            {event.attendees && event.attendees.length > 0 && (
              <EventAttendeesSection event={event} />
            )}

            {/* Research Meeting button */}
            {event.attendees && event.attendees.length > 0 && (
              <>
                <div className="mx-4 my-2 border-t border-border/50" />
                <div className="px-4 py-1">
                  <ResearchMeetingButton event={event} />
                </div>
              </>
            )}

            {/* Meeting link */}
            {meetingLink && (
              <>
                <div className="mx-4 my-2 border-t border-border/50" />
                <div className="px-4 py-1.5">
                  <a
                    href={meetingLink.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center w-full rounded-xl bg-[#4965E0] hover:bg-[#5A75F0] text-white font-semibold py-3 px-4 text-[15px] relative"
                  >
                    <IconVideo className="h-5 w-5 mr-2 opacity-80" />
                    <span>{getMeetingLabel(meetingLink.type)}</span>
                    <span className="absolute right-4 flex items-center gap-1 opacity-50">
                      <kbd className="text-xs font-normal">⌘</kbd>
                      <kbd className="inline-flex h-5 w-5 items-center justify-center rounded bg-white/20 text-[11px] font-medium">
                        J
                      </kbd>
                    </span>
                  </a>
                  {(meetingLink.pin || meetingLink.passcode) && (
                    <div className="mt-1.5 text-xs text-muted-foreground/60">
                      {meetingLink.pin && <span>PIN: {meetingLink.pin}</span>}
                      {meetingLink.pin && meetingLink.passcode && (
                        <span className="mx-1">&middot;</span>
                      )}
                      {meetingLink.passcode && (
                        <span>Passcode: {meetingLink.passcode}</span>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Location */}
            {event.location && !locationIsMeetingLink && (
              <>
                <div className="mx-4 my-2 border-t border-border/50" />
                <div className="flex items-start gap-3 px-4 py-1.5">
                  <IconMapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  {locationIsUrl ? (
                    <a
                      href={event.location}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline truncate block max-w-full"
                      title={event.location}
                    >
                      {event.location}
                    </a>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {event.location}
                    </span>
                  )}
                </div>
              </>
            )}

            {/* Description */}
            {event.description &&
              (() => {
                const cleanedHtml = descriptionIsHtml
                  ? stripGcalInviteHtml(sanitizeHtml(event.description))
                  : null;
                const hasContent = cleanedHtml
                  ? cleanedHtml.replace(/<[^>]*>/g, "").trim().length > 0
                  : true;
                if (!hasContent) return null;
                return (
                  <>
                    <div className="mx-4 my-2 border-t border-border/50" />
                    <div className="px-4 py-1.5">
                      {descriptionIsHtml ? (
                        <div
                          className="rounded-lg bg-muted/30 px-3 py-2.5 text-sm leading-relaxed text-foreground/80 prose prose-sm prose-invert prose-p:my-1 prose-a:text-primary"
                          dangerouslySetInnerHTML={{
                            __html: cleanedHtml!,
                          }}
                        />
                      ) : (
                        <p className="rounded-lg bg-muted/30 px-3 py-2.5 text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">
                          {event.description}
                        </p>
                      )}
                    </div>
                  </>
                );
              })()}

            {/* Reminders */}
            {event.reminders && event.reminders.length > 0 && (
              <>
                <div className="mx-4 my-2 border-t border-border/50" />
                <div className="flex items-start gap-3 px-4 py-1.5">
                  <IconBell className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="space-y-0.5">
                    {event.reminders.map((r, i) => (
                      <div key={i} className="text-sm text-muted-foreground">
                        {formatReminderText(r.minutes)}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Status / Visibility */}
            {(event.status || event.visibility) && (
              <>
                <div className="mx-4 my-2 border-t border-border/50" />
                <div className="flex items-center gap-3 px-4 py-1.5 text-sm text-muted-foreground">
                  <div className="h-4 w-4 shrink-0" />
                  <div className="flex items-center gap-2">
                    {event.status && event.status !== "cancelled" && (
                      <span>
                        {event.status === "confirmed" ? "Busy" : "Free"}
                      </span>
                    )}
                    {event.status &&
                      event.status !== "cancelled" &&
                      event.visibility &&
                      event.visibility !== "default" && (
                        <span className="text-muted-foreground/40">
                          &middot;
                        </span>
                      )}
                    {event.visibility && event.visibility !== "default" && (
                      <span className="capitalize">
                        {event.visibility} visibility
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Overlay person badge */}
            {event.overlayEmail && (
              <>
                <div className="mx-4 my-2 border-t border-border/50" />
                <div className="flex items-center gap-3 px-4 py-1.5">
                  <IconUser className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {event.overlayEmail}
                  </span>
                </div>
              </>
            )}

            {/* Bottom padding */}
            <div className="h-3" />
          </div>

          {/* Actions — only for local events */}
          {event.source !== "google" && !event.overlayEmail && (
            <div className="shrink-0 border-t border-border px-4 py-2.5 flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10 text-xs"
                onClick={() => {
                  onDelete(event.id);
                  setOpen(false);
                }}
              >
                Delete
              </Button>
              <div className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => {
                  onEdit(event);
                  setOpen(false);
                }}
              >
                Edit
              </Button>
            </div>
          )}
        </TooltipProvider>
      </PopoverContent>
    </Popover>
  );
}
