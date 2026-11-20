import { useT } from "@agent-native/core/client/i18n";
import { MAX_UPLOAD_MB, type QuestionType } from "@shared/form-model";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Payload = Record<string, unknown>;
type Patch = (patch: Payload) => void;

function LimitField({
  label,
  flag,
  field,
  payload,
  onPatch,
  min,
  max,
}: {
  label: string;
  flag?: string;
  field: string;
  payload: Payload;
  onPatch: Patch;
  min?: number;
  max?: number;
}) {
  const raw = payload[field];
  const value = typeof raw === "number" ? String(raw) : "";
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="text-sm font-normal">{label}</Label>
      <Input
        type="number"
        inputMode="numeric"
        aria-label={label}
        className="h-8 w-24"
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const text = event.target.value;
          if (text === "") {
            onPatch(
              flag
                ? { [flag]: false, [field]: undefined }
                : { [field]: undefined },
            );
            return;
          }
          const number = Number(text);
          const whole =
            field === "minNumber" ||
            field === "maxNumber" ||
            Number.isInteger(number);
          const inRange =
            (min === undefined || number >= min) &&
            (max === undefined || number <= max);
          if (!Number.isFinite(number) || !whole || !inRange) return;
          onPatch(
            flag ? { [flag]: true, [field]: number } : { [field]: number },
          );
        }}
      />
    </div>
  );
}

function ToggleField({
  label,
  field,
  payload,
  onPatch,
}: {
  label: string;
  field: string;
  payload: Payload;
  onPatch: Patch;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="text-sm font-normal">{label}</Label>
      <Switch
        aria-label={label}
        checked={payload[field] === true}
        onCheckedChange={(checked) => onPatch({ [field]: checked })}
      />
    </div>
  );
}

const PLACEHOLDER_TYPES: QuestionType[] = [
  "INPUT_TEXT",
  "TEXTAREA",
  "INPUT_EMAIL",
  "INPUT_NUMBER",
  "INPUT_PHONE_NUMBER",
  "INPUT_LINK",
];

export function QuestionSettings({
  type,
  payload,
  onPatch,
}: {
  type: QuestionType;
  payload: Payload;
  onPatch: Patch;
}) {
  const t = useT();
  const placeholder =
    typeof payload.placeholder === "string" ? payload.placeholder : "";
  const isChoice =
    type === "MULTIPLE_CHOICE" ||
    type === "CHECKBOXES" ||
    type === "DROPDOWN" ||
    type === "MULTI_SELECT" ||
    type === "RANKING";
  const allowedTypes = Array.isArray(payload.allowedTypes)
    ? payload.allowedTypes.join(", ")
    : "";
  const isMulti = type === "CHECKBOXES" || type === "MULTI_SELECT";
  return (
    <div className="flex flex-col gap-3">
      <ToggleField
        label={t("forms.editor.required")}
        field="isRequired"
        payload={payload}
        onPatch={onPatch}
      />
      {type === "INPUT_EMAIL" ? (
        <ToggleField
          label={t("forms.notify.verifyEmail")}
          field="requireVerification"
          payload={payload}
          onPatch={onPatch}
        />
      ) : null}
      {PLACEHOLDER_TYPES.includes(type) ? (
        <div className="flex items-center justify-between gap-3">
          <Label className="text-sm font-normal">
            {t("forms.editor.placeholder")}
          </Label>
          <Input
            aria-label={t("forms.editor.placeholder")}
            className="h-8 w-40"
            value={placeholder}
            maxLength={500}
            onChange={(event) => onPatch({ placeholder: event.target.value })}
          />
        </div>
      ) : null}
      {type === "INPUT_TEXT" || type === "TEXTAREA" ? (
        <>
          <LimitField
            label={t("forms.editor.minCharacters")}
            flag="hasMinCharacters"
            field="minCharacters"
            payload={payload}
            onPatch={onPatch}
            min={0}
          />
          <LimitField
            label={t("forms.editor.maxCharacters")}
            flag="hasMaxCharacters"
            field="maxCharacters"
            payload={payload}
            onPatch={onPatch}
            min={0}
          />
        </>
      ) : null}
      {type === "INPUT_NUMBER" ? (
        <>
          <LimitField
            label={t("forms.editor.minNumber")}
            flag="hasMinNumber"
            field="minNumber"
            payload={payload}
            onPatch={onPatch}
          />
          <LimitField
            label={t("forms.editor.maxNumber")}
            flag="hasMaxNumber"
            field="maxNumber"
            payload={payload}
            onPatch={onPatch}
          />
        </>
      ) : null}
      {isChoice ? (
        <ToggleField
          label={t("forms.editor.randomizeOrder")}
          field="randomize"
          payload={payload}
          onPatch={onPatch}
        />
      ) : null}
      {isMulti ? (
        <>
          <LimitField
            label={t("forms.editor.minChoices")}
            flag="hasMinChoices"
            field="minChoices"
            payload={payload}
            onPatch={onPatch}
            min={0}
          />
          <LimitField
            label={t("forms.editor.maxChoices")}
            flag="hasMaxChoices"
            field="maxChoices"
            payload={payload}
            onPatch={onPatch}
            min={0}
          />
        </>
      ) : null}
      {type === "MATRIX" ? (
        <ToggleField
          label={t("forms.richBlocks.editor.multiplePerRow")}
          field="allowMultiple"
          payload={payload}
          onPatch={onPatch}
        />
      ) : null}
      {type === "FILE_UPLOAD" ? (
        <>
          <ToggleField
            label={t("forms.richBlocks.editor.multipleFiles")}
            field="allowMultiple"
            payload={payload}
            onPatch={onPatch}
          />
          {payload.allowMultiple === true ? (
            <LimitField
              label={t("forms.richBlocks.editor.maxFiles")}
              field="maxFiles"
              payload={payload}
              onPatch={onPatch}
              min={1}
              max={20}
            />
          ) : null}
          <LimitField
            label={t("forms.richBlocks.editor.maxSize")}
            field="maxSizeMb"
            payload={payload}
            onPatch={onPatch}
            min={1}
            max={MAX_UPLOAD_MB}
          />
          <div className="flex items-center justify-between gap-3">
            <Label className="text-sm font-normal">
              {t("forms.richBlocks.editor.allowedTypes")}
            </Label>
            <Input
              aria-label={t("forms.richBlocks.editor.allowedTypes")}
              className="h-8 w-40"
              placeholder="image/*, application/pdf" // i18n-ignore MIME types are data, not copy
              defaultValue={allowedTypes}
              onChange={(event) =>
                onPatch({
                  allowedTypes: event.target.value
                    .split(",")
                    .map((entry) => entry.trim())
                    .filter(Boolean)
                    .slice(0, 20),
                })
              }
            />
          </div>
        </>
      ) : null}
      {type === "RATING" ? (
        <LimitField
          label={t("forms.editor.stars")}
          field="stars"
          payload={payload}
          onPatch={onPatch}
          min={1}
          max={10}
        />
      ) : null}
      {type === "LINEAR_SCALE" ? (
        <>
          <LimitField
            label={t("forms.editor.from")}
            field="start"
            payload={payload}
            onPatch={onPatch}
            min={0}
            max={1}
          />
          <LimitField
            label={t("forms.editor.to")}
            field="end"
            payload={payload}
            onPatch={onPatch}
            min={2}
            max={10}
          />
        </>
      ) : null}
    </div>
  );
}
