import { createHash } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { alias } from "@agent-native/core/db/schema";
import { getRequestTimezone } from "@agent-native/core/server/request-context";
import { accessFilter, type AccessContext } from "@agent-native/core/sharing";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { firstRow } from "../server/lib/first-row.js";
import type {
  ContentDatabaseFilter,
  ContentDatabaseFilterMode,
  ContentDatabaseFilterOperator,
  ContentDatabaseItem,
  ContentDatabaseNavigationGroup,
  ContentDatabaseNavigationItem,
  ContentDatabaseNavigationPage,
  ContentDatabaseNavigationPageResponse,
  ContentDatabaseNavigationSort,
  ContentDatabasePersonalViewOverrides,
  ContentDatabaseSort,
  ContentDatabaseView,
  DocumentProperty,
} from "../shared/api.js";
import {
  applyContentDatabaseTableQuery,
  contentDatabaseDateFilterCheck,
  contentDatabaseFilterComparesDates,
  contentDatabaseFilterHasTime,
  contentDatabaseFilterInstant,
  contentDatabaseFilterIsActive,
  contentDatabaseFilterIsRelative,
  contentDatabaseFilterToday,
  contentDatabaseFilterTree,
  reduceContentDatabaseFilterTree,
  type ContentDatabaseDateComparisonFilter,
  type ContentDatabaseDateFilterBound,
} from "../shared/database-query.js";
import {
  isLocalSourceDirectoryId,
  localSourceDirectoryId,
  localSourceDirectoryTitle,
  localSourceFileDirectory,
  parentLocalSourceDirectory,
  parseLocalSourceDirectoryId,
  type LocalSourceDirectory,
} from "../shared/local-source-directory.js";
import {
  FILES_PROPERTY_TYPES,
  parsePropertyOptions,
  parsePropertyValue,
} from "../shared/properties.js";
import { processWithConcurrency } from "./_batch-utils.js";
import { favoritesSystemIds } from "./_content-favorites.js";
import { softDeletedDatabaseDocumentExclusions } from "./_document-discovery-query.js";
import { linkedNestedLocalFile } from "./_document-source.js";
import { LOCAL_FOLDER_SOURCE_TYPE } from "./_local-folder-source.js";
import {
  parseDatabaseViewConfig,
  serializePropertyDefinition,
} from "./_property-utils.js";

const CURSOR_VERSION = 2;

type NavigationSort = ContentDatabaseNavigationSort | "property";

type NavigationCursor = {
  version: typeof CURSOR_VERSION;
  databaseId: string;
  parentId: string | null;
  sort: NavigationSort;
  viewId: string | null;
  orderHash: string | null;
  revision: string;
  configHash: string;
  sortValue: string | number;
  position?: number;
  itemId: string;
  folder?: [rootPath: string, name: string];
  group?: string;
};

function invalidCursor(): never {
  fail("The Files navigation cursor is invalid or stale.", {
    errorCode: "invalid_navigation_cursor",
    statusCode: 400,
  });
}

function decodeCursor(value: string): NavigationCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      parsed?.version !== CURSOR_VERSION ||
      typeof parsed.databaseId !== "string" ||
      !(parsed.parentId === null || typeof parsed.parentId === "string") ||
      !["custom", "name", "created", "last_edited", "property"].includes(
        parsed.sort,
      ) ||
      !(parsed.viewId === null || typeof parsed.viewId === "string") ||
      !(parsed.orderHash === null || typeof parsed.orderHash === "string") ||
      typeof parsed.revision !== "string" ||
      typeof parsed.configHash !== "string" ||
      !(
        typeof parsed.sortValue === "string" ||
        typeof parsed.sortValue === "number"
      ) ||
      typeof parsed.itemId !== "string" ||
      !(
        parsed.folder === undefined ||
        (Array.isArray(parsed.folder) &&
          parsed.folder.length === 2 &&
          parsed.folder.every((part: unknown) => typeof part === "string"))
      ) ||
      !(parsed.group === undefined || typeof parsed.group === "string") ||
      (parsed.folder === undefined &&
        (parsed.sort === "custom" || parsed.sort === "property") &&
        (typeof parsed.sortValue !== "number" ||
          typeof parsed.position !== "number"))
    ) {
      invalidCursor();
    }
    return parsed as NavigationCursor;
  } catch {
    return invalidCursor();
  }
}

function encodeCursor(cursor: NavigationCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function orderFingerprint(itemIds: string[]) {
  return createHash("sha256").update(JSON.stringify(itemIds)).digest("hex");
}

function selectedFilterValues(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return [trimmed];
    return [
      ...new Set(
        parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
  } catch {
    return [trimmed];
  }
}

// Every character String.prototype.trim() removes. Postgres' btrim() removes
// only spaces unless it is given the characters to remove.
const TRIMMED_CHARACTERS = String.fromCharCode(
  ...Array.from({ length: 0x10000 }, (_, code) => code).filter(
    (code) => !String.fromCharCode(code).trim(),
  ),
);

function textFilterSql(
  expression: SQL<string | null>,
  filter: ContentDatabaseFilter,
): SQL | undefined {
  const values = selectedFilterValues(filter.value).map((value) =>
    value.toLowerCase(),
  );
  // Trimmed and lowercased, as the shared evaluator compares values.
  const normalized = sql<string>`lower(btrim(coalesce(${expression}, ''), ${TRIMMED_CHARACTERS}))`;
  if (filter.operator === "is_empty") return sql`${normalized} = ''`;
  if (filter.operator === "is_not_empty") return sql`${normalized} <> ''`;
  if (filter.operator === "equals") return sql`${normalized} = ${values[0]}`;
  if (filter.operator === "does_not_equal")
    return sql`${normalized} <> ${values[0]}`;
  if (filter.operator === "contains")
    return sql`position(${values[0]} in ${normalized}) > 0`;
  if (filter.operator === "does_not_contain")
    return sql`position(${values[0]} in ${normalized}) = 0`;
  if (filter.operator === "starts_with")
    return sql`left(${normalized}, char_length(${values[0]})) = ${values[0]}`;
  if (filter.operator === "ends_with")
    return sql`right(${normalized}, char_length(${values[0]})) = ${values[0]}`;
  return undefined;
}

function dateFilterSql(
  expression: SQL<string>,
  filter: ContentDatabaseFilter,
  today: string,
  timeZone: string | undefined,
): SQL | undefined {
  if (filter.operator === "is_empty")
    return sql`coalesce(${expression}, '') = ''`;
  if (filter.operator === "is_not_empty")
    return sql`coalesce(${expression}, '') <> ''`;
  if (!contentDatabaseFilterComparesDates(filter)) return undefined;
  const check = contentDatabaseDateFilterCheck(filter, today, timeZone);
  if (!check) return sql`false`;
  const value = sql<string>`coalesce(${expression}, '')`;
  // Stored times start with their day, in both the app's ISO strings and the
  // database's default timestamps. A moment is compared as a timestamp, since
  // those two formats and offset-bearing bounds don't sort as text. The bound
  // is read the way the shared evaluator reads it, and the row's time is cut
  // to the millisecond, as a JavaScript date holds it; the database's own
  // timestamps keep microseconds.
  const compare = (
    op: "=" | "<>" | "<" | "<=" | ">" | ">=",
    bound: ContentDatabaseDateFilterBound,
  ) =>
    "day" in bound
      ? sql`left(${value}, 10) ${sql.raw(op)} ${bound.day}`
      : sql`date_trunc('milliseconds', nullif(${value}, '')::timestamptz) ${sql.raw(op)} ${new Date(bound.instant).toISOString()}::timestamptz`;
  if (check.op === "between") {
    return and(
      sql`${value} <> ''`,
      compare(">=", check.start),
      compare("<=", check.end),
    );
  }
  // Rows with no date match only "is not".
  if (check.op === "<>") {
    return or(sql`${value} = ''`, compare("<>", check.bound));
  }
  return and(sql`${value} <> ''`, compare(check.op, check.bound));
}

const STORED_VALUE_FILTER_TYPES: ReadonlySet<string> = new Set(
  FILES_PROPERTY_TYPES,
);

const NUMBER_FILTER_OPERATORS: Partial<
  Record<ContentDatabaseFilterOperator, ">" | "<" | ">=" | "<=">
> = {
  greater_than: ">",
  less_than: "<",
  greater_than_or_equal: ">=",
  less_than_or_equal: "<=",
};

const NUMBER_TEXT_PATTERN =
  "^[+-]?([0-9]+[.]?[0-9]*|[.][0-9]+)([eE][+-]?[0-9]+)?$";

const NUMBER_OVERFLOW = ((2n ** 54n - 1n) * 2n ** 970n).toString();
const NUMBER_UNDERFLOW = `0.${(5n ** 1075n).toString().padStart(1075, "0")}`;

const DATE_TIME_PATTERN =
  "^([0-9]{4})-([0-9]{2})-([0-9]{2})[T ]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:[.]([0-9]+))?)?(Z|[+-][0-9]{2}(?::?[0-9]{2})?)?$";

const DAY_MS = 24 * 60 * 60 * 1000;

type StoredFilterDefinition = {
  id: string;
  type: string;
  optionNames: Record<string, string>;
};

const storedIsUnset = sql`coalesce(jsonb_typeof(stored.value), 'null') = 'null'`;
const storedString = sql`(stored.value #>> '{}')`;
const trimmedSql = (expression: SQL) =>
  sql`btrim(${expression}, ${TRIMMED_CHARACTERS})`;

function storedOptionId() {
  return sql`case when jsonb_typeof(stored.value) = 'string' then ${storedString} else ${trimmedSql(sql`stored.raw`)} end`;
}

function storedValueText(type: string, names: SQL): SQL<string> {
  const id = storedOptionId();
  const start = trimmedSql(sql`(stored.value ->> 'start')`);
  const end = trimmedSql(sql`(stored.value ->> 'end')`);
  const scalar =
    type === "select" || type === "status"
      ? sql`coalesce(${names} ->> ${id}, ${id})`
      : type === "checkbox"
        ? sql`case when stored.value in ('false', '0', '""') then 'Unchecked' else 'Checked' end`
        : sql`case
              when jsonb_typeof(stored.value) = 'string' then ${storedString}
              when jsonb_typeof(stored.value -> 'start') = 'string' then ${start} || case when jsonb_typeof(stored.value -> 'end') = 'string' and ${end} <> '' then ' - ' || ${end} else '' end
              else ${trimmedSql(sql`stored.raw`)}
            end`;
  return sql<string>`case
    when ${storedIsUnset} then ''
    when jsonb_typeof(stored.value) = 'array' then (
      select coalesce(string_agg(coalesce(case when jsonb_typeof(item.element) = 'string' then ${names} ->> (item.element #>> '{}') end, item.element #>> '{}', ''), ' ' order by item.ordinal), '')
      from jsonb_array_elements(stored.value) with ordinality as item(element, ordinal)
    )
    else ${scalar}
  end`;
}

function storedValueIsAnyOf(type: string, names: SQL, values: string[]) {
  if (!values.length) return sql`false`;
  const list = sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
  const among = (expression: SQL) =>
    sql`lower(${trimmedSql(expression)}) in (${list})`;
  const id = storedOptionId();
  const scalar =
    type === "select" || type === "status"
      ? sql`${among(id)} or ${among(sql`coalesce(${names} ->> ${id}, ${id})`)}`
      : among(storedValueText(type, names));
  return sql`case
    when ${storedIsUnset} then false
    when jsonb_typeof(stored.value) = 'array' then exists (
      select 1 from jsonb_array_elements(stored.value) as item(element)
      where ${among(sql`(item.element #>> '{}')`)} or ${among(sql`(${names} ->> (item.element #>> '{}'))`)}
    )
    else coalesce(${scalar}, false)
  end`;
}

function storedNumber() {
  const text = trimmedSql(storedString);
  const exact = sql`case
    when jsonb_typeof(stored.value) = 'number' then (stored.value #>> '{}')::numeric
    when jsonb_typeof(stored.value) = 'string' and ${storedString} <> '' then
      case
        when ${text} = '' then 0
        when ${text} !~ ${NUMBER_TEXT_PATTERN} then null
        when pg_input_is_valid(${text}, 'numeric') then ${text}::numeric
        when ${text} ~ '^[+-]?[0.]*([eE]|$)' or ${text} ~ '[eE]-' then 0
      end
  end`;
  return sql`(select case
      when abs(parsed.exact) >= ${NUMBER_OVERFLOW}::numeric then null
      when abs(parsed.exact) <= ${NUMBER_UNDERFLOW}::numeric then 0
      else parsed.exact::double precision
    end from (select ${exact} as exact) as parsed)`;
}

function storedDateText() {
  return sql<string>`case
    when jsonb_typeof(stored.value) = 'string' then ${trimmedSql(storedString)}
    when jsonb_typeof(stored.value) = 'object' and jsonb_typeof(stored.value -> 'start') = 'string' then ${trimmedSql(sql`(stored.value ->> 'start')`)}
    else ''
  end`;
}

function wallClockOffsets(instant: number, timeZone: string | undefined) {
  const offsetAt = (wall: number) =>
    wall -
    contentDatabaseFilterInstant(
      new Date(wall).toISOString().slice(0, 23),
      timeZone,
    );
  const from = instant - 3 * DAY_MS;
  const to = instant + 3 * DAY_MS;
  const fromOffset = offsetAt(from);
  const toOffset = offsetAt(to);
  const before = Number.isFinite(fromOffset) ? fromOffset : toOffset || 0;
  const after = Number.isFinite(toOffset) ? toOffset : before;
  let low = from;
  let high = to;
  if (before !== after) {
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (offsetAt(middle) === before) low = middle;
      else high = middle;
    }
  }
  return { switchAt: high, before, after };
}

function storedInstantSql(
  text: SQL<string>,
  instant: number,
  timeZone: string | undefined,
) {
  const { switchAt, before, after } = wallClockOffsets(instant, timeZone);
  const field = (index: number) => sql.raw(`parsed.m[${index}]::int`);
  const [year, month, day, hour, minute] = [1, 2, 3, 4, 5].map(field);
  const second = sql.raw(`coalesce(parsed.m[6], '0')::int`);
  const offset = sql.raw("parsed.m[8]");
  const offsetHours = sql`substr(${offset}, 2, 2)::int`;
  const offsetMinutes = sql`coalesce(nullif(substr(replace(${offset}, ':', ''), 4, 2), ''), '0')::int`;
  const wall = sql`((make_date(${year}, ${month}, ${day}) - date '1970-01-01')::bigint * 86400000 + ${hour} * 3600000 + ${minute} * 60000 + ${second} * 1000 + rpad(coalesce(parsed.m[7], ''), 3, '0')::int)`;
  return sql`(select case
      when parsed.m is null then null
      when not (${year} >= 100 and ${month} between 1 and 12 and ${hour} <= 23 and ${minute} <= 59 and ${second} <= 59) then null
      when ${day} not between 1 and extract(day from make_date(${year}, ${month}, 1) + interval '1 month - 1 day') then null
      when ${offset} is null then ${wall} - case when ${wall} < ${String(switchAt)}::bigint then ${String(before)}::bigint else ${String(after)}::bigint end
      when upper(${offset}) = 'Z' then ${wall}
      when ${offsetHours} > 23 or ${offsetMinutes} > 59 then null
      else ${wall} - case when left(${offset}, 1) = '-' then -1 else 1 end * (${offsetHours} * 60 + ${offsetMinutes}) * 60000
    end
    from (select regexp_match(${text}, ${DATE_TIME_PATTERN}, 'i') as m) as parsed)`;
}

function storedDateFilterSql(
  filter: ContentDatabaseDateComparisonFilter,
  today: string,
  timeZone: string | undefined,
): SQL {
  const check = contentDatabaseDateFilterCheck(filter, today, timeZone);
  if (!check) return sql`false`;
  const text = storedDateText();
  const compare = (
    op: "=" | "<>" | "<" | "<=" | ">" | ">=",
    bound: ContentDatabaseDateFilterBound,
  ) => {
    if ("day" in bound) {
      return sql`(case when ${text} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then left(${text}, 10) end) ${sql.raw(op)} ${bound.day}`;
    }
    const instant = new Date(bound.instant).getTime();
    return sql`case
      when ${text} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then ${text} ${sql.raw(op)} ${contentDatabaseFilterToday(timeZone, new Date(instant))}
      else ${storedInstantSql(text, instant, timeZone)} ${sql.raw(op)} ${String(instant)}::bigint
    end`;
  };
  if (check.op === "between") {
    return sql`(${text} <> '' and coalesce(${compare(">=", check.start)} and ${compare("<=", check.end)}, false))`;
  }
  if (check.op === "<>") {
    return sql`(${text} = '' or coalesce(${compare("<>", check.bound)}, true))`;
  }
  return sql`(${text} <> '' and coalesce(${compare(check.op, check.bound)}, false))`;
}

function storedValuePredicate(
  definition: StoredFilterDefinition,
  filter: ContentDatabaseFilter,
  today: string,
  timeZone: string | undefined,
): SQL | undefined {
  const { type } = definition;
  const names = sql`${JSON.stringify(definition.optionNames)}::jsonb`;
  if (filter.operator === "is_checked")
    return sql`coalesce(stored.value = 'true', false)`;
  if (filter.operator === "is_unchecked")
    return sql`not coalesce(stored.value = 'true', false)`;
  const numberOperator = NUMBER_FILTER_OPERATORS[filter.operator];
  if (numberOperator) {
    const target = Number(filter.value.trim());
    if (!Number.isFinite(target)) return sql`false`;
    return sql`coalesce(${storedNumber()} ${sql.raw(numberOperator)} ${String(target)}::double precision, false)`;
  }
  if (
    contentDatabaseFilterComparesDates(filter) &&
    ((filter.operator !== "equals" && filter.operator !== "does_not_equal") ||
      type === "date")
  ) {
    return storedDateFilterSql(filter, today, timeZone);
  }
  const selected = selectedFilterValues(filter.value).map((value) =>
    value.toLowerCase(),
  );
  const discrete =
    type === "select" ||
    type === "status" ||
    type === "multi_select" ||
    type === "person";
  if (filter.operator === "equals" || filter.operator === "does_not_equal") {
    const matches = storedValueIsAnyOf(
      type,
      names,
      discrete ? selected : selected.slice(0, 1),
    );
    return filter.operator === "equals" ? matches : sql`not ${matches}`;
  }
  if (discrete && filter.operator === "contains") {
    return storedValueIsAnyOf(type, names, selected);
  }
  return textFilterSql(storedValueText(type, names), filter);
}

function storedValueSource(documentId: SQL<string>, propertyId: string) {
  const values = schema.documentPropertyValues;
  return sql`(
      select ${values.valueJson} as raw,
        case when pg_input_is_valid(${values.valueJson}, 'jsonb') then ${values.valueJson}::jsonb end as value
      from ${values}
      where ${values.documentId} = ${documentId} and ${values.propertyId} = ${propertyId}
      limit 1
    ) as stored`;
}

function storedValueSql(
  documentId: SQL<string>,
  propertyId: string,
  predicate: SQL,
) {
  return sql`coalesce((
    select ${predicate}
    from (select 1) as stored_row
    left join ${storedValueSource(documentId, propertyId)} on true
  ), false)`;
}

function storedValueFilterSql(args: {
  documentId: SQL<string>;
  definition: StoredFilterDefinition;
  filter: ContentDatabaseFilter;
  today: string;
  timeZone: string | undefined;
}): SQL | undefined {
  const predicate = storedValuePredicate(
    args.definition,
    args.filter,
    args.today,
    args.timeZone,
  );
  if (!predicate) return undefined;
  return storedValueSql(args.documentId, args.definition.id, predicate);
}

async function navigationFilterDefinitions(
  databaseId: string,
  filters: ContentDatabaseFilter[],
) {
  const propertyIds = [
    ...new Set(
      filters
        .filter(contentDatabaseFilterIsActive)
        .map((filter) => filter.key)
        .filter((key) => key !== "name"),
    ),
  ];
  const definitions = propertyIds.length
    ? await getDb()
        .select({
          id: schema.documentPropertyDefinitions.id,
          name: schema.documentPropertyDefinitions.name,
          type: schema.documentPropertyDefinitions.type,
          systemRole: schema.documentPropertyDefinitions.systemRole,
          optionsJson: schema.documentPropertyDefinitions.optionsJson,
        })
        .from(schema.documentPropertyDefinitions)
        .where(
          and(
            eq(schema.documentPropertyDefinitions.databaseId, databaseId),
            inArray(schema.documentPropertyDefinitions.id, propertyIds),
          ),
        )
    : [];
  return new Map(
    definitions.map(({ optionsJson, ...definition }) => [
      definition.id,
      { ...definition, optionNames: optionNamesById(optionsJson) },
    ]),
  );
}

async function navigationPropertySorts(
  databaseId: string,
  sorts: ContentDatabaseSort[],
) {
  const propertyIds = [
    ...new Set(sorts.map((sort) => sort.key).filter((key) => key !== "name")),
  ];
  const definitions = propertyIds.length
    ? await getDb()
        .select()
        .from(schema.documentPropertyDefinitions)
        .where(
          and(
            eq(schema.documentPropertyDefinitions.databaseId, databaseId),
            inArray(schema.documentPropertyDefinitions.id, propertyIds),
          ),
        )
    : [];
  const storedById = new Map(
    definitions
      .filter(
        (definition) =>
          !definition.systemRole &&
          STORED_VALUE_FILTER_TYPES.has(definition.type),
      )
      .map((definition) => [
        definition.id,
        {
          definition: serializePropertyDefinition(definition),
          value: null,
          editable: false,
        } satisfies DocumentProperty,
      ]),
  );
  const usable: ContentDatabaseSort[] = [];
  for (const sort of sorts) {
    if (sort.key !== "name" && !storedById.has(sort.key)) break;
    usable.push(sort);
  }
  return {
    sorts: usable.some((sort) => sort.key !== "name") ? usable : [],
    properties: [...storedById.values()].filter((property) =>
      usable.some((sort) => sort.key === property.definition.id),
    ),
  };
}

const LONE_SURROGATE =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

const jsonbCanHold = (text: string) =>
  !text.includes("\u0000") && !LONE_SURROGATE.test(text);

function optionNamesById(optionsJson: string) {
  const seen = new Set<string>();
  const names = new Map<string, string>();
  for (const option of parsePropertyOptions(optionsJson).options ?? []) {
    if (seen.has(option.id)) continue;
    seen.add(option.id);
    const name: unknown = option.name;
    if (
      typeof name === "string" ||
      typeof name === "number" ||
      typeof name === "boolean"
    ) {
      names.set(option.id, String(name));
    }
  }
  return Object.fromEntries(
    [...names].filter(([id, text]) => jsonbCanHold(id) && jsonbCanHold(text)),
  );
}

const NAVIGATION_GROUP_VIEW_TYPES: ReadonlySet<string> = new Set([
  "table",
  "list",
  "gallery",
  "sidebar",
]);

const NAVIGATION_GROUP_PROPERTY_TYPES: ReadonlySet<string> = new Set([
  "status",
  "select",
  "multi_select",
  "checkbox",
]);

type NavigationGroup = {
  id: string;
  label: string;
  unset: boolean;
  predicate: SQL;
};

type NavigationGrouping = {
  propertyId: string;
  type: string;
  groups: NavigationGroup[];
};

async function navigationGrouping(
  databaseId: string,
  view: ContentDatabaseView,
): Promise<NavigationGrouping | null> {
  if (!view.groupByPropertyId || !NAVIGATION_GROUP_VIEW_TYPES.has(view.type)) {
    return null;
  }
  const definitions = await getDb()
    .select({
      id: schema.documentPropertyDefinitions.id,
      name: schema.documentPropertyDefinitions.name,
      type: schema.documentPropertyDefinitions.type,
      systemRole: schema.documentPropertyDefinitions.systemRole,
      optionsJson: schema.documentPropertyDefinitions.optionsJson,
    })
    .from(schema.documentPropertyDefinitions)
    .where(
      and(
        eq(schema.documentPropertyDefinitions.databaseId, databaseId),
        eq(schema.documentPropertyDefinitions.id, view.groupByPropertyId),
      ),
    )
    .limit(1);
  const definition = firstRow(definitions);
  if (
    !definition ||
    definition.systemRole ||
    !NAVIGATION_GROUP_PROPERTY_TYPES.has(definition.type)
  ) {
    return null;
  }
  const groupId = (value: string) => `${definition.id}:${value}`;
  if (definition.type === "checkbox") {
    const checked = sql`coalesce(stored.value = 'true', false)`;
    return {
      propertyId: definition.id,
      type: definition.type,
      groups: [
        {
          id: groupId("false"),
          label: "Unchecked",
          unset: true,
          predicate: sql`not ${checked}`,
        },
        {
          id: groupId("true"),
          label: "Checked",
          unset: false,
          predicate: checked,
        },
      ],
    };
  }
  const options: Array<{ id: string; label: string }> = [];
  for (const option of parsePropertyOptions(definition.optionsJson).options ??
    []) {
    const id: unknown = option.id;
    const name: unknown = option.name;
    if (typeof id !== "string" || options.some((known) => known.id === id)) {
      continue;
    }
    options.push({
      id,
      label:
        typeof name === "string" || typeof name === "number"
          ? String(name)
          : "",
    });
  }
  const holdsAny = (optionIds: string[]) => {
    const ids = optionIds.filter(jsonbCanHold);
    if (!ids.length) return sql`false`;
    const list = sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    );
    return definition.type === "multi_select"
      ? sql`coalesce(jsonb_typeof(stored.value) = 'array' and exists (
          select 1 from jsonb_array_elements(stored.value) as item(element)
          where jsonb_typeof(item.element) = 'string' and (item.element #>> '{}') in (${list})
        ), false)`
      : sql`coalesce(jsonb_typeof(stored.value) = 'string' and ${storedString} in (${list}), false)`;
  };
  return {
    propertyId: definition.id,
    type: definition.type,
    groups: [
      ...options.map((option) => ({
        id: groupId(option.id),
        label: option.label,
        unset: false,
        predicate: holdsAny([option.id]),
      })),
      {
        id: groupId("__ungrouped__"),
        label: "No " + definition.name,
        unset: true,
        predicate: sql`not ${holdsAny(options.map((option) => option.id))}`,
      },
    ],
  };
}

function navigationFilterSql(args: {
  filters: ContentDatabaseFilter[];
  filterMode: ContentDatabaseFilterMode;
  today: string;
  timeZone: string | undefined;
  definitionById: Awaited<ReturnType<typeof navigationFilterDefinitions>>;
  document: {
    id: SQL<string>;
    title: SQL<string>;
    parentId: SQL<string | null>;
    ownerEmail: SQL<string>;
    createdAt: SQL<string>;
    updatedAt: SQL<string>;
  };
}) {
  if (!args.filters.some(contentDatabaseFilterIsActive)) return undefined;
  const definitionById = args.definitionById;

  const leaf = (filter: ContentDatabaseFilter): SQL => {
    let predicate: SQL | undefined;
    if (filter.key === "name") {
      predicate = textFilterSql(args.document.title, filter);
    } else {
      const definition = definitionById.get(filter.key);
      if (!definition) {
        fail(
          `The Files view filter property "${filter.label}" is unavailable.`,
          {
            errorCode: "unsupported_navigation_filter_property",
            statusCode: 400,
          },
        );
      }
      if (definition.systemRole === "files_parent") {
        predicate = textFilterSql(args.document.parentId, filter);
      } else if (definition.systemRole === "files_source") {
        const selected = selectedFilterValues(filter.value);
        const sourceMatch = selected.length
          ? exists(
              getDb()
                .select({ id: schema.contentDatabaseSourceRows.id })
                .from(schema.contentDatabaseSourceRows)
                .where(
                  and(
                    eq(
                      schema.contentDatabaseSourceRows.documentId,
                      args.document.id,
                    ),
                    inArray(
                      schema.contentDatabaseSourceRows.sourceId,
                      selected,
                    ),
                  ),
                ),
            )
          : undefined;
        const hasSource = exists(
          getDb()
            .select({ id: schema.contentDatabaseSourceRows.id })
            .from(schema.contentDatabaseSourceRows)
            .where(
              eq(schema.contentDatabaseSourceRows.documentId, args.document.id),
            ),
        );
        const matches = selected.includes("local")
          ? sourceMatch
            ? or(sourceMatch, sql`not ${hasSource}`)
            : sql`not ${hasSource}`
          : sourceMatch;
        if (filter.operator === "equals" || filter.operator === "contains")
          predicate = matches;
        else if (filter.operator === "does_not_equal")
          predicate = matches ? sql`not (${matches})` : undefined;
        else if (filter.operator === "is_empty") predicate = sql`false`;
        else if (filter.operator === "is_not_empty") predicate = sql`true`;
      } else if (definition.type === "created_time") {
        predicate = dateFilterSql(
          args.document.createdAt,
          filter,
          args.today,
          args.timeZone,
        );
      } else if (definition.type === "last_edited_time") {
        predicate = dateFilterSql(
          args.document.updatedAt,
          filter,
          args.today,
          args.timeZone,
        );
      } else if (
        definition.type === "created_by" ||
        definition.type === "last_edited_by"
      ) {
        predicate = textFilterSql(args.document.ownerEmail, filter);
      } else if (
        !definition.systemRole &&
        STORED_VALUE_FILTER_TYPES.has(definition.type)
      ) {
        predicate = storedValueFilterSql({
          documentId: args.document.id,
          definition,
          filter,
          today: args.today,
          timeZone: args.timeZone,
        });
      }
    }
    if (!predicate) {
      fail(
        `The Files view filter on "${filter.label}" is not supported in navigation.`,
        {
          errorCode: "unsupported_navigation_filter_expression",
          statusCode: 400,
        },
      );
    }
    return predicate;
  };
  return reduceContentDatabaseFilterTree(
    contentDatabaseFilterTree(
      args.filters,
      args.filterMode,
      contentDatabaseFilterIsActive,
    ),
    leaf,
    (mode, values): SQL =>
      (mode === "or" ? or(...values) : and(...values)) ?? sql`true`,
  );
}

type NavigationRevision = { count: number; checksum: bigint };

function combineRevisions(parts: NavigationRevision[]) {
  return `${parts.reduce((total, part) => total + part.count, 0)}:${parts.reduce(
    (total, part) => total + part.checksum,
    0n,
  )}`;
}

// Expanded branches one read returns with its page, and how many expanded
// document IDs it accepts.
export const MAX_NAVIGATION_EXPANDED_BRANCHES = 32;
export const MAX_NAVIGATION_EXPAND_IDS = 100;
const NAVIGATION_GROUP_READ_CONCURRENCY = 4;

/** Sort keys a Files view can hold that aren't property IDs. */
export const FILES_NAVIGATION_SORT_KEYS: ReadonlyMap<
  string,
  ContentDatabaseNavigationSort
> = new Map([
  ["name", "name"],
  ["created", "created"],
  ["created_at", "created"],
  ["updated", "last_edited"],
  ["updated_at", "last_edited"],
  ["last_edited", "last_edited"],
]);

/**
 * The Files view a navigation read follows: the one asked for, else the
 * person's active view, else the shared active view.
 */
function resolveNavigationView(args: {
  database: typeof schema.contentDatabases.$inferSelect;
  overrides: ContentDatabasePersonalViewOverrides | null;
  viewId?: string;
}) {
  const sharedConfig = parseDatabaseViewConfig(args.database.viewConfigJson);
  const viewId =
    args.viewId ?? args.overrides?.activeViewId ?? sharedConfig.activeViewId;
  const sharedView =
    sharedConfig.views.find((candidate) => candidate.id === viewId) ??
    (!args.viewId
      ? sharedConfig.views.find(
          (candidate) => candidate.id === sharedConfig.activeViewId,
        )
      : undefined);
  if (!sharedView) {
    fail("The selected Files view no longer exists.", {
      errorCode: "invalid_navigation_view",
      statusCode: 400,
    });
  }
  const personalView = args.overrides?.views.find(
    (candidate) => candidate.id === viewId,
  );
  return {
    viewId,
    sharedView,
    personalView,
    filters: personalView?.filters ?? sharedView.filters,
    filterMode: personalView?.filterMode ?? sharedView.filterMode ?? "and",
  };
}

function navigationAccessContext(
  userEmail: string,
  database: typeof schema.contentDatabases.$inferSelect,
): AccessContext {
  return { userEmail, ...(database.orgId ? { orgId: database.orgId } : {}) };
}

type LocalFolderSources = { databaseId: string; rootPaths: string[] };

type FolderLevel = {
  folders: LocalFolderSources;
  directory: LocalSourceDirectory | null;
};

async function localFolderSources(
  databaseId: string,
): Promise<LocalFolderSources> {
  const rows = await getDb()
    .select({
      rootPath: schema.contentDatabaseSources.sourceTable,
    })
    .from(schema.contentDatabaseSources)
    .where(
      and(
        eq(schema.contentDatabaseSources.databaseId, databaseId),
        eq(schema.contentDatabaseSources.sourceType, LOCAL_FOLDER_SOURCE_TYPE),
      ),
    );
  return {
    databaseId,
    rootPaths: [...new Set(rows.map((row) => row.rootPath))],
  };
}

function inLocalFolder(folders: LocalFolderSources) {
  return and(
    isNull(schema.documents.parentId),
    linkedNestedLocalFile(getDb(), folders.databaseId),
  );
}

function outsideLocalFolders(folders: LocalFolderSources): SQL {
  return sql`not coalesce(${inLocalFolder(folders)}, false)`;
}

function pathInDirectory(directory: LocalSourceDirectory | null): SQL<string> {
  return directory
    ? sql<string>`substr(${schema.documents.sourcePath}, char_length(${directory.path}::text) + 2)`
    : sql<string>`${schema.documents.sourcePath}`;
}

function withinDirectory(directory: LocalSourceDirectory | null) {
  return directory
    ? and(
        eq(schema.documents.sourceRootPath, directory.rootPath),
        sql`starts_with(${schema.documents.sourcePath}, ${`${directory.path}/`}::text)`,
      )
    : undefined;
}

export async function localFolderDirectoryOfDocument(args: {
  databaseId: string;
  documentId: string;
  accessContext: AccessContext;
}): Promise<LocalSourceDirectory | null> {
  const folders = await localFolderSources(args.databaseId);
  if (folders.rootPaths.length === 0) return null;
  const rows = await getDb()
    .select({
      rootPath: schema.documents.sourceRootPath,
      sourcePath: schema.documents.sourcePath,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, args.documentId),
        accessFilter(
          schema.documents,
          schema.documentShares,
          args.accessContext,
        ),
        inLocalFolder(folders),
      ),
    )
    .limit(1);
  const row = rows.length > 0 ? rows[0] : undefined;
  const path = localSourceFileDirectory(row?.sourcePath);
  return row?.rootPath && path ? { rootPath: row.rootPath, path } : null;
}

/**
 * The children the Files tree draws under `parentId`: pages in the same Files
 * database that aren't trashed, that the reader can see, and that pass the
 * view's filter. A row's `hasChildren` is whether this finds any.
 */
function visibleChildren(args: {
  parentId: typeof schema.documents.id;
  databaseId: string;
  accessContext: AccessContext;
  filter: Omit<Parameters<typeof navigationFilterSql>[0], "document">;
}) {
  const childDocuments = alias(schema.documents, "navigation_child_documents");
  const childItems = alias(
    schema.contentDatabaseItems,
    "navigation_child_memberships",
  );
  return getDb()
    .select({ id: childItems.id })
    .from(childItems)
    .innerJoin(childDocuments, eq(childDocuments.id, childItems.documentId))
    .where(
      and(
        eq(childItems.databaseId, args.databaseId),
        eq(childDocuments.parentId, args.parentId),
        isNull(childDocuments.trashedAt),
        accessFilter(childDocuments, schema.documentShares, args.accessContext),
        ...softDeletedDatabaseDocumentExclusions(childDocuments.id),
        navigationFilterSql({
          ...args.filter,
          document: {
            id: sql`${childDocuments.id}`,
            title: sql`${childDocuments.title}`,
            parentId: sql`${childDocuments.parentId}`,
            ownerEmail: sql`${childDocuments.ownerEmail}`,
            createdAt: sql`${childDocuments.createdAt}`,
            updatedAt: sql`${childDocuments.updatedAt}`,
          },
        }),
      ),
    );
}

/**
 * The pages among `documentIds` that have children in the Files tree, by
 * the same rule as a navigation row's `hasChildren`. The open page's path
 * uses it for rows the sidebar draws before their own page has loaded.
 */
export async function filesNavigationParentsWithChildren(args: {
  database: typeof schema.contentDatabases.$inferSelect;
  userEmail: string;
  overrides: ContentDatabasePersonalViewOverrides | null;
  documentIds: readonly string[];
}): Promise<Set<string>> {
  if (!args.documentIds.length) return new Set();
  const view = resolveNavigationView(args);
  const timeZone = getRequestTimezone();
  const rows = await getDb()
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(
      and(
        inArray(schema.documents.id, [...args.documentIds]),
        exists(
          visibleChildren({
            parentId: schema.documents.id,
            databaseId: args.database.id,
            accessContext: navigationAccessContext(
              args.userEmail,
              args.database,
            ),
            filter: {
              filters: view.filters,
              filterMode: view.filterMode,
              today: contentDatabaseFilterToday(timeZone),
              timeZone,
              definitionById: await navigationFilterDefinitions(
                args.database.id,
                view.filters,
              ),
            },
          }),
        ),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

export async function getContentDatabaseNavigationPage(args: {
  database: typeof schema.contentDatabases.$inferSelect;
  userEmail: string;
  overrides: ContentDatabasePersonalViewOverrides | null;
  parentId: string | null;
  sort: ContentDatabaseNavigationSort;
  viewId?: string;
  limit: number;
  cursor?: string;
  expand?: readonly string[];
  pagesOnly?: boolean;
  group?: string;
  locate?: string;
}): Promise<ContentDatabaseNavigationPageResponse> {
  if (args.database.systemRole !== "files" || !args.database.spaceId) {
    fail("Navigation mode is only available for a Files database.", {
      errorCode: "unsupported_navigation_database",
      statusCode: 400,
    });
  }
  if (args.group !== undefined && args.parentId !== null) {
    fail("A Files navigation group is read from the top level.", {
      errorCode: "invalid_navigation_group",
      statusCode: 400,
    });
  }
  if (
    args.locate !== undefined &&
    (args.parentId !== null || args.group !== undefined || args.cursor)
  ) {
    fail("A Files navigation page is located from the top level.", {
      errorCode: "invalid_navigation_group",
      statusCode: 400,
    });
  }

  const cursor = args.cursor ? decodeCursor(args.cursor) : null;
  const db = getDb();
  const accessContext = navigationAccessContext(args.userEmail, args.database);
  const {
    viewId,
    sharedView,
    personalView,
    filters: effectiveFilters,
    filterMode: effectiveFilterMode,
  } = resolveNavigationView(args);
  const sorts = personalView?.sorts ?? sharedView.sorts;
  // A view can have no sorts.
  const sharedSort = sorts.length > 0 ? sorts[0] : undefined;
  const configuredSort =
    (sharedSort && FILES_NAVIGATION_SORT_KEYS.get(sharedSort.key)) ?? null;
  const sidebarSort = personalView?.sidebarOrder?.mode;
  const [propertySorts, grouping] = await Promise.all([
    sidebarSort || !sharedSort || (configuredSort && configuredSort !== "name")
      ? null
      : navigationPropertySorts(args.database.id, sorts),
    args.parentId === null && (args.group !== undefined || !cursor)
      ? navigationGrouping(args.database.id, sharedView)
      : null,
  ]);
  const group =
    args.group === undefined
      ? undefined
      : grouping?.groups.find((candidate) => candidate.id === args.group);
  if (args.group !== undefined && !group) {
    if (cursor) invalidCursor();
    fail("The Files navigation group no longer exists.", {
      errorCode: "invalid_navigation_group",
      statusCode: 400,
    });
  }
  const effectiveSort: NavigationSort =
    sidebarSort ??
    (propertySorts?.sorts.length ? "property" : null) ??
    configuredSort ??
    args.sort;
  const descending = sidebarSort
    ? sidebarSort === "created" || sidebarSort === "last_edited"
    : effectiveSort !== "custom" && sharedSort?.direction === "desc";
  const itemIds =
    effectiveSort === "custom"
      ? (personalView?.sidebarOrder?.itemIds ?? [])
      : [];
  const orderHash =
    effectiveSort === "custom" ? orderFingerprint(itemIds) : null;
  const timeZone = getRequestTimezone();
  const today = contentDatabaseFilterToday(timeZone);
  const configHash = orderFingerprint([
    JSON.stringify({
      viewId,
      sharedView,
      personalView: personalView ?? null,
      effectiveSort,
      descending,
      ...(args.pagesOnly ? { pagesOnly: true } : {}),
      // A relative date filter matches other rows on another day, and one
      // with a time can in another time zone.
      ...(effectiveFilters.some(contentDatabaseFilterIsRelative)
        ? { today }
        : {}),
      ...(effectiveFilters.some(contentDatabaseFilterHasTime)
        ? { timeZone: timeZone ?? null }
        : {}),
    }),
  ]);
  const groupConfigHash =
    grouping &&
    orderFingerprint([
      configHash,
      JSON.stringify({
        type: grouping.type,
        groups: grouping.groups.map((candidate) => candidate.id),
      }),
    ]);
  if (
    cursor &&
    (cursor.databaseId !== args.database.id ||
      cursor.parentId !== args.parentId ||
      cursor.group !== args.group ||
      cursor.sort !== effectiveSort ||
      cursor.viewId !== viewId ||
      cursor.orderHash !== orderHash ||
      cursor.configHash !== (group ? groupConfigHash : configHash))
  ) {
    invalidCursor();
  }

  const readsLocalFolders =
    args.group === undefined &&
    args.locate === undefined &&
    (args.parentId === null ||
      isLocalSourceDirectoryId(args.parentId) ||
      (args.expand ?? []).some(isLocalSourceDirectoryId));
  const [definitionById, localFolders] = await Promise.all([
    navigationFilterDefinitions(args.database.id, effectiveFilters),
    readsLocalFolders ? localFolderSources(args.database.id) : null,
  ]);
  const linkedFolders =
    localFolders && localFolders.rootPaths.length > 0 ? localFolders : null;
  const folderLevel = (parentId: string | null): FolderLevel | null => {
    if (!linkedFolders) return null;
    if (parentId === null) return { folders: linkedFolders, directory: null };
    const directory = parseLocalSourceDirectoryId(parentId);
    return directory && linkedFolders.rootPaths.includes(directory.rootPath)
      ? { folders: linkedFolders, directory }
      : null;
  };
  if (
    args.parentId !== null &&
    isLocalSourceDirectoryId(args.parentId) &&
    !folderLevel(args.parentId)
  ) {
    fail("The Files navigation parent is unavailable.", {
      errorCode: "invalid_navigation_parent",
      statusCode: 400,
    });
  }
  const effectiveFilter = navigationFilterSql({
    filters: effectiveFilters,
    filterMode: effectiveFilterMode,
    today,
    timeZone,
    definitionById,
    document: {
      id: sql`${schema.documents.id}`,
      title: sql`${schema.documents.title}`,
      parentId: sql`${schema.documents.parentId}`,
      ownerEmail: sql`${schema.documents.ownerEmail}`,
      createdAt: sql`${schema.documents.createdAt}`,
      updatedAt: sql`${schema.documents.updatedAt}`,
    },
  });

  const favoriteItems = alias(
    schema.contentDatabaseItems,
    "navigation_favorite_memberships",
  );
  const roleShares = alias(schema.documentShares, "navigation_role_shares");
  const databaseDocuments = alias(
    schema.contentDatabases,
    "navigation_database_documents",
  );
  const filesRows = and(
    eq(schema.contentDatabaseItems.databaseId, args.database.id),
    isNull(schema.documents.trashedAt),
    accessFilter(schema.documents, schema.documentShares, accessContext),
    ...softDeletedDatabaseDocumentExclusions(schema.documents.id),
    effectiveFilter,
  );
  const siblingsOf = (parentId: string | null) => {
    const level = folderLevel(parentId);
    const directory = level?.directory ?? null;
    return and(
      directory
        ? undefined
        : parentId === null
          ? isNull(schema.documents.parentId)
          : eq(schema.documents.parentId, parentId),
      filesRows,
      level && !directory ? outsideLocalFolders(level.folders) : undefined,
      level && directory
        ? and(
            inLocalFolder(level.folders),
            withinDirectory(directory),
            sql`strpos(${pathInDirectory(directory)}, '/') = 0`,
          )
        : undefined,
    );
  };
  const groupRows = (candidate: NavigationGroup) =>
    and(
      filesRows,
      grouping
        ? storedValueSql(
            sql`${schema.documents.id}`,
            grouping.propertyId,
            candidate.predicate,
          )
        : sql`false`,
    );
  const accessRevision = sql<string>`coalesce((
    SELECT string_agg(ds.role || ':' || ds.principal_type || ':' || ds.principal_id, ',' ORDER BY ds.role, ds.principal_type, ds.principal_id)
    FROM document_shares ds
    WHERE ds.resource_id = ${schema.documents.id}
      AND ((ds.principal_type = 'user' AND lower(ds.principal_id) = lower(${args.userEmail}))
        ${args.database.orgId ? sql`OR (ds.principal_type = 'org' AND ds.principal_id = ${args.database.orgId})` : sql``})
  ), '')`;
  const rowHash = sql`hashtextextended(concat_ws('|',
    ${schema.contentDatabaseItems.id}, ${schema.contentDatabaseItems.position}::text,
    ${schema.contentDatabaseItems.updatedAt}, ${schema.documents.id},
    coalesce(${schema.documents.parentId}, ''), ${schema.documents.title},
    ${schema.documents.createdAt}, ${schema.documents.updatedAt},
    ${schema.documents.visibility}, coalesce(${schema.documents.trashedAt}, ''),
    coalesce(${schema.documents.sourceKind}, ''), ${accessRevision}
  ), 0)`;
  const activeDatabaseDocument = db
    .select({ id: databaseDocuments.id })
    .from(databaseDocuments)
    .where(
      and(
        eq(databaseDocuments.documentId, schema.documents.id),
        isNull(databaseDocuments.deletedAt),
      ),
    );
  const visibleChild = visibleChildren({
    parentId: schema.documents.id,
    databaseId: args.database.id,
    accessContext,
    filter: {
      filters: effectiveFilters,
      filterMode: effectiveFilterMode,
      today,
      timeZone,
      definitionById,
    },
  });
  const favoriteMembership = db
    .select({ id: favoriteItems.id })
    .from(favoriteItems)
    .where(
      and(
        eq(
          favoriteItems.databaseId,
          favoritesSystemIds(args.userEmail).databaseId,
        ),
        eq(favoriteItems.documentId, schema.documents.id),
      ),
    );
  const sharedWithRole = (roles: Array<"admin" | "editor">) =>
    db
      .select({ id: roleShares.id })
      .from(roleShares)
      .where(
        and(
          eq(roleShares.resourceId, schema.documents.id),
          or(
            inArray(roleShares.role, roles),
            // Legacy share rows can carry `owner` even though new writes use ShareRole.
            sql`${roleShares.role} = 'owner'`,
          ),
          or(
            and(
              eq(roleShares.principalType, "user"),
              eq(roleShares.principalId, args.userEmail),
            ),
            args.database.orgId
              ? and(
                  eq(roleShares.principalType, "org"),
                  eq(roleShares.principalId, args.database.orgId),
                )
              : undefined,
          ),
        ),
      );
  // The per-row lookups below are subqueries in the select list, so Postgres
  // runs them only for the rows the page returns, after its sort and limit.
  const rowFields = {
    membershipId: schema.contentDatabaseItems.id,
    membershipPosition: schema.contentDatabaseItems.position,
    documentId: schema.documents.id,
    parentId: schema.documents.parentId,
    title: schema.documents.title,
    icon: schema.documents.icon,
    spaceId: schema.documents.spaceId,
    sourceKind: schema.documents.sourceKind,
    sourceMode: schema.documents.sourceMode,
    sourcePath: schema.documents.sourcePath,
    ownerEmail: schema.documents.ownerEmail,
    createdAt: schema.documents.createdAt,
    updatedAt: schema.documents.updatedAt,
    type: sql<"page" | "database">`CASE WHEN ${exists(
      activeDatabaseDocument,
    )} THEN 'database' ELSE 'page' END`,
    hasChildren: sql<boolean>`${exists(visibleChild)}`,
    isFavorite: sql<boolean>`${exists(favoriteMembership)}`,
    sharedEditor: sql<boolean>`${exists(sharedWithRole(["admin", "editor"]))}`,
    sharedManager: sql<boolean>`${exists(sharedWithRole(["admin"]))}`,
    rowHash: sql<string>`${rowHash}::text`,
  };
  const membershipRows = (where: SQL | undefined) =>
    db
      .select(rowFields)
      .from(schema.contentDatabaseItems)
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabaseItems.documentId),
      )
      .where(where);
  type NavigationRow = Awaited<ReturnType<typeof membershipRows>>[number] & {
    sortValue: string | number;
  };

  // A cursor stays valid while every visible sibling up to it is unchanged:
  // rows after it are read fresh by the next page anyway. The revision is the
  // count and hash sum of that prefix, so it grows with the pages read, not
  // with the workspace.
  const revisionOf = async (
    query: Promise<Array<{ count: number; checksum: string }>>,
  ): Promise<NavigationRevision> => {
    const [row] = await query;
    return { count: row?.count ?? 0, checksum: BigInt(row?.checksum ?? "0") };
  };
  const revisionFields = {
    count: sql<number>`count(*)::int`,
    checksum: sql<string>`coalesce(sum((${rowHash})::numeric), 0)::text`,
  };
  const membershipRevision = (where: SQL | undefined) =>
    db
      .select(revisionFields)
      .from(schema.contentDatabaseItems)
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabaseItems.documentId),
      )
      .where(where);

  type NavigationOrder = {
    page: (
      siblings: SQL | undefined,
      after: NavigationCursor | null,
      take: number,
    ) => Promise<NavigationRow[]>;
    through: (
      siblings: SQL | undefined,
      cursor: NavigationCursor,
    ) => Promise<NavigationRevision[]>;
  };

  const sortValue: SQL<string> =
    effectiveSort === "name"
      ? sql<string>`${schema.documents.title}`
      : effectiveSort === "created"
        ? sql<string>`${schema.documents.createdAt}`
        : sql<string>`${schema.documents.updatedAt}`;
  const ascending = !descending;
  const sortedAfter = (key: { sortValue: string | number; itemId: string }) =>
    or(
      ascending ? gt(sortValue, key.sortValue) : lt(sortValue, key.sortValue),
      and(
        eq(sortValue, key.sortValue),
        gt(schema.contentDatabaseItems.id, key.itemId),
      ),
    );
  const sortedOrder: NavigationOrder = {
    page: (siblings, after, take) =>
      db
        .select({ ...rowFields, sortValue })
        .from(schema.contentDatabaseItems)
        .innerJoin(
          schema.documents,
          eq(schema.documents.id, schema.contentDatabaseItems.documentId),
        )
        .where(and(siblings, after ? sortedAfter(after) : undefined))
        .orderBy(
          ascending ? asc(sortValue) : desc(sortValue),
          asc(schema.contentDatabaseItems.id),
        )
        .limit(take),
    through: (siblings, cursor) =>
      Promise.all([
        revisionOf(
          membershipRevision(
            and(
              siblings,
              ascending
                ? lte(sortValue, cursor.sortValue)
                : gte(sortValue, cursor.sortValue),
              sql`not (${sortedAfter(cursor)!})`,
            ),
          ),
        ),
      ]),
  };

  // Custom order puts the saved item IDs first, in saved order, and the rest
  // after them by position.
  const rankById = new Map<string, number>();
  itemIds.forEach((itemId, index) => {
    if (!rankById.has(itemId)) rankById.set(itemId, index + 1);
  });
  const unrankedValue = itemIds.length + 1;
  const allRanks = [...rankById];

  // The root holds most of a workspace, and a saved order mostly lists root
  // items, so the root walks the saved list in order through primary-key
  // lookups and the unranked rest through the (database_id, position, id)
  // index. Neither sorts the whole Files database.
  const savedRanks = (ranks: Array<[string, number]>) =>
    sql`jsonb_to_recordset(${JSON.stringify(
      ranks.map(([itemId, rank]) => ({ item_id: itemId, rank })),
    )}::jsonb) as saved_rank(item_id text, rank integer)`;
  const rankedSource = (ranks: Array<[string, number]>) =>
    sql`(select item_id, rank from ${savedRanks(ranks)} order by rank) as navigation_rank`;
  // NOT IN over a subquery is a hashed lookup; NOT EXISTS here would rescan
  // the saved list for every candidate row.
  const notRanked = allRanks.length
    ? sql`${schema.contentDatabaseItems.id} not in (select item_id from ${savedRanks(allRanks)})`
    : undefined;
  const rankedRows = (ranks: Array<[string, number]>) =>
    db
      .select({ ...rowFields, sortValue: sql<number>`navigation_rank.rank` })
      .from(rankedSource(ranks))
      .innerJoin(
        schema.contentDatabaseItems,
        eq(schema.contentDatabaseItems.id, sql`navigation_rank.item_id`),
      )
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabaseItems.documentId),
      );
  const positionAfter = (key: { position?: number; itemId: string }) =>
    sql`(${schema.contentDatabaseItems.position}, ${schema.contentDatabaseItems.id}) > (${key.position!}, ${key.itemId})`;
  const positionThrough = (key: { position?: number; itemId: string }) =>
    sql`(${schema.contentDatabaseItems.position}, ${schema.contentDatabaseItems.id}) <= (${key.position!}, ${key.itemId})`;
  const savedListOrder: NavigationOrder = {
    page: async (siblings, after, take) => {
      const cursorRank = after ? Number(after.sortValue) : 0;
      const rankedAfterCursor = allRanks.filter(
        ([, rank]) => rank > cursorRank,
      );
      const rankedPage = (ranks: Array<[string, number]>) =>
        ranks.length
          ? rankedRows(ranks)
              .where(siblings)
              .orderBy(sql`navigation_rank.rank`)
              .limit(take)
          : Promise.resolve([]);
      // A saved order can hold thousands of IDs, but a page usually fills
      // from the first few, so the whole list is only sent when that window
      // falls short. Rows past the last saved sibling come from the unranked
      // side.
      const window = rankedAfterCursor.slice(0, take * 4);
      let ranked = await rankedPage(window);
      let unranked: Awaited<ReturnType<typeof membershipRows>> = [];
      if (ranked.length < take) {
        const [rest, tail] = await Promise.all([
          rankedPage(rankedAfterCursor.slice(window.length)),
          membershipRows(
            and(
              siblings,
              notRanked,
              after && cursorRank === unrankedValue
                ? positionAfter(after)
                : undefined,
            ),
          )
            .orderBy(
              asc(schema.contentDatabaseItems.position),
              asc(schema.contentDatabaseItems.id),
            )
            .limit(take),
        ]);
        ranked = [...ranked, ...rest].slice(0, take);
        unranked = tail.slice(0, take - ranked.length);
      }
      return [
        ...ranked,
        ...unranked.map((row) => ({ ...row, sortValue: unrankedValue })),
      ];
    },
    through: (siblings, cursor) => {
      const cursorRank = Number(cursor.sortValue);
      const ranksThrough = allRanks.filter(([, rank]) => rank <= cursorRank);
      return Promise.all([
        ...(ranksThrough.length
          ? [
              revisionOf(
                db
                  .select(revisionFields)
                  .from(rankedSource(ranksThrough))
                  .innerJoin(
                    schema.contentDatabaseItems,
                    eq(
                      schema.contentDatabaseItems.id,
                      sql`navigation_rank.item_id`,
                    ),
                  )
                  .innerJoin(
                    schema.documents,
                    eq(
                      schema.documents.id,
                      schema.contentDatabaseItems.documentId,
                    ),
                  )
                  .where(siblings),
              ),
            ]
          : []),
        ...(cursorRank === unrankedValue
          ? [
              revisionOf(
                membershipRevision(
                  and(siblings, notRanked, positionThrough(cursor)),
                ),
              ),
            ]
          : []),
      ]);
    },
  };

  // A folder's own children are found through the parent_id index, so a
  // child branch ranks just those rows by looking each one up in the saved
  // order, instead of walking a saved list that mostly holds other branches.
  // The order is one jsonb object bound once; a joined set of saved IDs would
  // be estimated at 100 rows and planned as a rescan per sibling.
  const rankOrder = (
    ranks: ReadonlyMap<string, number>,
    unranked: number,
  ): NavigationOrder => {
    const savedOrder = sql`(select ${JSON.stringify(
      Object.fromEntries(ranks),
    )}::jsonb as ranks) as navigation_saved_order`;
    const siblingRank = sql<number>`coalesce((navigation_saved_order.ranks ->> ${schema.contentDatabaseItems.id})::int, ${unranked})`;
    const siblingKey = sql`(${siblingRank}, ${schema.contentDatabaseItems.position}, ${schema.contentDatabaseItems.id})`;
    const cursorKey = (key: NavigationCursor) =>
      sql`(${Number(key.sortValue)}, ${Number(key.position)}, ${key.itemId})`;
    return {
      page: (siblings, after, take) =>
        db
          .select({ ...rowFields, sortValue: siblingRank })
          .from(schema.contentDatabaseItems)
          .innerJoin(
            schema.documents,
            eq(schema.documents.id, schema.contentDatabaseItems.documentId),
          )
          .innerJoin(savedOrder, sql`true`)
          .where(
            and(
              siblings,
              after ? sql`${siblingKey} > ${cursorKey(after)}` : undefined,
            ),
          )
          .orderBy(
            siblingRank,
            asc(schema.contentDatabaseItems.position),
            asc(schema.contentDatabaseItems.id),
          )
          .limit(take),
      through: (siblings, cursor) =>
        Promise.all([
          revisionOf(
            db
              .select(revisionFields)
              .from(schema.contentDatabaseItems)
              .innerJoin(
                schema.documents,
                eq(schema.documents.id, schema.contentDatabaseItems.documentId),
              )
              .innerJoin(savedOrder, sql`true`)
              .where(and(siblings, sql`${siblingKey} <= ${cursorKey(cursor)}`)),
          ),
        ]),
    };
  };

  const propertyRanks = async (
    siblings: SQL | undefined,
    { sorts: rankSorts, properties }: NonNullable<typeof propertySorts>,
  ) => {
    const values = schema.documentPropertyValues;
    const rows = await db
      .select({
        itemId: schema.contentDatabaseItems.id,
        title: schema.documents.title,
        values: sql<
          string | null
        >`(select jsonb_object_agg(${values.propertyId}, ${values.valueJson})::text from ${values} where ${values.documentId} = ${schema.documents.id} and ${inArray(
          values.propertyId,
          properties.map((property) => property.definition.id),
        )})`,
      })
      .from(schema.contentDatabaseItems)
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabaseItems.documentId),
      )
      .where(siblings)
      .orderBy(
        asc(schema.contentDatabaseItems.position),
        asc(schema.contentDatabaseItems.createdAt),
        asc(schema.contentDatabaseItems.id),
      );
    const items = rows.map((row) => {
      const saved: Record<string, string> = row.values
        ? JSON.parse(row.values)
        : {};
      return {
        id: row.itemId,
        databaseId: args.database.id,
        document: { title: row.title },
        properties: properties.map((property) => ({
          ...property,
          value: parsePropertyValue(saved[property.definition.id]),
        })),
      } as ContentDatabaseItem;
    });
    const sorted = applyContentDatabaseTableQuery(
      items,
      properties,
      { search: "", filters: [], sorts: rankSorts, filterMode: "and" },
      timeZone ? { timeZone } : {},
    );
    return new Map(sorted.map((item, index) => [item.id, index + 1]));
  };

  const folderPages = (level: FolderLevel) =>
    and(
      filesRows,
      inLocalFolder(level.folders),
      withinDirectory(level.directory),
      sql`strpos(${pathInDirectory(level.directory)}, '/') > 0`,
    );
  const folderEntries = (level: FolderLevel) =>
    sql`(${db
      .select({
        rootPath: sql`${schema.documents.sourceRootPath}`.as("root_path"),
        name: sql`split_part(${pathInDirectory(level.directory)}, '/', 1)`.as(
          "name",
        ),
        createdAt: sql`${schema.documents.createdAt}`.as("created_at"),
        updatedAt: sql`${schema.documents.updatedAt}`.as("updated_at"),
      })
      .from(schema.contentDatabaseItems)
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabaseItems.documentId),
      )
      .where(folderPages(level))}) as navigation_folder_entry`;
  const folderRoot = sql<string>`navigation_folder_entry.root_path`;
  const folderName = sql<string>`navigation_folder_entry.name`;
  const folderKey = sql`(${folderName}, ${folderRoot})`;
  const folderKeyOf = ([rootPath, name]: [string, string]) =>
    sql`(${name}::text, ${rootPath}::text)`;
  const folderCreatedAt = sql<string>`min(navigation_folder_entry.created_at)`;
  const folderUpdatedAt = sql<string>`max(navigation_folder_entry.updated_at)`;
  const folderHash = sql`hashtextextended(concat_ws('|', ${folderRoot}, ${folderName}, ${folderCreatedAt}::text, ${folderUpdatedAt}::text), 0)`;
  const readFolders = (
    level: FolderLevel,
    after: [string, string] | null,
    take: number,
  ) =>
    db
      .select({
        rootPath: folderRoot,
        name: folderName,
        createdAt: folderCreatedAt,
        updatedAt: folderUpdatedAt,
        rowHash: sql<string>`${folderHash}::text`,
      })
      .from(folderEntries(level))
      .where(after ? sql`${folderKey} > ${folderKeyOf(after)}` : undefined)
      .groupBy(folderRoot, folderName)
      .orderBy(asc(folderName), asc(folderRoot))
      .limit(take);
  const folderRevision = (
    level: FolderLevel,
    through: [string, string] | null,
  ) =>
    revisionOf(
      db
        .select({
          count: sql<number>`count(*)::int`,
          checksum: sql<string>`coalesce(sum(navigation_folder.row_hash::numeric), 0)::text`,
        })
        .from(
          sql`(${db
            .select({ rowHash: sql`${folderHash}`.as("row_hash") })
            .from(folderEntries(level))
            .where(
              through
                ? sql`${folderKey} <= ${folderKeyOf(through)}`
                : undefined,
            )
            .groupBy(folderRoot, folderName)}) as navigation_folder`,
        )
        .limit(1),
    );
  const revisionOfRows = (rows: Array<{ rowHash: string }>) => ({
    count: rows.length,
    checksum: rows.reduce((total, row) => total + BigInt(row.rowHash), 0n),
  });

  let groupedRanks: Promise<Map<string, number>> | undefined;
  const readBranch = async (
    parentId: string | null,
    after: NavigationCursor | null,
    inGroup?: NavigationGroup,
  ): Promise<ContentDatabaseNavigationPage> => {
    const siblings = inGroup ? groupRows(inGroup) : siblingsOf(parentId);
    const ranks =
      effectiveSort === "property" && propertySorts
        ? await (inGroup
            ? (groupedRanks ??= propertyRanks(filesRows, propertySorts))
            : propertyRanks(siblings, propertySorts))
        : null;
    const order = ranks
      ? rankOrder(ranks, ranks.size + 1)
      : effectiveSort !== "custom"
        ? sortedOrder
        : parentId === null && !inGroup
          ? savedListOrder
          : rankOrder(rankById, unrankedValue);
    const level = inGroup ? null : folderLevel(parentId);
    const listed = args.pagesOnly ? null : level;
    if (after?.folder && !listed) invalidCursor();
    const foldersAfter = listed && (!after || after.folder) ? listed : null;
    const [folders, rows, prefixRevision] = await Promise.all([
      foldersAfter
        ? readFolders(foldersAfter, after?.folder ?? null, args.limit + 1)
        : [],
      order.page(siblings, foldersAfter ? null : after, args.limit + 1),
      !after
        ? []
        : !listed
          ? order.through(siblings, after)
          : after.folder
            ? Promise.all([folderRevision(listed, after.folder)])
            : Promise.all([
                folderRevision(listed, null),
                order.through(siblings, after),
              ]).then(([folderPart, pageParts]) => [folderPart, ...pageParts]),
    ]);
    if (after && combineRevisions(prefixRevision) !== after.revision) {
      invalidCursor();
    }
    const hasMore = folders.length + rows.length > args.limit;
    const folderRows = folders.slice(0, args.limit);
    const pageRows = rows.slice(0, args.limit - folderRows.length);
    const candidates = pageRows.filter(
      (row) =>
        row.sourceMode === "local-files" &&
        row.sourceKind === "file" &&
        localSourceFileDirectory(row.sourcePath),
    );
    const linkedRows =
      candidates.length > 0
        ? await db
            .select({ id: schema.documents.id })
            .from(schema.documents)
            .where(
              and(
                inArray(
                  schema.documents.id,
                  candidates.map((row) => row.documentId),
                ),
                linkedNestedLocalFile(db),
              ),
            )
        : [];
    const immovable = new Set(linkedRows.map((row) => row.id));
    const folderPath = (name: string) =>
      level?.directory ? `${level.directory.path}/${name}` : name;
    const last =
      pageRows.length > 0 ? pageRows[pageRows.length - 1] : undefined;
    const lastFolder =
      folderRows.length > 0 ? folderRows[folderRows.length - 1] : undefined;
    const cursorFields = {
      version: CURSOR_VERSION,
      databaseId: args.database.id,
      parentId,
      sort: effectiveSort,
      viewId,
      orderHash,
      revision: combineRevisions([
        ...prefixRevision,
        revisionOfRows(folderRows),
        revisionOfRows(pageRows),
      ]),
      configHash: (inGroup ? groupConfigHash : null) ?? configHash,
      ...(inGroup ? { group: inGroup.id } : {}),
    } as const;
    return {
      items: [
        ...folderRows.map((folder): ContentDatabaseNavigationItem => {
          const path = folderPath(folder.name);
          const id = localSourceDirectoryId({
            rootPath: folder.rootPath,
            path,
          });
          return {
            membershipId: id,
            membershipPosition: 0,
            documentId: id,
            parentId,
            title: localSourceDirectoryTitle(path),
            icon: null,
            type: "folder",
            hasChildren: true,
            spaceId: args.database.spaceId,
            sourceKind: "folder",
            isFavorite: false,
            canEdit: false,
            canManage: false,
            createdAt: folder.createdAt,
            updatedAt: folder.updatedAt,
          };
        }),
        ...pageRows.map(
          ({
            sortValue: _sortValue,
            rowHash: _rowHash,
            ownerEmail,
            sharedEditor,
            sharedManager,
            sourceMode: _sourceMode,
            sourcePath: _sourcePath,
            ...row
          }) => {
            const isOwner =
              ownerEmail.toLowerCase() === args.userEmail.toLowerCase();
            return {
              ...row,
              ...(immovable.has(row.documentId) ? { canMove: false } : {}),
              ...(level?.directory ? { parentId } : {}),
              canEdit: isOwner || sharedEditor,
              canManage: isOwner || sharedManager,
            };
          },
        ),
      ],
      pagination: {
        limit: args.limit,
        hasMore,
        nextCursor: !hasMore
          ? null
          : last
            ? encodeCursor({
                ...cursorFields,
                sortValue: last.sortValue,
                position:
                  effectiveSort === "custom" || effectiveSort === "property"
                    ? last.membershipPosition
                    : undefined,
                itemId: last.membershipId,
              })
            : lastFolder
              ? encodeCursor({
                  ...cursorFields,
                  sortValue: lastFolder.name,
                  itemId: localSourceDirectoryId({
                    rootPath: lastFolder.rootPath,
                    path: folderPath(lastFolder.name),
                  }),
                  folder: [lastFolder.rootPath, lastFolder.name],
                })
              : null,
      },
    };
  };

  const groupCounts = async (where: SQL | undefined) => {
    if (!grouping) return [];
    const countRows = await db
      .select(
        Object.fromEntries(
          grouping.groups.map((candidate, index) => [
            `group${index}`,
            sql<number>`(count(*) filter (where ${candidate.predicate}))::int`,
          ]),
        ),
      )
      .from(schema.contentDatabaseItems)
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabaseItems.documentId),
      )
      .leftJoin(
        sql`lateral ${storedValueSource(sql`${schema.documents.id}`, grouping.propertyId)}`,
        sql`true`,
      )
      .where(where);
    const counts = firstRow(countRows);
    return grouping.groups.map((candidate, index) => ({
      candidate,
      count: Number(counts?.[`group${index}`] ?? 0),
    }));
  };

  if (args.locate !== undefined) {
    const located = await groupCounts(
      and(filesRows, eq(schema.documents.id, args.locate)),
    );
    return {
      items: [],
      pagination: { limit: args.limit, hasMore: false, nextCursor: null },
      locatedGroupIds: located.flatMap(({ candidate, count }) =>
        count > 0 ? [candidate.id] : [],
      ),
    };
  }

  const expandIds = group ? [] : (args.expand ?? []);
  // The requested parent and the expanded folders pass the same access,
  // trash, and deletion checks before any of their children are read.
  const checkedIds = [
    ...new Set([
      ...(args.parentId === null ? [] : [args.parentId]),
      ...expandIds,
    ]),
  ].filter((id) => !isLocalSourceDirectoryId(id));
  const checked =
    checkedIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: schema.documents.id,
            parentId: schema.documents.parentId,
            inLocalFolder: linkedFolders
              ? sql<boolean>`not ${outsideLocalFolders(linkedFolders)}`
              : sql<boolean>`false`,
            sourceRootPath: schema.documents.sourceRootPath,
            sourcePath: schema.documents.sourcePath,
          })
          .from(schema.contentDatabaseItems)
          .innerJoin(
            schema.documents,
            eq(schema.documents.id, schema.contentDatabaseItems.documentId),
          )
          .where(
            and(
              eq(schema.contentDatabaseItems.databaseId, args.database.id),
              inArray(schema.documents.id, checkedIds),
              eq(schema.documents.spaceId, args.database.spaceId),
              isNull(schema.documents.trashedAt),
              accessFilter(
                schema.documents,
                schema.documentShares,
                accessContext,
              ),
              ...softDeletedDatabaseDocumentExclusions(schema.documents.id),
            ),
          );
  const pageRead = readBranch(args.parentId, cursor, group);
  const parentFound = (rows: Array<{ id: string }>) =>
    args.parentId === null ||
    folderLevel(args.parentId) !== null ||
    rows.some((row) => row.id === args.parentId);

  // Expanded folders under the requested parent return their first pages
  // with it. Which ones open follows from the checked parent links alone, so
  // every branch reads alongside the page instead of one level per query. A
  // first page also opens expanded folders that are not on it: the sidebar
  // shows the open page's ancestors under their parent's first page wherever
  // they sort.
  const branchReads = checked.then(async (rows) => {
    if (!parentFound(rows)) return { branches: [], truncated: false };
    const expand = new Set(expandIds);
    const parentOf = new Map<string, string | null>();
    const expandedChildren = new Map<string | null, string[]>();
    const expandUnder = (id: string, parentId: string | null) => {
      parentOf.set(id, parentId);
      const siblings = expandedChildren.get(parentId) ?? [];
      siblings.push(id);
      expandedChildren.set(parentId, siblings);
    };
    for (const row of rows) {
      if (!expand.has(row.id)) continue;
      const directory = row.inLocalFolder
        ? localSourceFileDirectory(row.sourcePath)
        : null;
      expandUnder(
        row.id,
        directory && row.sourceRootPath
          ? localSourceDirectoryId({
              rootPath: row.sourceRootPath,
              path: directory,
            })
          : row.parentId,
      );
    }
    for (const id of expand) {
      const directory = folderLevel(id)?.directory;
      if (!directory) continue;
      const above = parentLocalSourceDirectory(directory);
      expandUnder(id, above ? localSourceDirectoryId(above) : null);
    }
    let level = expandedChildren.get(args.parentId) ?? [];
    if (cursor && level.length > 0) {
      const listed = new Set(
        (await pageRead).items.map((item) => item.documentId),
      );
      level = level.filter((documentId) => listed.has(documentId));
    }
    // Stored parent links can form a cycle through the requested parent, so
    // a folder is reached once and the parent itself never opens.
    const reachable = new Set<string>();
    while (level.length > 0) {
      for (const documentId of level) reachable.add(documentId);
      level = level.flatMap((documentId) =>
        (expandedChildren.get(documentId) ?? []).filter(
          (child) => child !== args.parentId && !reachable.has(child),
        ),
      );
    }
    // The cap keeps folders in the order the caller asked for them, each with
    // the open folders above it, so the open page's ancestors, asked for
    // first, are not cut for breadth.
    const opened = new Set<string>();
    for (const documentId of expandIds) {
      const chain: string[] = [];
      for (
        let id: string | null | undefined = documentId;
        typeof id === "string" && reachable.has(id) && !opened.has(id);
        id = parentOf.get(id)
      ) {
        chain.push(id);
      }
      if (opened.size + chain.length > MAX_NAVIGATION_EXPANDED_BRANCHES) {
        continue;
      }
      for (const id of chain) opened.add(id);
    }
    const openedIds = [...opened];
    const pages = await Promise.all(
      openedIds.map((documentId) => readBranch(documentId, null)),
    );
    return {
      // A folder with no children the caller can see draws no branch.
      branches: openedIds.flatMap((documentId, index) =>
        pages[index]!.items.length > 0
          ? [[documentId, pages[index]!] as const]
          : [],
      ),
      truncated: opened.size < reachable.size,
    };
  });

  const groupReads =
    grouping && !group && !cursor
      ? (async () => {
          const shown = (await groupCounts(filesRows)).filter(
            ({ count }) => count > 0 || sharedView.hideEmptyGroups !== true,
          );
          const pages = new Map<string, ContentDatabaseNavigationPage>();
          await processWithConcurrency(
            shown.filter(({ count }) => count > 0),
            NAVIGATION_GROUP_READ_CONCURRENCY,
            async ({ candidate }) => {
              pages.set(candidate.id, await readBranch(null, null, candidate));
            },
          );
          return shown.map(
            ({ candidate, count }): ContentDatabaseNavigationGroup => ({
              id: candidate.id,
              label: candidate.label,
              unset: candidate.unset,
              count,
              page: pages.get(candidate.id) ?? {
                items: [],
                pagination: {
                  limit: args.limit,
                  hasMore: false,
                  nextCursor: null,
                },
              },
            }),
          );
        })()
      : null;

  const [checkedRows, page, expanded, groups] = await Promise.all([
    checked,
    pageRead,
    branchReads,
    groupReads,
  ]);
  if (!parentFound(checkedRows)) {
    fail("The Files navigation parent is unavailable.", {
      errorCode: "invalid_navigation_parent",
      statusCode: 400,
    });
  }
  return {
    ...page,
    ...(groups ? { groups } : {}),
    ...(expanded.branches.length > 0
      ? { branches: Object.fromEntries(expanded.branches) }
      : {}),
    ...(expandIds.length > 0 ? { branchesTruncated: expanded.truncated } : {}),
  };
}
