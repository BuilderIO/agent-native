import { IconVariable } from "@tabler/icons-react";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  checkPathText,
  checkTemplateText,
  type ExpressionProblem,
} from "@/lib/workflow-editor";

import {
  useWorkflowCanvasStrings,
  type WorkflowCanvasStrings,
} from "../strings";
import type { FormContext } from "./context";

export function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        <span className="text-xs font-normal text-muted-foreground">
          {label}
        </span>
      </Label>
      {children}
    </div>
  );
}

function problemText(
  problem: ExpressionProblem,
  s: WorkflowCanvasStrings,
): string {
  const text = s.inspector.problem;
  switch (problem.code) {
    case "unknown_node":
      return text.unknown_node(problem.name);
    case "not_upstream":
      return text.not_upstream(problem.name);
    default:
      return text[problem.code];
  }
}

export function ProblemText({
  problem,
}: {
  problem: ExpressionProblem | null;
}) {
  const s = useWorkflowCanvasStrings();

  if (!problem) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {problemText(problem, s)}
    </p>
  );
}

export function TextInput({
  id,
  value,
  onChange,
  onBlur,
  onKeyDown,
  placeholder,
  invalid,
  type = "text",
  className,
  ...aria
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  invalid?: boolean;
  type?: string;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <Input
      id={id}
      type={type}
      value={value}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      className={cn("h-8", className)}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      {...aria}
    />
  );
}

/** A number that may be empty. Empty reports `undefined`; text that is not a number reports nothing. */
export function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  step,
  invalid,
  className,
}: {
  id?: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  invalid?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => {
    setText((current) =>
      (current === "" ? undefined : Number(current)) === value
        ? current
        : value === undefined
          ? ""
          : String(value),
    );
  }, [value]);
  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={text}
      aria-invalid={invalid || undefined}
      className={cn("h-8", className)}
      onChange={(event) => {
        setText(event.target.value);
        if (event.target.value === "") return onChange(undefined);
        const next = Number(event.target.value);
        if (Number.isFinite(next)) onChange(next);
      }}
    />
  );
}

export function SelectInput<T extends string>({
  id,
  value,
  options,
  onChange,
  placeholder,
  invalid,
  className,
}: {
  id?: string;
  value: T | undefined;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  placeholder?: string;
  invalid?: boolean;
  className?: string;
}) {
  return (
    <Select value={value ?? ""} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger
        id={id}
        size="sm"
        aria-invalid={invalid || undefined}
        className={className}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Comma-separated text that reports a list; an empty box reports `undefined`. */
export function ListInput({
  id,
  value,
  onChange,
  placeholder,
  invalid,
}: {
  id?: string;
  value: readonly string[] | undefined;
  onChange: (value: string[] | undefined) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  const [text, setText] = useState((value ?? []).join(", "));
  useEffect(() => {
    setText((current) => {
      const parsed = parseList(current);
      return JSON.stringify(parsed ?? []) === JSON.stringify(value ?? [])
        ? current
        : (value ?? []).join(", ");
    });
  }, [value]);
  return (
    <TextInput
      id={id}
      value={text}
      placeholder={placeholder}
      invalid={invalid}
      onChange={(next) => {
        setText(next);
        onChange(parseList(next));
      }}
    />
  );
}

function parseList(text: string): string[] | undefined {
  const parts = text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : undefined;
}

/** Offers the paths a step can read; picking one reports it as written. */
function PathPicker({
  context,
  onPick,
}: {
  context: FormContext;
  onPick: (path: string) => void;
}) {
  const s = useWorkflowCanvasStrings();

  const [open, setOpen] = useState(false);
  const groups = (
    Object.keys(s.inspector.pathGroup) as (keyof typeof s.inspector.pathGroup)[]
  )
    .map((group) => ({
      group,
      entries: context.suggestions.filter((entry) => entry.group === group),
    }))
    .filter(({ entries }) => entries.length > 0);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={s.inspector.insertPath}
          title={s.inspector.insertPath}
        >
          <IconVariable />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <Command>
          <CommandInput placeholder={s.inspector.searchPaths} />
          <CommandList className="max-h-64">
            <CommandEmpty>{s.inspector.noPaths}</CommandEmpty>
            {groups.map(({ group, entries }) => (
              <CommandGroup key={group} heading={s.inspector.pathGroup[group]}>
                {entries.map((entry) => (
                  <CommandItem
                    key={entry.path}
                    value={entry.path}
                    onSelect={() => {
                      onPick(entry.path);
                      setOpen(false);
                    }}
                  >
                    <span className="truncate font-mono text-xs">
                      {entry.path}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** A bare path, checked as it is typed against what this step can read. */
export function PathInput({
  id,
  value,
  onChange,
  context,
  invalid,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  context: FormContext;
  invalid?: boolean;
}) {
  const s = useWorkflowCanvasStrings();

  const problem = checkPathText(value, context.expression);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <TextInput
          id={id}
          value={value}
          placeholder={s.inspector.pathExample}
          invalid={invalid || problem !== null}
          onChange={onChange}
        />
        <PathPicker context={context} onPick={onChange} />
      </div>
      <ProblemText problem={problem} />
    </div>
  );
}

/** Text that may hold `{{ path }}` holes, checked the same way. */
export function TemplateInput({
  id,
  value,
  onChange,
  context,
  invalid,
  multiline,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  context: FormContext;
  invalid?: boolean;
  multiline?: boolean;
}) {
  const problem = checkTemplateText(value, context.expression);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-1">
        {multiline ? (
          <TemplateTextarea
            id={id}
            value={value}
            invalid={invalid || problem !== null}
            onChange={onChange}
          />
        ) : (
          <TextInput
            id={id}
            value={value}
            invalid={invalid || problem !== null}
            onChange={onChange}
          />
        )}
        <PathPicker
          context={context}
          onPick={(path) =>
            onChange(
              `${value}${value && !value.endsWith(" ") ? " " : ""}{{ ${path} }}`,
            )
          }
        />
      </div>
      <ProblemText problem={problem} />
    </div>
  );
}

function TemplateTextarea({
  id,
  value,
  onChange,
  invalid,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}) {
  return (
    <Textarea
      id={id}
      value={value}
      rows={3}
      aria-invalid={invalid || undefined}
      className="min-h-16"
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
