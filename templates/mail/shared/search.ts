import { mailLabelsInclude } from "./gmail-labels";
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

type SearchOperator =
  | "from"
  | "to"
  | "cc"
  | "bcc"
  | "subject"
  | "label"
  | "in"
  | "is";

type ParsedSearch = {
  operators: Array<{
    field: SearchOperator;
    value: string;
    negative: boolean;
  }>;
  terms: string[];
  excludedTerms: string[];
};

/**
 * Keep local/demo search compatible with the Gmail query strings saved by
 * search tabs. Gmail-connected reads send the raw query to Gmail; this parser
 * gives the local backend the same behavior for the operators Mail exposes
 * most often, especially `from:` filters copied from other mail clients.
 */
function parseSearch(query: string): ParsedSearch {
  const operators: ParsedSearch["operators"] = [];
  const operatorPattern =
    /(^|[\s({])(-?)(from|to|cc|bcc|subject|label|in|is):\s*(?:"([^"]+)"|(\S+))/gi;
  const residual = query.replace(
    operatorPattern,
    (
      _match,
      prefix: string,
      sign: string,
      field: SearchOperator,
      quoted: string,
      bare: string,
    ) => {
      const value = (quoted || bare).replace(/[)}]+$/, "").trim();
      if (value) {
        operators.push({
          field,
          value: value.toLowerCase(),
          negative: sign === "-",
        });
      }
      return prefix;
    },
  );

  const terms = residual.match(/"[^"]+"|\S+/g) ?? [];
  const normalizedTerms = terms
    .map((term) => term.replace(/^['"({]+|['"})]+$/g, "").toLowerCase())
    .filter((term) => term && term !== "or");

  return {
    operators,
    terms: normalizedTerms.filter((term) => !term.startsWith("-")),
    excludedTerms: normalizedTerms
      .filter((term) => term.startsWith("-") && term.length > 1)
      .map((term) => term.slice(1)),
  };
}

function operatorMatches(
  email: Pick<
    EmailMessage,
    | "subject"
    | "from"
    | "to"
    | "cc"
    | "bcc"
    | "labelIds"
    | "isRead"
    | "isStarred"
    | "isArchived"
    | "isTrashed"
    | "isDraft"
    | "isSent"
  >,
  field: SearchOperator,
  value: string,
): boolean {
  switch (field) {
    case "from":
      return (
        includesQuery(email.from.name, value) ||
        includesQuery(email.from.email, value)
      );
    case "to":
      return addressListMatches(email.to, value);
    case "cc":
      return addressListMatches(email.cc, value);
    case "bcc":
      return addressListMatches(email.bcc, value);
    case "subject":
      return includesQuery(email.subject, value);
    case "label":
      return mailLabelsInclude(email.labelIds, value);
    case "in":
      switch (value) {
        case "inbox":
          return mailLabelsInclude(email.labelIds, "inbox");
        case "sent":
          return email.isSent || mailLabelsInclude(email.labelIds, "sent");
        case "drafts":
        case "draft":
          return email.isDraft || mailLabelsInclude(email.labelIds, "drafts");
        case "trash":
          return email.isTrashed || mailLabelsInclude(email.labelIds, "trash");
        case "spam":
          return mailLabelsInclude(email.labelIds, "spam");
        case "all":
        case "anywhere":
          return true;
        default:
          return false;
      }
    case "is":
      switch (value) {
        case "unread":
          return !email.isRead;
        case "read":
          return email.isRead;
        case "starred":
          return email.isStarred;
        case "important":
          return mailLabelsInclude(email.labelIds, "important");
        case "sent":
          return email.isSent || mailLabelsInclude(email.labelIds, "sent");
        case "draft":
        case "drafts":
          return email.isDraft || mailLabelsInclude(email.labelIds, "drafts");
        default:
          return false;
      }
  }
}

export function emailMessageMatchesSearch(
  email: Pick<
    EmailMessage,
    | "subject"
    | "snippet"
    | "body"
    | "from"
    | "to"
    | "cc"
    | "bcc"
    | "labelIds"
    | "isRead"
    | "isStarred"
    | "isArchived"
    | "isTrashed"
    | "isDraft"
    | "isSent"
  >,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const parsed = parseSearch(q);
  const searchableText = [
    email.subject,
    email.snippet,
    email.body,
    email.from.name,
    email.from.email,
    ...(email.to ?? []).flatMap((address) => [address.name, address.email]),
    ...(email.cc ?? []).flatMap((address) => [address.name, address.email]),
    ...(email.bcc ?? []).flatMap((address) => [address.name, address.email]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    parsed.operators.some((operator) => {
      const matches = operatorMatches(email, operator.field, operator.value);
      return operator.negative ? matches : !matches;
    })
  ) {
    return false;
  }

  return (
    parsed.terms.every((term) => searchableText.includes(term)) &&
    parsed.excludedTerms.every((term) => !searchableText.includes(term))
  );
}
