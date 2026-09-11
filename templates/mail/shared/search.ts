import { mailLabelsInclude } from "./gmail-labels";
import type { EmailMessage } from "./types";

function includesQuery(value: unknown, query: string): boolean {
  return typeof value === "string" && value.toLowerCase().includes(query);
}

const pacificDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function dateBoundary(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw) * 1000;
  const parts = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!parts) return null;

  const [year, month, day] = parts.slice(1).map(Number);
  const utcDate = Date.UTC(year, month - 1, day);
  const date = new Date(utcDate);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;

  // 08:00 UTC is still in the requested Pacific calendar day in both PST
  // and PDT, including the two DST transition dates.
  const approximate = Date.UTC(year, month - 1, day, 8);
  const localParts = Object.fromEntries(
    pacificDateFormatter
      .formatToParts(new Date(approximate))
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
  const localAsUtc = Date.UTC(
    localParts.year,
    localParts.month - 1,
    localParts.day,
    localParts.hour,
    localParts.minute,
    localParts.second,
  );
  const offset = localAsUtc - approximate;
  return utcDate - offset;
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
  | "is"
  | "category"
  | "has"
  | "filename"
  | "after"
  | "before"
  | "newer"
  | "older";

type ParsedSearch = {
  operators: Array<{
    field: SearchOperator;
    value: string;
    negative: boolean;
  }>;
  terms: string[];
  excludedTerms: string[];
};

/** Attachment operators need Gmail's MIME parts, which metadata responses omit. */
export function searchQueryNeedsAttachmentMetadata(query: string): boolean {
  return /(?:^|[\s({])-?(?:has|filename):/i.test(query);
}

function splitSearchOr(query: string): string[] | undefined {
  const clauses: string[] = [];
  let start = 0;
  let inQuotes = false;
  let depth = 0;
  let foundOr = false;

  for (let index = 0; index < query.length; index += 1) {
    const character = query[index];
    if (character === '"' && query[index - 1] !== "\\") {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (
      depth === 0 &&
      query.slice(index, index + 2).toLowerCase() === "or" &&
      (index === 0 || /\s/.test(query[index - 1])) &&
      (index + 2 === query.length || /\s/.test(query[index + 2]))
    ) {
      clauses.push(query.slice(start, index).trim());
      start = index + 2;
      index += 1;
      foundOr = true;
    }
  }

  if (!foundOr) return undefined;
  clauses.push(query.slice(start).trim());
  return clauses.every(Boolean) ? clauses : [];
}

function findSearchGroup(
  query: string,
  open: string,
  close: string,
): { start: number; end: number; content: string } | undefined {
  let inQuotes = false;
  let start = -1;
  let depth = 0;

  for (let index = 0; index < query.length; index += 1) {
    const character = query[index];
    if (character === '"' && query[index - 1] !== "\\") {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (character === open) {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (character === close && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return {
          start,
          end: index,
          content: query.slice(start + 1, index),
        };
      }
    }
  }
  return undefined;
}

function expandSearchDisjunction(query: string): string[] | undefined {
  const braceGroup = findSearchGroup(query, "{", "}");
  if (braceGroup) {
    const alternatives =
      splitSearchOr(braceGroup.content) ??
      braceGroup.content.match(
        /-?(?:[a-z][\w-]*:\s*)?(?:"[^"\\]*(?:\\.[^"\\]*)*"|\S+)/gi,
      ) ??
      [];
    if (alternatives.length === 0) return [];

    if (braceGroup.start > 0 && query[braceGroup.start - 1] === "-") {
      const replaced =
        query.slice(0, braceGroup.start - 1) +
        alternatives.map((alternative) => `-${alternative}`).join(" ") +
        query.slice(braceGroup.end + 1);
      return expandSearchDisjunction(replaced) ?? [replaced];
    }

    return alternatives.flatMap((alternative) => {
      const replaced =
        query.slice(0, braceGroup.start) +
        alternative +
        query.slice(braceGroup.end + 1);
      return expandSearchDisjunction(replaced) ?? [replaced];
    });
  }

  const parenthesisGroup = findSearchGroup(query, "(", ")");
  if (parenthesisGroup) {
    const alternatives = splitSearchOr(parenthesisGroup.content);
    if (alternatives) {
      return alternatives.flatMap((alternative) => {
        const replaced =
          query.slice(0, parenthesisGroup.start) +
          alternative +
          query.slice(parenthesisGroup.end + 1);
        return expandSearchDisjunction(replaced) ?? [replaced];
      });
    }
  }

  return splitSearchOr(query);
}

/**
 * Keep local/demo search compatible with the Gmail query strings saved by
 * search tabs. Gmail-connected reads send the raw query to Gmail; this parser
 * gives the local backend the same behavior for the operators Mail exposes
 * most often, especially `from:` filters copied from other mail clients.
 */
function parseSearch(query: string): ParsedSearch {
  const operators: ParsedSearch["operators"] = [];
  const operatorPattern =
    /(^|[\s({])(-?)(from|to|cc|bcc|subject|label|in|is|category|has|filename|after|before|newer|older):\s*(?:"([^"]+)"|(\S+))/gi;
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
    | "date"
    | "attachments"
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
    case "category":
      return mailLabelsInclude(
        email.labelIds,
        value === "primary" ? "personal" : value,
      );
    case "has":
      return value === "attachment" && (email.attachments?.length ?? 0) > 0;
    case "filename":
      return (email.attachments ?? []).some((attachment) =>
        includesQuery(attachment.filename, value),
      );
    case "after":
    case "newer": {
      const boundary = dateBoundary(value);
      return boundary !== null && new Date(email.date).getTime() > boundary;
    }
    case "before":
    case "older": {
      const boundary = dateBoundary(value);
      return boundary !== null && new Date(email.date).getTime() < boundary;
    }
  }
}

function matchesSimpleSearch(
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
    | "date"
    | "attachments"
  >,
  query: string,
): boolean {
  const parsed = parseSearch(query);
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
    | "date"
    | "attachments"
  >,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const alternatives = expandSearchDisjunction(q);
  if (alternatives) {
    return (
      alternatives.length > 0 &&
      alternatives.some((alternative) =>
        matchesSimpleSearch(email, alternative),
      )
    );
  }
  return matchesSimpleSearch(email, q);
}
