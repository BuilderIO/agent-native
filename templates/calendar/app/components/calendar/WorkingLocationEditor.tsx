import { useT } from "@agent-native/core/client/i18n";
import type { CalendarEvent } from "@shared/api";
import { IconBuilding, IconHome, IconMapPin } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import {
  createWorkingLocationDisplayLabels,
  getWorkingLocationDetail,
  getWorkingLocationEditableLabel,
  getWorkingLocationLabel,
  getWorkingLocationType,
  type WorkingLocationKind,
  type WorkingLocationSelection,
} from "@/lib/working-location";

interface WorkingLocationEditorProps {
  event: CalendarEvent;
  isRecurring: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  onSave: (selection: WorkingLocationSelection) => void;
}

type LabeledWorkingLocation = Exclude<WorkingLocationKind, "homeOffice">;

function initialLabels(event: CalendarEvent) {
  const type = getWorkingLocationType(event);
  const editableLabel = getWorkingLocationEditableLabel(event);
  return {
    officeLocation: type === "officeLocation" ? editableLabel : "",
    customLocation: type === "customLocation" ? editableLabel : "",
  } satisfies Record<LabeledWorkingLocation, string>;
}

export function WorkingLocationEditor({
  event,
  isRecurring,
  readOnly = false,
  disabled = false,
  onSave,
}: WorkingLocationEditorProps) {
  const t = useT();
  const workingLocationLabels = createWorkingLocationDisplayLabels(t);
  const currentType = getWorkingLocationType(event);
  const currentLabel = getWorkingLocationEditableLabel(event);
  const [type, setType] = useState<WorkingLocationKind>(currentType);
  const [labels, setLabels] = useState(() => initialLabels(event));
  const [scope, setScope] = useState<"single" | "all">("single");
  const detail = getWorkingLocationDetail(event, workingLocationLabels);

  useEffect(() => {
    setType(getWorkingLocationType(event));
    setLabels(initialLabels(event));
    setScope("single");
  }, [currentLabel, currentType, event.id]);

  const label = type === "homeOffice" ? "" : labels[type];
  const isValid = type === "homeOffice" || label.trim().length > 0;
  const isDirty = useMemo(
    () => type !== currentType || label.trim() !== currentLabel.trim(),
    [currentLabel, currentType, label, type],
  );

  if (readOnly) {
    return (
      <div className="flex items-start gap-3 py-1.5">
        <IconMapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="truncate text-sm text-foreground">
            {getWorkingLocationLabel(event, workingLocationLabels)}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {detail || t("eventForm.workingLocation")}
          </div>
        </div>
      </div>
    );
  }

  const options: Array<{
    value: WorkingLocationKind;
    label: string;
    icon: typeof IconHome;
  }> = [
    { value: "homeOffice", label: t("eventForm.home"), icon: IconHome },
    {
      value: "officeLocation",
      label: t("eventForm.office"),
      icon: IconBuilding,
    },
    {
      value: "customLocation",
      label: t("eventForm.other"),
      icon: IconMapPin,
    },
  ];

  return (
    <div className="py-1.5" data-working-location-editor>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
        <IconMapPin className="size-4 text-muted-foreground" />
        {t("eventForm.workingLocation")}
      </div>
      <RadioGroup
        value={type}
        onValueChange={(value) => setType(value as WorkingLocationKind)}
        className="grid grid-cols-3 gap-1.5"
        aria-label={t("eventForm.workingLocation")}
        disabled={disabled}
      >
        {options.map((option) => {
          const Icon = option.icon;
          const id = `working-location-${event.id}-${option.value}`;
          return (
            <div key={option.value} className="relative">
              <RadioGroupItem
                id={id}
                value={option.value}
                className="peer sr-only"
              />
              <Label
                htmlFor={id}
                className={cn(
                  "flex h-8 cursor-pointer items-center justify-center gap-1 rounded-md border border-border px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground peer-data-[state=checked]:border-foreground/40 peer-data-[state=checked]:bg-muted peer-data-[state=checked]:text-foreground",
                  "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
                  disabled && "cursor-not-allowed opacity-50",
                )}
              >
                <Icon className="size-3.5" />
                <span className="truncate">{option.label}</span>
              </Label>
            </div>
          );
        })}
      </RadioGroup>

      {type !== "homeOffice" && (
        <div className="mt-2">
          <Input
            value={labels[type]}
            onChange={(event) =>
              setLabels((current) => ({
                ...current,
                [type]: event.target.value,
              }))
            }
            aria-label={
              type === "officeLocation"
                ? t("eventForm.office")
                : t("eventForm.other")
            }
            placeholder={t("eventForm.addLocation")}
            className="h-8 text-sm"
            disabled={disabled}
          />
          {type === "officeLocation" && detail && (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {detail}
            </p>
          )}
        </div>
      )}

      {isRecurring && (
        <div className="mt-2">
          <p className="mb-1 text-[10px] font-medium text-muted-foreground">
            {t("eventForm.applyTo")}
          </p>
          <RadioGroup
            value={scope}
            onValueChange={(value) => setScope(value as "single" | "all")}
            className="grid grid-cols-2 gap-1.5"
            aria-label={t("eventForm.applyTo")}
            disabled={disabled}
          >
            {(
              [
                ["single", t("eventForm.thisDayOnly")],
                ["all", t("eventForm.allDays")],
              ] as const
            ).map(([value, text]) => {
              const id = `working-location-scope-${event.id}-${value}`;
              return (
                <div key={value} className="relative">
                  <RadioGroupItem
                    id={id}
                    value={value}
                    className="peer sr-only"
                  />
                  <Label
                    htmlFor={id}
                    className="flex h-7 cursor-pointer items-center justify-center rounded-md border border-border px-2 text-center text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-data-[state=checked]:border-foreground/40 peer-data-[state=checked]:bg-muted peer-data-[state=checked]:text-foreground"
                  >
                    {text}
                  </Label>
                </div>
              );
            })}
          </RadioGroup>
        </div>
      )}

      <div className="mt-2 flex justify-end">
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={disabled || !isValid || !isDirty}
          onClick={() =>
            onSave({ type, label, scope: isRecurring ? scope : undefined })
          }
        >
          {t("eventForm.save")}
        </Button>
      </div>
    </div>
  );
}
