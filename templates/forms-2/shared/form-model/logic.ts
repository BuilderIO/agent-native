import { isChoiceAnswer, isEmptyAnswer } from "./answers.js";
import type { Page } from "./pages.js";
import type {
  AnswerValue,
  Answers,
  Block,
  Comparison,
  Condition,
  ConditionValue,
  DerivedQuestion,
  LogicAction,
} from "./types.js";

export type PageState = {
  /** Blocks to render: no logic or field blocks and nothing hidden by a rule. */
  visibleBlocks: Block[];
  /** Block uuids and group uuids hidden by a rule. */
  hiddenIds: Set<string>;
  /** Question ids a rule made required for this answer set. */
  requiredIds: Set<string>;
  /** The first matched jump target: a page-break uuid or "end". */
  jumpTarget: string | null;
  /** A matched rule removes the Next and Submit button. */
  hideButton: boolean;
};

const NEGATIVE: ReadonlySet<Comparison> = new Set([
  "is_not",
  "is_not_any_of",
  "does_not_contain",
  "does_not_start_with",
  "does_not_end_with",
  "not_equal",
]);

function asList(value: ConditionValue | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

const fold = (value: unknown) => String(value).trim().toLowerCase();

function textOf(answer: AnswerValue): string {
  return typeof answer === "object" ? "" : fold(answer);
}

function compare(
  comparison: Comparison,
  answer: AnswerValue,
  value: ConditionValue | undefined,
): boolean {
  if (comparison === "is_empty") return isEmptyAnswer(answer);
  if (comparison === "is_not_empty") return !isEmptyAnswer(answer);
  if (isEmptyAnswer(answer)) return NEGATIVE.has(comparison);

  const wanted = asList(value);
  const selected = isChoiceAnswer(answer) ? answer.selected : null;
  const text = textOf(answer);
  const needle = fold(wanted[0] ?? "");

  switch (comparison) {
    case "is":
      return selected
        ? selected.length === 1 && selected[0] === wanted[0]
        : text === needle;
    case "is_not":
      return !compare("is", answer, value);
    case "is_any_of":
      return selected
        ? selected.some((id) => wanted.includes(id))
        : wanted.some((candidate) => fold(candidate) === text);
    case "is_not_any_of":
      return !compare("is_any_of", answer, value);
    case "is_every_of":
      return selected ? wanted.every((id) => selected.includes(id)) : false;
    case "contains":
      return selected
        ? selected.includes(wanted[0] ?? "")
        : text.includes(needle);
    case "does_not_contain":
      return !compare("contains", answer, value);
    case "starts_with":
      return !selected && text.startsWith(needle);
    case "does_not_start_with":
      return !compare("starts_with", answer, value);
    case "ends_with":
      return !selected && text.endsWith(needle);
    case "does_not_end_with":
      return !compare("ends_with", answer, value);
    case "equal":
    case "not_equal":
    case "greater_than":
    case "less_than":
    case "greater_or_equal":
    case "less_or_equal": {
      const left = Number(answer);
      const right = Number(wanted[0]);
      if (Number.isNaN(left) || Number.isNaN(right)) return false;
      if (comparison === "equal") return left === right;
      if (comparison === "not_equal") return left !== right;
      if (comparison === "greater_than") return left > right;
      if (comparison === "less_than") return left < right;
      if (comparison === "greater_or_equal") return left >= right;
      return left <= right;
    }
    case "is_before":
      return typeof answer !== "object" && String(answer) < (wanted[0] ?? "");
    case "is_after":
      return typeof answer !== "object" && String(answer) > (wanted[0] ?? "");
  }
}

export function evaluateCondition(
  condition: Condition,
  answers: Answers,
): boolean {
  if (condition.type === "single")
    return compare(
      condition.comparison,
      answers[condition.questionId],
      condition.value,
    );
  const results = condition.conditions.map((child) =>
    evaluateCondition(child, answers),
  );
  if (results.length === 0) return false;
  return condition.operator === "and"
    ? results.every(Boolean)
    : results.some(Boolean);
}

type LogicPayload = { condition?: Condition | null; actions?: LogicAction[] };

function targeted(block: Block, ids: ReadonlySet<string>): boolean {
  return ids.has(block.uuid) || ids.has(block.groupUuid);
}

/**
 * Applies the page's CONDITIONAL_LOGIC blocks to the current answers.
 * `show_blocks` targets start hidden until a matched rule shows them.
 */
export function evaluatePage(page: Page, answers: Answers): PageState {
  const showTargets = new Set<string>();
  const shown = new Set<string>();
  const hidden = new Set<string>();
  const requiredIds = new Set<string>();
  let jumpTarget: string | null = null;
  let hideButton = false;

  for (const block of page.blocks) {
    if (block.type !== "CONDITIONAL_LOGIC") continue;
    const { condition, actions = [] } = block.payload as LogicPayload;
    const matched = condition ? evaluateCondition(condition, answers) : false;
    for (const action of actions) {
      if (action.type === "show_blocks")
        for (const id of action.targets) {
          showTargets.add(id);
          if (matched) shown.add(id);
        }
      if (!matched) continue;
      if (action.type === "hide_blocks")
        for (const id of action.targets) hidden.add(id);
      else if (action.type === "require_answer")
        for (const id of action.targets) requiredIds.add(id);
      else if (action.type === "jump_to_page") jumpTarget ??= action.target;
      else if (action.type === "hide_button_to_disable_completion")
        hideButton = true;
    }
  }

  const hiddenIds = new Set<string>();
  const visibleBlocks = page.blocks.filter((block) => {
    if (
      block.type === "CONDITIONAL_LOGIC" ||
      block.type === "HIDDEN_FIELDS" ||
      block.type === "CALCULATED_FIELDS"
    )
      return false;
    const isHidden =
      targeted(block, hidden) ||
      (targeted(block, showTargets) && !targeted(block, shown));
    if (isHidden) {
      hiddenIds.add(block.uuid);
      hiddenIds.add(block.groupUuid);
    }
    return !isHidden;
  });

  return { visibleBlocks, hiddenIds, requiredIds, jumpTarget, hideButton };
}

/** Questions a respondent sees on the page under the given state. */
export function visibleQuestions(
  page: Page,
  state: PageState,
  questions: readonly DerivedQuestion[],
): DerivedQuestion[] {
  return questions.filter(
    (question) =>
      question.pageNumber === page.number && !state.hiddenIds.has(question.id),
  );
}
