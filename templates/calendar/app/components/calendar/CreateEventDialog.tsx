import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateEvent, useDeleteEvent } from "@/hooks/use-events";
import { useConnectZoom, useZoomStatus } from "@/hooks/use-zoom-auth";
import { setUndoAction } from "@/hooks/use-undo";
import { toast } from "sonner";
import {
  AttendeeAutocomplete,
  type AttendeeAutocompleteHandle,
  type AttendeeRecipient,
} from "@/components/calendar/AttendeeAutocomplete";
import {
  IconBrandZoom,
  IconPlus,
  IconVideo,
  IconUsers,
} from "@tabler/icons-react";

type VideoProvider = "none" | "google_meet" | "zoom";

function uniqueAttendees(attendees: AttendeeRecipient[]) {
  const byEmail = new Map<string, AttendeeRecipient>();
  for (const attendee of attendees) {
    const email = attendee.email.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    const existing = byEmail.get(key);
    byEmail.set(key, {
      email,
      displayName: existing?.displayName ?? attendee.displayName,
      photoUrl: existing?.photoUrl ?? attendee.photoUrl,
    });
  }
  return Array.from(byEmail.values());
}

interface CreateEventPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate?: Date;
  defaultStartTime?: string;
  defaultEndTime?: string;
}

export function CreateEventPopover({
  open,
  onOpenChange,
  defaultDate,
  defaultStartTime: defaultStart,
  defaultEndTime: defaultEnd,
}: CreateEventPopoverProps) {
  const today = defaultDate || new Date();
  const defaultDateStr = format(today, "yyyy-MM-dd");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(defaultDateStr);
  const [startTime, setStartTime] = useState(defaultStart || "09:00");
  const [endTime, setEndTime] = useState(defaultEnd || "10:00");
  const [location, setLocation] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [videoProvider, setVideoProvider] = useState<VideoProvider>("none");
  const [attendees, setAttendees] = useState<AttendeeRecipient[]>([]);

  const createEvent = useCreateEvent();
  const delEvent = useDeleteEvent();
  const zoomStatus = useZoomStatus();
  const connectZoom = useConnectZoom();
  const formRef = useRef<HTMLFormElement>(null);
  const attendeeAutocompleteRef = useRef<AttendeeAutocompleteHandle>(null);

  // Reset form when popover opens
  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setDate(format(defaultDate || new Date(), "yyyy-MM-dd"));
      setStartTime(defaultStart || "09:00");
      setEndTime(defaultEnd || "10:00");
      setLocation("");
      setAllDay(false);
      setVideoProvider("none");
      setAttendees([]);
    }
  }, [open, defaultDate, defaultStart, defaultEnd]);

  function addAttendee(attendee: AttendeeRecipient) {
    setAttendees((prev) => uniqueAttendees([...prev, attendee]));
  }

  function removeAttendee(email: string) {
    setAttendees((prev) =>
      prev.filter(
        (attendee) => attendee.email.toLowerCase() !== email.toLowerCase(),
      ),
    );
  }

  // ⌘+Enter to submit
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }

    const startISO = allDay
      ? new Date(`${date}T00:00:00`).toISOString()
      : new Date(`${date}T${startTime}:00`).toISOString();
    const endISO = allDay
      ? new Date(`${date}T23:59:59`).toISOString()
      : new Date(`${date}T${endTime}:00`).toISOString();

    // Pick up any unsubmitted typed email so users do not lose the final entry.
    const trailingAttendees =
      attendeeAutocompleteRef.current?.commitPending() ?? [];
    const finalAttendees = uniqueAttendees([
      ...attendees,
      ...trailingAttendees,
    ]);

    createEvent.mutate(
      {
        title: title.trim(),
        description,
        start: startISO,
        end: endISO,
        location,
        allDay,
        addGoogleMeet: videoProvider === "google_meet",
        addZoom: videoProvider === "zoom",
        attendees:
          finalAttendees.length > 0
            ? finalAttendees.map((attendee) => ({
                email: attendee.email,
                displayName: attendee.displayName,
              }))
            : undefined,
        color: undefined,
      },
      {
        onSuccess: (result) => {
          onOpenChange(false);
          const eventId = result?.id;
          const undo = eventId
            ? () => {
                delEvent.mutate({
                  id: eventId,
                  scope: "single",
                  sendUpdates: "none",
                });
              }
            : undefined;
          if (undo) setUndoAction(undo);
          toast("Event created", {
            action: undo ? { label: "Undo", onClick: undo } : undefined,
          });
        },
        onError: (error) =>
          toast.error(
            error instanceof Error ? error.message : "Failed to create event",
          ),
      },
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button size="sm" className="ml-1 h-7 gap-1.5 px-2.5 text-xs">
          <IconPlus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">New Event</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[calc(100vw-2rem)] p-4 sm:w-80"
        onInteractOutside={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest("[data-attendee-autocomplete]")) {
            event.preventDefault();
          }
        }}
      >
        <div className="mb-3 text-sm font-semibold">New Event</div>
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="event-title" className="text-xs">
              Title
            </Label>
            <Input
              id="event-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title"
              autoFocus
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event-description" className="text-xs">
              Description
            </Label>
            <Textarea
              id="event-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={2}
              className="text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event-date" className="text-xs">
              Date
            </Label>
            <Input
              id="event-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-8 text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch id="all-day" checked={allDay} onCheckedChange={setAllDay} />
            <Label htmlFor="all-day" className="text-xs">
              All day
            </Label>
          </div>

          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="start-time" className="text-xs">
                  Start
                </Label>
                <Input
                  id="start-time"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end-time" className="text-xs">
                  End
                </Label>
                <Input
                  id="end-time"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="event-attendees" className="text-xs">
              Attendees
            </Label>
            <AttendeeAutocomplete
              ref={attendeeAutocompleteRef}
              attendees={attendees}
              onAdd={addAttendee}
              onRemove={removeAttendee}
              inputId="event-attendees"
              placeholder="Search contacts or type an email"
            />
            {attendees.length > 0 && (
              <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <IconUsers className="h-3 w-3" />
                {attendees.length} invited — Google will email them when you
                create
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event-location" className="text-xs">
              Location
            </Label>
            <Input
              id="event-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Optional location"
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event-video-provider" className="text-xs">
              Video
            </Label>
            <Select
              value={videoProvider}
              onValueChange={(value) =>
                setVideoProvider(value as VideoProvider)
              }
            >
              <SelectTrigger id="event-video-provider" className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No video</SelectItem>
                <SelectItem value="google_meet">
                  <span className="flex items-center gap-2">
                    <IconVideo className="h-3.5 w-3.5" />
                    Google Meet
                  </span>
                </SelectItem>
                <SelectItem value="zoom">
                  <span className="flex items-center gap-2">
                    <IconBrandZoom className="h-3.5 w-3.5" />
                    Zoom
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            {videoProvider === "zoom" && !zoomStatus.data?.connected && (
              <div className="rounded-md border border-border bg-muted/30 p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {zoomStatus.data?.configured === false
                      ? "Zoom OAuth is not configured."
                      : "Connect Zoom before creating this event."}
                  </p>
                  {zoomStatus.data?.configured !== false && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 gap-1.5 text-xs"
                      disabled={connectZoom.isPending}
                      onClick={() =>
                        connectZoom.mutate(undefined, {
                          onSuccess: () => toast("Zoom connection opened"),
                          onError: (error) =>
                            toast.error(
                              error instanceof Error
                                ? error.message
                                : "Could not connect Zoom",
                            ),
                        })
                      }
                    >
                      <IconBrandZoom className="h-3.5 w-3.5" />
                      Connect
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-1">
            <p className="text-[10px] text-muted-foreground/60">
              <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">
                ⌘↵
              </kbd>{" "}
              to save
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="h-7 text-xs"
                disabled={
                  createEvent.isPending ||
                  (videoProvider === "zoom" && !zoomStatus.data?.connected)
                }
              >
                {createEvent.isPending ? "Creating…" : "Create"}
              </Button>
            </div>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
