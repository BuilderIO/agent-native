import { useState, useEffect, useCallback } from "react";
import { format, parseISO } from "date-fns";
import {
  IconMapPin,
  IconClock,
  IconEdit,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  sanitizeHtml,
  stripGcalInviteHtml,
  isHtml,
} from "@/lib/sanitize-description";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useUpdateEvent, useDeleteEvent } from "@/hooks/use-events";
import { toast } from "sonner";
import type { CalendarEvent } from "@shared/api";

interface EventDialogProps {
  event: CalendarEvent | null;
  open: boolean;
  onClose: () => void;
}

function getEventColor(event: CalendarEvent) {
  if (event.color) return event.color;
  return event.source === "google" ? "#5085C0" : null;
}

export function EventDialog({ event, open, onClose }: EventDialogProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();

  useEffect(() => {
    if (event) {
      setTitle(event.title);
      setDescription(event.description);
      setLocation(event.location);
      setStartTime(event.start.slice(0, 16));
      setEndTime(event.end.slice(0, 16));
      setEditing(false);
    }
  }, [event]);

  // Keyboard shortcuts inside the dialog
  const isTyping = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    return (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    );
  }, []);

  useEffect(() => {
    if (!open || !event) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (!event) return;
      // Edit shortcut
      if (e.key === "e" && !editing && !isTyping(e)) {
        e.preventDefault();
        if (!isGoogle) setEditing(true);
        return;
      }
      // Delete shortcut
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        !editing &&
        !isTyping(e)
      ) {
        e.preventDefault();
        if (!isGoogle) handleDelete();
        return;
      }
      // Save with Cmd/Ctrl+Enter when editing
      if (editing && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSave();
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, event, editing, isTyping]);

  if (!event) return null;

  const isGoogle = event.source === "google";
  const color = getEventColor(event);

  function handleSave() {
    if (!event) return;
    updateEvent.mutate(
      {
        id: event.id,
        title,
        description,
        location,
        start: new Date(startTime).toISOString(),
        end: new Date(endTime).toISOString(),
      },
      {
        onSuccess: () => {
          toast.success("Event updated");
          setEditing(false);
          onClose();
        },
        onError: () => toast.error("Failed to update event"),
      },
    );
  }

  function handleDelete() {
    if (!event) return;
    deleteEvent.mutate(event.id, {
      onSuccess: () => {
        toast.success("Event deleted");
        onClose();
      },
      onError: () => toast.error("Failed to delete event"),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        {/* Color accent strip */}
        {color && (
          <div
            className="absolute top-0 left-0 right-0 h-1 rounded-t-lg"
            style={{ backgroundColor: color }}
          />
        )}

        <DialogHeader className="pt-1">
          <div className="flex items-start justify-between gap-2">
            {editing ? (
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="text-lg font-semibold"
                autoFocus
              />
            ) : (
              <DialogTitle className="text-lg leading-tight pr-8">
                {event.title}
              </DialogTitle>
            )}
          </div>
        </DialogHeader>

        {editing ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a description…"
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Start</Label>
                <Input
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>End</Label>
                <Input
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Add a location…"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Press{" "}
              <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">
                ⌘↵
              </kbd>{" "}
              to save
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Time */}
            <div className="flex items-start gap-2.5 text-sm text-muted-foreground">
              <IconClock className="mt-0.5 h-4 w-4 shrink-0" />
              {event.allDay ? (
                <span>
                  All day · {format(parseISO(event.start), "MMMM d, yyyy")}
                </span>
              ) : (
                <span>
                  {format(parseISO(event.start), "EEEE, MMMM d, yyyy")}
                  <br />
                  {format(parseISO(event.start), "h:mm a")} –{" "}
                  {format(parseISO(event.end), "h:mm a")}
                </span>
              )}
            </div>

            {/* Location */}
            {event.location && (
              <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <IconMapPin className="h-4 w-4 shrink-0" />
                <span>{event.location}</span>
              </div>
            )}

            {/* Description */}
            {event.description &&
              (() => {
                if (isHtml(event.description)) {
                  const cleanedHtml = stripGcalInviteHtml(
                    sanitizeHtml(event.description),
                  );
                  if (!cleanedHtml.replace(/<[^>]*>/g, "").trim()) return null;
                  return (
                    <div
                      className="rounded-md bg-muted/50 px-3 py-2.5 text-sm leading-relaxed text-foreground prose prose-sm dark:prose-invert prose-p:my-1 prose-a:text-primary"
                      dangerouslySetInnerHTML={{ __html: cleanedHtml }}
                    />
                  );
                }
                return (
                  <p className="rounded-md bg-muted/50 px-3 py-2.5 text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                    {event.description}
                  </p>
                );
              })()}

            {/* Keyboard hint */}
            {!isGoogle && (
              <p className="text-xs text-muted-foreground/60">
                Press{" "}
                <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">
                  E
                </kbd>{" "}
                to edit ·{" "}
                <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">
                  Del
                </kbd>{" "}
                to delete
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {editing ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={updateEvent.isPending}
              >
                {updateEvent.isPending ? "Saving…" : "Save changes"}
              </Button>
            </>
          ) : (
            <>
              {!isGoogle && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={handleDelete}
                  disabled={deleteEvent.isPending}
                >
                  <IconTrash className="mr-1.5 h-3.5 w-3.5" />
                  Delete
                </Button>
              )}
              <div className="flex-1" />
              {!isGoogle && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(true)}
                >
                  <IconEdit className="mr-1.5 h-3.5 w-3.5" />
                  Edit
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onClose}>
                <IconX className="mr-1.5 h-3.5 w-3.5" />
                Close
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
