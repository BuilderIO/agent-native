import { IconX } from "@tabler/icons-react";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  operationDefaultBinding,
  type FieldBinding,
  type OperationField,
} from "@/lib/workflow-editor";

import type { PickerKind } from "../../workflow/pickers/picker-kinds";
import { ProviderOptionCombobox } from "../../workflow/pickers/ProviderOptionCombobox";
import {
  useWorkflowCanvasStrings,
  type WorkflowCanvasStrings,
} from "../strings";
import { offeredModes } from "./binding-modes";
import type { FormContext } from "./context";
import {
  Field,
  NumberInput,
  PathInput,
  SelectInput,
  TemplateInput,
} from "./fields";
import { useInvalidMark } from "./issue-marks";
import { useMapTarget } from "./map-target";

type Mode = FieldBinding["mode"];

function bindingForMode(
  s: WorkflowCanvasStrings,
  mode: Mode,
  field: OperationField,
  previous: FieldBinding | undefined,
): FieldBinding {
  if (mode === "fixed") return operationDefaultBinding(field);
  if (mode === "path") return { mode: "path", path: "item.title" };
  // The schema refuses an empty instruction, so a new one starts with some text.
  const carried =
    previous?.mode === "fixed" && typeof previous.value === "string"
      ? previous.value
      : "";
  return {
    mode: "ai",
    instruction: carried || s.inspector.aiInstructionDefault,
  };
}

function JsonValueInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const s = useWorkflowCanvasStrings();

  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText((current) => {
      try {
        return JSON.stringify(JSON.parse(current)) === JSON.stringify(value)
          ? current
          : JSON.stringify(value ?? {}, null, 2);
      } catch {
        // coercion-ok: text mid-edit that is not JSON yet stays as typed
        return current;
      }
    });
  }, [value]);
  const mark = useInvalidMark(invalid);
  return (
    <div className="flex flex-col gap-1">
      <Textarea
        id={id}
        value={text}
        rows={4}
        aria-invalid={mark}
        onChange={(event) => {
          setText(event.target.value);
          try {
            onChange(JSON.parse(event.target.value));
            setInvalid(false);
          } catch {
            setInvalid(true);
          }
        }}
      />
      {mark && (
        <p role="alert" className="text-xs text-destructive">
          {s.inspector.jsonInvalid}
        </p>
      )}
    </div>
  );
}

/** A resource the connection can list, still a drop target for a path the way a typed template is. */
function PickerControl({
  id,
  kind,
  value,
  onChange,
}: {
  id: string;
  kind: PickerKind;
  value: string;
  onChange: (value: string) => void;
}) {
  const mapTarget = useMapTarget("template", value, onChange);
  return (
    <ProviderOptionCombobox
      id={id}
      kind={kind}
      value={value}
      onChange={onChange}
      mapTarget={mapTarget}
    />
  );
}

/**
 * A text field that is a dropdown while it holds a plain resource. Once its
 * value has held `{{ }}` it stays a text box: deleting a brace mid-edit must
 * not swap the box for a dropdown under the cursor.
 */
function ResourceControl({
  id,
  picker,
  text,
  context,
  onChange,
}: {
  id: string;
  picker?: PickerKind | undefined;
  text: string;
  context: FormContext;
  onChange: (value: string) => void;
}) {
  const [template, setTemplate] = useState(() => text.includes("{{"));
  if (!template && text.includes("{{")) setTemplate(true);
  if (picker && !template) {
    return (
      <PickerControl id={id} kind={picker} value={text} onChange={onChange} />
    );
  }
  return (
    <TemplateInput id={id} value={text} context={context} onChange={onChange} />
  );
}

function FixedControl({
  id,
  field,
  value,
  onChange,
  context,
  picker,
}: {
  id: string;
  field: OperationField;
  value: unknown;
  onChange: (value: unknown) => void;
  context: FormContext;
  picker?: PickerKind;
}) {
  switch (field.type) {
    case "boolean":
      return (
        <Switch
          id={id}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked)}
        />
      );
    case "number":
      return (
        <NumberInput
          id={id}
          value={typeof value === "number" ? value : undefined}
          onChange={(next) => onChange(next ?? 0)}
        />
      );
    case "enum":
      return (
        <SelectInput
          id={id}
          value={typeof value === "string" ? value : undefined}
          options={(field.enum ?? []).map((option) => ({
            value: option,
            label: option,
          }))}
          onChange={onChange}
        />
      );
    case "json":
      return <JsonValueInput id={id} value={value} onChange={onChange} />;
    case "text":
      return (
        <TemplateInput
          id={id}
          multiline
          value={typeof value === "string" ? value : ""}
          context={context}
          onChange={onChange}
        />
      );
    default:
      return (
        <ResourceControl
          id={id}
          picker={picker}
          text={typeof value === "string" ? value : ""}
          context={context}
          onChange={onChange}
        />
      );
  }
}

/** One operation field with its three ways of being filled: typed in, read from upstream, or written by AI. */
export function BindingField({
  field,
  binding,
  onChange,
  context,
  picker,
}: {
  field: OperationField;
  binding: FieldBinding | undefined;
  onChange: (next: FieldBinding | undefined) => void;
  context: FormContext;
  /** What a connection can list for this field, when it holds one of its resources. */
  picker?: PickerKind;
}) {
  const s = useWorkflowCanvasStrings();

  const id = useId();
  return (
    <Field
      htmlFor={id}
      label={
        <span className="flex w-full items-center justify-between gap-2">
          <span>
            {field.label ?? field.name}
            {field.required && (
              <span className="ms-1 text-muted-foreground/70">
                {s.inspector.required}
              </span>
            )}
          </span>
          {binding && !field.required && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={s.inspector.clear}
              title={s.inspector.clear}
              onClick={() => onChange(undefined)}
            >
              <IconX />
            </Button>
          )}
        </span>
      }
    >
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        value={binding?.mode ?? ""}
        onValueChange={(mode) => {
          if (mode) onChange(bindingForMode(s, mode as Mode, field, binding));
        }}
        className="justify-start"
        aria-label={field.label ?? field.name}
      >
        {offeredModes(field, binding).map((mode) => (
          <ToggleGroupItem key={mode} value={mode}>
            {s.inspector.mode[mode]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {binding === undefined && (
        <p className="text-xs text-muted-foreground">{s.inspector.notSet}</p>
      )}
      {binding?.mode === "fixed" && (
        <FixedControl
          id={id}
          field={field}
          value={binding.value}
          context={context}
          picker={picker}
          onChange={(value) => onChange({ mode: "fixed", value })}
        />
      )}
      {binding?.mode === "path" && (
        <PathInput
          id={id}
          value={binding.path}
          context={context}
          onChange={(path) => onChange({ mode: "path", path })}
        />
      )}
      {binding?.mode === "ai" && (
        <Textarea
          id={id}
          value={binding.instruction}
          rows={3}
          aria-label={s.inspector.aiInstructionLabel}
          className="min-h-16"
          onChange={(event) =>
            onChange({ mode: "ai", instruction: event.target.value })
          }
        />
      )}
    </Field>
  );
}
