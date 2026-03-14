import { useState, useEffect } from "react";
import { format, parseISO } from "date-fns";
import { MapPin, Clock, Trash2 } from "lucide-react";
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
      setStartTime(event.start.slice(0, 16)); // yyyy-MM-ddTHH:mm
      setEndTime(event.end.slice(0, 16));
      setEditing(false);
    }
  }, [event]);

  if (!event) return null;

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

  const isGoogle = event.source === "google";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="dark sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Event" : event.title}</DialogTitle>
        </DialogHeader>

        {editing ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
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
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {event.description && (
              <p className="text-sm text-muted-foreground">
                {event.description}
              </p>
            )}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              {event.allDay ? (
                <span>
                  All day - {format(parseISO(event.start), "MMMM d, yyyy")}
                </span>
              ) : (
                <span>
                  {format(parseISO(event.start), "MMM d, yyyy h:mm a")} -{" "}
                  {format(parseISO(event.end), "h:mm a")}
                </span>
              )}
            </div>
            {event.location && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <span>{event.location}</span>
              </div>
            )}
            {isGoogle && (
              <div className="rounded-md bg-green-500/10 px-3 py-2 text-xs text-green-400">
                Synced from Google Calendar
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {editing ? (
            <>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={updateEvent.isPending}>
                {updateEvent.isPending ? "Saving..." : "Save"}
              </Button>
            </>
          ) : (
            <>
              {!isGoogle && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                  disabled={deleteEvent.isPending}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Delete
                </Button>
              )}
              {!isGoogle && (
                <Button onClick={() => setEditing(true)}>Edit</Button>
              )}
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
