import { useT } from "@agent-native/core/client/i18n";
import {
  calculatedFieldsOf,
  type AnswerType,
  type Block,
  type CalculateOperator,
  type Comparison,
  type Condition,
  type DerivedQuestion,
  type LogicAction,
} from "@shared/form-model";
import { IconX } from "@tabler/icons-react";

import { Input } from "@/components/ui/input";

import {
  jumpTargets,
  optionsOf,
  questionsOnPageOf,
  targetsOnPageOf,
} from "./editor-ops";
import { MultiPicker, Picker, type PickerOption } from "./Picker";

const LABELS: Record<Comparison, string> = {
  is: "forms.editor.comparisons.is",
  is_not: "forms.editor.comparisons.isNot",
  is_any_of: "forms.editor.comparisons.isAnyOf",
  is_not_any_of: "forms.editor.comparisons.isNotAnyOf",
  is_every_of: "forms.editor.comparisons.isEveryOf",
  contains: "forms.editor.comparisons.contains",
  does_not_contain: "forms.editor.comparisons.doesNotContain",
  starts_with: "forms.editor.comparisons.startsWith",
  does_not_start_with: "forms.editor.comparisons.doesNotStartWith",
  ends_with: "forms.editor.comparisons.endsWith",
  does_not_end_with: "forms.editor.comparisons.doesNotEndWith",
  is_empty: "forms.editor.comparisons.isEmpty",
  is_not_empty: "forms.editor.comparisons.isNotEmpty",
  equal: "forms.editor.comparisons.equal",
  not_equal: "forms.editor.comparisons.notEqual",
  greater_than: "forms.editor.comparisons.greaterThan",
  less_than: "forms.editor.comparisons.lessThan",
  greater_or_equal: "forms.editor.comparisons.greaterOrEqual",
  less_or_equal: "forms.editor.comparisons.lessOrEqual",
  is_before: "forms.editor.comparisons.isBefore",
  is_after: "forms.editor.comparisons.isAfter",
};

const EMPTY_CHECKS: Comparison[] = ["is_empty", "is_not_empty"];
const NUMERIC: Comparison[] = [
  "equal",
  "not_equal",
  "greater_than",
  "less_than",
  "greater_or_equal",
  "less_or_equal",
];

function comparisonsFor(type: AnswerType): Comparison[] {
  switch (type) {
    case "MULTIPLE_CHOICE":
    case "DROPDOWN":
      return ["is", "is_not", ...EMPTY_CHECKS, "is_any_of", "is_not_any_of"];
    case "CHECKBOXES":
    case "MULTI_SELECT":
      return [
        "contains",
        "does_not_contain",
        ...EMPTY_CHECKS,
        "is_any_of",
        "is_not_any_of",
        "is_every_of",
      ];
    case "INPUT_NUMBER":
    case "RATING":
    case "LINEAR_SCALE":
      return [
        "equal",
        "not_equal",
        "greater_than",
        "less_than",
        "greater_or_equal",
        "less_or_equal",
        ...EMPTY_CHECKS,
      ];
    case "INPUT_DATE":
    case "INPUT_TIME":
      return ["is", "is_not", "is_before", "is_after", ...EMPTY_CHECKS];
    case "RANKING":
    case "MATRIX":
    case "FILE_UPLOAD":
    case "SIGNATURE":
      return EMPTY_CHECKS;
    case "CALCULATED_FIELD":
      return [
        "equal",
        "not_equal",
        "greater_than",
        "less_than",
        "greater_or_equal",
        "less_or_equal",
        "is",
        "is_not",
        "contains",
        ...EMPTY_CHECKS,
      ];
    case "HIDDEN_FIELD":
    case "INPUT_TEXT":
    case "TEXTAREA":
    case "INPUT_EMAIL":
    case "INPUT_PHONE_NUMBER":
    case "INPUT_LINK":
      return [
        "is",
        "is_not",
        "contains",
        "does_not_contain",
        "starts_with",
        "does_not_start_with",
        "ends_with",
        "does_not_end_with",
        ...EMPTY_CHECKS,
      ];
  }
}

const isChoice = (type: AnswerType) =>
  type === "MULTIPLE_CHOICE" ||
  type === "DROPDOWN" ||
  type === "CHECKBOXES" ||
  type === "MULTI_SELECT";

type ValueKind =
  | "none"
  | "option"
  | "options"
  | "text"
  | "number"
  | "date"
  | "time";

function valueKindFor(type: AnswerType, comparison: Comparison): ValueKind {
  if (EMPTY_CHECKS.includes(comparison)) return "none";
  if (isChoice(type)) {
    return comparison === "is_any_of" ||
      comparison === "is_not_any_of" ||
      comparison === "is_every_of"
      ? "options"
      : "option";
  }
  if (type === "INPUT_NUMBER" || type === "RATING" || type === "LINEAR_SCALE")
    return "number";
  if (type === "CALCULATED_FIELD")
    return NUMERIC.includes(comparison) ? "number" : "text";
  if (type === "INPUT_DATE") return "date";
  if (type === "INPUT_TIME") return "time";
  return "text";
}

const ACTIONS: { type: LogicAction["type"]; labelKey: string }[] = [
  { type: "jump_to_page", labelKey: "forms.editor.logicActions.jumpToPage" },
  {
    type: "require_answer",
    labelKey: "forms.editor.logicActions.requireAnswer",
  },
  { type: "show_blocks", labelKey: "forms.editor.logicActions.showBlocks" },
  { type: "hide_blocks", labelKey: "forms.editor.logicActions.hideBlocks" },
  {
    type: "hide_button_to_disable_completion",
    labelKey: "forms.editor.logicActions.hideButtonToDisableCompletion",
  },
  { type: "calculate", labelKey: "forms.calc.action" },
];

const OPERATORS: { operator: CalculateOperator; labelKey: string }[] = [
  { operator: "add", labelKey: "forms.calc.operators.add" },
  { operator: "subtract", labelKey: "forms.calc.operators.subtract" },
  { operator: "multiply", labelKey: "forms.calc.operators.multiply" },
  { operator: "divide", labelKey: "forms.calc.operators.divide" },
  { operator: "set", labelKey: "forms.calc.operators.set" },
  { operator: "formula", labelKey: "forms.calc.operators.formula" },
];

const TEXT_OPERATORS: CalculateOperator[] = ["add", "set", "formula"];

function defaultAction(type: LogicAction["type"]): LogicAction {
  switch (type) {
    case "jump_to_page":
      return { type, target: "" };
    case "hide_button_to_disable_completion":
      return { type };
    case "calculate":
      return { type, fieldId: "", operator: "add" };
    case "require_answer":
    case "show_blocks":
    case "hide_blocks":
      return { type, targets: [] };
  }
}

function ConditionRow({
  block,
  blocks,
  condition,
  onChange,
}: {
  block: Block;
  blocks: Block[];
  condition: Condition | null;
  onChange: (condition: Condition | null) => void;
}) {
  const t = useT();
  const questions = questionsOnPageOf(blocks, block.uuid);
  if (condition?.type === "group")
    return (
      <p className="text-sm text-muted-foreground">
        {t("forms.editor.combinedConditions", {
          number: condition.conditions.length,
        })}
      </p>
    );
  const question: DerivedQuestion | undefined = questions.find(
    (candidate) => candidate.id === condition?.questionId,
  );
  const comparison = condition?.comparison ?? "is";
  const kind = question ? valueKindFor(question.type, comparison) : "none";
  const optionItems: PickerOption[] = question
    ? optionsOf(blocks, question.id).map((option) => ({
        value: option.uuid,
        label:
          (option.payload as { text?: string }).text ||
          t("forms.editor.untitledOption"),
      }))
    : [];
  const value = condition?.value;
  const textValue =
    typeof value === "string" || typeof value === "number" ? String(value) : "";
  const listValue = Array.isArray(value) ? value : [];

  function set(next: Partial<Extract<Condition, { type: "single" }>>) {
    if (condition?.type !== "single") return;
    onChange({ ...condition, ...next });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Picker
        value={question?.id}
        placeholder={t("forms.editor.selectQuestion")}
        options={questions.map((candidate) => ({
          value: candidate.id,
          label: candidate.title || t("forms.editor.untitledQuestion"),
        }))}
        onChange={(id) =>
          onChange({ type: "single", questionId: id, comparison: "is" })
        }
      />
      {question ? (
        <Picker
          value={comparison}
          placeholder={t("forms.editor.selectComparison")}
          options={comparisonsFor(question.type).map((item) => ({
            value: item,
            label: t(LABELS[item]),
          }))}
          onChange={(next) => {
            const nextComparison = next as Comparison;
            const same =
              valueKindFor(question.type, nextComparison) ===
              valueKindFor(question.type, comparison);
            set({
              comparison: nextComparison,
              value: same ? value : undefined,
            });
          }}
        />
      ) : null}
      {question && kind === "option" ? (
        <Picker
          value={textValue}
          placeholder={t("forms.editor.selectOption")}
          options={optionItems}
          onChange={(next) => set({ value: next })}
        />
      ) : null}
      {question && kind === "options" ? (
        <MultiPicker
          selected={listValue}
          placeholder={t("forms.editor.chooseOptions")}
          options={optionItems}
          onChange={(next) => set({ value: next })}
        />
      ) : null}
      {question &&
      (kind === "text" ||
        kind === "number" ||
        kind === "date" ||
        kind === "time") ? (
        <Input
          aria-label={t("forms.editor.value")}
          className="h-7 w-40 rounded-md border-transparent bg-muted px-2 text-sm shadow-none"
          type={kind === "text" ? "text" : kind}
          value={textValue}
          onChange={(event) => {
            const text = event.target.value;
            if (text === "") set({ value: undefined });
            else if (kind === "number") set({ value: Number(text) });
            else set({ value: text });
          }}
        />
      ) : null}
    </div>
  );
}

function CalculateControls({
  action,
  blocks,
  onChange,
}: {
  action: Extract<LogicAction, { type: "calculate" }>;
  blocks: Block[];
  onChange: (action: LogicAction) => void;
}) {
  const t = useT();
  const fields = calculatedFieldsOf(blocks);
  const field = fields.find((candidate) => candidate.id === action.fieldId);
  const operators = OPERATORS.filter(
    (item) => field?.type !== "text" || TEXT_OPERATORS.includes(item.operator),
  );
  const value = action.value;
  return (
    <>
      <Picker
        value={field?.id}
        placeholder={t("forms.calc.selectField")}
        options={fields.map((item) => ({ value: item.id, label: item.name }))}
        onChange={(fieldId) => onChange({ ...action, fieldId })}
      />
      <Picker
        value={action.operator}
        placeholder={t("forms.calc.selectOperator")}
        options={operators.map((item) => ({
          value: item.operator,
          label:
            field?.type === "text" && item.operator === "add"
              ? t("forms.calc.operators.concat")
              : t(item.labelKey),
        }))}
        onChange={(operator) =>
          onChange({ ...action, operator: operator as CalculateOperator })
        }
      />
      <Input
        aria-label={t("forms.calc.value")}
        className="h-7 w-40 rounded-md border-transparent bg-muted px-2 text-sm shadow-none"
        value={value === undefined ? "" : String(value)}
        onChange={(event) =>
          onChange({ ...action, value: event.target.value || undefined })
        }
      />
    </>
  );
}

function ActionRow({
  action,
  block,
  blocks,
  onChange,
  onRemove,
}: {
  action: LogicAction | null;
  block: Block;
  blocks: Block[];
  onChange: (action: LogicAction) => void;
  onRemove?: () => void;
}) {
  const t = useT();
  const targets = targetsOnPageOf(blocks, block.uuid, t).map((target) => ({
    value: target.id,
    label: target.label,
  }));
  const pages: PickerOption[] = [
    ...jumpTargets(blocks, t).map((page) => ({
      value: page.id,
      label: page.label,
    })),
    ...blocks
      .filter((candidate) => candidate.type === "THANK_YOU_PAGE")
      .map((page) => ({
        value: page.uuid,
        label: t("forms.blocks.thankYouPage"),
      })),
    { value: "end", label: t("forms.editor.defaultThankYouPage") },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Picker
        value={action?.type}
        placeholder={t("forms.editor.selectAction")}
        options={ACTIONS.map((item) => ({
          value: item.type,
          label: t(item.labelKey),
        }))}
        onChange={(type) =>
          onChange(defaultAction(type as LogicAction["type"]))
        }
      />
      {action?.type === "jump_to_page" ? (
        <Picker
          value={action.target}
          placeholder={t("forms.editor.selectPage")}
          options={pages}
          onChange={(target) => onChange({ type: "jump_to_page", target })}
        />
      ) : null}
      {action &&
      (action.type === "require_answer" ||
        action.type === "show_blocks" ||
        action.type === "hide_blocks") ? (
        <MultiPicker
          selected={action.targets}
          placeholder={t("forms.editor.selectBlocks")}
          options={targets}
          onChange={(next) => onChange({ ...action, targets: next })}
        />
      ) : null}
      {action?.type === "calculate" ? (
        <CalculateControls
          action={action}
          blocks={blocks}
          onChange={onChange}
        />
      ) : null}
      {onRemove ? (
        <button
          type="button"
          aria-label={t("forms.editor.removeAction")}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
          onClick={onRemove}
        >
          <IconX className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function LogicBlock({
  block,
  blocks,
  onPatch,
}: {
  block: Block;
  blocks: Block[];
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const t = useT();
  const payload = block.payload as {
    condition?: Condition | null;
    actions?: LogicAction[];
  };
  const actions = payload.actions ?? [];
  const label = "text-xs font-medium text-muted-foreground";
  return (
    <div className="flex flex-col gap-2 border-l-2 border-border py-1 pl-3">
      <span className={label}>{t("forms.editor.when")}</span>
      <ConditionRow
        block={block}
        blocks={blocks}
        condition={payload.condition ?? null}
        onChange={(condition) => onPatch({ condition })}
      />
      <span className={label}>{t("forms.editor.then")}</span>
      {actions.map((action, index) => (
        <ActionRow
          key={index}
          action={action}
          block={block}
          blocks={blocks}
          onChange={(next) =>
            onPatch({
              actions: actions.map((item, at) => (at === index ? next : item)),
            })
          }
          onRemove={() =>
            onPatch({ actions: actions.filter((_, at) => at !== index) })
          }
        />
      ))}
      <ActionRow
        action={null}
        block={block}
        blocks={blocks}
        onChange={(next) => onPatch({ actions: [...actions, next] })}
      />
    </div>
  );
}
