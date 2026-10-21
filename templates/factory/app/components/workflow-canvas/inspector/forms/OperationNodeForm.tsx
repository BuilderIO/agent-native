import { useId } from "react";

import {
  operationsForKind,
  type FieldBinding,
  type OperationDefinition,
} from "@/lib/workflow-editor";

import { useWorkflowCanvasStrings } from "../../strings";
import { Field, TextInput } from "../fields";
import {
  OperationFields,
  OperationSelect,
  argsForOperation,
} from "../OperationFields";
import type { FormProps } from "./types";
import { withOptional } from "./types";

export function LookupForm({
  settings,
  onChange,
  context,
}: FormProps<"lookup">) {
  const s = useWorkflowCanvasStrings();

  const id = useId();
  const operations = operationsForKind(context.catalog, "lookup");
  const def = context.catalog.get(settings.operation);
  return (
    <div className="flex flex-col gap-4">
      <OperationSelect
        id={`${id}-op`}
        value={settings.operation}
        operations={operations}
        onChange={(next) =>
          onChange({
            ...settings,
            operation: next.id,
            args: argsForOperation(next, settings.args),
          })
        }
      />
      <OperationFields
        def={def}
        args={settings.args}
        context={context}
        onChange={(args) => onChange({ ...settings, args })}
      />
      <Field label={s.inspector.resultName} htmlFor={`${id}-into`}>
        <TextInput
          id={`${id}-into`}
          value={settings.into ?? ""}
          placeholder={context.node.name}
          onChange={(into) => onChange(withOptional(settings, "into", into))}
        />
      </Field>
    </div>
  );
}

export function ActionForm({
  settings,
  onChange,
  context,
}: FormProps<"action">) {
  const id = useId();
  const operations = operationsForKind(context.catalog, "action");
  return (
    <div className="flex flex-col gap-4">
      <OperationSelect
        id={`${id}-op`}
        value={settings.operation}
        operations={operations}
        onChange={(next) =>
          onChange({
            operation: next.id,
            args: argsForOperation(next, settings.args),
          })
        }
      />
      <OperationFields
        def={context.catalog.get(settings.operation)}
        args={settings.args}
        context={context}
        onChange={(args) => onChange({ ...settings, args })}
      />
    </div>
  );
}

function agentOperation(
  def: OperationDefinition,
): "start" | "check" | "followUp" | undefined {
  return def.implementation.type === "builder"
    ? def.implementation.op
    : undefined;
}

export function AgentForm({ settings, onChange, context }: FormProps<"agent">) {
  const s = useWorkflowCanvasStrings();

  const id = useId();
  const operations = operationsForKind(context.catalog, "agent");
  const current = `${settings.agent}.${settings.op}`;
  return (
    <div className="flex flex-col gap-4">
      <OperationSelect
        id={`${id}-op`}
        label={s.inspector.agent.operation}
        value={current}
        operations={operations}
        onChange={(next) => {
          const op = agentOperation(next);
          if (op) {
            onChange({
              ...settings,
              op,
              args: argsForOperation(
                next,
                settings.args as Record<string, FieldBinding>,
              ),
            });
          }
        }}
      />
      {operations.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {s.inspector.agent.none}
        </p>
      )}
      <OperationFields
        def={context.catalog.get(current)}
        args={settings.args}
        context={context}
        onChange={(args) => onChange({ ...settings, args })}
      />
    </div>
  );
}
