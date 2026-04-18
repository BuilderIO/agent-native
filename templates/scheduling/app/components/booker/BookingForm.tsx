/**
 * Attendee form — name, email, notes, and any custom fields on the event type.
 */
import { useState } from "react";
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import type { EventType, Slot } from "@agent-native/scheduling/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export interface BookingFormProps {
  eventType: EventType;
  slot: Slot;
  timezone: string;
  onSubmit: (values: { name: string; email: string; notes: string }) => void;
}

export function BookingForm(props: BookingFormProps) {
  const [form, setForm] = useState({ name: "", email: "", notes: "" });
  const canSubmit = form.name.trim() && form.email.includes("@");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        props.onSubmit(form);
      }}
      className="mx-auto max-w-md space-y-4"
    >
      <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
        <div className="font-medium">{props.eventType.title}</div>
        <div className="text-muted-foreground">
          {format(
            new TZDate(new Date(props.slot.start).getTime(), props.timezone),
            "EEEE, MMMM d · h:mm a",
          )}{" "}
          ({props.timezone})
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.currentTarget.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="notes">Additional notes</Label>
        <Textarea
          id="notes"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.currentTarget.value })}
        />
      </div>
      <Button type="submit" disabled={!canSubmit} className="w-full">
        Confirm booking
      </Button>
    </form>
  );
}
