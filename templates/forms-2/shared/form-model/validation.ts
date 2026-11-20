import {
  isChoiceAnswer,
  isEmptyAnswer,
  isFileAnswer,
  isMatrixAnswer,
} from "./answers.js";
import { calculateFields, MAX_HIDDEN_VALUE_LENGTH } from "./fields.js";
import { visibleQuestions, type PageState } from "./logic.js";
import { walkPages } from "./navigation.js";
import { splitPages, type Page } from "./pages.js";
import { deriveQuestions } from "./questions.js";
import type {
  AnswerValue,
  Answers,
  Block,
  ChoiceAnswer,
  DerivedQuestion,
} from "./types.js";

export const VALIDATION_CODES = [
  "required",
  "email",
  "phone",
  "url",
  "min_chars",
  "max_chars",
  "min_number",
  "max_number",
  "date_range",
  "min_selections",
  "max_selections",
  "other_empty",
  "ranking",
  "matrix",
  "file",
  "signature",
  "invalid_value",
] as const;
export type ValidationCode = (typeof VALIDATION_CODES)[number];

export type ValidationError = {
  questionId: string;
  code: ValidationCode;
  min?: number | string | undefined;
  max?: number | string | undefined;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 ()\-.]{6,24}$/;

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    // coercion-ok: an unparsable string is not a link, so the answer is invalid.
    return false;
  }
}

type Settings = Record<string, unknown>;

function limit(settings: Settings, flag: string, key: string) {
  const value = settings[key];
  return settings[flag] === true && typeof value === "number" ? value : null;
}

function validateText(
  settings: Settings,
  value: string,
  question: DerivedQuestion,
): ValidationError | null {
  const min = limit(settings, "hasMinCharacters", "minCharacters");
  const max = limit(settings, "hasMaxCharacters", "maxCharacters");
  if (min !== null && value.length < min)
    return { questionId: question.id, code: "min_chars", min };
  if (max !== null && value.length > max)
    return { questionId: question.id, code: "max_chars", max };
  return null;
}

function validateChoice(
  question: DerivedQuestion,
  settings: Settings,
  value: AnswerValue,
): ValidationError | null {
  const id = question.id;
  if (!isChoiceAnswer(value)) return { questionId: id, code: "invalid_value" };
  const answer: ChoiceAnswer = value;
  const known = new Map(question.options.map((option) => [option.id, option]));
  if (answer.selected.some((selected) => !known.has(selected)))
    return { questionId: id, code: "invalid_value" };
  const multiple =
    question.type === "CHECKBOXES" || question.type === "MULTI_SELECT";
  if (!multiple && answer.selected.length > 1)
    return { questionId: id, code: "max_selections", max: 1 };
  const other = answer.selected.some(
    (selected) => known.get(selected)?.isOther,
  );
  if (other && !answer.other?.trim())
    return { questionId: id, code: "other_empty" };
  if (!multiple) return null;
  const min = limit(settings, "hasMinChoices", "minChoices");
  const max = limit(settings, "hasMaxChoices", "maxChoices");
  if (min !== null && answer.selected.length < min)
    return { questionId: id, code: "min_selections", min };
  if (max !== null && answer.selected.length > max)
    return { questionId: id, code: "max_selections", max };
  return null;
}

function validateRanking(
  question: DerivedQuestion,
  value: AnswerValue,
): ValidationError | null {
  if (!isChoiceAnswer(value))
    return { questionId: question.id, code: "invalid_value" };
  const known = new Set(question.options.map((option) => option.id));
  const ranked = new Set(value.selected);
  if (
    ranked.size !== value.selected.length ||
    value.selected.some((id) => !known.has(id))
  )
    return { questionId: question.id, code: "invalid_value" };
  return ranked.size === known.size
    ? null
    : { questionId: question.id, code: "ranking" };
}

function validateMatrix(
  question: DerivedQuestion,
  settings: Settings,
  value: AnswerValue,
  required: boolean,
): ValidationError | null {
  const id = question.id;
  if (!isMatrixAnswer(value)) return { questionId: id, code: "invalid_value" };
  const rows = new Set(question.rows.map((row) => row.id));
  const columns = new Set(question.options.map((column) => column.id));
  const multiple = settings.allowMultiple === true;
  for (const [rowId, picked] of Object.entries(value.matrix)) {
    if (!rows.has(rowId) || picked.some((column) => !columns.has(column)))
      return { questionId: id, code: "invalid_value" };
    if (!multiple && picked.length > 1)
      return { questionId: id, code: "matrix" };
  }
  const unanswered = question.rows.some(
    (row) => (value.matrix[row.id] ?? []).length === 0,
  );
  return required && unanswered ? { questionId: id, code: "matrix" } : null;
}

function validateFiles(
  question: DerivedQuestion,
  settings: Settings,
  value: AnswerValue,
): ValidationError | null {
  const id = question.id;
  if (!isFileAnswer(value)) return { questionId: id, code: "invalid_value" };
  const allowed =
    settings.allowMultiple === true
      ? typeof settings.maxFiles === "number"
        ? settings.maxFiles
        : 20
      : 1;
  if (value.files.length > allowed || !value.files.every(isHttpUrl))
    return { questionId: id, code: "file", max: allowed };
  return null;
}

function validateAnswer(
  question: DerivedQuestion,
  value: AnswerValue,
  required: boolean,
): ValidationError | null {
  const id = question.id;
  const settings = question.settings.payload as Settings;
  const invalid: ValidationError = { questionId: id, code: "invalid_value" };
  switch (question.type) {
    case "INPUT_TEXT":
    case "TEXTAREA":
      return typeof value === "string"
        ? validateText(settings, value, question)
        : invalid;
    case "INPUT_EMAIL":
      return typeof value === "string" && EMAIL.test(value.trim())
        ? null
        : { questionId: id, code: "email" };
    case "INPUT_PHONE_NUMBER": {
      const digits = typeof value === "string" ? value.replace(/\D/g, "") : "";
      return typeof value === "string" &&
        PHONE.test(value.trim()) &&
        digits.length >= 6
        ? null
        : { questionId: id, code: "phone" };
    }
    case "INPUT_LINK":
      return typeof value === "string" && isHttpUrl(value.trim())
        ? null
        : { questionId: id, code: "url" };
    case "INPUT_NUMBER": {
      const number = typeof value === "number" ? value : Number(value);
      if (typeof value === "object" || Number.isNaN(number)) return invalid;
      const min = limit(settings, "hasMinNumber", "minNumber");
      const max = limit(settings, "hasMaxNumber", "maxNumber");
      if (min !== null && number < min)
        return { questionId: id, code: "min_number", min };
      if (max !== null && number > max)
        return { questionId: id, code: "max_number", max };
      return null;
    }
    case "INPUT_DATE": {
      if (typeof value !== "string" || !isRealDate(value)) return invalid;
      const minDate = settings.hasMinDate === true ? settings.minDate : null;
      const maxDate = settings.hasMaxDate === true ? settings.maxDate : null;
      const min = typeof minDate === "string" ? minDate : undefined;
      const max = typeof maxDate === "string" ? maxDate : undefined;
      if ((min && value < min) || (max && value > max))
        return { questionId: id, code: "date_range", min, max };
      return null;
    }
    case "INPUT_TIME":
      return typeof value === "string" &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
        ? null
        : invalid;
    case "MULTIPLE_CHOICE":
    case "CHECKBOXES":
    case "DROPDOWN":
    case "MULTI_SELECT":
      return validateChoice(question, settings, value);
    case "RATING": {
      const stars = typeof settings.stars === "number" ? settings.stars : 5;
      return typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 1 &&
        value <= stars
        ? null
        : invalid;
    }
    case "RANKING":
      return validateRanking(question, value);
    case "MATRIX":
      return validateMatrix(question, settings, value, required);
    case "FILE_UPLOAD":
      return validateFiles(question, settings, value);
    case "SIGNATURE":
      return typeof value === "string" && isHttpUrl(value.trim())
        ? null
        : { questionId: id, code: "signature" };
    case "HIDDEN_FIELD":
    case "CALCULATED_FIELD":
      return null;
    case "LINEAR_SCALE": {
      const start = typeof settings.start === "number" ? settings.start : 1;
      const end = typeof settings.end === "number" ? settings.end : 5;
      const step = typeof settings.step === "number" ? settings.step : 1;
      return typeof value === "number" &&
        Number.isInteger(value) &&
        value >= start &&
        value <= end &&
        (value - start) % step === 0
        ? null
        : invalid;
    }
  }
}

/** Errors for the questions the respondent sees on one page. */
export function validatePage(
  page: Page,
  state: PageState,
  questions: readonly DerivedQuestion[],
  answers: Answers,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const question of visibleQuestions(page, state, questions)) {
    const value = answers[question.id];
    if (isEmptyAnswer(value)) {
      if (question.isRequired || state.requiredIds.has(question.id))
        errors.push({ questionId: question.id, code: "required" });
      continue;
    }
    const error = validateAnswer(
      question,
      value,
      question.isRequired || state.requiredIds.has(question.id),
    );
    if (error) errors.push(error);
  }
  return errors;
}

/**
 * Server-side check of a completed submission: walks the pages the answers
 * lead through, validates each, and keeps only the answers to questions the
 * respondent actually saw.
 */
export function validateSubmission(
  blocks: readonly Block[],
  answers: Answers,
): { errors: ValidationError[]; answers: Answers } {
  const questions = deriveQuestions(blocks);
  const withCalculated = { ...answers, ...calculateFields(blocks, answers) };
  const errors: ValidationError[] = [];
  const kept: Answers = {};
  for (const { page, state } of walkPages(splitPages(blocks), withCalculated)) {
    errors.push(...validatePage(page, state, questions, withCalculated));
    for (const question of visibleQuestions(page, state, questions)) {
      const value = withCalculated[question.id];
      if (!isEmptyAnswer(value)) kept[question.id] = value;
    }
  }
  for (const question of questions) {
    if (
      question.type !== "HIDDEN_FIELD" &&
      question.type !== "CALCULATED_FIELD"
    )
      continue;
    const value = withCalculated[question.id];
    if (question.type === "HIDDEN_FIELD" && typeof value !== "string") continue;
    if (isEmptyAnswer(value)) continue;
    kept[question.id] =
      typeof value === "string"
        ? value.slice(0, MAX_HIDDEN_VALUE_LENGTH)
        : value;
  }
  return { errors, answers: kept };
}
