import { useId } from "react";

import {
  operationsForKind,
  type FieldBinding,
  type OperationDefinition,
} from "@/lib/workflow-editor";
import { apiRequestShape } from "@/lib/workflow-editor/api-request";

import { useWorkflowCanvasStrings } from "../../strings";
import { Field, TextInput } from "../fields";
import {
  OperationFields,
  OperationSelect,
  argsForOperation,
} from "../OperationFields";
import { ApiRequestForm } from "./ApiRequestForm";
import { OnErrorField } from "./OnErrorField";
import type { FormProps } from "./types";
import { withOptional } from "./types";

/** An API request has a form of its own; every other lookup is its operation's declared fields. */
export function LookupForm(props: FormProps<"lookup">) {
  const def = props.context.catalog.get(props.settings.operation);
  return apiRequestShape(def) ? (
    <ApiRequestForm {...props} />
  ) : (
    <OperationLookupForm {...props} />
  );
}

function OperationLookupForm({
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
      <OnErrorField settings={settings} onChange={onChange} />
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
            ...settings,
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
      <OnErrorField settings={settings} onChange={onChange} />
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
      <OnErrorField settings={settings} onChange={onChange} />
    </div>
  );
}
