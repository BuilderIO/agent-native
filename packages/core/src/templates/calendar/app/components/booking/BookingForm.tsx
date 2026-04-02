import { useState } from "react";
import { Turnstile } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CustomField } from "@shared/api";

interface BookingFormProps {
  onSubmit: (data: {
    name: string;
    email: string;
    notes?: string;
    captchaToken?: string;
    fieldResponses?: Record<string, string | boolean>;
  }) => void;
  loading?: boolean;
  customFields?: CustomField[];
}

export function BookingForm({
  onSubmit,
  loading,
  customFields = [],
}: BookingFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | undefined>();
  const [fieldValues, setFieldValues] = useState<
    Record<string, string | boolean>
  >({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function setFieldValue(id: string, value: string | boolean) {
    setFieldValues((prev) => ({ ...prev, [id]: value }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function validateFields(): boolean {
    const errors: Record<string, string> = {};
    for (const field of customFields) {
      const value = fieldValues[field.id];
      if (field.required) {
        if (
          value === undefined ||
          value === null ||
          value === "" ||
          value === false
        ) {
          errors[field.id] = `${field.label} is required`;
          continue;
        }
      }
      if (field.pattern && typeof value === "string" && value) {
        try {
          const re = new RegExp(field.pattern);
          if (!re.test(value)) {
            errors[field.id] =
              field.patternError ||
              `${field.label} does not match the expected format`;
          }
        } catch {}
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    if (!validateFields()) return;

    const fieldResponses =
      customFields.length > 0 ? { ...fieldValues } : undefined;

    onSubmit({
      name: name.trim(),
      email: email.trim(),
      notes: notes.trim() || undefined,
      captchaToken,
      fieldResponses,
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

      {customFields.map((field) => (
        <CustomFieldInput
          key={field.id}
          field={field}
          value={fieldValues[field.id]}
          error={fieldErrors[field.id]}
          onChange={(val) => setFieldValue(field.id, val)}
        />
      ))}

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

function CustomFieldInput({
  field,
  value,
  error,
  onChange,
}: {
  field: CustomField;
  value: string | boolean | undefined;
  error?: string;
  onChange: (value: string | boolean) => void;
}) {
  const id = `custom-field-${field.id}`;
  const strValue = typeof value === "string" ? value : "";
  const boolValue = typeof value === "boolean" ? value : false;

  if (field.type === "checkbox") {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Checkbox
            id={id}
            checked={boolValue}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
          <Label htmlFor={id} className="text-sm font-normal">
            {field.label}
            {field.required && (
              <span className="text-destructive ml-0.5">*</span>
            )}
          </Label>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  if (field.type === "select" && field.options) {
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>
          {field.label}
          {!field.required && (
            <span className="text-muted-foreground font-normal">
              {" "}
              (optional)
            </span>
          )}
        </Label>
        <Select value={strValue} onValueChange={(val) => onChange(val)}>
          <SelectTrigger id={id}>
            <SelectValue placeholder={field.placeholder || "Select..."} />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>
          {field.label}
          {!field.required && (
            <span className="text-muted-foreground font-normal">
              {" "}
              (optional)
            </span>
          )}
        </Label>
        <Textarea
          id={id}
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={3}
          required={field.required}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {field.label}
        {!field.required && (
          <span className="text-muted-foreground font-normal"> (optional)</span>
        )}
      </Label>
      <Input
        id={id}
        type={
          field.type === "url"
            ? "url"
            : field.type === "tel"
              ? "tel"
              : field.type === "email"
                ? "email"
                : "text"
        }
        value={strValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        required={field.required}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
