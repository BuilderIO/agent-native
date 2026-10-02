const AUTOZ_QA_EMAIL_PATTERN = /\+autoz[^@\s]*@/i;

/**
 * The convention every QA harness account follows, including the beta E2E
 * account (`BETA_E2E_EMAIL` must contain `+autoz`). Harnesses assert it so a
 * run can never sign in as a real person; exclusion uses
 * `isTestIdentityEmail`, which includes this marker.
 */
export function isAutozQaEmail(value: unknown): boolean {
  return typeof value === "string" && AUTOZ_QA_EMAIL_PATTERN.test(value.trim());
}

// RFC 2606 / RFC 6761 reserve these names, so no real mailbox can exist under
// them. `.local` is deliberately absent: Active Directory tenants use it, and
// an SSO IdP can hand back a real employee as `jane@corp.local`. Bare
// example.com/net/org are absent too: unit tests and docs use them as the
// stand-in for a real user, so a deployment opts them in through
// `testIdentity.emails` instead.
const RESERVED_TLDS = ["test", "invalid", "localhost", "example"];
// `+` cannot appear in a domain, so a marker anywhere is a local-part marker.
const LOCAL_PART_MARKERS = ["+autoz", "+qa-test-bot-"];
const LOCAL_PART_PREFIXES = ["qa-test-bot-", "an-e2e-probe-"];
const PREFIXED_DOMAINS = ["example.com", "example.net", "example.org"].map(
  (domain) => ({ prefix: "e2e-", suffix: `@${domain}` }),
);

function domainSuffixes(domain: string): string[] {
  return [`@${domain}`, `.${domain}`];
}

const BUILT_IN_DOMAIN_SUFFIXES = RESERVED_TLDS.flatMap(domainSuffixes);

function normalizedExtras(extraEmails: readonly string[]): {
  addresses: string[];
  suffixes: string[];
} {
  const addresses: string[] = [];
  const suffixes: string[] = [];
  for (const raw of extraEmails) {
    const entry = raw.trim().toLowerCase();
    if (entry.startsWith("@")) suffixes.push(...domainSuffixes(entry.slice(1)));
    else if (entry) addresses.push(entry);
  }
  return { addresses, suffixes };
}

/**
 * The one rule for "this email belongs to a test identity": reserved test
 * domains, QA harness markers, and any deployment-configured extras (exact
 * addresses or `@domain` entries). Test identities keep working everywhere;
 * they are excluded from metrics and non-auth email. Server code calls
 * `isTestIdentity` from `@agent-native/core/server`, which supplies the
 * configured extras; browser code gets the built-in rules only.
 */
export function isTestIdentityEmail(
  value: unknown,
  extraEmails: readonly string[] = [],
): boolean {
  if (typeof value !== "string") return false;
  const email = value.trim().toLowerCase();
  if (email.indexOf("@") < 1) return false;
  const extras = normalizedExtras(extraEmails);
  return (
    LOCAL_PART_MARKERS.some((marker) => email.includes(marker)) ||
    LOCAL_PART_PREFIXES.some((prefix) => email.startsWith(prefix)) ||
    PREFIXED_DOMAINS.some(
      ({ prefix, suffix }) =>
        email.startsWith(prefix) && email.endsWith(suffix),
    ) ||
    [...BUILT_IN_DOMAIN_SUFFIXES, ...extras.suffixes].some((suffix) =>
      email.endsWith(suffix),
    ) ||
    extras.addresses.includes(email)
  );
}

/** @deprecated Use `isTestIdentityEmail` (or `isTestIdentity` on the server). */
export function isQaTestEmail(value: unknown): boolean {
  return isTestIdentityEmail(value);
}

function sqlLiteral(value: string): string {
  if (!/^[a-z0-9@._%+-]+$/.test(value)) {
    throw new Error(`Unsafe test identity literal: ${JSON.stringify(value)}`);
  }
  return `'${value}'`;
}

/**
 * `isTestIdentityEmail` as one boolean SQL expression over `column`, using
 * only functions PostgreSQL and BigQuery share. `column` is trusted SQL from
 * the caller; every literal is checked.
 */
export function testIdentityEmailSql(
  column: string,
  extraEmails: readonly string[] = [],
): string {
  const email = `lower(trim(coalesce(${column}, '')))`;
  const startsWith = (prefix: string) =>
    `left(${email}, ${prefix.length}) = ${sqlLiteral(prefix)}`;
  const endsWith = (suffix: string) =>
    `right(${email}, ${suffix.length}) = ${sqlLiteral(suffix)}`;
  const extras = normalizedExtras(extraEmails);
  const clauses = [
    ...LOCAL_PART_MARKERS.map(
      (marker) => `strpos(${email}, ${sqlLiteral(marker)}) > 0`,
    ),
    ...LOCAL_PART_PREFIXES.map(startsWith),
    ...PREFIXED_DOMAINS.map(
      ({ prefix, suffix }) => `(${startsWith(prefix)} AND ${endsWith(suffix)})`,
    ),
    ...[...BUILT_IN_DOMAIN_SUFFIXES, ...extras.suffixes].map(endsWith),
    ...extras.addresses.map((address) => `${email} = ${sqlLiteral(address)}`),
  ];
  return `(strpos(${email}, '@') > 1 AND (${clauses.join(" OR ")}))`;
}
