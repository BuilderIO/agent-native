const AUTOZ_QA_EMAIL_PATTERN = /\+autoz[^@\s]*@/i;

export function isAutozQaEmail(value: unknown): boolean {
  return typeof value === "string" && AUTOZ_QA_EMAIL_PATTERN.test(value.trim());
}

const QA_TEST_EMAIL_PATTERNS = [
  AUTOZ_QA_EMAIL_PATTERN,
  /\+qa-test-bot-[^@\s]+@/i,
  /^qa-test-bot-[^@\s]*@/i,
  /^an-e2e-probe-[^@\s]*@/i,
  /@[^@\s]*\.(?:invalid|localhost)$/i,
  /^e2e-[^@\s]*@example\.(?:com|net|org)$/i,
];

export function isQaTestEmail(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const candidate = value.trim();
  if (!candidate) return false;
  return QA_TEST_EMAIL_PATTERNS.some((pattern) => pattern.test(candidate));
}
