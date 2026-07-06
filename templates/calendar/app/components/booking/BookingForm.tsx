import { Turnstile, useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import { Checkbox } from "@agent-native/toolkit/ui/checkbox";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import type { CustomField } from "@shared/api";
import { useState } from "react";

export interface BookingFormValue {
  name: string;
  email: string;
  notes: string;
  fieldResponses: Record<string, string | boolean>;
}

interface BookingFormProps {
  onSubmit: (data: {
    name: string;
    email: string;
    notes?: string;
    captchaToken?: string;
    fieldResponses?: Record<string, string | boolean>;
  }) => void;
  value: BookingFormValue;
  onChange: (value: BookingFormValue) => void;
  loading?: boolean;
  customFields?: CustomField[];
}

export function BookingForm({
  onSubmit,
  value,
  onChange,
  loading,
  customFields = [],
}: BookingFormProps) {
  const t = useT();
  const [captchaToken, setCaptchaToken] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function updateValue(patch: Partial<BookingFormValue>) {
    onChange({ ...value, ...patch });
  }

  function setFieldValue(id: string, fieldValue: string | boolean) {
    updateValue({
      fieldResponses: { ...value.fieldResponses, [id]: fieldValue },
    });
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function validateFields(): boolean {
    const errors: Record<string, string> = {};
    for (const field of customFields) {
      const value = fieldResponses[field.id];
      if (field.required) {
        if (
          value === undefined ||
          value === null ||
          value === "" ||
          value === false
        ) {
          errors[field.id] = t("bookingLinks.fieldRequired", {
            label: field.label,
          });
          continue;
        }
      }
      if (field.pattern && typeof value === "string" && value) {
        try {
          const re = new RegExp(field.pattern);
          if (!re.test(value)) {
            errors[field.id] =
              field.patternError ||
              t("bookingLinks.fieldFormatError", { label: field.label });
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
      customFields.length > 0 ? { ...value.fieldResponses } : undefined;

    onSubmit({
      name: name.trim(),
      email: email.trim(),
      notes: notes.trim() || undefined,
      captchaToken,
      fieldResponses,
    });
  }

  const { name, email, notes, fieldResponses } = value;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="booking-name">{t("bookingLinks.name")}</Label>
        <Input
          id="booking-name"
          value={name}
          onChange={(e) => updateValue({ name: e.target.value })}
          placeholder={t("bookingLinks.yourName")}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="booking-email">{t("bookingLinks.email")}</Label>
        <Input
          id="booking-email"
          type="email"
          value={email}
          onChange={(e) => updateValue({ email: e.target.value })}
          placeholder="you@example.com"
          required
        />
      </div>

      {customFields.map((field) => (
        <CustomFieldInput
          key={field.id}
          field={field}
          value={fieldResponses[field.id]}
          error={fieldErrors[field.id]}
          onChange={(val) => setFieldValue(field.id, val)}
          optionalLabel={t("bookingLinks.optional")}
          selectPlaceholder={t("bookingLinks.selectPlaceholder")}
        />
      ))}

      <div className="space-y-2">
        <Label htmlFor="booking-notes">{t("bookingLinks.notesOptional")}</Label>
        <Textarea
          id="booking-notes"
          value={notes}
          onChange={(e) => updateValue({ notes: e.target.value })}
          placeholder={t("bookingLinks.notesPlaceholder")}
          rows={3}
        />
      </div>

      <Turnstile onVerify={setCaptchaToken} />

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? t("bookingLinks.booking") : t("bookingLinks.confirmBooking")}
      </Button>
    </form>
  );
}

function CustomFieldInput({
  field,
  value,
  error,
  optionalLabel,
  selectPlaceholder,
  onChange,
}: {
  field: CustomField;
  value: string | boolean | undefined;
  error?: string;
  optionalLabel: string;
  selectPlaceholder: string;
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
              {optionalLabel}
            </span>
          )}
        </Label>
        <Select value={strValue} onValueChange={(val) => onChange(val)}>
          <SelectTrigger id={id}>
            <SelectValue placeholder={field.placeholder || selectPlaceholder} />
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
              {optionalLabel}
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
          <span className="text-muted-foreground font-normal">
            {" "}
            {optionalLabel}
          </span>
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
