import { answersSchema, type Answers } from "@shared/form-model";

const sessionKey = (formId: string) => `forms:session:${formId}`;
const answersKey = (formId: string) => `forms:answers:${formId}`;
const RESPONDENT_KEY = "forms:respondent";

function readOrCreate(key: string): string {
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(key, created);
  return created;
}

/** Stays the same across retries and reloads until the form is submitted. */
export const sessionIdFor = (formId: string) =>
  readOrCreate(sessionKey(formId));

/** Kept in memory only: a typed password must not outlive the page. */
const unlockedPasswords = new Map<string, string>();
export const rememberPassword = (formId: string, password: string) =>
  unlockedPasswords.set(formId, password);
export const passwordFor = (formId: string) => unlockedPasswords.get(formId);

export const respondentId = () => readOrCreate(RESPONDENT_KEY);

export function loadAnswers(formId: string): Answers {
  const raw = window.localStorage.getItem(answersKey(formId));
  if (!raw) return {};
  const parsed = answersSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : {};
}

export function saveAnswers(formId: string, answers: Answers) {
  window.localStorage.setItem(answersKey(formId), JSON.stringify(answers));
}

export function clearRespondState(formId: string) {
  window.localStorage.removeItem(answersKey(formId));
  window.localStorage.removeItem(sessionKey(formId));
}
