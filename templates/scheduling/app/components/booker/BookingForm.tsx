/**
 * Attendee form — name, email, notes. Slot summary lives in the host column.
 */
import { useState } from "react";
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
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="name">Your name *</Label>
        <Input
          id="name"
          required
          placeholder="Full name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email address *</Label>
        <Input
          id="email"
          type="email"
          required
          placeholder="you@example.com"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.currentTarget.value })}
        />
      </div>
      {!props.eventType.disableGuests && (
        <div className="space-y-1.5">
          <Label htmlFor="notes">Additional notes</Label>
          <Textarea
            id="notes"
            rows={3}
            placeholder="Please share anything that will help prepare for our meeting."
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.currentTarget.value })}
          />
        </div>
      )}
      <Button type="submit" disabled={!canSubmit} className="w-full">
        Confirm
      </Button>
      <p className="text-center text-[11px] text-muted-foreground">
        By proceeding you agree to our Terms and Privacy Policy.
      </p>
    </form>
  );
}
