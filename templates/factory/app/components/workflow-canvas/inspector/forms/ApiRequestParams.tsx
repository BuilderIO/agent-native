import { IconPlus, IconX } from "@tabler/icons-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { OperationDefinition } from "@/lib/workflow-editor";
import {
  activeOptions,
  apiRequestProblems,
  availableOptions,
  fitsRows,
  objectOf,
  optionBlock,
  optionName,
  optionValue,
  paginationOf,
  paginationValue,
  paramsEnabled,
  paramsValue,
  isPlainBinding,
  reconcileRows,
  rowProblems,
  rowsOf,
  withOption,
  withoutOption,
  withParams,
  withParamsEnabled,
  type ApiRequestArgs,
  type ApiRequestOption,
  type ApiRequestProblem,
  type ApiRequestShape,
  type PaginationForm,
  type ParamKind,
  type ParamRow,
} from "@/lib/workflow-editor/api-request";

import { useWorkflowCanvasStrings } from "../../strings";
import { BindingField, JsonValueInput } from "../BindingField";
import type { FormContext } from "../context";
import {
  Field,
  NumberInput,
  SelectInput,
  TemplateInput,
  TextInput,
} from "../fields";
import { useQuietMarks } from "../issue-marks";

interface SectionProps {
  def: OperationDefinition;
  shape: ApiRequestShape;
  args: ApiRequestArgs;
  onArgs: (args: ApiRequestArgs) => void;
  context: FormContext;
}

function ProblemLine({ children }: { children: string }) {
  return (
    <p role="alert" className="text-xs text-destructive">
      {children}
    </p>
  );
}

/** The generic control for a field some other way of filling set, so no control here can drop what it holds. */
function GenericField({
  def,
  name,
  label,
  args,
  onArgs,
  context,
}: SectionProps & { name: string; label: string }) {
  const field = def.fields.find((candidate) => candidate.name === name);
  if (!field) return null;
  return (
    <BindingField
      field={field}
      label={label}
      binding={args[name]}
      context={context}
      onChange={(binding) => {
        if (binding) onArgs({ ...args, [name]: binding });
        else {
          const { [name]: _removed, ...rest } = args;
          onArgs(rest);
        }
      }}
    />
  );
}

/**
 * The saved object as rows, kept for as long as the section lives so that going
 * to the JSON editor and back loses nothing: a row the object cannot hold (no
 * name yet, a header listed twice) stays as it was. They are rebuilt only when
 * something other than the rows changed the object (JSON typed, undo, the
 * agent, an import).
 */
function useRows(kind: ParamKind, saved: unknown) {
  const counter = useRef(0);
  const newId = () => {
    counter.current += 1;
    return `row-${counter.current}`;
  };
  const [rows, setRows] = useState<ParamRow[]>(() => rowsOf(saved, newId));
  const [basis, setBasis] = useState(saved);
  if (basis !== saved) {
    setBasis(saved);
    setRows(reconcileRows(kind, rows, saved, newId));
  }
  return { rows, setRows, newId };
}

type RowState = ReturnType<typeof useRows>;

function ParamRows({
  kind,
  shape,
  args,
  onArgs,
  context,
  rowState,
}: Omit<SectionProps, "def"> & { kind: ParamKind; rowState: RowState }) {
  const s = useWorkflowCanvasStrings().inspector.apiRequest;
  const quiet = useQuietMarks();
  const { rows, setRows, newId } = rowState;
  const problems = rowProblems(kind, rows);

  const commit = (next: ParamRow[]) => {
    setRows(next);
    onArgs(withParams(shape, args, kind, objectOf(kind, next)));
  };
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        const problem = quiet ? undefined : problems.get(row.id);
        return (
          <div key={row.id} className="flex flex-col gap-1">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-start gap-1.5">
              <TextInput
                value={row.name}
                placeholder={s.name}
                aria-label={s.name}
                invalid={
                  problem?.part !== undefined && problem.part !== "value"
                }
                onChange={(name) =>
                  commit(
                    rows.map((entry) =>
                      entry.id === row.id ? { ...entry, name } : entry,
                    ),
                  )
                }
              />
              <TemplateInput
                value={row.value}
                placeholder={s.value}
                ariaLabel={s.value}
                invalid={problem?.part === "value"}
                context={context}
                onChange={(value) =>
                  commit(
                    rows.map((entry) =>
                      entry.id === row.id ? { ...entry, value } : entry,
                    ),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={s.removeRow}
                title={s.removeRow}
                onClick={() =>
                  commit(rows.filter((entry) => entry.id !== row.id))
                }
              >
                <IconX />
              </Button>
            </div>
            {problem ? (
              <ProblemLine>{s.problem.row(problem)}</ProblemLine>
            ) : null}
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => setRows([...rows, { id: newId(), name: "", value: "" }])}
      >
        <IconPlus />
        {kind === "query" ? s.addParameter : s.addHeader}
      </Button>
    </div>
  );
}

/** "Send query parameters" and "Send headers": a switch, then name and value rows, or the same object as JSON. */
export function ParamsSection({
  kind,
  ...section
}: SectionProps & { kind: ParamKind }) {
  const s = useWorkflowCanvasStrings().inspector.apiRequest;
  const quiet = useQuietMarks();
  const { shape, args, onArgs } = section;
  const name = shape.fields[kind];
  const saved = paramsValue(shape, args, kind);
  const [mode, setMode] = useState<"fields" | "json">(() =>
    fitsRows(saved) ? "fields" : "json",
  );
  const rowState = useRows(kind, saved);
  if (name === undefined) return null;
  // Something saved that rows cannot hold (a nested value, an agent's edit) stays in the JSON editor whichever mode is picked.
  const shown = mode === "fields" && fitsRows(saved) ? "fields" : "json";
  const heading = kind === "query" ? s.sendQuery : s.sendHeaders;
  if (!isPlainBinding(args, name)) {
    return <GenericField {...section} name={name} label={heading} />;
  }
  const enabled = paramsEnabled(shape, args, kind);
  const problem = quiet
    ? undefined
    : apiRequestProblems(shape, args).find((entry) => entry.field === kind);
  const switchId = `api-request-${kind}`;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={switchId} className="text-sm">
          {heading}
        </label>
        <Switch
          id={switchId}
          checked={enabled}
          onCheckedChange={(on) =>
            onArgs(withParamsEnabled(shape, args, kind, on))
          }
        />
      </div>
      {enabled ? (
        <>
          <Field label={kind === "query" ? s.specifyQuery : s.specifyHeaders}>
            <SelectInput
              value={shown}
              options={[
                { value: "fields", label: s.modeFields },
                { value: "json", label: s.modeJson },
              ]}
              onChange={setMode}
            />
          </Field>
          {/* Both editors stay mounted, one hidden, so JSON that is not valid yet is still there when a person comes back to it. */}
          <div hidden={shown !== "fields"}>
            <ParamRows
              kind={kind}
              shape={shape}
              args={args}
              onArgs={onArgs}
              context={section.context}
              rowState={rowState}
            />
          </div>
          <div hidden={shown !== "json"}>
            <JsonValueInput
              id={`${switchId}-json`}
              value={saved}
              onChange={(value) => onArgs(withParams(shape, args, kind, value))}
            />
          </div>
          {/* The refusal stays in view in both editors, so a denied or invalid entry is never only in the one that is hidden. */}
          {problem ? (
            <ProblemLine>{s.problem.sentence(problem)}</ProblemLine>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function PaginationFields({
  shape,
  args,
  onArgs,
  problem,
}: Omit<SectionProps, "def" | "context"> & {
  problem: Extract<ApiRequestProblem, { field: "pagination" }> | undefined;
}) {
  const s = useWorkflowCanvasStrings().inspector.apiRequest;
  const form = paginationOf(optionValue(shape, args, "pagination"));
  const update = (patch: Partial<PaginationForm>) =>
    onArgs(
      withOption(
        shape,
        args,
        "pagination",
        paginationValue({ ...form, ...patch }),
      ),
    );
  const bad = (part: "cursorPath" | "cursorParam" | "itemsPath" | "maxPages") =>
    problem?.part === part;
  return (
    <div className="flex flex-col gap-2.5">
      <Field label={s.cursorPath}>
        <TextInput
          value={form.cursorPath}
          invalid={bad("cursorPath")}
          onChange={(cursorPath) => update({ cursorPath })}
        />
      </Field>
      <Field label={s.cursorParam}>
        <TextInput
          value={form.cursorParam}
          invalid={bad("cursorParam")}
          onChange={(cursorParam) => update({ cursorParam })}
        />
      </Field>
      <Field label={s.itemsPath}>
        <TextInput
          value={form.itemsPath}
          invalid={bad("itemsPath")}
          onChange={(itemsPath) => update({ itemsPath })}
        />
      </Field>
      <Field label={s.maxPages}>
        <NumberInput
          value={form.maxPages}
          min={1}
          max={5}
          step={1}
          invalid={bad("maxPages")}
          onChange={(maxPages) => update({ maxPages })}
        />
      </Field>
      {problem ? (
        <ProblemLine>{s.problem.sentence(problem)}</ProblemLine>
      ) : null}
    </div>
  );
}

/** The options a person has added, each with its own control and a way to remove it, and the menu that adds the rest. */
export function OptionsSection(section: SectionProps) {
  const s = useWorkflowCanvasStrings().inspector.apiRequest;
  const quiet = useQuietMarks();
  const { shape, args, onArgs } = section;
  const active = activeOptions(shape, args);
  const addable = availableOptions(shape).filter(
    (option) => !active.includes(option),
  );
  const problems = quiet ? [] : apiRequestProblems(shape, args);
  const label = (option: ApiRequestOption) =>
    option === "timeout"
      ? s.optionTimeout
      : option === "pagination"
        ? s.optionPagination
        : s.optionStatus;
  const blockedReason = (option: ApiRequestOption) => {
    const block = optionBlock(shape, args, option);
    if (block === "pagination_on") return s.optionBlockedByPagination;
    return block === "status_on" ? s.optionBlockedByStatus : undefined;
  };

  return (
    <div className="flex flex-col gap-2.5">
      {active.map((option) => {
        const name = optionName(shape, option);
        if (name === undefined) return null;
        const body = !isPlainBinding(args, name) ? (
          <GenericField {...section} name={name} label={label(option)} />
        ) : option === "timeout" ? (
          <TimeoutBody {...section} problems={problems} />
        ) : option === "pagination" ? (
          <PaginationFields
            shape={shape}
            args={args}
            onArgs={onArgs}
            problem={problems.find(
              (
                entry,
              ): entry is Extract<ApiRequestProblem, { field: "pagination" }> =>
                entry.field === "pagination",
            )}
          />
        ) : (
          <StatusProblem
            problem={problems.find((entry) => entry.field === "includeStatus")}
          />
        );
        return (
          <div
            key={option}
            className="flex flex-col gap-2 rounded-md border border-border p-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">{label(option)}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={s.removeOption(label(option))}
                title={s.removeOption(label(option))}
                onClick={() => onArgs(withoutOption(shape, args, option))}
              >
                <IconX />
              </Button>
            </div>
            {body}
          </div>
        );
      })}
      {addable.length > 0 ? (
        <Select
          value=""
          onValueChange={(option) =>
            onArgs(withOption(shape, args, option as ApiRequestOption))
          }
        >
          <SelectTrigger size="sm" aria-label={s.addOption}>
            <SelectValue placeholder={s.addOption} />
          </SelectTrigger>
          <SelectContent>
            {addable.map((option) => {
              const reason = blockedReason(option);
              return (
                <SelectItem
                  key={option}
                  value={option}
                  disabled={reason !== undefined}
                >
                  <span className="flex flex-col">
                    <span>{label(option)}</span>
                    {reason ? (
                      <span className="text-xs text-muted-foreground">
                        {reason}
                      </span>
                    ) : null}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}

/** The status switch has no control of its own to fill, only the one thing that can be wrong with it: paging beside it. */
function StatusProblem({
  problem,
}: {
  problem: ApiRequestProblem | undefined;
}) {
  const s = useWorkflowCanvasStrings().inspector.apiRequest;
  return problem ? (
    <ProblemLine>{s.problem.sentence(problem)}</ProblemLine>
  ) : null;
}

function TimeoutBody({
  shape,
  args,
  onArgs,
  problems,
}: SectionProps & { problems: readonly ApiRequestProblem[] }) {
  const s = useWorkflowCanvasStrings().inspector.apiRequest;
  const value = optionValue(shape, args, "timeout");
  const problem = problems.find((entry) => entry.field === "timeoutSeconds");
  return (
    <Field label={s.timeoutSeconds}>
      <NumberInput
        value={typeof value === "number" ? value : undefined}
        min={1}
        max={60}
        step={1}
        invalid={problem !== undefined}
        onChange={(next) =>
          onArgs(withOption(shape, args, "timeout", next ?? 0))
        }
      />
      {problem ? (
        <ProblemLine>{s.problem.sentence(problem)}</ProblemLine>
      ) : null}
    </Field>
  );
}
