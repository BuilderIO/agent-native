import { useState, useRef, useEffect, useCallback } from "react";
import { format, parseISO, differenceInMinutes } from "date-fns";
import {
  IconX,
  IconClock,
  IconMapPin,
  IconTrash,
  IconLayoutSidebarRightCollapse,
  IconExternalLink,
  IconFileText,
  IconAlignLeft,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getEventAutoColor } from "@/lib/event-colors";
import type { CalendarEvent } from "@shared/api";
import { ResearchMeetingButton } from "@/components/calendar/ApolloPanel";
import { EventAttendeesSection } from "@/components/calendar/EventAttendeesSection";
import { useCalendarContext } from "@/components/layout/AppLayout";
import {
  RenderedDescription,
  AutoGrowTextarea,
} from "@/components/calendar/EventDescription";
import { useUpdateEvent } from "@/hooks/use-events";

interface EventDetailPanelProps {
  event: CalendarEvent | null;
  onClose: () => void;
  onDelete: (eventId: string) => void;
  onTitleSave?: (eventId: string, title: string) => void;
}

function formatDuration(start: string, end: string): string {
  const totalMinutes = differenceInMinutes(parseISO(end), parseISO(start));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function getEventColor(event: CalendarEvent): string {
  return getEventAutoColor(event);
}

export function EventDetailPanel({
  event,
  onClose,
  onDelete,
  onTitleSave,
}: EventDetailPanelProps) {
  const { setEventDetailSidebar } = useCalendarContext();
  const isOpen = event !== null;
  const color = event ? getEventColor(event) : null;
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitle, setEditingTitle] = useState("");
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editDescription, setEditDescription] = useState(
    event?.description || "",
  );
  const titleInputRef = useRef<HTMLInputElement>(null);
  const updateEvent = useUpdateEvent();
  const isOverlay = !!event?.overlayEmail;
  const lastSavedDescriptionRef = useRef(event?.description || "");

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

  useEffect(() => {
    if (!isOpen || !event) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        !isEditingTitle &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        onDelete(event.id);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, event, isEditingTitle, onDelete]);

  const handleSaveDescription = useCallback(() => {
    if (!event) return;
    const trimmed = editDescription.trim();
    if (trimmed !== lastSavedDescriptionRef.current.trim()) {
      const prev = lastSavedDescriptionRef.current;
      lastSavedDescriptionRef.current = trimmed;
      updateEvent.mutate(
        {
          id: event.id,
          accountEmail: event.accountEmail,
          description: trimmed,
        },
        {
          onError: () => {
            lastSavedDescriptionRef.current = prev;
          },
        },
      );
    }
    setIsEditingDescription(false);
  }, [editDescription, event, updateEvent]);

  const handleUnpin = () => {
    setEventDetailSidebar(false);
    onClose();
  };

  return (
    <TooltipProvider>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={onClose}
        />
      )}
      <div
        className={cn(
          "fixed inset-y-0 right-0 z-50 w-full max-w-sm overflow-hidden md:static md:z-auto md:max-w-none md:shrink-0",
          isOpen ? "md:w-80" : "w-0 md:w-0",
          !isOpen && "pointer-events-none",
        )}
      >
        <div className="h-full w-full border-l border-border bg-card flex flex-col md:w-80">
          {event && (
            <>
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Event
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
                      <p>Use popover instead</p>
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
                {isEditingTitle ? (
                  <input
                    ref={titleInputRef}
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const trimmed = editingTitle.trim();
                        if (trimmed && trimmed !== event.title) {
                          onTitleSave?.(event.id, trimmed);
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
                        onTitleSave?.(event.id, trimmed);
                      }
                      setIsEditingTitle(false);
                    }}
                    placeholder="Add title"
                    className="w-full text-lg font-semibold text-foreground leading-tight bg-transparent border-none outline-none placeholder:text-muted-foreground/50 focus:ring-0"
                  />
                ) : (
                  <h2
                    className="text-lg font-semibold text-foreground leading-tight cursor-text rounded px-0.5 -mx-0.5 hover:bg-muted/50"
                    onClick={() => {
                      setEditingTitle(event.title);
                      setIsEditingTitle(true);
                    }}
                  >
                    {event.title}
                  </h2>
                )}

                {/* Time */}
                <div className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <IconClock className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    {event.allDay ? (
                      <span>
                        All day &middot;{" "}
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

                {/* Location */}
                {event.location && (
                  <div className="flex items-start gap-2.5 text-sm text-muted-foreground">
                    <IconMapPin className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{event.location}</span>
                  </div>
                )}

                {/* Description — always shown, editable; hidden for overlay events with no description */}
                {(!isOverlay || event.description) && (
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
                {event.attachments && event.attachments.length > 0 && (
                  <div className="space-y-1">
                    {event.attachments.map((att, i) => (
                      <a
                        key={i}
                        href={att.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50 group"
                      >
                        {att.iconLink ? (
                          <img
                            src={att.iconLink}
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
                {event.attendees && event.attendees.length > 0 && (
                  <EventAttendeesSection event={event} />
                )}

                {/* Research Meeting */}
                {event.attendees && event.attendees.length > 0 && (
                  <ResearchMeetingButton event={event} />
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
                    Delete
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
