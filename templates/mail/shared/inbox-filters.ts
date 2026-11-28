import {
  addFilterRule,
  createFilterRule,
  createFilterState,
  isDefaultFilterState,
  matchesFilter,
  type FilterField,
  type FilterMatchContext,
  type FilterState,
} from "@agent-native/toolkit/app/filters/model";
import {
  filterStateKey,
  readFilterParams,
  writeFilterSearch,
} from "@agent-native/toolkit/app/filters/url";

export interface InboxFilterFlags {
  unread: boolean;
  starred: boolean;
}

export interface InboxFilterLabels {
  unread: string;
  starred: string;
}

export const INBOX_FILTER_LABELS_EN: InboxFilterLabels = {
  unread: "Unread",
  starred: "Starred",
};

const FLAG_KEYS = ["unread", "starred"] as const;

const FILTERED_VIEWS: ReadonlySet<string> = new Set(["inbox", "all"]);

const FLAG_COMBINATIONS: readonly InboxFilterFlags[] = [
  { unread: true, starred: true },
  { unread: true, starred: false },
  { unread: false, starred: true },
  { unread: false, starred: false },
];

const BOOLEAN_CONTEXT: FilterMatchContext = { today: "1970-01-01" };

export function inboxFilterFields(
  labels: InboxFilterLabels,
): FilterField<InboxFilterFlags>[] {
  return [
    {
      id: "unread",
      label: labels.unread,
      type: "boolean",
      get: (flags) => flags.unread,
    },
    {
      id: "starred",
      label: labels.starred,
      type: "boolean",
      get: (flags) => flags.starred,
    },
  ];
}

const FIELDS = inboxFilterFields(INBOX_FILTER_LABELS_EN);

export function readInboxFilter(search: string | URLSearchParams): FilterState {
  return readFilterParams(search, FIELDS);
}

export function inboxFilterParam(search: string | URLSearchParams): string {
  return filterStateKey(readInboxFilter(search), FIELDS).replace(/^\?/, "");
}

export function viewTakesInboxFilter(view: string | undefined): boolean {
  return view !== undefined && FILTERED_VIEWS.has(view);
}

export function inboxFilterParamForView(
  view: string | undefined,
  search: string | URLSearchParams,
): string {
  return viewTakesInboxFilter(view) ? inboxFilterParam(search) : "";
}

export function inboxFilterParamFor(flags: {
  [Key in keyof InboxFilterFlags]?: boolean | undefined;
}): string {
  let state = createFilterState(FIELDS);
  for (const field of FIELDS) {
    const value = flags[field.id as keyof InboxFilterFlags];
    if (value === undefined) continue;
    state = addFilterRule(
      state,
      createFilterRule(field, [], value ? "is_checked" : "is_unchecked"),
    );
  }
  return filterStateKey(state, FIELDS).replace(/^\?/, "");
}

export function inboxFilterAccepts(
  param: string,
): ((flags: InboxFilterFlags) => boolean) | null {
  const state = readInboxFilter(param);
  if (isDefaultFilterState(state, FIELDS)) return null;
  return (flags) => matchesFilter(flags, state, FIELDS, BOOLEAN_CONTEXT);
}

export function withInboxFilter(href: string, param: string): string {
  const queryAt = href.indexOf("?");
  const path = queryAt === -1 ? href : href.slice(0, queryAt);
  const search = queryAt === -1 ? "" : href.slice(queryAt);
  return `${path}${writeFilterSearch(search, readInboxFilter(param), FIELDS)}`;
}

export function inboxFilterGmailClause(param: string): string {
  const accepts = inboxFilterAccepts(param);
  if (!accepts) return "";
  const allowed = FLAG_COMBINATIONS.filter(accepts);
  if (allowed.length === 0) return "is:unread -is:unread";
  if (allowed.length === FLAG_COMBINATIONS.length) return "";
  const keys = FLAG_KEYS.filter((key) =>
    FLAG_COMBINATIONS.some(
      (flags) => accepts(flags) !== accepts({ ...flags, [key]: !flags[key] }),
    ),
  );
  const terms = [
    ...new Set(
      allowed.map((flags) =>
        keys.map((key) => (flags[key] ? `is:${key}` : `-is:${key}`)).join(" "),
      ),
    ),
  ];
  if (terms.length === 1) return terms[0] ?? "";
  return `{${terms.map((term) => (keys.length > 1 ? `(${term})` : term)).join(" ")}}`;
}

export function withInboxFilterClause(
  search: string | undefined,
  param: string,
): string | undefined {
  const clause = inboxFilterGmailClause(param);
  if (!clause) return search;
  return search ? `${search} ${clause}` : clause;
}
