import { useState } from "react";
import { Turnstile } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface BookingFormProps {
  onSubmit: (data: {
    name: string;
    email: string;
    notes?: string;
    captchaToken?: string;
  }) => void;
  loading?: boolean;
}

export function BookingForm({ onSubmit, loading }: BookingFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | undefined>();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    onSubmit({
      name: name.trim(),
      email: email.trim(),
      notes: notes.trim() || undefined,
      captchaToken,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="booking-name">Name</Label>
        <Input
          id="booking-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="booking-email">Email</Label>
        <Input
          id="booking-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="booking-notes">Notes (optional)</Label>
        <Textarea
          id="booking-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything you'd like to share"
          rows={3}
        />
      </div>

      <Turnstile onVerify={setCaptchaToken} />

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Booking..." : "Confirm Booking"}
      </Button>
    </form>
  );
}
