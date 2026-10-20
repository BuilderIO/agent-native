import { IconPlus, IconX } from "@tabler/icons-react";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ResultField } from "@/lib/workflow-editor";

import { useWorkflowCanvasStrings } from "../../strings";
import {
  Field,
  ListInput,
  NumberInput,
  SelectInput,
  TextInput,
} from "../fields";
import type { FormProps } from "./types";
import { withOptional } from "./types";

type Settings = FormProps<"ai">["settings"];
type FieldType = ResultField["type"];
type Entry = [name: string, field: ResultField];

function toResult(entries: readonly Entry[]): Settings["result"] | undefined {
  const names = entries.map(([name]) => name);
  if (
    names.some((name) => name === "") ||
    new Set(names).size !== names.length
  ) {
    return undefined;
  }
  return Object.fromEntries(entries);
}

function fieldForType(
  type: FieldType,
  previous: ResultField,
  newFieldValue: string,
): ResultField {
  const { enum: _enum, ...rest } = previous;
  return type === "enum"
    ? { ...rest, type, enum: [newFieldValue] }
    : { ...rest, type };
}

/**
 * The answer fields keep their order and can be renamed freely, so the rows
 * live here as a list and only a list with distinct names is sent on.
 */
function ResultFields({
  result,
  onChange,
}: {
  result: Settings["result"];
  onChange: (result: Settings["result"]) => void;
}) {
  const s = useWorkflowCanvasStrings();
  const typeOptions = (Object.keys(s.inspector.ai.types) as FieldType[]).map(
    (value) => ({ value, label: s.inspector.ai.types[value] }),
  );

  const id = useId();
  const [entries, setEntries] = useState<Entry[]>(() => Object.entries(result));
  useEffect(() => {
    setEntries((current) =>
      JSON.stringify(toResult(current)) === JSON.stringify(result)
        ? current
        : Object.entries(result),
    );
  }, [result]);
  const commit = (next: Entry[]) => {
    setEntries(next);
    const sent = toResult(next);
    if (sent) onChange(sent);
  };
  const names = entries.map(([name]) => name);
  return (
    <div className="flex flex-col gap-3">
      {entries.map(([name, field], index) => {
        const clash =
          name === "" || names.indexOf(name) !== names.lastIndexOf(name);
        const set = (patch: Partial<ResultField>) =>
          commit(
            entries.map((entry, i) =>
              i === index ? [entry[0], { ...entry[1], ...patch }] : entry,
            ),
          );
        return (
          <div
            key={index}
            className="flex flex-col gap-2 rounded-md border border-border p-2"
          >
            <div className="flex items-start gap-1">
              <TextInput
                value={name}
                invalid={clash}
                placeholder={s.inspector.ai.fieldName}
                onChange={(next) =>
                  commit(
                    entries.map((entry, i) =>
                      i === index ? [next, entry[1]] : entry,
                    ),
                  )
                }
              />
              {entries.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={s.inspector.ai.removeField}
                  title={s.inspector.ai.removeField}
                  onClick={() => commit(entries.filter((_, i) => i !== index))}
                >
                  <IconX />
                </Button>
              )}
            </div>
            <SelectInput
              value={field.type}
              options={typeOptions}
              onChange={(type) =>
                commit(
                  entries.map((entry, i) =>
                    i === index
                      ? [
                          entry[0],
                          fieldForType(
                            type,
                            entry[1],
                            s.inspector.ai.newFieldValue,
                          ),
                        ]
                      : entry,
                  ),
                )
              }
            />
            {field.type === "enum" && (
              <Field
                label={s.inspector.ai.values}
                htmlFor={`${id}-${index}-values`}
              >
                <ListInput
                  id={`${id}-${index}-values`}
                  value={field.enum}
                  onChange={(values) =>
                    commit(
                      entries.map((entry, i) =>
                        i === index
                          ? [entry[0], withOptional(entry[1], "enum", values)]
                          : entry,
                      ),
                    )
                  }
                />
              </Field>
            )}
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={`${id}-${index}-optional`} className="text-sm">
                {s.inspector.ai.optional}
              </label>
              <Switch
                id={`${id}-${index}-optional`}
                checked={field.optional === true}
                onCheckedChange={(optional) =>
                  set({ optional: optional ? true : undefined })
                }
              />
            </div>
          </div>
        );
      })}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="justify-start"
        disabled={entries.length >= 30}
        onClick={() => {
          let n = entries.length + 1;
          while (names.includes(`field${n}`)) n += 1;
          commit([...entries, [`field${n}`, { type: "string" }]]);
        }}
      >
        <IconPlus />
        {s.inspector.ai.addField}
      </Button>
    </div>
  );
}

export function AiForm({ settings, onChange }: FormProps<"ai">) {
  const s = useWorkflowCanvasStrings();
  const modeOptions = (["perItem", "wholeList"] as const).map((value) => ({
    value,
    label: s.inspector.ai.modes[value],
  }));

  const id = useId();
  return (
    <div className="flex flex-col gap-4">
      <Field
        label={s.inspector.aiInstructionLabel}
        htmlFor={`${id}-instruction`}
      >
        <Textarea
          id={`${id}-instruction`}
          value={settings.instruction}
          rows={5}
          aria-invalid={settings.instruction === "" || undefined}
          onChange={(event) =>
            onChange({ ...settings, instruction: event.target.value })
          }
        />
      </Field>
      <Field label={s.inspector.ai.mode} htmlFor={`${id}-mode`}>
        <SelectInput
          id={`${id}-mode`}
          value={settings.mode}
          options={modeOptions}
          onChange={(mode) => onChange({ ...settings, mode })}
        />
      </Field>
      <Field label={s.inspector.ai.resultHeading}>
        <ResultFields
          result={settings.result}
          onChange={(result) => onChange({ ...settings, result })}
        />
      </Field>
      <Field label={s.inspector.ai.batchSize} htmlFor={`${id}-batch`}>
        <NumberInput
          id={`${id}-batch`}
          min={1}
          max={100}
          value={settings.batchSize}
          onChange={(batchSize) =>
            onChange({ ...settings, batchSize: batchSize ?? 1 })
          }
        />
      </Field>
      <Field label={s.inspector.ai.tools} htmlFor={`${id}-tools`}>
        <ListInput
          id={`${id}-tools`}
          value={settings.tools}
          onChange={(tools) => onChange({ ...settings, tools: tools ?? [] })}
        />
      </Field>
      <Field label={s.inspector.ai.inputBudget} htmlFor={`${id}-budget`}>
        <NumberInput
          id={`${id}-budget`}
          min={100}
          max={200000}
          value={settings.inputBudgetTokens}
          onChange={(tokens) =>
            onChange(withOptional(settings, "inputBudgetTokens", tokens))
          }
        />
      </Field>
    </div>
  );
}
