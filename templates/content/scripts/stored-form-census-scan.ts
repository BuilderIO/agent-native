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
const ORPHAN_BATCH = 1000;
// Larger live copies are counted without being built. A build has no
// deadline, so this is what keeps one huge copy from stalling the run.
const MAX_LIVE_COPY_BASE64_BYTES = 2 * 1024 * 1024;
const SUGGESTION_ADAPTER = "content.document-markdown";

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
  toJSON() {
    return Object.fromEntries(
      [...this.map.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  }
}

type AnchorOutcome =
  | "survives"
  | "strandedByCanonicalize"
  | "recoveredByCanonicalize"
  | "alreadyUnanchored"
  | "unreadable";

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
  | "missing";

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
): { ok: true; value: object } | { ok: false } {
  if (typeof raw !== "string") return { ok: false };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  return value && typeof value === "object"
    ? { ok: true, value }
    : { ok: false };
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
 * bucket per question, and a row the census could not judge is counted as
 * unreadable or too large, never as clean.
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

  const present = new Set(
    (
      await query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY(?)",
        [[...TABLES]],
      )
    ).map((row) => String(row.table_name)),
  );
  const missingTables = TABLES.filter((table) => !present.has(table));
  if (!present.has("documents")) {
    throw new Error(
      "The documents table does not exist here; this is not a Content database",
    );
  }
  for (const table of missingTables)
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
    const rows = await query(
      "SELECT id, content, body_revision, collab_body_revision, trashed_at, source_mode, source_kind, source_path FROM documents WHERE id > ? ORDER BY id LIMIT ?",
      [lastId, PAGE_BATCH],
    );
    if (rows.length === 0) break;
    const nextLastId = String(rows[rows.length - 1].id);
    if (nextLastId === lastId)
      throw new Error("The documents scan stopped advancing");
    lastId = nextLastId;

    const pages = new Map<string, Page & { body: string; canonical: string }>();
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
        bodies.unreadable.add(page);
        continue;
      }
      batchBodies.set(page.id, row.content);
      const result = classifyBody(row.content);
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
          await query(
            "SELECT doc_id, CASE WHEN octet_length(yjs_state) <= ? THEN yjs_state END AS yjs_state FROM _collab_docs WHERE doc_id = ANY(?)",
            [MAX_LIVE_COPY_BASE64_BYTES, [...batchPages.keys()]],
          )
        ).map((row) => [String(row.doc_id), row.yjs_state]),
      );
      for (const page of batchPages.values()) {
        const body = batchBodies.get(page.id);
        let outcome: LiveCopyOutcome;
        if (!copies.has(page.id)) outcome = "missing";
        else if (copies.get(page.id) == null) outcome = "tooLarge";
        else if (body === undefined || typeof copies.get(page.id) !== "string")
          outcome = "unreadable";
        else outcome = liveCopyOutcome(copies.get(page.id) as string, body);
        liveCopies.byOutcome.get(outcome).add(page);
      }
    }

    const agentFormIds = [...pages.keys()];
    if (agentFormIds.length === 0) continue;

    if (hasSuggestions) {
      const suggestionRows = await query(
        `SELECT s.id, s.resource_id, o.operation_kind, o.target_id, o.schema_version, o.before_json, o.after_json, o.anchor_json
         FROM agent_review_suggestions s
         INNER JOIN agent_review_suggestion_operations o ON o.suggestion_id = s.id
         WHERE s.resource_type = 'document' AND s.adapter_kind = ? AND s.status = 'pending' AND s.resource_id = ANY(?)
         ORDER BY s.resource_id, s.id, o.ordinal`,
        [SUGGESTION_ADAPTER, agentFormIds],
      );
      const operationsBySuggestion = new Map<
        string,
        Record<string, unknown>[]
      >();
      for (const row of suggestionRows) {
        const id = String(row.id);
        const operations = operationsBySuggestion.get(id);
        if (operations) operations.push(row);
        else operationsBySuggestion.set(id, [row]);
      }
      for (const operations of operationsBySuggestion.values()) {
        const row = operations[0];
        const page = pages.get(String(row.resource_id))!;
        const before = parseJsonObject(row.before_json);
        const after = parseJsonObject(row.after_json);
        const anchor = parseJsonObject(row.anchor_json);
        // Content suggestions carry exactly one operation; the accept path
        // refuses any other shape, so it cannot apply as stored.
        if (operations.length !== 1 || !before.ok || !after.ok || !anchor.ok) {
          agentForm.suggestions.get("unreadable").add(page);
          continue;
        }
        const operation = {
          kind: String(row.operation_kind),
          targetId: row.target_id == null ? null : String(row.target_id),
          schemaVersion: Number(row.schema_version),
          before: before.value,
          after: after.value,
          anchor: anchor.value,
        } as Parameters<typeof resolveMarkdownSuggestionRange>[1];
        agentForm.suggestions
          .get(
            anchorOutcome(
              resolveMarkdownSuggestionRange(page.body, operation) !== null,
              resolveMarkdownSuggestionRange(page.canonical, operation) !==
                null,
            ),
          )
          .add(page);
      }
    }

    if (hasComments) {
      const commentRows = await query(
        "SELECT document_id, quoted_text FROM document_comments WHERE document_id = ANY(?) AND parent_id IS NULL AND resolved = 0 AND quoted_text IS NOT NULL AND quoted_text <> '' ORDER BY document_id, id",
        [agentFormIds],
      );
      type PageAnchors = {
        now: (quote: string) => boolean;
        after: (quote: string) => boolean;
      };
      const anchorsByPage = new Map<string, PageAnchors | "unreadable">();
      const anchorsFor = (page: {
        id: string;
        body: string;
        canonical: string;
      }) => {
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
      for (const row of commentRows) {
        const page = pages.get(String(row.document_id))!;
        const anchors = anchorsFor(page);
        if (anchors === "unreadable" || typeof row.quoted_text !== "string") {
          agentForm.comments.get("unreadable").add(page);
          continue;
        }
        agentForm.comments
          .get(
            anchorOutcome(
              anchors.now(row.quoted_text),
              anchors.after(row.quoted_text),
            ),
          )
          .add(page);
      }
    }

    if (hasDrafts) {
      for (const row of await query(
        "SELECT document_id, COUNT(*) AS drafts FROM document_preview_drafts WHERE document_id = ANY(?) GROUP BY document_id ORDER BY document_id",
        [agentFormIds],
      )) {
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
    const [count] = await query("SELECT COUNT(*) AS rows FROM _collab_docs");
    collabRows = Number(count?.rows);
    let lastDocId = "";
    while (true) {
      const rows = await query(
        "SELECT c.doc_id FROM _collab_docs c WHERE c.doc_id > ? AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = c.doc_id) ORDER BY c.doc_id LIMIT ?",
        [lastDocId, ORPHAN_BATCH],
      );
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

  const liveCopyOutcomes = liveCopies.byOutcome.toJSON();
  if ((liveCopyOutcomes.tooLarge?.pages ?? 0) > 0) {
    incompleteReasons.push(
      `${liveCopyOutcomes.tooLarge!.pages} live copies were over ${MAX_LIVE_COPY_BASE64_BYTES} bytes and were not compared`,
    );
  }

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
    },
    liveCopies: hasCollab
      ? {
          byOutcome: liveCopyOutcomes,
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
