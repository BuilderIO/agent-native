import { IconX } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  defaultArgs,
  engineManagedParams,
  type FieldBinding,
  type OperationDefinition,
} from "@/lib/workflow-editor";

import { providerName } from "../node-kinds";
import { useWorkflowCanvasStrings } from "../strings";
import { BindingField } from "./BindingField";
import type { FormContext } from "./context";
import { Field } from "./fields";

type Args = Record<string, FieldBinding>;

/** Operations grouped by provider; the one in use is listed even if the catalog no longer has it. */
export function OperationSelect({
  id,
  value,
  operations,
  onChange,
  label,
}: {
  id?: string;
  value: string;
  operations: readonly OperationDefinition[];
  onChange: (def: OperationDefinition) => void;
  label?: string;
}) {
  const s = useWorkflowCanvasStrings();

  const providers = [...new Set(operations.map((def) => def.provider))];
  const known = operations.some((def) => def.id === value);
  return (
    <Field label={label ?? s.inspector.operation} htmlFor={id}>
      <Select
        value={value}
        onValueChange={(next) => {
          const def = operations.find((candidate) => candidate.id === next);
          if (def) onChange(def);
        }}
        disabled={operations.length === 0}
      >
        <SelectTrigger id={id} size="sm" aria-invalid={!known || undefined}>
          <SelectValue placeholder={s.inspector.noOperations} />
        </SelectTrigger>
        <SelectContent>
          {!known && value && (
            <SelectItem value={value} disabled>
              {s.inspector.notInCatalog(value)}
            </SelectItem>
          )}
          {providers.map((provider) => (
            <SelectGroup key={provider}>
              <SelectLabel>{providerName(provider)}</SelectLabel>
              {operations
                .filter((def) => def.provider === provider)
                .map((def) => (
                  <SelectItem key={def.id} value={def.id}>
                    {def.label}
                  </SelectItem>
                ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** Starting arguments for a different operation: its defaults, keeping what the author already set under the same names. */
export function argsForOperation(
  def: OperationDefinition,
  previous: Args,
): Args {
  const next = defaultArgs(def);
  const names = new Set(def.fields.map((field) => field.name));
  for (const [name, binding] of Object.entries(previous)) {
    if (names.has(name)) next[name] = binding;
  }
  return next;
}

/** The arguments of an operation, one field per row, read from the operation's own declaration. */
export function OperationFields({
  def,
  args,
  onChange,
  context,
}: {
  def: OperationDefinition | undefined;
  args: Args;
  onChange: (args: Args) => void;
  context: FormContext;
}) {
  const s = useWorkflowCanvasStrings();

  if (!def) return null;
  const managed = engineManagedParams(def);
  const names = new Set(def.fields.map((field) => field.name));
  const unknown = Object.keys(args).filter((name) => !names.has(name));
  return (
    <div className="flex flex-col gap-4">
      {def.fields
        .filter((field) => !managed.has(field.name))
        .map((field) => (
          <BindingField
            key={field.name}
            field={field}
            binding={args[field.name]}
            context={context}
            onChange={(binding) => {
              const next = { ...args };
              if (binding) next[field.name] = binding;
              else delete next[field.name];
              onChange(next);
            }}
          />
        ))}
      {unknown.map((name) => (
        <div
          key={name}
          className="flex items-center justify-between gap-2 text-xs text-destructive"
        >
          <span>{s.inspector.unknownField(name)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={s.inspector.removeUnknownField}
            title={s.inspector.removeUnknownField}
            onClick={() => {
              const next = { ...args };
              delete next[name];
              onChange(next);
            }}
          >
            <IconX />
          </Button>
        </div>
      ))}
    </div>
  );
}
