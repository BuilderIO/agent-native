import { useT } from "@agent-native/core/client/i18n";
import {
  isChoiceAnswer,
  type AnswerValue,
  type ChoiceAnswer,
  type DerivedQuestion,
} from "@shared/form-model";
import { IconChevronDown, IconStar } from "@tabler/icons-react";
import { useState } from "react";

import { RequiredDot } from "@/components/forms/BlockRenderer";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FIELD_SURFACE, STAR_INK } from "@/lib/field-surface";
import { cn } from "@/lib/utils";

import { MatrixField } from "./matrix-field";
import { RankingField } from "./ranking-field";
import { FileField, SignatureField } from "./upload-fields";

export type FieldProps = {
  question: DerivedQuestion;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
  onBlur: () => void;
  invalid: boolean;
  /** The live form's id; absent in the editor's Preview, which uploads nothing. */
  formId?: string | null | undefined;
};

export const inputClass = `forms-input h-9 w-80 max-w-full ${FIELD_SURFACE} px-2.5 text-base leading-[18.4px] text-foreground outline-none placeholder:text-[color:var(--forms-placeholder)] focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-destructive`;

const optionClass =
  "forms-input flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg border border-input bg-background px-2.5 text-base text-foreground shadow-sm has-[:checked]:border-foreground has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-ring";

const payloadOf = (question: DerivedQuestion) =>
  question.settings.payload as Record<string, unknown>;

const numberOf = (value: unknown, fallback: number) =>
  typeof value === "number" ? value : fallback;

function describe(question: DerivedQuestion, invalid: boolean) {
  return {
    "aria-label": question.title,
    "aria-invalid": invalid,
    "aria-describedby": invalid ? `error_${question.id}` : undefined,
  };
}

function TextField({
  question,
  value,
  onChange,
  onBlur,
  invalid,
  type,
}: FieldProps & { type: "text" | "email" | "tel" | "url" | "time" }) {
  const placeholder = payloadOf(question).placeholder;
  return (
    <input
      {...describe(question, invalid)}
      type={type}
      className={inputClass}
      placeholder={typeof placeholder === "string" ? placeholder : ""}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
    />
  );
}

function NumberField({
  question,
  value,
  onChange,
  onBlur,
  invalid,
}: FieldProps) {
  const placeholder = payloadOf(question).placeholder;
  return (
    <input
      {...describe(question, invalid)}
      type="number"
      className={inputClass}
      placeholder={typeof placeholder === "string" ? placeholder : ""}
      value={typeof value === "number" ? value : ""}
      onChange={(event) =>
        onChange(event.target.value === "" ? null : Number(event.target.value))
      }
      onBlur={onBlur}
    />
  );
}

function TextAreaField({
  question,
  value,
  onChange,
  onBlur,
  invalid,
}: FieldProps) {
  const placeholder = payloadOf(question).placeholder;
  return (
    <textarea
      {...describe(question, invalid)}
      className={cn(inputClass, "h-24 w-full max-w-[700px] resize-y !py-[9px]")}
      placeholder={typeof placeholder === "string" ? placeholder : ""}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
    />
  );
}

function isoToDisplay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

function displayToIso(text: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  return match ? `${match[3]}-${match[2]}-${match[1]}` : text;
}

/** Shows DD/MM/YYYY and answers with an ISO date; unfinished text stays invalid. */
function DateField({ question, value, onChange, onBlur, invalid }: FieldProps) {
  const t = useT();
  const [text, setText] = useState(
    typeof value === "string" ? isoToDisplay(value) : "",
  );
  return (
    <input
      {...describe(question, invalid)}
      type="text"
      inputMode="numeric"
      className={inputClass}
      placeholder={t("forms.respond.datePlaceholder")}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(displayToIso(event.target.value));
      }}
      onBlur={onBlur}
    />
  );
}

function selectedOf(value: AnswerValue): ChoiceAnswer {
  return isChoiceAnswer(value) ? value : { selected: [] };
}

function OtherInput({
  question,
  choice,
  onChange,
}: {
  question: DerivedQuestion;
  choice: ChoiceAnswer;
  onChange: (value: ChoiceAnswer) => void;
}) {
  const t = useT();
  return (
    <input
      aria-label={t("forms.respond.otherLabel", { title: question.title })}
      className={cn(inputClass, "mb-1")}
      value={choice.other ?? ""}
      onChange={(event) => onChange({ ...choice, other: event.target.value })}
    />
  );
}

function ChoiceList({ question, value, onChange, invalid }: FieldProps) {
  const multiple = question.type === "CHECKBOXES";
  const choice = selectedOf(value);
  const otherSelected = question.options.some(
    (option) => option.isOther && choice.selected.includes(option.id),
  );

  function toggle(id: string) {
    if (!multiple) return onChange({ ...choice, selected: [id] });
    const selected = choice.selected.includes(id)
      ? choice.selected.filter((candidate) => candidate !== id)
      : [...choice.selected, id];
    onChange({ ...choice, selected });
  }

  return (
    <div
      role={multiple ? "group" : "radiogroup"}
      aria-label={question.title}
      aria-invalid={invalid}
      aria-describedby={invalid ? `error_${question.id}` : undefined}
      className="flex flex-col items-start gap-3"
    >
      {question.options.map((option, index) => (
        <label key={option.id} className={optionClass}>
          <input
            type={multiple ? "checkbox" : "radio"}
            name={question.id}
            className="sr-only"
            checked={choice.selected.includes(option.id)}
            onChange={() => toggle(option.id)}
          />
          <span
            aria-hidden
            className="flex size-[18px] items-center justify-center rounded-[3px] bg-[hsl(var(--forms-keycap))] text-xs font-black text-primary-foreground"
          >
            {String.fromCharCode(65 + index)}
          </span>
          <span>{option.text}</span>
        </label>
      ))}
      {otherSelected ? (
        <OtherInput question={question} choice={choice} onChange={onChange} />
      ) : null}
    </div>
  );
}

function DropdownField({ question, value, onChange, invalid }: FieldProps) {
  const t = useT();
  const choice = selectedOf(value);
  const otherSelected = question.options.some(
    (option) => option.isOther && choice.selected.includes(option.id),
  );
  return (
    <div className="flex flex-col gap-2">
      <select
        {...describe(question, invalid)}
        className={inputClass}
        value={choice.selected[0] ?? ""}
        onChange={(event) =>
          onChange({ ...choice, selected: [event.target.value] })
        }
      >
        <option value="" disabled>
          {t("forms.respond.selectOption")}
        </option>
        {question.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.text}
          </option>
        ))}
      </select>
      {otherSelected ? (
        <OtherInput question={question} choice={choice} onChange={onChange} />
      ) : null}
    </div>
  );
}

function MultiSelectField({ question, value, onChange, invalid }: FieldProps) {
  const t = useT();
  const choice = selectedOf(value);
  const labels = question.options
    .filter((option) => choice.selected.includes(option.id))
    .map((option) => option.text);
  const otherSelected = question.options.some(
    (option) => option.isOther && choice.selected.includes(option.id),
  );
  return (
    <div className="flex flex-col gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            {...describe(question, invalid)}
            className={cn(
              inputClass,
              "flex items-center justify-between gap-2",
            )}
          >
            <span
              className={cn(
                "truncate",
                labels.length === 0 && "text-muted-foreground/70",
              )}
            >
              {labels.length
                ? labels.join(", ")
                : t("forms.respond.selectOptions")}
            </span>
            <IconChevronDown size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          {question.options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.id}
              checked={choice.selected.includes(option.id)}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) =>
                onChange({
                  ...choice,
                  selected: checked
                    ? [...choice.selected, option.id]
                    : choice.selected.filter((id) => id !== option.id),
                })
              }
            >
              {option.text}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {otherSelected ? (
        <OtherInput question={question} choice={choice} onChange={onChange} />
      ) : null}
    </div>
  );
}

function RatingField({ question, value, onChange, invalid }: FieldProps) {
  const t = useT();
  const stars = numberOf(payloadOf(question).stars, 5);
  const current = typeof value === "number" ? value : 0;
  return (
    <div
      role="radiogroup"
      aria-label={question.title}
      aria-invalid={invalid}
      aria-describedby={invalid ? `error_${question.id}` : undefined}
      className="flex pb-[3px]"
    >
      {Array.from({ length: stars }, (_, index) => {
        const star = index + 1;
        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={current === star}
            aria-label={t("forms.respond.star", { count: star })}
            className={cn(
              "rounded-md p-0 text-start outline-none focus-visible:ring-1 focus-visible:ring-ring",
              STAR_INK,
            )}
            onClick={() => onChange(star)}
          >
            <IconStar
              size={36}
              stroke={1.5}
              className={cn(star <= current && "text-[hsl(var(--forms-star))]")}
              fill={star <= current ? "currentColor" : "none"}
            />
          </button>
        );
      })}
    </div>
  );
}

function ScaleField({ question, value, onChange, invalid }: FieldProps) {
  const payload = payloadOf(question);
  const start = numberOf(payload.start, 1);
  const end = numberOf(payload.end, 5);
  const step = numberOf(payload.step, 1);
  const values: number[] = [];
  for (let next = start; next <= end; next += step) values.push(next);
  const label = (flag: string, key: string) =>
    payload[flag] === true && typeof payload[key] === "string"
      ? payload[key]
      : null;
  return (
    <div>
      <div
        role="radiogroup"
        aria-label={question.title}
        aria-invalid={invalid}
        aria-describedby={invalid ? `error_${question.id}` : undefined}
        className="flex gap-2"
      >
        {values.map((scaleValue) => (
          <button
            key={scaleValue}
            type="button"
            role="radio"
            aria-checked={value === scaleValue}
            className={cn(
              "forms-input flex size-9 items-center justify-center rounded-lg border border-input bg-background text-base shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring",
              value === scaleValue &&
                "border-foreground bg-foreground text-background",
            )}
            onClick={() => onChange(scaleValue)}
          >
            {scaleValue}
          </button>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-sm text-muted-foreground">
        <span>{label("hasLeftLabel", "leftLabel")}</span>
        <span>{label("hasCenterLabel", "centerLabel")}</span>
        <span>{label("hasRightLabel", "rightLabel")}</span>
      </div>
    </div>
  );
}

function Control(props: FieldProps) {
  switch (props.question.type) {
    case "INPUT_TEXT":
      return <TextField {...props} type="text" />;
    case "INPUT_EMAIL":
      return <TextField {...props} type="email" />;
    case "INPUT_PHONE_NUMBER":
      return <TextField {...props} type="tel" />;
    case "INPUT_LINK":
      return <TextField {...props} type="url" />;
    case "INPUT_TIME":
      return <TextField {...props} type="time" />;
    case "INPUT_NUMBER":
      return <NumberField {...props} />;
    case "INPUT_DATE":
      return <DateField {...props} />;
    case "TEXTAREA":
      return <TextAreaField {...props} />;
    case "MULTIPLE_CHOICE":
    case "CHECKBOXES":
      return <ChoiceList {...props} />;
    case "DROPDOWN":
      return <DropdownField {...props} />;
    case "MULTI_SELECT":
      return <MultiSelectField {...props} />;
    case "RATING":
      return <RatingField {...props} />;
    case "LINEAR_SCALE":
      return <ScaleField {...props} />;
    case "RANKING":
      return <RankingField {...props} />;
    case "MATRIX":
      return <MatrixField {...props} />;
    case "FILE_UPLOAD":
      return <FileField {...props} />;
    case "SIGNATURE":
      return <SignatureField {...props} />;
    case "CALCULATED_FIELD":
    case "HIDDEN_FIELD":
      return null;
  }
}

export function QuestionField({
  required,
  message,
  ...props
}: FieldProps & { required: boolean; message: string | null }) {
  return (
    <div className="forms-question">
      <div className="py-px">
        <div className="relative">
          <div className="relative inline-flex pt-5 pb-2.5">
            <h3 className="forms-question-title pr-[5px] text-xl leading-[25px] font-semibold">
              {props.question.title}
            </h3>
            {required ? <RequiredDot /> : null}
          </div>
        </div>
      </div>
      <div className="py-px">
        <div className="relative mb-[10px]">
          <Control {...props} />
          {message ? (
            <p
              id={`error_${props.question.id}`}
              role="alert"
              className="mt-3 text-sm text-destructive"
            >
              {message}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
