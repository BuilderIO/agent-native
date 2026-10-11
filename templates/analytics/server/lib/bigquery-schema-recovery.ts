import { editDistance } from "../../shared/panel-render-contract";
import {
  flattenBigQueryFields,
  getBigQueryProjectId,
  getBigQueryTableMetadata,
  listBigQueryTables,
} from "./bigquery";

const LOOKUP_TIMEOUT_MS = 8_000;
// The deadline aborts the metadata fetches, and the lookup gets this long to
// settle with the tables that did answer before it is abandoned.
const ABORT_GRACE_MS = 250;
const MAX_LOOKUP_TABLES = 3;
const MAX_COLUMNS = 60;
const MAX_SUGGESTIONS = 5;
const TABLE_LISTING_LIMIT = 200;
const PROJECT_RE = /^[A-Za-z][A-Za-z0-9-]{4,61}[A-Za-z0-9]$/;
const ID_RE = /^[A-Za-z0-9_-]+$/;

/** `unavailable`: the SQL and the error name no table that can be looked up.
 *  `failed`: a lookup ran and the metadata API did not answer. A result without
 *  the field carries the schema it found. */
export type SchemaLookupStatus = "failed" | "unavailable";

export interface SchemaRecovery {
  schemaLookup?: SchemaLookupStatus;
  table?: string;
  /** Columns of `table` nearest to the unrecognized name. */
  didYouMean?: string[];
  /** Tables of the missing table's dataset nearest to its name. */
  didYouMeanTables?: string[];
  /** The dataset has more tables than were searched for `didYouMeanTables`. */
  truncated?: true;
  /** The first columns of `table` as `name:type`. */
  columns?: string[];
  columnCount?: number;
  columnsTruncated?: true;
  /** Tables in the SQL whose metadata could not be read. */
  unreadTables?: string[];
}

interface TableRef {
  projectId: string;
  datasetId: string;
  tableId: string;
}

const refName = (ref: TableRef) =>
  `${ref.projectId}.${ref.datasetId}.${ref.tableId}`;

async function parseTableRef(raw: string): Promise<TableRef | null> {
  // BigQuery writes a missing table as `project:dataset.table`.
  const parts = raw.replace(/`/g, "").replace(":", ".").split(".");
  if (parts.length < 2 || parts.length > 3) return null;
  const [projectId, datasetId, tableId] =
    parts.length === 3
      ? parts
      : [await getBigQueryProjectId(), parts[0]!, parts[1]!];
  if (
    !PROJECT_RE.test(projectId!) ||
    !ID_RE.test(datasetId!) ||
    !ID_RE.test(tableId!)
  ) {
    return null;
  }
  return { projectId: projectId!, datasetId: datasetId!, tableId: tableId! };
}

// A dotted path whose parts are bare or backtick-quoted: `proj.ds`.tbl is valid.
const TABLE_PATH = "(?:`[^`]+`|[\\w-]+)(?:\\.(?:`[^`]+`|[\\w-]+))*";
const TABLE_AT_START = new RegExp(`^\\s*(${TABLE_PATH})(?![\\w.\`-]|\\s*\\()`);
const NOT_AN_ALIAS =
  /^(?:cross|for|from|full|group|having|inner|intersect|join|left|limit|natural|on|order|qualify|right|select|tablesample|union|using|where|window)$/i;
// Functions whose arguments contain a FROM that does not name a table.
const FROM_IN_ARGUMENTS =
  /(?:^|\W)(?:extract|trim|ltrim|rtrim|substring|substr|overlay|position)\s*$/i;

/** Blanks comments and string literals: a table named in prose is not read. */
function codeOnly(sql: string): string {
  return sql.replace(
    /('''[\s\S]*?'''|"""[\s\S]*?"""|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`[^`]*`)|--[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\//g,
    (_match, kept: string | undefined) => (kept?.startsWith("`") ? kept : " "),
  );
}

/** The tables of the comma-separated list that starts `tail`. */
function tableList(tail: string): string[] {
  const refs: string[] = [];
  const aliases = new Set<string>();
  for (;;) {
    const table = TABLE_AT_START.exec(tail);
    if (!table) return refs;
    tail = tail.slice(table[0].length);
    const path = table[1]!.replace(/`/g, "").split(".");
    // `FROM orders o, o.items` reads the array column of an earlier table.
    if (!aliases.has(path[0]!.toLowerCase())) refs.push(table[1]!);
    aliases.add(path[path.length - 1]!.toLowerCase());
    const alias = /^\s+(?:as\s+)?(\w+)/i.exec(tail);
    if (alias && !NOT_AN_ALIAS.test(alias[1]!)) {
      aliases.add(alias[1]!.toLowerCase());
      tail = tail.slice(alias[0].length);
    }
    const comma = /^\s*,/.exec(tail);
    if (!comma) return refs;
    tail = tail.slice(comma[0].length);
  }
}

async function tablesInSql(sql: string): Promise<TableRef[]> {
  const code = codeOnly(sql);
  const functionParens: boolean[] = [];
  const raws: string[] = [];
  const scan = /\(|\)|\b(from|join)\b/gi;
  for (let hit = scan.exec(code); hit; hit = scan.exec(code)) {
    const before = code.slice(Math.max(0, hit.index - 40), hit.index);
    if (hit[0] === "(") functionParens.push(FROM_IN_ARGUMENTS.test(before));
    else if (hit[0] === ")") functionParens.pop();
    else if (
      !functionParens[functionParens.length - 1] &&
      !/\bdistinct\s+$/i.test(before)
    ) {
      raws.push(...tableList(code.slice(scan.lastIndex)));
    }
  }
  const found = new Map<string, TableRef>();
  for (const raw of raws) {
    if (/[*$@]/.test(raw)) continue;
    const ref = await parseTableRef(raw);
    if (ref) found.set(refName(ref), ref);
  }
  return [...found.values()].slice(0, MAX_LOOKUP_TABLES);
}

function nearest(
  target: string,
  names: readonly string[],
  leaf: (name: string) => string,
): string[] {
  const wanted = target.toLowerCase();
  const limit = Math.max(2, Math.ceil(wanted.length / 2));
  return names
    .map((name) => {
      const candidate = leaf(name).toLowerCase();
      const contains = candidate.includes(wanted) || wanted.includes(candidate);
      return { name, distance: contains ? 1 : editDistance(wanted, candidate) };
    })
    .filter(({ distance }) => distance <= limit)
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ name }) => name);
}

/** What a failed query's next call needs: the real columns when a name was not
 *  recognized, the real sibling tables when a table was not found. Never throws;
 *  a lookup that cannot finish says so in `schemaLookup` and the caller keeps
 *  the original error. */
export async function recoverFromSchemaMiss(
  sql: string,
  message: string,
  signal?: AbortSignal,
): Promise<SchemaRecovery | null> {
  // BigQuery words a bare miss "Unrecognized name: x" and an alias-qualified
  // one "Name x not found inside s".
  const column =
    /Unrecognized name:\s*`?([\w.]+)`?/i.exec(message)?.[1] ??
    /\bName\s+`?(\w+)`?\s+not found inside\b/i.exec(message)?.[1];
  const missingTable = /Not found:\s*Table\s+`?([^\s`]+)`?/i.exec(message)?.[1];
  if (!column && !missingTable) return null;

  // The deadline bounds the whole lookup. Aborting the metadata fetches alone
  // does not: the token and credential reads ahead of them take no signal, and
  // a token cache miss retries Google for 30 seconds per attempt. So the abort
  // lets the fetches reject and the lookup keep what answered, and only a lookup
  // still pending after the grace is abandoned.
  const deadline = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`timed out after ${LOOKUP_TIMEOUT_MS}ms`);
      deadline.abort(error);
      timer = setTimeout(() => reject(error), ABORT_GRACE_MS);
    }, LOOKUP_TIMEOUT_MS);
  });
  const lookupSignal = signal
    ? AbortSignal.any([signal, deadline.signal])
    : deadline.signal;
  const lookup = async (): Promise<SchemaRecovery> => {
    if (missingTable) {
      const ref = await parseTableRef(missingTable);
      if (!ref) return { schemaLookup: "unavailable" };
      // One past the limit tells a full listing from a cut one.
      const listed = await listBigQueryTables(
        ref.projectId,
        ref.datasetId,
        TABLE_LISTING_LIMIT + 1,
        lookupSignal,
      );
      const ids = listed
        .slice(0, TABLE_LISTING_LIMIT)
        .flatMap((table) =>
          table.tableId ? [`${ref.datasetId}.${table.tableId}`] : [],
        );
      return {
        table: `${ref.datasetId}.${ref.tableId}`,
        didYouMeanTables: nearest(
          ref.tableId,
          ids,
          (name) => name.split(".").pop()!,
        ),
        ...(listed.length > TABLE_LISTING_LIMIT ? { truncated: true } : {}),
      };
    }

    const refs = await tablesInSql(sql);
    if (refs.length === 0) return { schemaLookup: "unavailable" };
    const settled = await Promise.allSettled(
      refs.map(async (ref) => ({
        ref,
        columns: flattenBigQueryFields(
          (await getBigQueryTableMetadata(ref, lookupSignal, { fresh: true }))
            .schema?.fields,
        ),
      })),
    );
    const tables = settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    if (tables.length === 0) return { schemaLookup: "failed" };
    const unread = refs
      .filter((_, index) => settled[index]!.status === "rejected")
      .map(refName);

    const ranked = tables.map((entry) => ({
      ...entry,
      suggestions: nearest(
        column!,
        entry.columns.map((c) => c.name),
        (name) => name.split(".").pop()!,
      ),
    }));
    const best =
      ranked.find((entry) => entry.suggestions.length > 0) ?? ranked[0]!;
    return {
      table: refName(best.ref),
      didYouMean: best.suggestions,
      columns: best.columns
        .slice(0, MAX_COLUMNS)
        .map((c) => `${c.name}:${c.type ?? "UNKNOWN"}`),
      columnCount: best.columns.length,
      ...(best.columns.length > MAX_COLUMNS ? { columnsTruncated: true } : {}),
      ...(unread.length ? { unreadTables: unread } : {}),
    };
  };
  try {
    return await Promise.race([lookup(), expired]);
  } catch (error) {
    console.warn(
      "[bigquery] Schema lookup after a failed query did not finish.",
      error instanceof Error ? error.message : "unknown error",
    );
    return { schemaLookup: "failed" };
  } finally {
    clearTimeout(timer);
  }
}
