import { base64ToUint8Array } from "@agent-native/core/collab";
import { applyUpdate, Doc as YDoc } from "yjs";

import { compareLiveBody, materializeLiveBody } from "../shared/live-body.js";
import { resolveMarkdownSuggestionRange } from "../shared/suggestion-rebase.js";
import {
  canonicalizerFingerprint,
  classifyBody,
  quoteAnchors,
} from "./stored-form-census-kinds.js";

type CensusQuery = (
  sql: string,
  args?: unknown[],
) => Promise<Record<string, unknown>[]>;

const PAGE_BATCH = 100;
const ITEM_BATCH = 200;
const ORPHAN_BATCH = 1000;
// Larger bodies and live copies are counted without being parsed. Parsing has
// no deadline, so this is what keeps one huge page from stalling the run.
const MAX_BODY_BYTES = 512 * 1024;
const MAX_LIVE_COPY_BASE64_BYTES = 2 * 1024 * 1024;
// Core's Neon transactions end after 30 seconds idle, and classifying a batch
// can take longer than that, so the scan pings its snapshot between pages.
const KEEPALIVE_AFTER_MS = 10_000;
const SUGGESTION_ADAPTER = "content.document-markdown";
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

/**
 * Every statement the scan sends, verbatim. The CLI refuses anything else,
 * so values must travel as bound parameters.
 */
export const CENSUS_STATEMENTS = {
  tables:
    "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY(?)",
  keepalive: "SELECT 1 AS alive",
  documents:
    "SELECT id, CASE WHEN octet_length(content) <= ? THEN content END AS content, octet_length(content) AS content_bytes, body_revision, collab_body_revision, trashed_at, source_mode, source_kind, source_path FROM documents WHERE id > ? ORDER BY id LIMIT ?",
  liveCopies:
    "SELECT doc_id, CASE WHEN octet_length(yjs_state) <= ? THEN yjs_state END AS yjs_state FROM _collab_docs WHERE doc_id = ANY(?)",
  suggestions:
    "SELECT id, resource_id FROM agent_review_suggestions WHERE resource_type = 'document' AND adapter_kind = ? AND status = 'pending' AND resource_id = ANY(?) AND (resource_id > ? OR (resource_id = ? AND id > ?)) ORDER BY resource_id, id LIMIT ?",
  suggestionOperations:
    "SELECT suggestion_id, operation_kind, target_id, schema_version, before_json, after_json, anchor_json FROM agent_review_suggestion_operations WHERE suggestion_id = ANY(?) ORDER BY suggestion_id, ordinal",
  comments:
    "SELECT id, document_id, quoted_text FROM document_comments WHERE document_id = ANY(?) AND parent_id IS NULL AND resolved = 0 AND quoted_text IS NOT NULL AND quoted_text <> '' AND (document_id > ? OR (document_id = ? AND id > ?)) ORDER BY document_id, id LIMIT ?",
  drafts:
    "SELECT document_id, COUNT(*) AS drafts FROM document_preview_drafts WHERE document_id = ANY(?) GROUP BY document_id ORDER BY document_id",
  collabRows: "SELECT COUNT(*) AS rows FROM _collab_docs",
  orphans:
    "SELECT c.doc_id FROM _collab_docs c WHERE c.doc_id > ? AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = c.doc_id) ORDER BY c.doc_id LIMIT ?",
} as const;

const TABLES = [
  "documents",
  "_collab_docs",
  "agent_review_suggestions",
  "agent_review_suggestion_operations",
  "document_comments",
  "document_preview_drafts",
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

type LiveCopyOutcome =
  | "match"
  | "equivalent"
  | "stale"
  | "uninitialized"
  | "lossy"
  | "unreadable"
  | "tooLarge"
  | "missing"
  | "bodyNotRead";

function liveCopyOutcome(state: string, body: string): LiveCopyOutcome {
  const ydoc = new YDoc();
  try {
    applyUpdate(ydoc, base64ToUint8Array(state));
    const parity = compareLiveBody(materializeLiveBody(ydoc), body);
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
): { ok: true; value: Record<string, unknown> } | { ok: false } {
  if (typeof raw !== "string") return { ok: false };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ok: true, value: value as Record<string, unknown> }
    : { ok: false };
}

/** Where a pending suggestion's anchor lands, or why it cannot be judged. */
function suggestionOutcome(
  operations: Record<string, unknown>[],
  page: AgentFormPage,
): AnchorOutcome | "notAcceptable" | "unreadable" {
  if (operations.length !== 1) return "notAcceptable";
  const [row] = operations;
  const before = parseJsonObject(row.before_json);
  const after = parseJsonObject(row.after_json);
  const anchor = parseJsonObject(row.anchor_json);
  if (
    !ACCEPTED_OPERATION_KINDS.has(String(row.operation_kind)) ||
    row.target_id !== "body" ||
    Number(row.schema_version) !== 1 ||
    !before.ok ||
    !after.ok ||
    !anchor.ok ||
    typeof before.value.markdown !== "string" ||
    typeof after.value.markdown !== "string" ||
    before.value.markdown === after.value.markdown
  ) {
    return "notAcceptable";
  }
  const operation = {
    kind: String(row.operation_kind),
    targetId: "body",
    schemaVersion: 1,
    before: before.value,
    after: after.value,
    anchor: anchor.value,
  } as Parameters<typeof resolveMarkdownSuggestionRange>[1];
  try {
    return anchorOutcome(
      resolveMarkdownSuggestionRange(page.body, operation) !== null,
      resolveMarkdownSuggestionRange(page.canonical, operation) !== null,
    );
  } catch {
    return "unreadable";
  }
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
    present.has("agent_review_suggestion_operations");
  const hasComments = present.has("document_comments");
  const hasDrafts = present.has("document_preview_drafts");

  const scanned = { documents: 0, trashed: 0, sourceOwned: 0 };
  const bodies = {
    canonical: new PageBucket(0),
    nonCanonical: pageBucket(),
    canonicalizeFailed: pageBucket(),
    unreadable: pageBucket(),
    tooLarge: pageBucket(),
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

  let lastId = "";
  while (true) {
    const rows = await read(CENSUS_STATEMENTS.documents, [
      MAX_BODY_BYTES,
      lastId,
      PAGE_BATCH,
    ]);
    if (rows.length === 0) break;
    const nextLastId = String(rows[rows.length - 1].id);
    if (nextLastId === lastId)
      throw new Error("The documents scan stopped advancing");
    lastId = nextLastId;

    const pages = new Map<string, AgentFormPage>();
    const batchPages = new Map<string, Page>();
    const batchBodies = new Map<string, string>();
    for (const row of rows) {
      const page: Page = {
        id: String(row.id),
        trashed: row.trashed_at != null,
        sourceOwned:
          row.source_mode != null ||
          row.source_kind != null ||
          row.source_path != null,
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
      batchBodies.set(page.id, row.content);
      const result = classifyBody(row.content);
      await keepAlive();
      if (result.status === "failed") {
        bodies.canonicalizeFailed.add(page);
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
      for (const kind of result.kinds) bodies.byKind.get(kind).add(page);
      if (result.idempotence === "changes") bodies.notIdempotent.add(page);
      if (result.idempotence === "throws") bodies.idempotenceThrows.add(page);
    }

    if (hasCollab) {
      const copies = new Map(
        (
          await read(CENSUS_STATEMENTS.liveCopies, [
            MAX_LIVE_COPY_BASE64_BYTES,
            [...batchPages.keys()],
          ])
        ).map((row) => [String(row.doc_id), row.yjs_state]),
      );
      for (const page of batchPages.values()) {
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

    const agentFormIds = [...pages.keys()];
    if (agentFormIds.length === 0) continue;

    if (hasSuggestions) {
      let lastResource = "";
      let lastSuggestion = "";
      while (true) {
        const suggestions = await read(CENSUS_STATEMENTS.suggestions, [
          SUGGESTION_ADAPTER,
          agentFormIds,
          lastResource,
          lastResource,
          lastSuggestion,
          ITEM_BATCH,
        ]);
        if (suggestions.length === 0) break;
        const last = suggestions[suggestions.length - 1];
        lastResource = String(last.resource_id);
        lastSuggestion = String(last.id);
        const operations = new Map<string, Record<string, unknown>[]>(
          suggestions.map((row) => [String(row.id), []]),
        );
        for (const row of await read(CENSUS_STATEMENTS.suggestionOperations, [
          [...operations.keys()],
        ]))
          operations.get(String(row.suggestion_id))?.push(row);
        for (const row of suggestions) {
          const page = pages.get(String(row.resource_id))!;
          agentForm.suggestions
            .get(suggestionOutcome(operations.get(String(row.id))!, page))
            .add(page);
          await keepAlive();
        }
      }
    }

    if (hasComments) {
      type PageAnchors = {
        now: (quote: string) => boolean;
        after: (quote: string) => boolean;
      };
      const anchorsByPage = new Map<string, PageAnchors | "unreadable">();
      const anchorsFor = (page: AgentFormPage) => {
        let anchors = anchorsByPage.get(page.id);
        if (anchors === undefined) {
          try {
            anchors = {
              now: quoteAnchors(page.body),
              after: quoteAnchors(page.canonical),
            };
          } catch {
            anchors = "unreadable";
          }
          anchorsByPage.set(page.id, anchors);
        }
        return anchors;
      };
      let lastDocument = "";
      let lastComment = "";
      while (true) {
        const comments = await read(CENSUS_STATEMENTS.comments, [
          agentFormIds,
          lastDocument,
          lastDocument,
          lastComment,
          ITEM_BATCH,
        ]);
        if (comments.length === 0) break;
        const last = comments[comments.length - 1];
        lastDocument = String(last.document_id);
        lastComment = String(last.id);
        for (const row of comments) {
          const page = pages.get(String(row.document_id))!;
          const anchors = anchorsFor(page);
          const quote = row.quoted_text;
          agentForm.comments
            .get(
              anchors === "unreadable" || typeof quote !== "string"
                ? "unreadable"
                : anchorOutcome(anchors.now(quote), anchors.after(quote)),
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
    let lastDocId = "";
    while (true) {
      const rows = await read(CENSUS_STATEMENTS.orphans, [
        lastDocId,
        ORPHAN_BATCH,
      ]);
      if (rows.length === 0) break;
      const next = String(rows[rows.length - 1].doc_id);
      if (next === lastDocId)
        throw new Error("The live-copy orphan scan stopped advancing");
      lastDocId = next;
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
    ["bodies canonicalizeNfm threw on", bodies.canonicalizeFailed.pages],
    ["unreadable live copies", liveCopies.byOutcome.pagesIn("unreadable")],
    [
      `live copies over ${MAX_LIVE_COPY_BASE64_BYTES} bytes, not compared`,
      liveCopies.byOutcome.pagesIn("tooLarge"),
    ],
    [
      "pages with suggestions whose anchors could not be resolved",
      agentForm.suggestions.pagesIn("unreadable"),
    ],
    [
      "pages with comments whose anchors could not be checked",
      agentForm.comments.pagesIn("unreadable"),
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
      notIdempotent: bodies.notIdempotent,
      idempotenceThrows: bodies.idempotenceThrows,
      unreadable: bodies.unreadable,
      tooLarge: bodies.tooLarge,
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
        : { skipped: "suggestion tables do not exist" },
      commentAnchors: hasComments
        ? agentForm.comments
        : { skipped: "table document_comments does not exist" },
      drafts: hasDrafts
        ? agentForm.drafts
        : { skipped: "table document_preview_drafts does not exist" },
    },
  };
}
