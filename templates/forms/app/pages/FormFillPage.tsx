import { useState, useMemo } from "react";
import { useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { FieldRenderer } from "@/components/builder/FieldRenderer";
import { Turnstile, PoweredByBadge } from "@agent-native/core/client";
import { ThemeToggle } from "@/components/ThemeToggle";
import { usePublicForm, useSubmitForm } from "@/hooks/use-forms";
import { toast } from "sonner";
import { CheckCircle2, RefreshCw } from "lucide-react";
import type { FormField, FormSettings } from "@shared/types";

export function FormFillPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: form, isLoading, error } = usePublicForm(slug!);
  const submitForm = useSubmitForm();

  const [values, setValues] = useState<Record<string, unknown>>({});
  const [captchaToken, setCaptchaToken] = useState<string | undefined>();
  const [submitted, setSubmitted] = useState(false);

  const fields: FormField[] = form?.fields || [];
  const settings: FormSettings = form?.settings || {};

  // Evaluate conditional visibility
  const visibleFields = useMemo(() => {
    return fields.filter((field) => {
      if (!field.conditional) return true;
      const { fieldId, operator, value: condValue } = field.conditional;
      const fieldVal = String(values[fieldId] ?? "");
      switch (operator) {
        case "equals":
          return fieldVal === condValue;
        case "not_equals":
          return fieldVal !== condValue;
        case "contains":
          return fieldVal.includes(condValue);
        default:
          return true;
      }
    });
  }, [fields, values]);

  function handleChange(fieldId: string, value: unknown) {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  function validate(): string | null {
    for (const field of visibleFields) {
      if (field.required) {
        const val = values[field.id];
        if (val === undefined || val === null || val === "") {
          return `${field.label} is required`;
        }
      }
      if (field.validation) {
        const val = values[field.id];
        if (
          field.validation.min !== undefined &&
          Number(val) < field.validation.min
        ) {
          return (
            field.validation.message ||
            `${field.label} must be at least ${field.validation.min}`
          );
        }
        if (
          field.validation.max !== undefined &&
          Number(val) > field.validation.max
        ) {
          return (
            field.validation.message ||
            `${field.label} must be at most ${field.validation.max}`
          );
        }
        if (field.validation.pattern && typeof val === "string") {
          const regex = new RegExp(field.validation.pattern);
          if (!regex.test(val)) {
            return field.validation.message || `${field.label} is invalid`;
          }
        }
      }
    }
    return null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }

    submitForm.mutate(
      {
        formId: form.id,
        data: values,
        captchaToken,
      },
      {
        onSuccess: () => {
          setSubmitted(true);
          if (settings.redirectUrl) {
            window.location.href = settings.redirectUrl;
          }
        },
        onError: (err: any) => {
          toast.error(err?.error || "Failed to submit form");
        },
      },
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">
          Loading form...
        </div>
      </div>
    );
  }

  if (error || !form) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-2xl font-semibold mb-2">Form not found</h1>
          <p className="text-muted-foreground mb-4">
            This form may have been removed or is no longer accepting responses.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
            className="gap-2"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Try Again
          </Button>
        </div>
        <PoweredByBadge />
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600/10">
            <CheckCircle2 className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h1 className="text-2xl font-semibold mb-2">Response submitted</h1>
          <p className="text-muted-foreground">
            {settings.successMessage ||
              "Thank you! Your response has been recorded."}
          </p>
        </div>
        <PoweredByBadge />
      </div>
    );
  }

  const primaryColor = settings.primaryColor || "#334155";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 py-12 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-2xl">
        {/* Form header */}
        <div className="mb-8">
          <h1 className="text-3xl font-semibold">{form.title}</h1>
          {form.description && (
            <p className="mt-2 text-muted-foreground">{form.description}</p>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="space-y-6 rounded-xl border border-border bg-card p-6">
            {visibleFields.map((field) => (
              <FieldRenderer
                key={field.id}
                field={field}
                value={values[field.id]}
                onChange={(v) => handleChange(field.id, v)}
              />
            ))}

            {visibleFields.length === 0 && (
              <p className="text-center text-muted-foreground py-8">
                This form has no fields yet.
              </p>
            )}
          </div>

          <div className="mt-6">
            <Turnstile onVerify={setCaptchaToken} />
          </div>

          <Button
            type="submit"
            className="w-full mt-4"
            size="lg"
            disabled={submitForm.isPending}
            style={{ backgroundColor: primaryColor }}
          >
            {submitForm.isPending
              ? "Submitting..."
              : settings.submitText || "Submit"}
          </Button>
        </form>
      </div>

      <PoweredByBadge />
    </div>
  );
}
