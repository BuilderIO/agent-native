/**
 * CustomFieldsEditor — add, remove, reorder, and configure custom form
 * fields shown on a booking page.
 *
 * The shape matches the calendar template's `CustomField`. The scheduling
 * template's event types also have `customFields` — both can use this
 * directly.
 *
 * All edits flow through `onChange` synchronously so the caller can
 * update the UI (and persist) optimistically.
 *
 * Shadcn primitives expected in the consumer: button, input, label,
 * textarea, switch. Icons from `@tabler/icons-react`.
 */
import { useState } from "react";
import { nanoid } from "nanoid";
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconGripVertical,
  IconListCheck,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

export type CustomFieldType =
  | "text"
  | "email"
  | "url"
  | "tel"
  | "textarea"
  | "select"
  | "checkbox";

export interface CustomField {
  id: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  placeholder?: string;
  pattern?: string;
  patternError?: string;
  options?: string[];
}

export interface CustomFieldsEditorProps {
  fields: CustomField[];
  onChange: (fields: CustomField[]) => void;
  /** Hide the outer label + add button (e.g. if rendered inside its own card). */
  hideLabel?: boolean;
}

const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Short text",
  email: "Email",
  url: "URL",
  tel: "Phone",
  textarea: "Long text",
  select: "Dropdown",
  checkbox: "Checkbox",
};

const PRESETS: {
  label: string;
  type: CustomFieldType;
  placeholder?: string;
  pattern?: string;
  patternError?: string;
}[] = [
  {
    label: "LinkedIn Profile",
    type: "url",
    placeholder: "https://linkedin.com/in/yourname",
    pattern: "^https?://(www\\.)?linkedin\\.com/in/.+",
    patternError: "Please enter a valid LinkedIn profile URL",
  },
  { label: "Company", type: "text", placeholder: "Your company name" },
  { label: "Phone Number", type: "tel", placeholder: "+1 (555) 123-4567" },
  { label: "Website", type: "url", placeholder: "https://example.com" },
];

function cls(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function CustomFieldsEditor(props: CustomFieldsEditorProps) {
  const { fields, onChange, hideLabel } = props;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showPresets, setShowPresets] = useState(false);

  function addField(
    partial?: Partial<CustomField> & { label: string; type: CustomFieldType },
  ) {
    const field: CustomField = {
      id: nanoid(8),
      label: partial?.label || "New Field",
      type: partial?.type || "text",
      required: partial?.required ?? true,
      placeholder: partial?.placeholder,
      pattern: partial?.pattern,
      patternError: partial?.patternError,
      options: partial?.options,
    };
    onChange([...fields, field]);
    setEditingId(field.id);
    setShowPresets(false);
  }

  function updateField(id: string, updates: Partial<CustomField>) {
    onChange(fields.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  }

  function removeField(id: string) {
    onChange(fields.filter((f) => f.id !== id));
    if (editingId === id) setEditingId(null);
  }

  function moveField(id: string, dir: -1 | 1) {
    const idx = fields.findIndex((f) => f.id === id);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {!hideLabel && (
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-1.5">
            <IconListCheck className="h-4 w-4" />
            Custom fields
          </Label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowPresets((p) => !p)}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            >
              <IconChevronDown
                className={cls(
                  "h-3 w-3 transition-transform",
                  showPresets && "rotate-180",
                )}
              />
              Presets
            </button>
            <button
              type="button"
              onClick={() => addField()}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            >
              <IconPlus className="h-3 w-3" />
              Add
            </button>
          </div>
        </div>
      )}

      {showPresets && (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => addField(preset)}
              className="rounded-lg border border-border/60 px-3 py-2 text-left text-xs hover:border-primary/30 hover:bg-accent/60"
            >
              <p className="font-medium">{preset.label}</p>
              <p className="text-muted-foreground">
                {TYPE_LABELS[preset.type]}
              </p>
            </button>
          ))}
        </div>
      )}

      {fields.length === 0 && !showPresets && (
        <p className="text-xs text-muted-foreground">
          Add custom fields to collect information from bookers — e.g. LinkedIn
          profile, company name, phone number.
        </p>
      )}

      <div className="space-y-2">
        {fields.map((field) => {
          const isEditing = editingId === field.id;
          return (
            <div
              key={field.id}
              className="overflow-hidden rounded-lg border border-border"
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => setEditingId(isEditing ? null : field.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setEditingId(isEditing ? null : field.id);
                  }
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-accent/40"
              >
                <IconGripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {field.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {TYPE_LABELS[field.type]}
                    {field.required ? " · Required" : " · Optional"}
                    {field.pattern ? " · Pattern" : ""}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      moveField(field.id, -1);
                    }}
                    className="p-0.5 text-muted-foreground/40 hover:text-foreground"
                    title="Move up"
                  >
                    <IconChevronLeft className="h-3 w-3 rotate-90" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      moveField(field.id, 1);
                    }}
                    className="p-0.5 text-muted-foreground/40 hover:text-foreground"
                    title="Move down"
                  >
                    <IconChevronRight className="h-3 w-3 rotate-90" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeField(field.id);
                    }}
                    className="p-0.5 text-muted-foreground/40 hover:text-destructive"
                    title="Remove field"
                  >
                    <IconTrash className="h-3 w-3" />
                  </button>
                </div>
              </div>

              {isEditing && (
                <div className="space-y-3 border-t border-border bg-muted/20 px-3 py-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Label</Label>
                      <Input
                        value={field.label}
                        onChange={(e) =>
                          updateField(field.id, { label: e.target.value })
                        }
                        placeholder="Field label"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Type</Label>
                      <select
                        value={field.type}
                        onChange={(e) =>
                          updateField(field.id, {
                            type: e.target.value as CustomFieldType,
                          })
                        }
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                      >
                        {(
                          Object.entries(TYPE_LABELS) as [
                            CustomFieldType,
                            string,
                          ][]
                        ).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Placeholder</Label>
                    <Input
                      value={field.placeholder || ""}
                      onChange={(e) =>
                        updateField(field.id, {
                          placeholder: e.target.value || undefined,
                        })
                      }
                      placeholder="Placeholder text"
                      className="h-8 text-sm"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Required</Label>
                    <Switch
                      checked={field.required}
                      onCheckedChange={(checked) =>
                        updateField(field.id, { required: checked })
                      }
                    />
                  </div>

                  {field.type === "select" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        Options{" "}
                        <span className="font-normal text-muted-foreground">
                          (one per line)
                        </span>
                      </Label>
                      <Textarea
                        value={(field.options || []).join("\n")}
                        onChange={(e) => {
                          const options = e.target.value
                            .split("\n")
                            .filter((o) => o.trim());
                          updateField(field.id, { options });
                        }}
                        placeholder={"Option 1\nOption 2\nOption 3"}
                        rows={3}
                        className="text-sm"
                      />
                    </div>
                  )}

                  {field.type !== "checkbox" && field.type !== "select" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        Validation pattern{" "}
                        <span className="font-normal text-muted-foreground">
                          (regex, optional)
                        </span>
                      </Label>
                      <Input
                        value={field.pattern || ""}
                        onChange={(e) =>
                          updateField(field.id, {
                            pattern: e.target.value || undefined,
                          })
                        }
                        placeholder="e.g. ^https?://(www\.)?linkedin\.com/in/.+"
                        className="h-8 font-mono text-sm"
                      />
                      {field.pattern && (
                        <div className="space-y-1.5">
                          <Label className="text-xs">
                            Error message{" "}
                            <span className="font-normal text-muted-foreground">
                              (shown when pattern doesn't match)
                            </span>
                          </Label>
                          <Input
                            value={field.patternError || ""}
                            onChange={(e) =>
                              updateField(field.id, {
                                patternError: e.target.value || undefined,
                              })
                            }
                            placeholder="e.g. Please enter a valid LinkedIn URL"
                            className="h-8 text-sm"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hideLabel && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowPresets((p) => !p)}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          >
            <IconChevronDown
              className={cls(
                "h-3 w-3 transition-transform",
                showPresets && "rotate-180",
              )}
            />
            Presets
          </button>
          <button
            type="button"
            onClick={() => addField()}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          >
            <IconPlus className="h-3 w-3" />
            Add field
          </button>
        </div>
      )}
    </div>
  );
}
