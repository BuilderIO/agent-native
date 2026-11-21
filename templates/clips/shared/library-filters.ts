import {
  countFilter,
  FILTER_NOBODY,
  isDefaultFilterState,
  matchesFilter,
  setPinnedFilter,
  type FilterCounts,
  type FilterField,
  type FilterMatchContext,
  type FilterState,
} from "@agent-native/toolkit/app/filters/model";
import {
  filterSearchKey,
  readFilterParams,
} from "@agent-native/toolkit/app/filters/url";

export const LIBRARY_SOURCES = ["clips", "content"] as const;

export type LibrarySource = (typeof LIBRARY_SOURCES)[number];

export const LIBRARY_SOURCE_FIELD = "source";

export const LIBRARY_LENGTHS = [
  "under_1m",
  "1_to_5m",
  "5_to_20m",
  "over_20m",
] as const;

export type LibraryLength = (typeof LIBRARY_LENGTHS)[number];

export interface LibraryFilterRow {
  id: string;
  source: LibrarySource;
  madeBy: "person" | "agent" | null;
  createdAt: string;
  visibility: "private" | "org" | "public";
  shared: boolean;
  durationMs: number;
  tags: readonly string[];
  hasTranscript: boolean;
}

export interface LibraryFilterLabels {
  source: string;
  sourceShort: string;
  sourceClips: string;
  sourceContent: string;
  sourceAll: string;
  madeBy: string;
  madeByPerson: string;
  madeByAgent: string;
  created: string;
  sharing: string;
  sharingPrivate: string;
  sharingOrg: string;
  sharingPublic: string;
  sharingShared: string;
  sharingNotShared: string;
  length: string;
  lengthUnder1m: string;
  length1To5m: string;
  length5To20m: string;
  lengthOver20m: string;
  tag: string;
  tagOne: string;
  tagOther: string;
  transcript: string;
  transcriptYes: string;
  transcriptNo: string;
}

export const LIBRARY_FILTER_LABELS_EN: LibraryFilterLabels = {
  source: "Where it came from",
  sourceShort: "Where",
  sourceClips: "Recorded in Clips",
  sourceContent: "Uploaded from a Content page",
  sourceAll: "Anywhere",
  madeBy: "Made by",
  madeByPerson: "A person",
  madeByAgent: "An agent",
  created: "Created",
  sharing: "Sharing",
  sharingPrivate: "Private",
  sharingOrg: "Organization",
  sharingPublic: "Public",
  sharingShared: "Shared with someone",
  sharingNotShared: "Not shared with anyone",
  length: "Length",
  lengthUnder1m: "Under 1 minute",
  length1To5m: "1 to 5 minutes",
  length5To20m: "5 to 20 minutes",
  lengthOver20m: "Over 20 minutes",
  tag: "Tag",
  tagOne: "tag",
  tagOther: "tags",
  transcript: "Transcript",
  transcriptYes: "Has a transcript",
  transcriptNo: "No transcript",
};

export function libraryLength(durationMs: number): LibraryLength {
  const minutes = durationMs / 60_000;
  if (minutes < 1) return "under_1m";
  if (minutes < 5) return "1_to_5m";
  if (minutes < 20) return "5_to_20m";
  return "over_20m";
}

export function libraryFilterFields(
  labels: LibraryFilterLabels,
  tags: readonly string[] = [],
): FilterField<LibraryFilterRow>[] {
  return [
    {
      id: LIBRARY_SOURCE_FIELD,
      label: labels.source,
      shortLabel: labels.sourceShort,
      type: "choice",
      alwaysSet: true,
      options: [
        { id: "clips", label: labels.sourceClips },
        { id: "content", label: labels.sourceContent },
      ],
      pinned: { default: ["clips"], allLabel: labels.sourceAll },
      get: (row) => row.source,
    },
    {
      id: "madeBy",
      label: labels.madeBy,
      type: "choice",
      options: [
        { id: "person", label: labels.madeByPerson },
        { id: "agent", label: labels.madeByAgent },
      ],
      get: (row) => row.madeBy,
    },
    {
      id: "created",
      label: labels.created,
      type: "date",
      dates: "past",
      alwaysSet: true,
      get: (row) => row.createdAt,
    },
    {
      id: "sharing",
      label: labels.sharing,
      type: "choice",
      alwaysSet: true,
      options: [
        { id: "private", label: labels.sharingPrivate },
        { id: "org", label: labels.sharingOrg },
        { id: "public", label: labels.sharingPublic },
        { id: "shared", label: labels.sharingShared },
        { id: "not_shared", label: labels.sharingNotShared },
      ],
      get: (row) => [row.visibility, row.shared ? "shared" : "not_shared"],
    },
    {
      id: "length",
      label: labels.length,
      type: "choice",
      alwaysSet: true,
      options: [
        { id: "under_1m", label: labels.lengthUnder1m },
        { id: "1_to_5m", label: labels.length1To5m },
        { id: "5_to_20m", label: labels.length5To20m },
        { id: "over_20m", label: labels.lengthOver20m },
      ],
      get: (row) => libraryLength(row.durationMs),
    },
    {
      id: "tag",
      label: labels.tag,
      type: "multi",
      options: tags.map((tag) => ({ id: tag, label: tag })),
      valueNoun: { one: labels.tagOne, other: labels.tagOther },
      get: (row) => row.tags,
    },
    {
      id: "transcript",
      label: labels.transcript,
      type: "boolean",
      booleanLabels: {
        checked: labels.transcriptYes,
        unchecked: labels.transcriptNo,
      },
      get: (row) => row.hasTranscript,
    },
  ];
}

const SERVER_FIELDS = libraryFilterFields(LIBRARY_FILTER_LABELS_EN);

export function readLibraryFilter(search: string): FilterState {
  return readFilterParams(search, SERVER_FIELDS);
}

export function isDefaultLibraryFilter(state: FilterState): boolean {
  return isDefaultFilterState(state, SERVER_FIELDS);
}

export function unreadLibraryFilterParts(search: string): string[] {
  const params = new URLSearchParams(search);
  const unread: string[] = [];
  const source = params.get(LIBRARY_SOURCE_FIELD);
  if (
    source !== null &&
    source !== "all" &&
    !source
      .split(",")
      .every((value) => LIBRARY_SOURCES.some((known) => known === value))
  ) {
    unread.push(`${LIBRARY_SOURCE_FIELD}=${source}`);
  }
  const match = params.get("match");
  if (match !== null && match !== "any" && match !== "all") {
    unread.push(`match=${match}`);
  }
  const groups = params.getAll("g").map((raw): [string, string] => ["g", raw]);
  for (const raw of params.getAll("r")) {
    const rule = new URLSearchParams([...groups, ["r", raw]]);
    if (readLibraryFilter(rule.toString()).items.length === 0) {
      unread.push(`r=${raw}`);
    }
  }
  return unread;
}

export function libraryFilterQuery(search: string): string {
  return filterSearchKey(search, SERVER_FIELDS).replace(/^\?/, "");
}

export function withLibrarySource(
  state: FilterState,
  source: LibrarySource | "all",
): FilterState {
  return setPinnedFilter(
    state,
    LIBRARY_SOURCE_FIELD,
    source === "all" ? [...LIBRARY_SOURCES] : [source],
  );
}

export interface LibraryFilterCounts {
  matching: number;
  hiddenByPinned: number;
  options: Partial<Record<string, Record<string, number>>>;
}

export interface LibraryFilterResult {
  ids: string[];
  counts: LibraryFilterCounts;
  tags: string[];
}

export function evaluateLibraryFilter(
  rows: readonly LibraryFilterRow[],
  state: FilterState,
  context: FilterMatchContext,
  listed?: (row: LibraryFilterRow) => boolean,
): LibraryFilterResult {
  const tags = [...new Set(rows.flatMap((row) => row.tags))].sort((a, b) =>
    a.localeCompare(b),
  );
  const fields = libraryFilterFields(LIBRARY_FILTER_LABELS_EN, tags);
  const counts = countFilter(rows, state, fields, context);
  const options: Record<string, Record<string, number>> = {};
  for (const field of fields) {
    if (!field.options) continue;
    const ids = field.options.map((option) => option.id);
    if (field.type === "person") ids.push(FILTER_NOBODY);
    options[field.id] = Object.fromEntries(
      ids.map((id) => [id, counts.option(field.id, id) ?? 0]),
    );
  }
  const ids = (listed ? rows.filter(listed) : rows)
    .filter((row) => matchesFilter(row, state, fields, context))
    .map((row) => row.id);
  return {
    ids,
    counts: {
      matching: listed ? ids.length : counts.matching,
      hiddenByPinned: counts.hiddenByPinned,
      options,
    },
    tags,
  };
}

export function libraryFilterCounts(counts: LibraryFilterCounts): FilterCounts {
  return {
    matching: counts.matching,
    hiddenByPinned: counts.hiddenByPinned,
    option: (fieldId, optionId) => {
      const field = counts.options[fieldId];
      return field ? (field[optionId] ?? 0) : undefined;
    },
  };
}
