import { IconCheck, IconPlus, IconTrash } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { GOOGLE_EVENT_COLOR_OPTIONS } from "@/lib/event-colors";
import {
  createAttachmentDraft,
  createReminderDraft,
  formatReminderText,
  MAX_EVENT_ATTACHMENTS,
  REMINDER_PRESETS,
  type AttachmentDraft,
  type ReminderDraft,
  type ReminderMode,
} from "@/lib/event-form-utils";

export function ReminderControls({
  mode,
  reminders,
  onModeChange,
  onRemindersChange,
  idPrefix,
}: {
  mode: ReminderMode;
  reminders: ReminderDraft[];
  onModeChange: (mode: ReminderMode) => void;
  onRemindersChange: (reminders: ReminderDraft[]) => void;
  idPrefix: string;
}) {
  const activeReminders =
    reminders.length > 0 ? reminders : [createReminderDraft()];

  return (
    <div className="space-y-2">
      <Select value={mode} onValueChange={(value) => onModeChange(value as ReminderMode)}>
        <SelectTrigger id={`${idPrefix}-alerts`} className="h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Calendar default</SelectItem>
          <SelectItem value="none">No alerts</SelectItem>
          <SelectItem value="custom">Custom alerts</SelectItem>
        </SelectContent>
      </Select>

      {mode === "custom" && (
        <div className="space-y-2 rounded-md border border-border/60 p-2">
          {activeReminders.map((reminder, index) => (
            <div key={reminder.id} className="flex items-center gap-1.5">
              <Select
                value={reminder.method}
                onValueChange={(value) =>
                  onRemindersChange(
                    activeReminders.map((item) =>
                      item.id === reminder.id
                        ? { ...item, method: value as "popup" | "email" }
                        : item,
                    ),
                  )
                }
              >
                <SelectTrigger className="h-8 w-[84px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="popup">Popup</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={String(reminder.minutes)}
                onValueChange={(value) =>
                  onRemindersChange(
                    activeReminders.map((item) =>
                      item.id === reminder.id
                        ? { ...item, minutes: Number(value) }
                        : item,
                    ),
                  )
                }
              >
                <SelectTrigger className="h-8 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REMINDER_PRESETS.map((preset) => (
                    <SelectItem key={preset.value} value={String(preset.value)}>
                      {formatReminderText(preset.value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground"
                disabled={activeReminders.length === 1}
                onClick={() =>
                  onRemindersChange(
                    activeReminders.filter((item) => item.id !== reminder.id),
                  )
                }
                aria-label={`Remove alert ${index + 1}`}
              >
                <IconTrash className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-1.5 text-xs text-muted-foreground"
            disabled={activeReminders.length >= 5}
            onClick={() =>
              onRemindersChange([...activeReminders, createReminderDraft(60)])
            }
          >
            <IconPlus className="mr-1 h-3.5 w-3.5" />
            Add alert
          </Button>
        </div>
      )}
    </div>
  );
}

export function AttachmentControls({
  attachments,
  onChange,
  idPrefix,
}: {
  attachments: AttachmentDraft[];
  onChange: (attachments: AttachmentDraft[]) => void;
  idPrefix: string;
}) {
  const activeAttachments =
    attachments.length > 0 ? attachments : [createAttachmentDraft()];

  function updateAttachment(id: string, patch: Partial<AttachmentDraft>) {
    onChange(
      activeAttachments.map((attachment) =>
        attachment.id === id ? { ...attachment, ...patch } : attachment,
      ),
    );
  }

  return (
    <div className="space-y-2">
      {activeAttachments.map((attachment, index) => (
        <div key={attachment.id} className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Input
              id={`${idPrefix}-attachment-title-${index}`}
              value={attachment.title}
              onChange={(event) =>
                updateAttachment(attachment.id, { title: event.target.value })
              }
              placeholder="Attachment title"
              className="h-8 text-sm"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground"
              onClick={() =>
                onChange(
                  activeAttachments.filter(
                    (item) => item.id !== attachment.id,
                  ),
                )
              }
              aria-label={`Remove attachment ${index + 1}`}
            >
              <IconTrash className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Input
            id={`${idPrefix}-attachment-url-${index}`}
            value={attachment.fileUrl}
            onChange={(event) =>
              updateAttachment(attachment.id, { fileUrl: event.target.value })
            }
            placeholder="https://drive.google.com/..."
            className="h-8 text-sm"
          />
        </div>
      ))}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-1.5 text-xs text-muted-foreground"
        disabled={activeAttachments.length >= MAX_EVENT_ATTACHMENTS}
        onClick={() => onChange([...activeAttachments, createAttachmentDraft()])}
      >
        <IconPlus className="mr-1 h-3.5 w-3.5" />
        Add attachment
      </Button>
    </div>
  );
}

export function EventColorSwatches({
  value,
  onChange,
  includeDefault = false,
}: {
  value?: string;
  onChange: (colorId: string | undefined) => void;
  includeDefault?: boolean;
}) {
  const options = includeDefault
    ? GOOGLE_EVENT_COLOR_OPTIONS
    : GOOGLE_EVENT_COLOR_OPTIONS.filter((option) => option.id !== "default");

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const selected = (value ?? "default") === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() =>
              onChange(option.id === "default" ? undefined : option.id)
            }
            className={cn(
              "relative flex h-5 w-5 items-center justify-center rounded-full border border-border",
              option.id === "default" && "bg-background",
            )}
            style={
              option.color ? { backgroundColor: option.color } : undefined
            }
            aria-label={`Set event color to ${option.label}`}
          >
            {selected && (
              <IconCheck
                className={cn(
                  "h-3 w-3",
                  option.id === "default"
                    ? "text-foreground"
                    : "text-white drop-shadow",
                )}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <Label htmlFor={htmlFor} className="text-xs">
      {children}
    </Label>
  );
}
