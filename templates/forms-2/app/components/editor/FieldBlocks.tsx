import { useT } from "@agent-native/core/client/i18n";
import { newId, type Block } from "@shared/form-model";
import {
  IconCalculator,
  IconEyeOff,
  IconPlus,
  IconX,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Picker } from "./Picker";

const inputClass =
  "h-8 min-w-0 flex-1 rounded-md border-transparent bg-muted px-2 text-sm shadow-none";

type Patch = (patch: Record<string, unknown>) => void;

function RemoveButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t("forms.calc.removeField")}
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
      onClick={onClick}
    >
      <IconX className="size-3.5" />
    </button>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 self-start px-2 text-muted-foreground"
      onClick={onClick}
    >
      <IconPlus className="size-3.5" />
      {label}
    </Button>
  );
}

export function HiddenFieldsEditor({
  block,
  onPatch,
}: {
  block: Extract<Block, { type: "HIDDEN_FIELDS" }>;
  onPatch: Patch;
}) {
  const t = useT();
  const { fields } = block.payload;
  const change = (id: string, name: string) =>
    onPatch({
      fields: fields.map((field) =>
        field.id === id ? { ...field, name } : field,
      ),
    });
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border p-2.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <IconEyeOff className="size-3.5" />
        {t("forms.calc.hiddenTitle")}
      </span>
      {fields.map((field) => (
        <div key={field.id} className="flex items-center gap-1.5">
          <Input
            aria-label={t("forms.calc.queryParameter")}
            placeholder={t("forms.calc.queryParameter")}
            className={inputClass}
            value={field.name}
            onChange={(event) => change(field.id, event.target.value)}
          />
          {fields.length > 1 ? (
            <RemoveButton
              onClick={() =>
                onPatch({
                  fields: fields.filter((other) => other.id !== field.id),
                })
              }
            />
          ) : null}
        </div>
      ))}
      <AddButton
        label={t("forms.calc.addHidden")}
        onClick={() =>
          onPatch({ fields: [...fields, { id: newId(), name: "" }] })
        }
      />
    </div>
  );
}

export function CalculatedFieldsEditor({
  block,
  onPatch,
}: {
  block: Extract<Block, { type: "CALCULATED_FIELDS" }>;
  onPatch: Patch;
}) {
  const t = useT();
  const { fields } = block.payload;
  const change = (id: string, patch: Record<string, unknown>) =>
    onPatch({
      fields: fields.map((field) =>
        field.id === id ? { ...field, ...patch } : field,
      ),
    });
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border p-2.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <IconCalculator className="size-3.5" />
        {t("forms.calc.calculatedTitle")}
      </span>
      {fields.map((field) => (
        <div key={field.id} className="flex items-center gap-1.5">
          <Input
            aria-label={t("forms.calc.fieldName")}
            placeholder={t("forms.calc.fieldName")}
            className={inputClass}
            value={field.name}
            onChange={(event) => change(field.id, { name: event.target.value })}
          />
          <Picker
            value={field.type}
            placeholder={t("forms.calc.selectType")}
            options={[
              { value: "number", label: t("forms.calc.typeNumber") },
              { value: "text", label: t("forms.calc.typeText") },
            ]}
            onChange={(type) => change(field.id, { type })}
          />
          <Input
            aria-label={t("forms.calc.initialValue")}
            placeholder={t("forms.calc.initialValue")}
            className={inputClass}
            value={field.initialValue ?? ""}
            onChange={(event) =>
              change(field.id, { initialValue: event.target.value })
            }
          />
          {fields.length > 1 ? (
            <RemoveButton
              onClick={() =>
                onPatch({
                  fields: fields.filter((other) => other.id !== field.id),
                })
              }
            />
          ) : null}
        </div>
      ))}
      <AddButton
        label={t("forms.calc.addCalculated")}
        onClick={() =>
          onPatch({ fields: [...fields, { id: newId(), name: "" }] })
        }
      />
    </div>
  );
}
