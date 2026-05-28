import type { EmailMessage } from "./types";

function includesQuery(value: unknown, query: string): boolean {
  return typeof value === "string" && value.toLowerCase().includes(query);
}

function addressListMatches(
  addresses: EmailMessage["to"] | undefined,
  query: string,
): boolean {
  return (addresses ?? []).some(
    (address) =>
      includesQuery(address.name, query) || includesQuery(address.email, query),
  );
}

export function emailMessageMatchesSearch(
  email: Pick<
    EmailMessage,
    "subject" | "snippet" | "body" | "from" | "to" | "cc" | "bcc"
  >,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  return (
    includesQuery(email.subject, q) ||
    includesQuery(email.snippet, q) ||
    includesQuery(email.body, q) ||
    includesQuery(email.from.name, q) ||
    includesQuery(email.from.email, q) ||
    addressListMatches(email.to, q) ||
    addressListMatches(email.cc, q) ||
    addressListMatches(email.bcc, q)
  );
}
