import { useSearchParams } from "react-router";
import { useForm } from "@/hooks/use-forms";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isInAgentEmbed, postNavigate } from "@agent-native/core/client";
import {
  IconAlertCircle,
  IconExternalLink,
  IconTextSize,
  IconAt,
  IconNumber123,
  IconAlignLeft,
  IconChevronDown,
  IconCheckbox,
  IconCircleDot,
  IconCalendar,
  IconStar,
  IconSlideshow,
  IconList,
} from "@tabler/icons-react";
import type { FormFieldType } from "@shared/types";

const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  text: "Text",
  email: "Email",
  number: "Number",
  textarea: "Long Text",
  select: "Dropdown",
  multiselect: "Multi-select",
  checkbox: "Checkbox",
  radio: "Radio",
  date: "Date",
  rating: "Rating",
  scale: "Scale",
};

const FIELD_TYPE_ICONS: Record<FormFieldType, React.ElementType> = {
  text: IconTextSize,
  email: IconAt,
  number: IconNumber123,
  textarea: IconAlignLeft,
  select: IconChevronDown,
  multiselect: IconList,
  checkbox: IconCheckbox,
  radio: IconCircleDot,
  date: IconCalendar,
  rating: IconStar,
  scale: IconSlideshow,
};

export default function FormPreviewRoute() {
  const [searchParams] = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const { data: form, isLoading, error } = useForm(id);

  if (!id) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <IconAlertCircle className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Missing form id</p>
          <p className="text-xs text-muted-foreground">
            Add{" "}
            <code className="font-mono bg-muted px-1 rounded">
              ?id=&lt;form-id&gt;
            </code>{" "}
            to the URL.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-lg mx-auto space-y-5">
          <div className="space-y-2">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
          </div>
          <div className="space-y-3 pt-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-md" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !form) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <IconAlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">Form not found</p>
          <p className="text-xs text-muted-foreground">
            The form with id{" "}
            <code className="font-mono bg-muted px-1 rounded">{id}</code> does
            not exist or you don&apos;t have access.
          </p>
        </div>
      </div>
    );
  }

  const fields = form.fields ?? [];
  const inEmbed = isInAgentEmbed();

  return (
    <div className="min-h-screen bg-background p-5">
      <div className="max-w-lg mx-auto space-y-5">
        {/* Header */}
        <div className="space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-base font-semibold leading-snug">
              {form.title}
            </h1>
            <div className="flex items-center gap-2 shrink-0">
              <Badge
                variant={
                  form.status === "published"
                    ? "default"
                    : form.status === "closed"
                      ? "destructive"
                      : "secondary"
                }
                className="text-xs"
              >
                {form.status}
              </Badge>
              {inEmbed && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => postNavigate(`/forms/${form.id}`)}
                >
                  <IconExternalLink className="h-3.5 w-3.5" />
                  Open in app
                </Button>
              )}
            </div>
          </div>
          {form.description && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {form.description}
            </p>
          )}
        </div>

        {/* Field list */}
        {fields.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            This form has no fields yet.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {fields.length} {fields.length === 1 ? "field" : "fields"}
            </p>
            <div className="divide-y divide-border rounded-md border bg-card">
              {fields.map((field) => {
                const Icon =
                  FIELD_TYPE_ICONS[field.type as FormFieldType] ?? IconTextSize;
                const typeLabel =
                  FIELD_TYPE_LABELS[field.type as FormFieldType] ?? field.type;
                return (
                  <div
                    key={field.id}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">
                          {field.label}
                        </span>
                        {field.required && (
                          <span className="text-destructive text-xs leading-none">
                            *
                          </span>
                        )}
                      </div>
                      {field.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {field.description}
                        </p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {typeLabel}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer meta */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
          {form.responseCount !== undefined && (
            <span>{form.responseCount} responses</span>
          )}
          <span>Updated {new Date(form.updatedAt).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}
