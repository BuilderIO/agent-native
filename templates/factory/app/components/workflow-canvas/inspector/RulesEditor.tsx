import { IconPlus, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  formatOperand,
  parseOperand,
  ruleNeedsOperand,
  ruleOps,
  checkTemplateText,
  type Rule,
  type RuleOp,
} from "@/lib/workflow-editor";

import { useWorkflowCanvasStrings } from "../strings";
import type { FormContext } from "./context";
import { PathInput, ProblemText, SelectInput, TextInput } from "./fields";

/** The right-hand value, typed as text and read back as a number, yes or no, list, or text. */
function OperandInput({
  op,
  value,
  onChange,
  context,
}: {
  op: RuleOp;
  value: unknown;
  onChange: (value: unknown) => void;
  context: FormContext;
}) {
  const s = useWorkflowCanvasStrings();

  const [text, setText] = useState(() => formatOperand(op, value));
  useEffect(() => {
    setText((current) =>
      JSON.stringify(parseOperand(op, current)) === JSON.stringify(value)
        ? current
        : formatOperand(op, value),
    );
  }, [op, value]);
  const problem =
    typeof value === "string"
      ? checkTemplateText(value, context.expression)
      : null;
  return (
    <div className="flex flex-col gap-1">
      <TextInput
        value={text}
        invalid={problem !== null}
        placeholder={
          op === "inList" || op === "between"
            ? s.inspector.rules.listHint
            : undefined
        }
        onChange={(next) => {
          setText(next);
          onChange(parseOperand(op, next));
        }}
      />
      <ProblemText problem={problem} />
    </div>
  );
}

export function RuleRow({
  rule,
  onChange,
  onRemove,
  context,
}: {
  rule: Rule;
  onChange: (rule: Rule) => void;
  onRemove?: () => void;
  context: FormContext;
}) {
  const s = useWorkflowCanvasStrings();
  const opOptions = ruleOps().map((op) => ({
    value: op,
    label: s.inspector.rules.op[op],
  }));

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border p-2">
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <PathInput
            value={rule.left}
            context={context}
            onChange={(left) => onChange({ ...rule, left })}
          />
        </div>
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={s.inspector.rules.remove}
            title={s.inspector.rules.remove}
            onClick={onRemove}
          >
            <IconX />
          </Button>
        )}
      </div>
      <SelectInput
        value={rule.op}
        options={opOptions}
        onChange={(op) => {
          const next: Rule = { left: rule.left, op };
          if (ruleNeedsOperand(op)) {
            next.right = rule.right === undefined ? "" : rule.right;
          }
          onChange(next);
        }}
      />
      {ruleNeedsOperand(rule.op) && (
        <OperandInput
          op={rule.op}
          value={rule.right}
          context={context}
          onChange={(right) => onChange({ ...rule, right })}
        />
      )}
    </div>
  );
}

/** A list of rules joined by all/any. At least `minRules` stay, since the schema needs one. */
export function RulesEditor({
  combinator,
  onCombinator,
  rules,
  onChange,
  context,
  minRules = 1,
}: {
  combinator: "all" | "any";
  onCombinator: (combinator: "all" | "any") => void;
  rules: readonly Rule[];
  onChange: (rules: Rule[]) => void;
  context: FormContext;
  minRules?: number;
}) {
  const s = useWorkflowCanvasStrings();

  return (
    <div className="flex flex-col gap-2">
      {rules.length > 1 && (
        <SelectInput
          value={combinator}
          options={[
            { value: "all", label: s.inspector.rules.matchAll },
            { value: "any", label: s.inspector.rules.matchAny },
          ]}
          onChange={onCombinator}
        />
      )}
      {rules.map((rule, index) => (
        <RuleRow
          key={index}
          rule={rule}
          context={context}
          onChange={(next) =>
            onChange(rules.map((r, i) => (i === index ? next : r)))
          }
          onRemove={
            rules.length > minRules
              ? () => onChange(rules.filter((_, i) => i !== index))
              : undefined
          }
        />
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="justify-start"
        onClick={() =>
          onChange([
            ...rules,
            { left: "item.title", op: "contains", right: "" },
          ])
        }
      >
        <IconPlus />
        {s.inspector.rules.add}
      </Button>
    </div>
  );
}
