const QA_TEST_EMAIL_PATTERN = /\+qa-test-bot-[^@\s]+@/i;

export function isQaTestEmail(value: unknown): boolean {
  return typeof value === "string" && QA_TEST_EMAIL_PATTERN.test(value);
}
