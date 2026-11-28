import {
  createFilterGroup,
  createFilterRule,
  createFilterState,
  isDefaultFilterState,
  matchesFilter,
  type FilterField,
  type FilterItem,
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

type InboxFilterTerm = Partial<InboxFilterFlags>;

const FILTER_PARAM_KEYS: ReadonlySet<string> = new Set(["r", "g", "match"]);

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
  const term: InboxFilterTerm = {};
  for (const key of FLAG_KEYS) {
    const value = flags[key];
    if (value !== undefined) term[key] = value;
  }
  const state = createFilterState(FIELDS);
  state.items = termRules(term);
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

function inboxFilterTerms(param: string): InboxFilterTerm[] | null {
  const accepts = inboxFilterAccepts(param);
  if (!accepts) return null;
  const keys = FLAG_KEYS.filter((key) =>
    FLAG_COMBINATIONS.some(
      (flags) => accepts(flags) !== accepts({ ...flags, [key]: !flags[key] }),
    ),
  );
  const terms = new Map<string, InboxFilterTerm>();
  for (const flags of FLAG_COMBINATIONS.filter(accepts)) {
    const term: InboxFilterTerm = {};
    for (const key of keys) term[key] = flags[key];
    terms.set(JSON.stringify(term), term);
  }
  return [...terms.values()];
}

function termRules(term: InboxFilterTerm): FilterItem[] {
  return FIELDS.flatMap((field) => {
    const value = term[field.id as keyof InboxFilterFlags];
    return value === undefined
      ? []
      : [createFilterRule(field, [], value ? "is_checked" : "is_unchecked")];
  });
}

export function inboxFilterIsReadable(param: string): boolean {
  const counts = { r: 0, g: 0 };
  for (const [key, value] of new URLSearchParams(param)) {
    if (!FILTER_PARAM_KEYS.has(key)) return false;
    if (key === "match" && value !== "any" && value !== "all") return false;
    if (key === "r" || key === "g") counts[key] += 1;
  }
  const read = new URLSearchParams(inboxFilterParam(param));
  return (
    counts.r > 0 &&
    read.getAll("r").length === counts.r &&
    read.getAll("g").length === counts.g
  );
}

export function inboxFilterRequest(search: string | URLSearchParams): string {
  const terms = inboxFilterTerms(inboxFilterParam(search));
  if (!terms) return "";
  const state = createFilterState(FIELDS);
  if (terms.length === 0) {
    state.items = [
      ...termRules({ unread: true }),
      ...termRules({ unread: false }),
    ];
  } else if (terms.length === 1) {
    state.items = terms.flatMap(termRules);
  } else {
    state.mode = "or";
    state.items = terms.flatMap((term) => {
      const rules = termRules(term);
      return rules.length === 1 ? rules : [createFilterGroup(rules, "and")];
    });
  }
  return filterStateKey(state, FIELDS).replace(/^\?/, "");
}

export function inboxFilterGmailClause(param: string): string {
  const terms = inboxFilterTerms(param);
  if (!terms) return "";
  if (terms.length === 0) return "is:unread -is:unread";
  const clauses = terms.map((term) =>
    FLAG_KEYS.flatMap((key) =>
      term[key] === undefined ? [] : [term[key] ? `is:${key}` : `-is:${key}`],
    ).join(" "),
  );
  if (clauses.length === 1) return clauses[0] ?? "";
  return `{${clauses.map((clause) => (clause.includes(" ") ? `(${clause})` : clause)).join(" ")}}`;
}
