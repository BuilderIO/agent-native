/**
 * Identities that automated checks create, so tracking can drop their events
 * before they reach a provider.
 *
 * Every pattern here must be impossible for a real signup to match. The
 * reserved domains and TLDs come from RFC 2606 / RFC 6761 and are permanently
 * undeliverable, so matching them cannot suppress a real user. Do not add a
 * pattern that merely looks synthetic — `test@`, `demo@` and `qa@` are real
 * addresses people sign up with.
 *
 * Widened after a fleet audit found 17 synthetic signups reaching production
 * analytics: the original pattern only matched plus-addressed
 * `+qa-test-bot-…@`, so `an-e2e-probe-…@e2e.agent-native.test`,
 * `e2e-…@example.com` and bare `qa-test-bot-…@` all slipped through.
 */
const QA_TEST_EMAIL_PATTERNS = [
  // Plus-addressed bot identities on an otherwise real mailbox.
  /\+qa-test-bot-[^@\s]+@/i,
  // Bare bot identities — the local part starts with the marker.
  /^qa-test-bot-[^@\s]*@/i,
  /^an-e2e-probe-[^@\s]*@/i,
  // RFC 2606 / RFC 6761 reserved TLDs. Never resolvable, never a real user.
  /@[^@\s]*\.(?:test|invalid|example|localhost)$/i,
  // Only on a reserved domain: this repo uses bare example.com addresses as
  // fixtures for REAL users, so the domain alone must never suppress.
  /^e2e-[^@\s]*@example\.(?:com|net|org)$/i,
];

export function isQaTestEmail(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const candidate = value.trim();
  if (!candidate) return false;
  return QA_TEST_EMAIL_PATTERNS.some((pattern) => pattern.test(candidate));
}
