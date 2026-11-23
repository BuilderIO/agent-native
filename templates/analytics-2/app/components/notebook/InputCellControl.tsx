import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconChevronDown, IconListDetails } from "@tabler/icons-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { CellContents } from "@/lib/model/contracts";
import { resolveOptions, type OptionSource } from "@/lib/model/input-options";
import { compareOrder } from "@/lib/model/order";

import type getNotebookInputChoices from "../../../actions/get-notebook-input-choices";
import { parseMultiValue } from "../../../shared/notebook-input-values";
import type { ChartDataframe } from "./chart-config";
import { InputSelect } from "./InputSelect";
import { InputSettings } from "./InputSettings";
import { inputDisplayLabel } from "./utils";

export { parseMultiValue } from "../../../shared/notebook-input-values";
export type InputCellContents = Extract<CellContents, { kind: "input" }>;
type Choice = { value: string; label: string };
type CommitValue = (value: string, inputOptionsResultId?: string) => void;

const SUPPORTED_INPUT_TYPES = new Set<InputCellContents["inputType"]>([
  "TEXT_INPUT",
  "NUMERIC_INPUT",
  "DATE",
  "CHECKBOX",
  "SLIDER",
  "DROPDOWN",
  "MULTISELECT",
]);

/** The parameter types this build can render and let a person fill in. */
export const RENDERABLE_INPUT_TYPES: readonly InputCellContents["inputType"][] =
  [...SUPPORTED_INPUT_TYPES];

export function isRenderableInput(
  contents: CellContents,
): contents is InputCellContents {
  return (
    contents.kind === "input" && SUPPORTED_INPUT_TYPES.has(contents.inputType)
  );
}

export const INLINE_SLOT_CLASS =
  "nb-cell-slot shrink-0 max-w-full flex-row! items-start gap-2 pb-0! [&>.nb-cell]:w-72 [&>.nb-cell]:max-w-full";

export function groupInlineInputs(
  cells: readonly { id: string; contents: CellContents }[],
  nodes: readonly ReactNode[],
): ReactNode[] {
  const out: ReactNode[] = [];
  let run: ReactNode[] = [];
  let runId = "";
  const flush = () => {
    if (run.length === 0) return;
    out.push(
      <div
        key={`inline:${runId}`}
        data-nb-inline-group=""
        className="flex flex-wrap items-start gap-x-3 gap-y-2 pb-6"
      >
        {run}
      </div>,
    );
    run = [];
  };
  cells.forEach((cell, index) => {
    if (isRenderableInput(cell.contents)) {
      if (run.length === 0) runId = cell.id;
      run.push(nodes[index]);
    } else {
      flush();
      out.push(nodes[index]);
    }
  });
  flush();
  return out;
}

function MultiValueInput({
  contents,
  options,
  value,
  disabled,
  descriptionId,
  onCommit,
}: {
  contents: InputCellContents;
  options: readonly Choice[];
  value: string;
  disabled: boolean;
  descriptionId: string | undefined;
  onCommit: (value: string) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<string[] | null>(null);
  const saved = parseMultiValue(value).filter((entry) =>
    options.some((option) => option.value === entry),
  );
  const selected = draft ?? saved;
  const [search, setSearch] = useState("");
  const visible = options.filter(({ label }) =>
    label.toLowerCase().includes(search.toLowerCase()),
  );
  if (options.length === 0) return null;
  return (
    <Popover
      open={draft !== null}
      onOpenChange={(open) => {
        if (open) {
          setSearch("");
          setDraft(saved);
        } else if (draft !== null) {
          if (
            draft.length !== saved.length ||
            draft.some((option) => !saved.includes(option))
          ) {
            const ordered = options
              .map(({ value }) => value)
              .filter((value) => draft.includes(value));
            onCommit(JSON.stringify(ordered));
          }
          setDraft(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full min-w-0 justify-between border-input font-normal"
          disabled={disabled}
          aria-label={t("notebook.multiselectLabel", { name: contents.name })}
          aria-describedby={descriptionId}
        >
          <span className="truncate">
            {selected.length
              ? selected
                  .map(
                    (value) =>
                      options.find((option) => option.value === value)?.label ??
                      value,
                  )
                  .join(", ")
              : t("notebook.multiselectPlaceholder")}
          </span>
          <IconChevronDown className="opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="grid max-h-64 w-64 max-w-[var(--radix-popover-content-available-width)] gap-2 overflow-y-auto p-2"
      >
        <Input
          size="sm"
          aria-label={t("notebook.inputChoices.search")}
          placeholder={t("notebook.inputChoices.search")}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="justify-self-start"
          onClick={() =>
            setDraft((current) =>
              current === null
                ? null
                : [
                    ...new Set([
                      ...current,
                      ...visible.map(({ value }) => value),
                    ]),
                  ],
            )
          }
          disabled={visible.length === 0}
        >
          {t("notebook.inputChoices.selectAll", { count: visible.length })}
        </Button>
        <div className="nb-input-multi" role="group" aria-label={contents.name}>
          {visible.map(({ value: option, label }) => (
            <label className="nb-input-multi-option" key={option}>
              <Checkbox
                checked={selected.includes(option)}
                disabled={disabled}
                onCheckedChange={(checked) => {
                  setDraft((current) =>
                    current === null
                      ? null
                      : checked === true
                        ? [...current, option]
                        : current.filter((entry) => entry !== option),
                  );
                }}
              />
              {label}
            </label>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="justify-self-start"
          onClick={() => setDraft(null)}
        >
          {t("notebook.inputChoices.cancel")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

type ChoiceRead = Awaited<ReturnType<typeof getNotebookInputChoices.run>>;

type InputCellControlProps = {
  contents: InputCellContents;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onCommit: CommitValue;
  projectId?: string | undefined;
  verifiedChoices?: ChoiceRead | undefined;
  dataframes?: readonly ChartDataframe[] | undefined;
  updatedAt?: string | undefined;
  onChangeContents?:
    | ((
        contents: InputCellContents,
        expectedUpdatedAt?: string,
        optionsResultId?: string,
      ) => void)
    | undefined;
};

function queryInputChoices(
  contents: InputCellContents,
  source: OptionSource,
  frame: ChartDataframe | undefined,
  value: string,
  t: ReturnType<typeof useT>,
): { options: Choice[]; note: string | null } {
  const resolved = resolveOptions(
    source,
    frame
      ? {
          columns: frame.columns,
          rows: frame.rows,
          complete: frame.truncated !== true,
        }
      : null,
  );
  const options =
    resolved.status === "ready"
      ? resolved.options.map(({ text, label }) => ({
          value: text,
          label: label ?? text,
        }))
      : (contents.options ?? []).map((value) => ({ value, label: value }));
  const known = new Set(options.map(({ value }) => value));
  const selected =
    contents.inputType === "MULTISELECT" ? parseMultiValue(value) : [value];
  for (const value of selected) {
    if (value === "" || known.has(value)) continue;
    known.add(value);
    options.push({ value, label: value });
  }

  switch (resolved.status) {
    case "pending":
      return {
        options,
        note: t("notebook.inputOptions.pending", {
          dataframe: source.dataframe,
        }),
      };
    case "missingColumn":
      return {
        options,
        note: t("notebook.inputOptions.missingColumn", {
          dataframe: source.dataframe,
          column: resolved.column,
        }),
      };
    case "ambiguous":
      return {
        options,
        note: t("notebook.inputOptions.ambiguous", { value: resolved.text }),
      };
    case "ready":
      return {
        options,
        note: resolved.incomplete
          ? t("notebook.inputOptions.incomplete")
          : null,
      };
  }
}

function OptionsSourceEditor({
  source,
  dataframes,
  frame,
  disabled,
  onChange,
}: {
  source: OptionSource | undefined;
  dataframes: readonly ChartDataframe[];
  frame: ChartDataframe | undefined;
  disabled: boolean;
  onChange: (source: OptionSource | undefined) => void;
}) {
  const t = useT();
  const id = useId();
  const label = t("notebook.inputOptions.choicesFrom");
  const valueLabel = t("notebook.inputOptions.valueColumn");
  const displayLabel = t("notebook.inputOptions.labelColumn");
  const sources = new Map<string, ChartDataframe>();
  for (const candidate of dataframes) {
    if (candidate.columns.length > 0 && !sources.has(candidate.name))
      sources.set(candidate.name, candidate);
  }
  const options = [
    { value: "", label: t("notebook.inputOptions.typedValues") },
    ...Array.from(sources.keys(), (name) => ({ value: name, label: name })),
  ];
  if (source && !sources.has(source.dataframe))
    options.push({ value: source.dataframe, label: source.dataframe });
  const columns =
    frame?.columns.map(({ name }) => ({ value: name, label: name })) ?? [];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={label}
          disabled={disabled}
        >
          <IconListDetails size={14} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={label}
        className="nb-input-config"
        align="start"
      >
        <div className="nb-input-config-fields">
          <label htmlFor={`${id}-source`}>{label}</label>
          <InputSelect
            id={`${id}-source`}
            label={label}
            value={source?.dataframe ?? ""}
            options={options}
            disabled={disabled}
            onChange={(dataframe) => {
              if (dataframe === "") return onChange(undefined);
              const valueColumn = sources.get(dataframe)?.columns[0]?.name;
              if (valueColumn !== undefined && dataframe !== source?.dataframe)
                onChange({ dataframe, valueColumn, labelColumn: null });
            }}
          />
          {source && columns.length > 0 && (
            <>
              <label htmlFor={`${id}-value`}>{valueLabel}</label>
              <InputSelect
                id={`${id}-value`}
                label={valueLabel}
                placeholder={source.valueColumn}
                value={source.valueColumn}
                options={columns}
                disabled={disabled}
                onChange={(valueColumn) => onChange({ ...source, valueColumn })}
              />
              <label htmlFor={`${id}-label`}>{displayLabel}</label>
              <InputSelect
                id={`${id}-label`}
                label={displayLabel}
                placeholder={source.labelColumn ?? displayLabel}
                value={source.labelColumn ?? ""}
                options={[
                  { value: "", label: t("notebook.inputOptions.noLabel") },
                  ...columns,
                ]}
                disabled={disabled}
                onChange={(labelColumn) =>
                  onChange({ ...source, labelColumn: labelColumn || null })
                }
              />
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DynamicInputCellControl({
  projectId,
  contents,
  onChange,
  onCommit,
  disabled,
  value,
  ...props
}: InputCellControlProps & { projectId: string }) {
  const query = useActionQuery<ChoiceRead>(
    "get-notebook-input-choices",
    { projectId, cellId: contents.id },
    { queryKeyScope: [contents.dynamicOptions], retry: false },
  );
  const choices: ChoiceRead = query.isError
    ? { status: "unreadable" }
    : (query.data ?? { status: "pending" });
  const first = choices.status === "ready" ? choices.values[0] : undefined;
  const resultId = choices.status === "ready" ? choices.resultId : undefined;
  const initializedResult = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      !disabled &&
      !contents.optional &&
      contents.inputType === "DROPDOWN" &&
      contents.defaultValueString === "" &&
      value === "" &&
      first &&
      resultId !== undefined &&
      initializedResult.current !== resultId
    ) {
      initializedResult.current = resultId;
      onChange(first.value);
      onCommit(first.value, resultId);
    }
  }, [
    contents.defaultValueString,
    contents.inputType,
    contents.optional,
    disabled,
    first,
    onChange,
    onCommit,
    resultId,
    value,
  ]);
  return (
    <InputControl
      {...props}
      contents={contents}
      value={value}
      disabled={disabled}
      choices={choices}
      onRefreshChoices={() => void query.refetch()}
      onChange={onChange}
      onCommit={(next) => {
        if (resultId !== undefined) onCommit(next, resultId);
      }}
    />
  );
}

export function InputCellControl(props: InputCellControlProps) {
  if (props.contents.dynamicOptions) {
    const choices = props.verifiedChoices;
    if (choices !== undefined)
      return (
        <InputControl
          {...props}
          choices={choices}
          onCommit={(value) => {
            if (choices.status === "ready")
              props.onCommit(value, choices.resultId);
          }}
        />
      );
    if (props.projectId !== undefined)
      return <DynamicInputCellControl {...props} projectId={props.projectId} />;
    return <InputControl {...props} choices={{ status: "missing" }} />;
  }
  return <InputControl {...props} />;
}

function InputControl({
  contents,
  value,
  disabled,
  onChange,
  onCommit,
  onChangeContents,
  dataframes,
  updatedAt,
  choices,
  onRefreshChoices,
}: InputCellControlProps & {
  choices?: ChoiceRead;
  onRefreshChoices?: () => void;
}) {
  const id = useId();
  const t = useT();
  const name = inputDisplayLabel(contents);
  const supportsQueryChoices =
    !contents.dynamicOptions &&
    (contents.inputType === "DROPDOWN" || contents.inputType === "MULTISELECT");
  const source = supportsQueryChoices ? contents.optionsSource : undefined;
  const earlierFrames = supportsQueryChoices
    ? (dataframes ?? []).filter(
        ({ sourceOrder }) =>
          sourceOrder === undefined ||
          compareOrder(sourceOrder, contents.order) < 0,
      )
    : [];
  const frame = earlierFrames.find(({ name }) => name === source?.dataframe);
  const queryChoices =
    source && queryInputChoices(contents, source, frame, value, t);
  const inputSettings = onChangeContents && (
    <InputSettings
      contents={contents}
      dataframes={dataframes}
      disabled={disabled}
      updatedAt={updatedAt}
      onSave={(next, expectedUpdatedAt) => {
        if (source && next.inputType === contents.inputType) {
          if (next.dynamicOptions) delete next.optionsSource;
          else next.defaultValueString = contents.defaultValueString;
        }
        onChangeContents(
          next,
          expectedUpdatedAt,
          choices?.status === "ready" ? choices.resultId : undefined,
        );
      }}
    />
  );
  const settings =
    onChangeContents &&
    supportsQueryChoices &&
    (source || earlierFrames.some(({ columns }) => columns.length > 0)) ? (
      <div className="flex items-center gap-1">
        <OptionsSourceEditor
          source={source}
          dataframes={earlierFrames}
          frame={frame}
          disabled={disabled}
          onChange={(source) => {
            const next = { ...contents };
            if (source) next.optionsSource = source;
            else delete next.optionsSource;
            onChangeContents(next, updatedAt);
          }}
        />
        {inputSettings}
      </div>
    ) : (
      inputSettings
    );
  const label = (htmlFor: string) => (
    <div className="nb-input-heading">
      <label className="nb-input-label" htmlFor={htmlFor}>
        {name}
      </label>
      {settings}
    </div>
  );
  const options =
    queryChoices?.options ??
    (choices === undefined
      ? (contents.options ?? []).map((value) => ({
          value,
          label: contents.optionLabels?.[value] ?? value,
        }))
      : choices.status === "ready"
        ? choices.values
        : []);
  const removed =
    choices?.status === "ready" &&
    (contents.inputType === "MULTISELECT"
      ? parseMultiValue(value)
      : value === ""
        ? []
        : [value]
    ).some((selected) => !options.some((option) => option.value === selected));
  const note =
    queryChoices?.note ??
    (removed
      ? t("notebook.inputChoices.removed")
      : choices?.status === "pending"
        ? t("notebook.inputChoices.loading")
        : choices && choices.status !== "ready"
          ? t(`notebook.inputChoices.${choices.status}`)
          : options.length === 0
            ? t("notebook.inputChoices.empty")
            : null);
  const descriptionId = note === null ? undefined : `${id}-choices`;
  const choiceNotice = note !== null && (
    <p className="nb-input-note" role="status" id={descriptionId}>
      {note}
      {choices?.status === "unreadable" && onRefreshChoices && (
        <button type="button" onClick={onRefreshChoices}>
          {t("notebook.inputChoices.refresh")}
        </button>
      )}
    </p>
  );

  if (contents.inputType === "DROPDOWN") {
    const placeholder = t("notebook.inputChoices.chooseOption");
    const dropdownOptions = contents.optional
      ? [
          {
            value: "",
            label:
              choices === undefined
                ? t("notebook.inputChoices.clearSelection")
                : placeholder,
          },
          ...options.filter((option) => option.value !== ""),
        ]
      : options;
    const selected = dropdownOptions.some((option) => option.value === value)
      ? value
      : choices === undefined
        ? dropdownOptions[0]?.value
        : contents.optional
          ? ""
          : undefined;
    return (
      <div className="nb-input-cell">
        {label(`${id}-dropdown`)}
        <InputSelect
          id={`${id}-dropdown`}
          label={t("notebook.inputChoices.valueFor", { name })}
          descriptionId={descriptionId}
          placeholder={placeholder}
          options={dropdownOptions}
          value={selected}
          disabled={
            disabled || (choices !== undefined && choices.status !== "ready")
          }
          onChange={(next) => {
            onChange(next);
            onCommit(next);
          }}
        />
        {choiceNotice}
      </div>
    );
  }

  if (contents.inputType === "MULTISELECT") {
    return (
      <div className="nb-input-cell">
        <div className="nb-input-heading">
          <span className="nb-input-label">{name}</span>
          {settings}
        </div>
        <MultiValueInput
          contents={contents}
          options={options}
          value={value}
          disabled={disabled}
          descriptionId={descriptionId}
          onCommit={(next) => {
            onChange(next);
            onCommit(next);
          }}
        />
        {choiceNotice}
      </div>
    );
  }

  if (contents.inputType === "SLIDER") {
    const settings = contents.sliderOptions ?? { min: 0, max: 10, step: 1 };
    const interval = (settings.max - settings.min) / 1000;
    const step = Math.max(
      interval > 1 ? Math.round(interval) : interval,
      settings.step > 0 ? settings.step : 1,
    );
    const numeric = value.trim() === "" ? settings.min : Number(value);
    const current = Number.isFinite(numeric) ? numeric : settings.min;
    return (
      <div className="nb-input-cell">
        {label(`${id}-slider`)}
        <input
          id={`${id}-slider`}
          className="nb-input-slider"
          type="range"
          min={settings.min}
          max={settings.max}
          step={step}
          value={current}
          disabled={disabled}
          aria-label={t("notebook.inputChoices.valueFor", { name })}
          onChange={(event) => onChange(event.target.value)}
          onPointerUp={(event) => onCommit(event.currentTarget.value)}
          onBlur={(event) => onCommit(event.currentTarget.value)}
          onKeyUp={(event) => {
            if (
              [
                "ArrowLeft",
                "ArrowRight",
                "ArrowDown",
                "ArrowUp",
                "Home",
                "End",
                "PageUp",
                "PageDown",
              ].includes(event.key)
            )
              onCommit(event.currentTarget.value);
          }}
        />
        <output className="nb-input-slider-value" htmlFor={`${id}-slider`}>
          {current}
        </output>
      </div>
    );
  }

  if (contents.inputType === "CHECKBOX") {
    return (
      <div className="nb-input-cell">
        <div className="nb-input-heading">
          <label className="nb-input-checkbox" htmlFor={`${id}-checkbox`}>
            <Switch
              id={`${id}-checkbox`}
              size="sm"
              checked={value === "true"}
              disabled={disabled}
              aria-label={name}
              onCheckedChange={(checked) => {
                const next = String(checked);
                onChange(next);
                onCommit(next);
              }}
            />
            <span className="nb-input-label">{name}</span>
          </label>
          {settings}
        </div>
      </div>
    );
  }

  const type =
    contents.inputType === "DATE"
      ? "date"
      : contents.inputType === "NUMERIC_INPUT"
        ? "number"
        : "text";
  return (
    <div className="nb-input-cell">
      {label(`${id}-input`)}
      {contents.inputType === "TEXT_INPUT" && contents.multiline === true ? (
        <Textarea
          id={`${id}-input`}
          rows={3}
          value={value}
          disabled={disabled}
          aria-label={t("notebook.inputChoices.valueFor", { name })}
          onChange={(event) => onChange(event.currentTarget.value)}
          onBlur={(event) => onCommit(event.currentTarget.value)}
        />
      ) : (
        <Input
          id={`${id}-input`}
          size="sm"
          className="min-w-0"
          type={type}
          step={type === "number" ? "any" : undefined}
          value={value}
          disabled={disabled}
          aria-label={t("notebook.inputChoices.valueFor", { name })}
          onChange={(event) => {
            const next = event.currentTarget.value;
            onChange(next);
            if (type === "date") onCommit(next);
          }}
          onBlur={
            type === "date"
              ? undefined
              : (event) => onCommit(event.currentTarget.value)
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      )}
    </div>
  );
}
