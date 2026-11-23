import { useT } from "@agent-native/core/client/i18n";
import { Tooltip } from "@agent-native/toolkit/design-system";
import { Switch } from "@agent-native/toolkit/ui/switch";
import { IconSettings } from "@tabler/icons-react";
import { useEffect, useRef, useState, type MutableRefObject } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { CellContents } from "@/lib/model/contracts";

import { isSqlInputName } from "../../../shared/sql-input-name";
import {
  consumeInputConfigRequest,
  onInputConfigRequest,
} from "./input-config-request";
import { RENDERABLE_INPUT_TYPES } from "./InputCellControl";

type InputCellContents = Extract<CellContents, { kind: "input" }>;

/** What a new value of each type starts as, in its serialized form. */
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

const OUTPUT_TYPE_KEY = {
  TEXT_INPUT: "notebook.inputConfig.outputTypes.string",
  NUMERIC_INPUT: "notebook.inputConfig.outputTypes.number",
  DROPDOWN: "notebook.inputConfig.outputTypes.string",
  SLIDER: "notebook.inputConfig.outputTypes.number",
  DATE: "notebook.inputConfig.outputTypes.datetime",
  CHECKBOX: "notebook.inputConfig.outputTypes.boolean",
  MULTISELECT: "notebook.inputConfig.outputTypes.listOfStrings",
} as const;

/** The input types in the order the type picker lists them. */
const pickerTypes = () =>
  (Object.keys(TYPE_TITLE_KEY) as (keyof typeof TYPE_TITLE_KEY)[]).filter(
    (type) => RENDERABLE_INPUT_TYPES.includes(type),
  );

const nameFromLabel = (label: string) =>
  label.toLocaleLowerCase().replace(/\s+/g, "_").trim();

/** A name shown as a label: underscores become spaces, first letter upper. */
const labelFromName = (name: string) => {
  const spaced = name.replace(/_/g, " ");
  return spaced.charAt(0).toLocaleUpperCase() + spaced.substring(1);
};

function ConfigForm({
  contents,
  onChangeContents,
  onClose,
  commitRef,
}: {
  contents: InputCellContents;
  onChangeContents: (contents: InputCellContents) => void;
  onClose: () => void;
  commitRef: MutableRefObject<(() => void) | null>;
}) {
  const t = useT();
  const [label, setLabel] = useState(contents.label ?? "");
  const [name, setName] = useState(contents.name);
  const nameValid = isSqlInputName(name);

  // The name follows the label only while it still matches the label's own
  // slug; a name the person has edited on its own stays put.
  const changeLabel = (next: string) => {
    if (name === nameFromLabel(label)) setName(nameFromLabel(next));
    setLabel(next);
  };

  const commit = () => {
    const nextName = nameValid ? name : contents.name;
    let nextLabel: string | null = contents.label;
    if (label === "") {
      if (contents.label != null) nextLabel = null;
      else if (nextName !== contents.name) nextLabel = labelFromName(nextName);
    } else if (label !== contents.label) {
      nextLabel = label;
    } else if (contents.label == null && nextName !== contents.name) {
      nextLabel = labelFromName(nextName);
    }
    if (nextName === contents.name && nextLabel === contents.label) return;
    onChangeContents({ ...contents, name: nextName, label: nextLabel });
  };

  // The popover can close from outside the form (click away, Escape), so the
  // owner saves through this handle instead of the form's own buttons.
  useEffect(() => {
    commitRef.current = commit;
    return () => {
      commitRef.current = null;
    };
  });

  const onEnter = (event: React.KeyboardEvent) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onClose();
  };

  const labelId = `${contents.id}-config-label`;
  const nameId = `${contents.id}-config-name`;
  const multilineId = `${contents.id}-config-multiline`;
  const fieldLabel = (htmlFor: string, text: string, info: string) => (
    <Tooltip
      content={info}
      placement="left"
      trigger={
        <Label htmlFor={htmlFor} className="underline decoration-dashed">
          {text}
        </Label>
      }
    />
  );

  // A type change starts the new type from its own default; settings that only
  // mean something to the old type go with it.
  const changeType = (inputType: InputCellContents["inputType"]) => {
    if (inputType === contents.inputType) return;
    const {
      options: _options,
      optionLabels: _optionLabels,
      optionsSource: _optionsSource,
      optional: _optional,
      multiline: _multiline,
      sliderOptions: _sliderOptions,
      ...rest
    } = contents;
    onChangeContents({
      ...rest,
      inputType,
      defaultValueString: TYPE_DEFAULT_VALUE[inputType],
    });
  };
  const currentType = contents.inputType as keyof typeof TYPE_TITLE_KEY;

  return (
    <div className="flex flex-col gap-3 p-1">
      {pickerTypes().includes(currentType) ? (
        <div className="flex items-center gap-2">
          <select
            aria-label={t("notebook.inputConfig.inputType")}
            className="h-8 flex-1 rounded-md border bg-transparent px-2 text-sm"
            value={currentType}
            onChange={(event) =>
              changeType(event.target.value as InputCellContents["inputType"])
            }
          >
            {pickerTypes().map((type) => (
              <option key={type} value={type}>
                {t(TYPE_TITLE_KEY[type])}
              </option>
            ))}
          </select>
          <span
            data-testid="input-output-type"
            className="text-xs text-muted-foreground"
          >
            {t(OUTPUT_TYPE_KEY[currentType])}
          </span>
        </div>
      ) : null}
      <div className="grid grid-cols-[4.5rem_1fr] items-center gap-x-3 gap-y-2">
        {fieldLabel(
          labelId,
          t("notebook.inputConfig.label"),
          t("notebook.inputConfig.labelInfo"),
        )}
        <Input
          id={labelId}
          aria-label={t("notebook.inputConfig.label")}
          value={label}
          onChange={(event) => changeLabel(event.target.value)}
          onKeyDown={onEnter}
        />
        {fieldLabel(
          nameId,
          t("notebook.inputConfig.name"),
          t("notebook.inputConfig.nameInfo"),
        )}
        <Input
          id={nameId}
          aria-label={t("notebook.inputConfig.name")}
          aria-invalid={!nameValid}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={onEnter}
        />
      </div>
      {nameValid ? null : (
        <p className="text-xs text-destructive" role="alert">
          {t("notebook.inputConfig.nameInvalid")}
        </p>
      )}
      {contents.inputType === "TEXT_INPUT" ? (
        <div className="flex items-center justify-between border-t pt-3">
          <Label htmlFor={multilineId}>
            {t("notebook.inputConfig.multiline")}
          </Label>
          <Switch
            id={multilineId}
            checked={contents.multiline === true}
            onCheckedChange={(checked) =>
              onChangeContents({ ...contents, multiline: checked })
            }
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The input cell's own settings. The form mounts only while the popover is
 * open, so each opening starts from what is saved; closing by any route saves
 * a valid change.
 */
export function InputCellConfig({
  contents,
  disabled,
  onChangeContents,
}: {
  contents: InputCellContents;
  disabled: boolean;
  onChangeContents: (contents: InputCellContents) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const commitRef = useRef<(() => void) | null>(null);
  const changeOpen = (next: boolean) => {
    if (!next) commitRef.current?.();
    setOpen(next);
  };
  const cellId = contents.id;
  useEffect(() => {
    const openIfRequested = () => {
      if (consumeInputConfigRequest(cellId)) setOpen(true);
    };
    openIfRequested();
    return onInputConfigRequest(cellId, openIfRequested);
  }, [cellId]);
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="nb-icon-button"
          aria-label={t("notebook.inputConfig.configure")}
          title={t("notebook.inputConfig.configure")}
          disabled={disabled}
        >
          <IconSettings size={14} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className={
          contents.inputType === "MULTISELECT" ? "w-[460px]" : "w-[340px]"
        }
      >
        <ConfigForm
          contents={contents}
          onChangeContents={onChangeContents}
          onClose={() => changeOpen(false)}
          commitRef={commitRef}
        />
      </PopoverContent>
    </Popover>
  );
}
