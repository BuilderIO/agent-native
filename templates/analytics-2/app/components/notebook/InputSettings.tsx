import { useT } from "@agent-native/core/client/i18n";
import { Tooltip } from "@agent-native/toolkit/design-system";
import { IconSettings } from "@tabler/icons-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

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
import { inputNameToLabel } from "@/lib/model/cell-references";
import { compareOrder } from "@/lib/model/order";

import {
  isNumericNotebookInput,
  parseMultiValue,
} from "../../../shared/notebook-input-values";
import { isSqlInputName } from "../../../shared/sql-input-name";
import type { ChartDataframe } from "./chart-config";
import {
  consumeInputConfigRequest,
  onInputConfigRequest,
} from "./input-config-request";
import {
  RENDERABLE_INPUT_TYPES,
  type InputCellContents,
} from "./InputCellControl";
import { InputSelect } from "./InputSelect";
import { inputDisplayLabel } from "./utils";

const DEFAULT_SLIDER = { min: 0, max: 10, step: 1 };
type OptionMode = "dynamic" | "static";

const TYPE_DEFAULT_VALUE: Record<InputCellContents["inputType"], string> = {
  TEXT_INPUT: "",
  DROPDOWN: "",
  MULTISELECT: "[]",
  DATE: "",
  CHECKBOX: "false",
  SLIDER: "0",
  NUMERIC_INPUT: "0",
  BUTTON: "",
  TABLE: "",
  FILE_UPLOAD: "",
};

const TYPE_TITLE_KEY = {
  TEXT_INPUT: "notebook.inputConfig.types.text",
  NUMERIC_INPUT: "notebook.inputConfig.types.number",
  DROPDOWN: "notebook.inputConfig.types.dropdown",
  SLIDER: "notebook.inputConfig.types.slider",
  DATE: "notebook.inputConfig.types.date",
  CHECKBOX: "notebook.inputConfig.types.checkbox",
  MULTISELECT: "notebook.inputConfig.types.multiselect",
} as const;
type PickerType = keyof typeof TYPE_TITLE_KEY;

const OUTPUT_TYPE_KEY = {
  TEXT_INPUT: "notebook.inputConfig.outputTypes.string",
  NUMERIC_INPUT: "notebook.inputConfig.outputTypes.number",
  DROPDOWN: "notebook.inputConfig.outputTypes.string",
  SLIDER: "notebook.inputConfig.outputTypes.number",
  DATE: "notebook.inputConfig.outputTypes.datetime",
  CHECKBOX: "notebook.inputConfig.outputTypes.boolean",
  MULTISELECT: "notebook.inputConfig.outputTypes.listOfStrings",
} as const;

const pickerTypes = () =>
  (Object.keys(TYPE_TITLE_KEY) as PickerType[]).filter((type) =>
    RENDERABLE_INPUT_TYPES.includes(type),
  );

const nameFromLabel = (label: string) =>
  label.trim().toLocaleLowerCase().replace(/\s+/g, "_");

function readSettings(contents: InputCellContents) {
  return {
    inputType: contents.inputType,
    name: contents.name,
    label: contents.label,
    multiline: contents.multiline === true,
    mode: (contents.dynamicOptions || contents.options === undefined
      ? "dynamic"
      : "static") as OptionMode,
    values: contents.options?.join(", ") ?? "",
    valueType: contents.optionValueType ?? "string",
    producerCellId: contents.dynamicOptions?.producerCellId ?? "",
    valueFieldId: contents.dynamicOptions?.valueFieldId ?? "",
    displayFieldId: contents.dynamicOptions?.displayFieldId ?? "",
    optional: contents.optional === true,
    slider: contents.sliderOptions ?? DEFAULT_SLIDER,
  };
}

type Settings = ReturnType<typeof readSettings>;
type SettingsError =
  | "invalidName"
  | "invalidChoices"
  | "invalidValueColumn"
  | "invalidSlider";

function staticValues(text: string) {
  return [
    ...new Set(
      text
        .split(/[,\n]/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function configuredContents(
  contents: InputCellContents,
  settings: Settings,
): InputCellContents | SettingsError {
  const name = settings.name.trim();
  if (!isSqlInputName(name)) return "invalidName";
  const next: InputCellContents = { ...contents, name };
  if (settings.label !== contents.label)
    next.label = settings.label?.trim() || null;

  if (settings.inputType !== contents.inputType) {
    const {
      options: _options,
      optionLabels: _optionLabels,
      optionValueType: _optionValueType,
      optionsSource: _optionsSource,
      dynamicOptions: _dynamicOptions,
      optional: _optional,
      multiline: _multiline,
      sliderOptions: _sliderOptions,
      ...rest
    } = next;
    return {
      ...rest,
      inputType: settings.inputType,
      defaultValueString: TYPE_DEFAULT_VALUE[settings.inputType],
    };
  }

  if (
    contents.inputType === "TEXT_INPUT" &&
    settings.multiline !== (contents.multiline === true)
  )
    next.multiline = settings.multiline;

  if (contents.inputType === "SLIDER") {
    const { min, max, step } = settings.slider;
    if (![min, max, step].every(Number.isFinite) || min > max || step <= 0)
      return "invalidSlider";
    next.sliderOptions = settings.slider;
  }
  if (contents.inputType !== "DROPDOWN" && contents.inputType !== "MULTISELECT")
    return next;

  if (
    contents.inputType === "DROPDOWN" &&
    settings.optional !== (contents.optional === true)
  )
    next.optional = settings.optional;
  if (settings.mode === "dynamic") {
    if (!settings.producerCellId) {
      if (contents.options === undefined && !contents.dynamicOptions)
        return next;
      delete next.options;
      delete next.optionValueType;
      delete next.dynamicOptions;
      next.defaultValueString =
        contents.inputType === "MULTISELECT" ? "[]" : "";
      return next;
    }
    if (!settings.valueFieldId) return "invalidValueColumn";
    const binding = {
      producerCellId: settings.producerCellId,
      valueFieldId: settings.valueFieldId,
      ...(settings.displayFieldId && {
        displayFieldId: settings.displayFieldId,
      }),
    };
    if (
      contents.dynamicOptions?.producerCellId !== binding.producerCellId ||
      contents.dynamicOptions.valueFieldId !== binding.valueFieldId
    )
      next.defaultValueString =
        contents.inputType === "MULTISELECT" ? "[]" : "";
    delete next.optionValueType;
    next.dynamicOptions = binding;
    return next;
  }

  const values =
    settings.values === readSettings(contents).values
      ? (contents.options ?? [])
      : staticValues(settings.values);
  if (
    values.length > 200 ||
    values.some(
      (value) =>
        value.length > 500 ||
        (settings.valueType === "number" && !isNumericNotebookInput(value)),
    )
  )
    return "invalidChoices";
  const options =
    settings.valueType === "number"
      ? [...new Set(values.map((value) => String(Number(value))))]
      : values;
  delete next.dynamicOptions;
  next.options = options;
  if (settings.valueType === "number") next.optionValueType = "number";
  else delete next.optionValueType;
  if (contents.inputType === "MULTISELECT") {
    next.defaultValueString = JSON.stringify(
      parseMultiValue(contents.defaultValueString).filter((value) =>
        options.includes(value),
      ),
    );
  } else if (!options.includes(contents.defaultValueString)) {
    next.defaultValueString = settings.optional ? "" : (options[0] ?? "");
  }
  return next;
}

export function InputSettings({
  contents,
  dataframes,
  disabled,
  updatedAt,
  onSave,
}: {
  contents: InputCellContents;
  dataframes?: readonly ChartDataframe[] | undefined;
  disabled: boolean;
  updatedAt?: string | undefined;
  onSave: (contents: InputCellContents, expectedUpdatedAt?: string) => void;
}) {
  const t = useT();
  const id = useId();
  const configureInput = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<{
    contents: InputCellContents;
    updatedAt: string | undefined;
    settings: Settings;
    requested?: boolean;
    savedMultiline?: boolean;
  } | null>(null);
  const settings = draft?.settings;
  const [error, setError] = useState<SettingsError | null>(null);
  const nameInvalid =
    settings !== undefined && !isSqlInputName(settings.name.trim());
  const choices =
    contents.inputType === "DROPDOWN" || contents.inputType === "MULTISELECT";
  const typeChanged =
    settings !== undefined && settings.inputType !== contents.inputType;
  const showConfigureLabel =
    choices &&
    !disabled &&
    !contents.dynamicOptions &&
    !contents.options?.length;
  const producers = dataframes?.filter(
    ({ sourceOrder }) =>
      sourceOrder !== undefined &&
      compareOrder(sourceOrder, contents.order) < 0,
  );
  const columns = producers?.find(
    ({ cellId }) => cellId === settings?.producerCellId,
  )?.columns;

  useEffect(() => {
    if (disabled) return;
    const openIfRequested = () => {
      if (!consumeInputConfigRequest(contents.id)) return;
      setDraft(
        (current) =>
          current ?? {
            contents,
            updatedAt,
            settings: readSettings(contents),
            requested: true,
          },
      );
    };
    const unsubscribe = onInputConfigRequest(contents.id, openIfRequested);
    openIfRequested();
    return unsubscribe;
  }, [contents, disabled, updatedAt]);

  function update(patch: Partial<Settings>) {
    setDraft(
      (current) =>
        current && {
          ...current,
          settings: { ...current.settings, ...patch },
          requested: false,
        },
    );
    setError(null);
  }

  function commit(settings: Settings, keepOpen: boolean) {
    if (!draft) return;
    const original = readSettings(draft.contents);
    if (JSON.stringify(settings) !== JSON.stringify(original)) {
      const savedMultiline =
        draft.savedMultiline &&
        JSON.stringify(readSettings(contents)) === JSON.stringify(original);
      const revision = savedMultiline ? updatedAt : draft.updatedAt;
      const next = configuredContents(
        savedMultiline ? contents : draft.contents,
        settings,
      );
      if (typeof next === "string") {
        setError(next);
        return;
      }
      onSave(next, revision);
      if (keepOpen) {
        setDraft({
          contents: next,
          updatedAt: revision,
          settings: readSettings(next),
          savedMultiline: true,
        });
      }
    }
    if (!keepOpen) setDraft(null);
  }

  function onOpenChange(open: boolean) {
    if (open) {
      setError(null);
      setDraft({ contents, updatedAt, settings: readSettings(contents) });
    } else if (draft) {
      commit(draft.settings, false);
    }
  }

  function acceptRequest() {
    if (!draft?.requested) return false;
    setDraft({ ...draft, requested: false });
    return true;
  }

  function submitOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onOpenChange(false);
  }

  const labelId = `${id}-config-label`;
  const nameId = `${id}-config-name`;
  const multilineId = `${id}-config-multiline`;

  return (
    <Popover open={draft !== null} onOpenChange={onOpenChange}>
      <div className="flex items-center gap-1">
        <Button
          ref={configureInput}
          type="button"
          variant="ghost"
          size="sm"
          className={
            showConfigureLabel
              ? "h-6 px-1.5"
              : "sr-only focus:not-sr-only h-6 px-1.5"
          }
          disabled={disabled}
          aria-label={t("notebook.inputSettings.configure")}
          aria-haspopup="dialog"
          aria-expanded={draft !== null}
          onClick={() => {
            if (!acceptRequest()) onOpenChange(draft === null);
          }}
        >
          {t("notebook.inputSettings.configure")}
        </Button>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            disabled={disabled}
            aria-label={t("notebook.inputConfig.configure")}
            title={t("notebook.inputConfig.configure")}
            onClick={(event) => {
              if (acceptRequest()) event.preventDefault();
            }}
          >
            <IconSettings size={14} aria-hidden="true" />
          </Button>
        </PopoverTrigger>
      </div>
      {draft && settings && (
        <PopoverContent
          aria-label={t("notebook.inputSettings.title")}
          className="nb-input-config"
          align="start"
          onInteractOutside={(event) => {
            if (
              event.target instanceof Node &&
              configureInput.current?.contains(event.target)
            )
              event.preventDefault();
          }}
        >
          {pickerTypes().includes(settings.inputType as PickerType) && (
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <InputSelect
                  label={t("notebook.inputConfig.inputType")}
                  value={settings.inputType as PickerType}
                  options={pickerTypes().map((type) => ({
                    value: type,
                    label: t(TYPE_TITLE_KEY[type]),
                  }))}
                  onChange={(inputType) => update({ inputType })}
                />
              </div>
              <span
                data-testid="input-output-type"
                className="text-xs text-muted-foreground"
              >
                {t(OUTPUT_TYPE_KEY[settings.inputType as PickerType])}
              </span>
            </div>
          )}
          <div className="nb-input-config-fields">
            <Tooltip
              placement="left"
              content={t("notebook.inputConfig.labelInfo")}
              trigger={
                <label
                  htmlFor={labelId}
                  className="underline decoration-dashed"
                >
                  {t("notebook.inputSettings.label")}
                </label>
              }
            />
            <Input
              id={labelId}
              name="label"
              aria-label={t("notebook.inputSettings.label")}
              value={settings.label ?? inputDisplayLabel(draft.contents)}
              onChange={(event) => {
                const label = event.currentTarget.value;
                const name = nameFromLabel(label);
                const followsLabel =
                  settings.label !== null &&
                  settings.name === nameFromLabel(settings.label);
                update({
                  label,
                  ...(followsLabel && name !== "" && { name }),
                });
              }}
              onKeyDown={submitOnEnter}
            />
            <Tooltip
              placement="left"
              content={t("notebook.inputConfig.nameInfo")}
              trigger={
                <label htmlFor={nameId} className="underline decoration-dashed">
                  {t("notebook.inputSettings.name")}
                </label>
              }
            />
            <Input
              id={nameId}
              name="name"
              aria-label={t("notebook.inputSettings.name")}
              spellCheck={false}
              value={settings.name}
              aria-invalid={nameInvalid}
              onChange={(event) => {
                const name = event.currentTarget.value;
                const usesDefault =
                  settings.label === null ||
                  settings.label === inputNameToLabel(settings.name);
                update({
                  name,
                  ...(usesDefault && { label: inputNameToLabel(name) }),
                });
              }}
              onKeyDown={submitOnEnter}
            />
          </div>
          {contents.inputType === "TEXT_INPUT" && !typeChanged && (
            <label
              className="flex items-center justify-between gap-2 border-t pt-2"
              htmlFor={multilineId}
            >
              {t("notebook.inputConfig.multiline")}
              <Switch
                id={multilineId}
                checked={settings.multiline}
                onCheckedChange={(multiline) =>
                  commit({ ...settings, multiline }, true)
                }
              />
            </label>
          )}
          {choices && !typeChanged && (
            <>
              <div className="nb-input-config-fields">
                <span id={`${id}-values-label`}>
                  {t("notebook.inputChoices.values")}
                </span>
                <div
                  role="group"
                  aria-labelledby={`${id}-values-label`}
                  className="flex"
                >
                  {(["dynamic", "static"] as const).map((mode) => (
                    <Button
                      key={mode}
                      type="button"
                      variant={settings.mode === mode ? "secondary" : "ghost"}
                      size="sm"
                      aria-pressed={settings.mode === mode}
                      className="flex-1"
                      onClick={() => update({ mode })}
                    >
                      {t(`notebook.inputChoices.${mode}`)}
                    </Button>
                  ))}
                </div>
              </div>
              {settings.mode === "dynamic" ? (
                <div className="nb-input-config-choices">
                  <InputSelect
                    label={t("notebook.inputChoices.chooseInput")}
                    value={settings.producerCellId}
                    options={[
                      {
                        value: "",
                        label: t("notebook.inputChoices.chooseInput"),
                      },
                      ...(producers?.map(({ cellId, name }) => ({
                        value: cellId,
                        label: name,
                      })) ?? []),
                    ]}
                    onChange={(producerCellId) =>
                      update({
                        producerCellId,
                        valueFieldId: "",
                        displayFieldId: "",
                      })
                    }
                  />
                  {settings.producerCellId &&
                    (["valueFieldId", "displayFieldId"] as const).map(
                      (field) => {
                        const label = t(
                          field === "valueFieldId"
                            ? "notebook.inputChoices.valueColumn"
                            : "notebook.inputChoices.displayColumn",
                        );
                        return (
                          <InputSelect
                            key={field}
                            label={label}
                            value={settings[field]}
                            placeholder={label}
                            disabled={columns === undefined}
                            options={[
                              { value: "", label },
                              ...(columns?.map((column, index) => ({
                                value: String(index),
                                label: t(
                                  "notebook.inputChoices.columnWithType",
                                  {
                                    column: column.name,
                                    type: column.type,
                                  },
                                ),
                              })) ?? []),
                            ]}
                            onChange={(value) => update({ [field]: value })}
                          />
                        );
                      },
                    )}
                </div>
              ) : (
                <>
                  <div>
                    <Textarea
                      aria-labelledby={`${id}-values-label`}
                      placeholder={t("notebook.inputSettings.commaSeparated")}
                      className="min-h-16 text-xs"
                      spellCheck={false}
                      value={settings.values}
                      onChange={(event) =>
                        update({ values: event.currentTarget.value })
                      }
                    />
                    {settings.values && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => update({ values: "" })}
                      >
                        {t("notebook.inputSettings.clearAll")}
                      </Button>
                    )}
                  </div>
                  <div className="nb-input-config-fields">
                    <label htmlFor={`${id}-data-type`}>
                      {t("notebook.inputSettings.dataType")}
                    </label>
                    <InputSelect
                      id={`${id}-data-type`}
                      label={t("notebook.inputSettings.dataType")}
                      value={settings.valueType}
                      options={[
                        {
                          value: "string",
                          label: t("notebook.inputSettings.stringType"),
                        },
                        {
                          value: "number",
                          label: t("notebook.inputSettings.numberType"),
                        },
                      ]}
                      onChange={(valueType) => update({ valueType })}
                    />
                  </div>
                </>
              )}
              {contents.inputType === "DROPDOWN" && (
                <label
                  className="flex items-center justify-between gap-2"
                  htmlFor={`${id}-optional`}
                >
                  {t("notebook.inputChoices.allowClear")}
                  <Checkbox
                    id={`${id}-optional`}
                    aria-label={t("notebook.inputChoices.allowClear")}
                    checked={settings.optional}
                    onCheckedChange={(optional) =>
                      update({ optional: optional === true })
                    }
                  />
                </label>
              )}
            </>
          )}
          {contents.inputType === "SLIDER" && !typeChanged && (
            <div className="nb-input-config-fields">
              {(["min", "max", "step"] as const).map((key) => (
                <label className="contents" key={key}>
                  <span>{t(`notebook.sliderSettings.${key}`)}</span>
                  <Input
                    type="number"
                    name={`slider-${key}`}
                    step="any"
                    defaultValue={settings.slider[key]}
                    onChange={(event) =>
                      update({
                        slider: {
                          ...settings.slider,
                          [key]: event.currentTarget.valueAsNumber,
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          )}
          {(nameInvalid || error) && (
            <p role="alert" className="text-destructive">
              {nameInvalid || error === "invalidName"
                ? t("notebook.inputConfig.nameInvalid")
                : t(`notebook.inputSettings.${error}`)}
            </p>
          )}
        </PopoverContent>
      )}
    </Popover>
  );
}
