import { base64ToUint8Array } from "@agent-native/core/collab";
import { applyUpdate, Doc as YDoc } from "yjs";

import { compareLiveBody, materializeLiveBody } from "../shared/live-body.js";
import { resolveMarkdownSuggestionRange } from "../shared/suggestion-rebase.js";
import {
  canonicalizerFingerprint,
  classifyBody,
  commentAnchorText,
} from "./stored-form-census-kinds.js";

type CensusQuery = (
  sql: string,
  args?: unknown[],
) => Promise<Record<string, unknown>[]>;

const ORPHAN_BATCH = 1000;
// Larger bodies and live copies are counted without being parsed. Parsing has
// no deadline: Content's parser is quadratic in the length of a line that
// holds a long run of spaces or `[` (about 1.5 seconds per parse at 40 KiB),
// and the GFM reader in how deeply one line nests (`- - - …`, `> > > …`),
// overflowing the stack past a few thousand levels. These caps are what keep
// one page inside the snapshot's 10-minute idle limit: the slowest page found
// under them takes about a minute to classify.
const MAX_BODY_BYTES = 256 * 1024;
const MAX_LINE_CHARS = 32 * 1024;
const MAX_NESTING = 100;
const CONTAINER_MARKER = /[ \t]*(?:>|(?:[-*+]|\d{1,9}[.)])(?=[ \t]))/y;
const PAST_PARSER_LIMITS = `over ${MAX_BODY_BYTES} characters, or with a line over ${MAX_LINE_CHARS} characters or nested over ${MAX_NESTING} levels`;
const MAX_LIVE_COPY_BASE64_BYTES = 2 * 1024 * 1024;
const MAX_SUGGESTION_PAYLOAD_BYTES = 4 * 1024 * 1024;
// What one query may return, which bounds the census's memory however large
// the rows it meets: a batch holds as many rows as fit at their byte cap, and
// a row over its cap is counted without being loaded. A text column the
// census only tests for presence is read as a flag, never as its value.
const QUERY_BYTES = 32 * 1024 * 1024;
const PAGE_BATCH = QUERY_BYTES / MAX_BODY_BYTES;
const LIVE_COPY_BATCH = QUERY_BYTES / MAX_LIVE_COPY_BASE64_BYTES;
const COMMENT_BATCH = QUERY_BYTES / MAX_BODY_BYTES;
const SUGGESTION_BATCH = QUERY_BYTES / MAX_SUGGESTION_PAYLOAD_BYTES;
const KEEPALIVE_AFTER_MS = 10_000;
const SUGGESTION_ADAPTER = "content.document-markdown";
// Content's adapter in server/lib/suggested-edits.ts. A decision refuses a
// suggestion made under any other version, so it can never apply.
const SUGGESTION_ADAPTER_VERSION = 1;
// The checks validateOperations in server/lib/suggested-edits.ts makes before
// accepting. A suggestion that fails them can never apply, so it has no
// anchor to keep or lose.
const ACCEPTED_OPERATION_KINDS = new Set([
  "insert_text",
  "delete_text",
  "replace_text",
  "add_text_block",
  "set_inline_mark",
]);
const MAX_SUGGESTION_MARKDOWN_CHARS = 1_000_000;

/**
 * Every statement the scan sends, verbatim. The CLI refuses anything else,
 * so values must travel as bound parameters.
 */
export const CENSUS_STATEMENTS = {
  tables:
    "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY(?)",
  keepalive: "SELECT 1 AS alive",
  // Trashed and source-owned as Content's suggestion paths test them, where
  // an empty value is unset.
  documents:
    "SELECT id, CASE WHEN octet_length(content) <= ? THEN content END AS content, octet_length(content) AS content_bytes, body_revision, collab_body_revision, COALESCE(trashed_at, '') <> '' AS trashed, (COALESCE(source_mode, '') <> '' OR COALESCE(source_kind, '') <> '' OR COALESCE(source_path, '') <> '') AS source_owned FROM documents WHERE id >= ? ORDER BY id LIMIT ?",
  liveCopies:
    "SELECT doc_id, CASE WHEN octet_length(yjs_state) <= ? THEN yjs_state END AS yjs_state FROM _collab_docs WHERE doc_id = ANY(?)",
  suggestions:
    "SELECT id, resource_id, adapter_version FROM agent_review_suggestions WHERE resource_type = 'document' AND adapter_kind = ? AND status = 'pending' AND resource_id = ANY(?) AND (resource_id, id) >= (?, ?) ORDER BY resource_id, id LIMIT ?",
  suggestionOperations:
    "SELECT o.suggestion_id, o.operation_kind, o.target_id, o.schema_version, p.payload_bytes, CASE WHEN p.payload_bytes <= ? THEN o.before_json END AS before_json, CASE WHEN p.payload_bytes <= ? THEN o.after_json END AS after_json, CASE WHEN p.payload_bytes <= ? THEN o.anchor_json END AS anchor_json FROM agent_review_suggestion_operations o CROSS JOIN LATERAL (SELECT COALESCE(octet_length(o.before_json), 0) + COALESCE(octet_length(o.after_json), 0) + COALESCE(octet_length(o.anchor_json), 0) AS payload_bytes) p WHERE o.suggestion_id = ANY(?) AND NOT EXISTS (SELECT 1 FROM agent_review_suggestion_operations x WHERE x.suggestion_id = o.suggestion_id AND x.id <> o.id) ORDER BY o.suggestion_id",
  syncLinks:
    "SELECT document_id FROM document_sync_links WHERE document_id = ANY(?) AND state <> 'unlinked' ORDER BY document_id",
  comments:
    "SELECT id, document_id, CASE WHEN octet_length(quoted_text) <= ? THEN quoted_text END AS quoted_text FROM document_comments WHERE document_id = ANY(?) AND parent_id IS NULL AND resolved = 0 AND quoted_text IS NOT NULL AND quoted_text <> '' AND (document_id, id) >= (?, ?) ORDER BY document_id, id LIMIT ?",
  drafts:
    "SELECT document_id, COUNT(*) AS drafts FROM document_preview_drafts WHERE document_id = ANY(?) GROUP BY document_id ORDER BY document_id",
  collabRows: "SELECT COUNT(*) AS rows FROM _collab_docs",
  orphans:
    "SELECT c.doc_id FROM _collab_docs c WHERE c.doc_id >= ? AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = c.doc_id) ORDER BY c.doc_id LIMIT ?",
} as const;

type Row = Record<string, unknown>;

/**
 * Every row of a keyset scan, a page at a time. A page starts at the last key
 * it saw, inclusive, and drops that row again: a key may be '', and nothing
 * sorts before '' to start an exclusive scan from.
 */
async function* keysetPages(
  readPage: (from: string[], limit: number) => Promise<Row[]>,
  keyOf: (row: Row) => string[],
  width: number,
  batch: number,
): AsyncGenerator<Row[]> {
  let last: string[] | null = null;
  while (true) {
    const rows = await readPage(last ?? Array(width).fill(""), batch + 1);
    const resumed = last !== null && rows.length > 0 && sameKey(rows[0], last);
    const fresh = resumed ? rows.slice(1) : rows;
    if (fresh.length === 0) return;
    const lastRow = fresh[fresh.length - 1];
    if (last !== null && sameKey(lastRow, last))
      throw new Error("A keyset scan stopped advancing");
    last = keyOf(lastRow);
    yield fresh;
  }

  function sameKey(row: Row, key: readonly string[]) {
    return keyOf(row).every((part, index) => part === key[index]);
  }
}

const TABLES = [
  "documents",
  "_collab_docs",
  "agent_review_suggestions",
  "agent_review_suggestion_operations",
  "document_comments",
  "document_preview_drafts",
  "document_sync_links",
] as const;

type Page = {
  id: string;
  trashed: boolean;
  sourceOwned: boolean;
};

type AgentFormPage = Page & { body: string; canonical: string };

class PageBucket {
  pages = 0;
  trashed = 0;
  sourceOwned = 0;
  private readonly ids: string[] = [];
  constructor(private readonly maxIds: number) {}
  add(page: Page) {
    this.pages += 1;
    if (page.trashed) this.trashed += 1;
    if (page.sourceOwned) this.sourceOwned += 1;
    if (this.ids.length < this.maxIds) this.ids.push(page.id);
  }
  toJSON() {
    return {
      pages: this.pages,
      trashed: this.trashed,
      sourceOwned: this.sourceOwned,
      pageIds: this.ids,
      pageIdsOmitted: this.pages - this.ids.length,
    };
  }
}

/** Items (suggestions, comments, drafts) counted with the pages they sit on. */
class ItemBucket {
  items = 0;
  private readonly pages: PageBucket;
  private lastPage: string | null = null;
  constructor(maxIds: number) {
    this.pages = new PageBucket(maxIds);
  }
  // Rows arrive ordered by page, so a page is counted once.
  add(page: Page, items = 1) {
    this.items += items;
    if (this.lastPage !== page.id) this.pages.add(page);
    this.lastPage = page.id;
  }
  toJSON() {
    return { items: this.items, ...this.pages.toJSON() };
  }
}

class Buckets<T extends PageBucket | ItemBucket> {
  private readonly map = new Map<string, T>();
  constructor(private readonly make: () => T) {}
  get(key: string): T {
    let bucket = this.map.get(key);
    if (!bucket) this.map.set(key, (bucket = this.make()));
    return bucket;
  }
  pagesIn(key: string): number {
    return this.map.get(key)?.toJSON().pages ?? 0;
  }
  toJSON() {
    return Object.fromEntries(
      [...this.map.entries()].sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    );
  }
}

type AnchorOutcome =
  | "survives"
  | "strandedByCanonicalize"
  | "recoveredByCanonicalize"
  | "alreadyUnanchored";

function anchorOutcome(
  now: boolean,
  afterCanonicalize: boolean,
): AnchorOutcome {
  if (now) return afterCanonicalize ? "survives" : "strandedByCanonicalize";
  return afterCanonicalize ? "recoveredByCanonicalize" : "alreadyUnanchored";
}

function occurrences(text: string, quote: string): number {
  // Non-overlapping, as the editor counts the candidates it chooses among.
  let count = 0;
  for (
    let at = text.indexOf(quote);
    at !== -1 && count < 2;
    at = text.indexOf(quote, at + Math.max(1, quote.length))
  )
    count += 1;
  return count;
}

/**
 * Where a comment's quote lands. The editor picks among repeated quotes by
 * the text around them, so once canonicalizing changes the editor text a
 * repeated quote may land on another occurrence, which is not judged.
 */
function commentOutcome(
  now: string,
  after: string,
  quote: string,
): AnchorOutcome | "ambiguous" {
  const before = occurrences(now, quote);
  const kept = occurrences(after, quote);
  if (now !== after && before > 0 && kept > 0 && Math.max(before, kept) > 1)
    return "ambiguous";
  return anchorOutcome(before > 0, kept > 0);
}

type LiveCopyOutcome =
  | "match"
  | "equivalent"
  | "stale"
  | "uninitialized"
  | "lossy"
  | "unreadable"
  | "tooLarge"
  | "pastParserLimits"
  | "missing"
  | "bodyNotRead";

/** Whether the census's parsers can read `text` within the caps above. */
export function withinParserLimits(text: string): boolean {
  if (text.length > MAX_BODY_BYTES) return false;
  for (let start = 0; start <= text.length; ) {
    const end = text.indexOf("\n", start);
    const stop = end === -1 ? text.length : end;
    if (stop - start > MAX_LINE_CHARS) return false;
    CONTAINER_MARKER.lastIndex = start;
    let depth = 0;
    while (CONTAINER_MARKER.lastIndex < stop && CONTAINER_MARKER.test(text))
      if (++depth > MAX_NESTING) return false;
    start = stop + 1;
  }
  return true;
}

function liveCopyOutcome(state: string, body: string): LiveCopyOutcome {
  const ydoc = new YDoc();
  try {
    applyUpdate(ydoc, base64ToUint8Array(state));
    const live = materializeLiveBody(ydoc);
    // A stored state under its byte cap can still hold text past the parser's.
    if (live.kind === "body" && !withinParserLimits(live.markdown))
      return "pastParserLimits";
    const parity = compareLiveBody(live, body);
    if (parity === "mismatch") return "stale";
    if (
      parity === "match" ||
      parity === "equivalent" ||
      parity === "uninitialized" ||
      parity === "lossy"
    )
      return parity;
    return "unreadable";
  } catch {
    return "unreadable";
  } finally {
    ydoc.destroy();
  }
}

function parseJsonObject(
  raw: unknown,
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; malformed: boolean } {
  if (typeof raw !== "string") return { ok: false, malformed: false };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, malformed: true };
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ok: true, value: value as Record<string, unknown> }
    : { ok: false, malformed: false };
}

type SuggestionOperation = Parameters<typeof resolveMarkdownSuggestionRange>[1];

/**
 * Whether accepting would place `operation` on `markdown`, by the rule of
 * applyMarkdownSuggestionOperation in server/lib/suggested-edits.ts: the text
 * it was made against takes it whole, with or without an anchor; any other
 * text needs changed text on both sides and an anchor that still resolves.
 */
function appliesTo(markdown: string, operation: SuggestionOperation) {
  const before = operation.before as Record<string, unknown>;
  const after = operation.after as Record<string, unknown>;
  if (markdown === before.markdown) return true;
  const anchor = operation.anchor as Record<string, unknown> | null;
  if (
    typeof before.changedText !== "string" ||
    typeof after.changedText !== "string" ||
    !anchor ||
    !Number.isInteger(anchor.from) ||
    !Number.isInteger(anchor.to) ||
    typeof anchor.prefix !== "string" ||
    typeof anchor.suffix !== "string"
  )
    return false;
  return resolveMarkdownSuggestionRange(markdown, operation) !== null;
}

/** Where a pending suggestion's anchor lands, or why it cannot be judged. */
function suggestionOutcome(
  operations: Record<string, unknown>[],
  page: AgentFormPage,
  linked: boolean,
):
  | AnchorOutcome
  | "notAcceptable"
  | "pageRefuses"
  | "unreadable"
  | "tooLarge"
  | "pastParserLimits" {
  if (operations.length !== 1) return "notAcceptable";
  const [row] = operations;
  if (Number(row.payload_bytes) > MAX_SUGGESTION_PAYLOAD_BYTES)
    return "tooLarge";
  const before = parseJsonObject(row.before_json);
  const after = parseJsonObject(row.after_json);
  const anchor = parseJsonObject(row.anchor_json);
  // Core's suggestion store throws on JSON it cannot parse, so the page's
  // suggestions fail to load: not judged, unlike an operation Content refuses.
  if ([before, after, anchor].some((json) => !json.ok && json.malformed))
    return "unreadable";
  if (
    !ACCEPTED_OPERATION_KINDS.has(String(row.operation_kind)) ||
    row.target_id !== "body" ||
    Number(row.schema_version) !== 1 ||
    !before.ok ||
    !after.ok ||
    typeof before.value.markdown !== "string" ||
    typeof after.value.markdown !== "string" ||
    before.value.markdown.length > MAX_SUGGESTION_MARKDOWN_CHARS ||
    after.value.markdown.length > MAX_SUGGESTION_MARKDOWN_CHARS ||
    before.value.markdown === after.value.markdown
  ) {
    return "notAcceptable";
  }
  // Then, as Content's accept path does, the page itself: a trashed,
  // source-owned or externally linked page takes no suggestion at all.
  if (page.trashed || page.sourceOwned || linked) return "pageRefuses";
  // Placing the anchor parses the text the suggestion was made against.
  if (!withinParserLimits(before.value.markdown)) return "pastParserLimits";
  const operation = {
    kind: String(row.operation_kind),
    targetId: "body",
    schemaVersion: 1,
    before: before.value,
    after: after.value,
    anchor: anchor.ok ? anchor.value : null,
  } as SuggestionOperation;
  try {
    return anchorOutcome(
      appliesTo(page.body, operation),
      appliesTo(page.canonical, operation),
    );
  } catch {
    return "unreadable";
  }
}

function flag(value: unknown): boolean {
  if (typeof value !== "boolean")
    throw new Error(`A flag column was read as ${typeof value}, not a boolean`);
  return value;
}

function revisionState(row: Record<string, unknown>) {
  if (row.collab_body_revision == null) return "none";
  const collab = Number(row.collab_body_revision);
  const body = Number(row.body_revision);
  if (!Number.isFinite(collab) || !Number.isFinite(body)) return "unreadable";
  if (collab === body) return "equal";
  return collab < body ? "behind" : "ahead";
}

export type StoredFormCensusReport = Awaited<
  ReturnType<typeof runStoredFormCensusScan>
>;

/**
 * The census over one read-only snapshot. `query` must already be bound to
 * that snapshot; this function only reads. Every row lands in exactly one
 * bucket per question. A row the census could not judge is counted as
 * unreadable, too large or not read, never as clean, and marks the report
 * incomplete.
 *
 * Agent-form pages are those whose body is not canonical, plus canonical
 * bodies a GFM reader sees more in than Content keeps (`__bold__`, a
 * four-space nested list): the pages the backfill or the reader fix changes.
 */
export async function runStoredFormCensusScan(
  query: CensusQuery,
  options: { maxIds: number },
) {
  const pageBucket = () => new PageBucket(options.maxIds);
  const itemBucket = () => new ItemBucket(options.maxIds);
  const incompleteReasons: string[] = [];

  let lastQueryAt = Date.now();
  const read: CensusQuery = async (sql, args) => {
    const rows = await query(sql, args);
    lastQueryAt = Date.now();
    return rows;
  };
  const keepAlive = async () => {
    if (Date.now() - lastQueryAt >= KEEPALIVE_AFTER_MS)
      await read(CENSUS_STATEMENTS.keepalive);
  };

  const present = new Set(
    (await read(CENSUS_STATEMENTS.tables, [[...TABLES]])).map((row) =>
      String(row.table_name),
    ),
  );
  if (!present.has("documents")) {
    throw new Error(
      "The documents table does not exist here; this is not a Content database",
    );
  }
  for (const table of TABLES.filter((table) => !present.has(table)))
    incompleteReasons.push(`table ${table} does not exist`);
  const hasCollab = present.has("_collab_docs");
  const hasSuggestions =
    present.has("agent_review_suggestions") &&
    present.has("agent_review_suggestion_operations") &&
    present.has("document_sync_links");
  const hasComments = present.has("document_comments");
  const hasDrafts = present.has("document_preview_drafts");

  const scanned = { documents: 0, trashed: 0, sourceOwned: 0 };
  const bodies = {
    canonical: new PageBucket(0),
    nonCanonical: pageBucket(),
    canonicalizeFailed: pageBucket(),
    readerFailed: pageBucket(),
    unreadable: pageBucket(),
    tooLarge: pageBucket(),
    pastParserLimits: pageBucket(),
    notIdempotent: pageBucket(),
    idempotenceThrows: pageBucket(),
    lossy: pageBucket(),
    canonicalButMisread: pageBucket(),
    byKind: new Buckets(pageBucket),
    lossByKind: new Buckets(pageBucket),
  };
  const liveCopies = {
    byOutcome: new Buckets(pageBucket),
    revisions: new Buckets(pageBucket),
  };
  const agentForm = {
    pages: pageBucket(),
    suggestions: new Buckets(itemBucket),
    comments: new Buckets(itemBucket),
    drafts: itemBucket(),
  };

  for await (const rows of keysetPages(
    ([from], limit) =>
      read(CENSUS_STATEMENTS.documents, [MAX_BODY_BYTES, from, limit]),
    (row) => [String(row.id)],
    1,
    PAGE_BATCH,
  )) {
    const pages = new Map<string, AgentFormPage>();
    const batchPages = new Map<string, Page>();
    const batchBodies = new Map<string, string>();
    for (const row of rows) {
      const page: Page = {
        id: String(row.id),
        trashed: flag(row.trashed),
        sourceOwned: flag(row.source_owned),
      };
      batchPages.set(page.id, page);
      scanned.documents += 1;
      if (page.trashed) scanned.trashed += 1;
      if (page.sourceOwned) scanned.sourceOwned += 1;
      liveCopies.revisions.get(revisionState(row)).add(page);
      if (typeof row.content !== "string") {
        if (Number(row.content_bytes) > MAX_BODY_BYTES)
          bodies.tooLarge.add(page);
        else bodies.unreadable.add(page);
        continue;
      }
      if (!withinParserLimits(row.content)) {
        bodies.pastParserLimits.add(page);
        continue;
      }
      batchBodies.set(page.id, row.content);
      const result = classifyBody(row.content);
      await keepAlive();
      if (result.status === "failed") {
        bodies.canonicalizeFailed.add(page);
        continue;
      }
      if (result.status === "readerFailed") {
        bodies.readerFailed.add(page);
        continue;
      }
      if (result.losses.length > 0) bodies.lossy.add(page);
      for (const loss of result.losses) bodies.lossByKind.get(loss).add(page);
      if (result.status === "canonical") {
        bodies.canonical.add(page);
        if (result.losses.length === 0) continue;
        bodies.canonicalButMisread.add(page);
        agentForm.pages.add(page);
        pages.set(page.id, {
          ...page,
          body: row.content,
          canonical: row.content,
        });
        continue;
      }
      bodies.nonCanonical.add(page);
      agentForm.pages.add(page);
      pages.set(page.id, {
        ...page,
        body: row.content,
        canonical: result.canonical,
      });
      // An `unclassified` kind is a difference no normalizer names. The body
      // was still judged for losses, so it leaves the report complete.
      for (const kind of result.kinds) bodies.byKind.get(kind).add(page);
      if (result.idempotence === "changes") bodies.notIdempotent.add(page);
      if (result.idempotence === "throws") bodies.idempotenceThrows.add(page);
    }

    if (hasCollab) {
      const batch = [...batchPages.values()];
      for (let start = 0; start < batch.length; start += LIVE_COPY_BATCH) {
        const chunk = batch.slice(start, start + LIVE_COPY_BATCH);
        const copies = new Map(
          (
            await read(CENSUS_STATEMENTS.liveCopies, [
              MAX_LIVE_COPY_BASE64_BYTES,
              chunk.map((page) => page.id),
            ])
          ).map((row) => [String(row.doc_id), row.yjs_state]),
        );
        for (const page of chunk) {
          const body = batchBodies.get(page.id);
          const state = copies.get(page.id);
          let outcome: LiveCopyOutcome;
          if (!copies.has(page.id)) outcome = "missing";
          else if (state == null) outcome = "tooLarge";
          else if (body === undefined) outcome = "bodyNotRead";
          else if (typeof state !== "string") outcome = "unreadable";
          else {
            outcome = liveCopyOutcome(state, body);
            await keepAlive();
          }
          liveCopies.byOutcome.get(outcome).add(page);
        }
      }
    }

    const agentFormIds = [...pages.keys()];
    if (agentFormIds.length === 0) continue;

    if (hasSuggestions) {
      const linked = new Set(
        (await read(CENSUS_STATEMENTS.syncLinks, [agentFormIds])).map((row) =>
          String(row.document_id),
        ),
      );
      for await (const suggestions of keysetPages(
        ([resource, id], limit) =>
          read(CENSUS_STATEMENTS.suggestions, [
            SUGGESTION_ADAPTER,
            agentFormIds,
            resource,
            id,
            limit,
          ]),
        (row) => [String(row.resource_id), String(row.id)],
        2,
        SUGGESTION_BATCH,
      )) {
        // Content accepts a suggestion only with exactly one operation, so the
        // query loads no others: a malformed suggestion may have any number,
        // and one that loads none is not acceptable.
        const operations = new Map<string, Record<string, unknown>[]>(
          suggestions.map((row) => [String(row.id), []]),
        );
        for (const row of await read(CENSUS_STATEMENTS.suggestionOperations, [
          MAX_SUGGESTION_PAYLOAD_BYTES,
          MAX_SUGGESTION_PAYLOAD_BYTES,
          MAX_SUGGESTION_PAYLOAD_BYTES,
          [...operations.keys()],
        ]))
          operations.get(String(row.suggestion_id))?.push(row);
        for (const row of suggestions) {
          const page = pages.get(String(row.resource_id))!;
          agentForm.suggestions
            .get(
              Number(row.adapter_version) === SUGGESTION_ADAPTER_VERSION
                ? suggestionOutcome(
                    operations.get(String(row.id))!,
                    page,
                    linked.has(page.id),
                  )
                : "notAcceptable",
            )
            .add(page);
          await keepAlive();
        }
      }
    }

    if (hasComments) {
      type PageAnchors = { now: string; after: string };
      const anchorsByPage = new Map<string, PageAnchors | "unreadable">();
      const anchorsFor = (page: AgentFormPage) => {
        let anchors = anchorsByPage.get(page.id);
        if (anchors === undefined) {
          try {
            anchors = {
              now: commentAnchorText(page.body),
              after: commentAnchorText(page.canonical),
            };
          } catch {
            anchors = "unreadable";
          }
          anchorsByPage.set(page.id, anchors);
        }
        return anchors;
      };
      for await (const comments of keysetPages(
        ([document, id], limit) =>
          read(CENSUS_STATEMENTS.comments, [
            MAX_BODY_BYTES,
            agentFormIds,
            document,
            id,
            limit,
          ]),
        (row) => [String(row.document_id), String(row.id)],
        2,
        COMMENT_BATCH,
      )) {
        for (const row of comments) {
          const page = pages.get(String(row.document_id))!;
          const anchors = anchorsFor(page);
          // The query keeps only non-empty quotes, so a null one was over the
          // cap: longer than any body the census reads, and not loaded.
          const quote = row.quoted_text;
          agentForm.comments
            .get(
              quote == null
                ? "tooLarge"
                : anchors === "unreadable" || typeof quote !== "string"
                  ? "unreadable"
                  : commentOutcome(anchors.now, anchors.after, quote),
            )
            .add(page);
          await keepAlive();
        }
      }
    }

    if (hasDrafts) {
      for (const row of await read(CENSUS_STATEMENTS.drafts, [agentFormIds])) {
        agentForm.drafts.add(
          pages.get(String(row.document_id))!,
          Number(row.drafts),
        );
      }
    }
  }

  const orphaned = { rows: 0, docIds: [] as string[], docIdsOmitted: 0 };
  let collabRows: number | null = null;
  if (hasCollab) {
    const [count] = await read(CENSUS_STATEMENTS.collabRows);
    collabRows = Number(count?.rows);
    for await (const rows of keysetPages(
      ([from], limit) => read(CENSUS_STATEMENTS.orphans, [from, limit]),
      (row) => [String(row.doc_id)],
      1,
      ORPHAN_BATCH,
    )) {
      for (const row of rows) {
        orphaned.rows += 1;
        if (orphaned.docIds.length < options.maxIds)
          orphaned.docIds.push(String(row.doc_id));
      }
    }
    orphaned.docIdsOmitted = orphaned.rows - orphaned.docIds.length;
  }

  const notJudged: Array<[string, number]> = [
    ["unreadable bodies", bodies.unreadable.pages],
    [
      `bodies over ${MAX_BODY_BYTES} bytes, not classified`,
      bodies.tooLarge.pages,
    ],
    [
      `bodies with a line over ${MAX_LINE_CHARS} characters or nested over ${MAX_NESTING} levels, not classified`,
      bodies.pastParserLimits.pages,
    ],
    ["bodies canonicalizeNfm threw on", bodies.canonicalizeFailed.pages],
    ["bodies the census's own readers failed on", bodies.readerFailed.pages],
    ["unreadable live copies", liveCopies.byOutcome.pagesIn("unreadable")],
    [
      `live copies over ${MAX_LIVE_COPY_BASE64_BYTES} bytes, not compared`,
      liveCopies.byOutcome.pagesIn("tooLarge"),
    ],
    [
      `live copies ${PAST_PARSER_LIMITS}, not compared`,
      liveCopies.byOutcome.pagesIn("pastParserLimits"),
    ],
    [
      "pages with suggestions that could not be read or resolved",
      agentForm.suggestions.pagesIn("unreadable"),
    ],
    [
      `pages with suggestions over ${MAX_SUGGESTION_PAYLOAD_BYTES} bytes, not judged`,
      agentForm.suggestions.pagesIn("tooLarge"),
    ],
    [
      `pages with suggestions made against text ${PAST_PARSER_LIMITS}, not judged`,
      agentForm.suggestions.pagesIn("pastParserLimits"),
    ],
    [
      "pages with comments whose anchors could not be checked",
      agentForm.comments.pagesIn("unreadable"),
    ],
    [
      `pages with comment quotes over ${MAX_BODY_BYTES} bytes, not checked`,
      agentForm.comments.pagesIn("tooLarge"),
    ],
    [
      "pages with comments whose repeated quote may land elsewhere",
      agentForm.comments.pagesIn("ambiguous"),
    ],
  ];
  for (const [reason, pages] of notJudged)
    if (pages > 0) incompleteReasons.push(`${reason}: ${pages}`);

  return {
    reportVersion: 1,
    readOnly: true,
    snapshot: "repeatable read, read only",
    canonicalizer: {
      function: "canonicalizeNfm (templates/content/shared/nfm.ts)",
      fingerprint: canonicalizerFingerprint(),
    },
    complete: incompleteReasons.length === 0,
    incompleteReasons,
    scanned: { ...scanned, collabRows },
    bodies: {
      canonical: bodies.canonical,
      nonCanonical: bodies.nonCanonical,
      byKind: bodies.byKind,
      lossy: bodies.lossy,
      lossByKind: bodies.lossByKind,
      canonicalButMisread: bodies.canonicalButMisread,
      canonicalizeFailed: bodies.canonicalizeFailed,
      readerFailed: bodies.readerFailed,
      notIdempotent: bodies.notIdempotent,
      idempotenceThrows: bodies.idempotenceThrows,
      unreadable: bodies.unreadable,
      tooLarge: bodies.tooLarge,
      pastParserLimits: bodies.pastParserLimits,
    },
    liveCopies: hasCollab
      ? {
          byOutcome: liveCopies.byOutcome,
          orphaned,
          collabRevision: liveCopies.revisions,
        }
      : { skipped: "table _collab_docs does not exist" },
    agentFormPages: {
      pages: agentForm.pages,
      pendingSuggestions: hasSuggestions
        ? agentForm.suggestions
        : { skipped: "a table the suggestion check reads does not exist" },
      commentAnchors: hasComments
        ? agentForm.comments
        : { skipped: "table document_comments does not exist" },
      drafts: hasDrafts
        ? agentForm.drafts
        : { skipped: "table document_preview_drafts does not exist" },
    },
  };
}
