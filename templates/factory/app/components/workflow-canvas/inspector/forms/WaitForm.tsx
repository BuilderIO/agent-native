import { useId } from "react";

import {
  defaultNodeSettings,
  operationsForKind,
  type NodeVariant,
} from "@/lib/workflow-editor";

import { useWorkflowCanvasStrings } from "../../strings";
import {
  Field,
  ListInput,
  NumberInput,
  SelectInput,
  TextInput,
} from "../fields";
import {
  OperationFields,
  OperationSelect,
  argsForOperation,
} from "../OperationFields";
import { RuleRow } from "../RulesEditor";
import type { FormProps } from "./types";
import { withOptional } from "./types";

type Settings = FormProps<"wait">["settings"];
type WaitKind = Settings["wait"];
type Reply = Extract<Settings, { wait: "reply" }>;

const OWN_THREAD = "own";

function acceptKind(acceptFrom: Reply["acceptFrom"]) {
  return typeof acceptFrom === "string" ? acceptFrom : "people";
}

export function WaitForm({ settings, onChange, context }: FormProps<"wait">) {
  const s = useWorkflowCanvasStrings();
  const kindOptions = (Object.keys(s.inspector.wait.kinds) as WaitKind[]).map(
    (value) => ({ value, label: s.inspector.wait.kinds[value] }),
  );
  const unitOptions = (["minutes", "hours", "days"] as const).map((value) => ({
    value,
    label: s.inspector.wait.units[value],
  }));
  const acceptOptions = [
    { value: "anyone", label: s.inspector.wait.anyone },
    { value: "owner", label: s.inspector.wait.owner },
    { value: "people", label: s.inspector.wait.people },
  ] as const;

  const id = useId();
  const switchKind = (variant: WaitKind) => {
    const next = defaultNodeSettings("wait", context.catalog, {
      variant: variant as NodeVariant,
    });
    if (next.ok) onChange(next.settings as Settings);
  };
  return (
    <div className="flex flex-col gap-4">
      <Field label={s.inspector.wait.kind} htmlFor={`${id}-kind`}>
        <SelectInput
          id={`${id}-kind`}
          value={settings.wait}
          options={kindOptions}
          onChange={switchKind}
        />
      </Field>
      {settings.wait === "reply" && (
        <>
          <Field label={s.inspector.wait.limitHours} htmlFor={`${id}-limit`}>
            <NumberInput
              id={`${id}-limit`}
              min={0}
              max={720}
              value={settings.limitHours}
              onChange={(limitHours) =>
                onChange({ ...settings, limitHours: limitHours ?? 0 })
              }
            />
          </Field>
          <Field label={s.inspector.wait.acceptFrom} htmlFor={`${id}-accept`}>
            <SelectInput
              id={`${id}-accept`}
              value={acceptKind(settings.acceptFrom)}
              options={acceptOptions}
              onChange={(kind) =>
                onChange({
                  ...settings,
                  acceptFrom:
                    kind === "people"
                      ? { emails: ["person@example.com"] }
                      : kind,
                })
              }
            />
          </Field>
          {typeof settings.acceptFrom !== "string" && (
            <Field label={s.inspector.wait.emails} htmlFor={`${id}-emails`}>
              <ListInput
                id={`${id}-emails`}
                value={settings.acceptFrom.emails}
                onChange={(emails) =>
                  onChange({
                    ...settings,
                    acceptFrom: { emails: emails ?? [] },
                  })
                }
              />
            </Field>
          )}
          <Field label={s.inspector.wait.watch} htmlFor={`${id}-watch`}>
            <SelectInput
              id={`${id}-watch`}
              value={settings.watch?.fromNode ?? OWN_THREAD}
              options={[
                { value: OWN_THREAD, label: s.inspector.wait.ownThread },
                ...context.upstream.map((step) => ({
                  value: step.id,
                  label: step.name,
                })),
              ]}
              onChange={(fromNode) =>
                onChange(
                  withOptional(
                    settings,
                    "watch",
                    fromNode === OWN_THREAD ? undefined : { fromNode },
                  ),
                )
              }
            />
          </Field>
          <Field label={s.inspector.wait.ackReaction} htmlFor={`${id}-ack`}>
            <TextInput
              id={`${id}-ack`}
              value={settings.ackReaction ?? ""}
              placeholder="white_check_mark"
              onChange={(ackReaction) =>
                onChange(withOptional(settings, "ackReaction", ackReaction))
              }
            />
          </Field>
        </>
      )}
      {settings.wait === "time" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={s.inspector.wait.amount} htmlFor={`${id}-amount`}>
            <NumberInput
              id={`${id}-amount`}
              min={0}
              value={settings.duration.amount}
              onChange={(amount) =>
                onChange({
                  ...settings,
                  duration: { ...settings.duration, amount: amount ?? 0 },
                })
              }
            />
          </Field>
          <Field label={s.inspector.wait.unit} htmlFor={`${id}-unit`}>
            <SelectInput
              id={`${id}-unit`}
              value={settings.duration.unit}
              options={unitOptions}
              onChange={(unit) =>
                onChange({
                  ...settings,
                  duration: { ...settings.duration, unit },
                })
              }
            />
          </Field>
        </div>
      )}
      {settings.wait === "condition" && (
        <>
          <OperationSelect
            id={`${id}-op`}
            value={settings.operation}
            operations={operationsForKind(context.catalog, "condition")}
            onChange={(def) =>
              onChange({
                ...settings,
                operation: def.id,
                args: argsForOperation(def, settings.args),
              })
            }
          />
          <OperationFields
            def={context.catalog.get(settings.operation)}
            args={settings.args}
            context={context}
            onChange={(args) => onChange({ ...settings, args })}
          />
          <Field label={s.inspector.wait.rule}>
            <RuleRow
              rule={settings.rule}
              context={context}
              onChange={(rule) => onChange({ ...settings, rule })}
            />
          </Field>
          <Field label={s.inspector.wait.everyMinutes} htmlFor={`${id}-every`}>
            <NumberInput
              id={`${id}-every`}
              min={5}
              max={1440}
              value={settings.everyMinutes}
              onChange={(everyMinutes) =>
                onChange({ ...settings, everyMinutes: everyMinutes ?? 5 })
              }
            />
          </Field>
          <Field label={s.inspector.wait.limitHours} htmlFor={`${id}-limit`}>
            <NumberInput
              id={`${id}-limit`}
              min={0}
              max={720}
              value={settings.limitHours}
              onChange={(limitHours) =>
                onChange({ ...settings, limitHours: limitHours ?? 0 })
              }
            />
          </Field>
        </>
      )}
    </div>
  );
}
