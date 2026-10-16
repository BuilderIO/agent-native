import { createDbExec, type DbExec } from "@agent-native/core/db";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { getTableColumns } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { encodeStateAsUpdate } from "yjs";

import {
  documentComments,
  documentPreviewDrafts,
  documents,
} from "../server/db/schema";
import { createContentEditorStructuralSchema } from "../shared/content-editor-structural-schema";
import { LIVE_BODY_FIELD } from "../shared/live-body";
import { canonicalizeNfm, docToNfm, nfmToDoc } from "../shared/nfm";
import {
  CensusRefusal,
  PRODUCTION_HOSTS_ENV,
  databaseHostIdentity,
  readOnlyStatement,
  runStoredFormCensusCli,
  withReadOnlySnapshot,
} from "./stored-form-census";

const PRODUCTION_HOST = "ep-prod-endpoint-123456.us-east-2.aws.neon.tech";
const BRANCH_HOST = "ep-census-branch-654321.us-east-2.aws.neon.tech";
const PASSWORD = "fixture-password-not-real";
const POOLED_BRANCH_HOST = BRANCH_HOST.replace(
  ".us-east-2",
  "-pooler.us-east-2",
);

/** A connection URL carrying `password`, built without a literal. */
function targetUrl(
  user: string,
  host: string,
  path: string,
  password = PASSWORD,
): string {
  const url = new URL(`postgres://${host}/${path}`);
  url.username = user;
  url.password = password;
  return url.toString();
}

function cli(
  argv: string[],
  env: Record<string, string | undefined>,
  connect: (url: string) => Promise<DbExec>,
) {
  const events: string[] = [];
  const stdout: string[] = [];
  const run = runStoredFormCensusCli({
    argv,
    env,
    log: (line) => events.push(`log ${line}`),
    out: (text) => stdout.push(text),
    connect: async (url) => {
      events.push("connect");
      return connect(url);
    },
  });
  return { run, events, stdout };
}

const neverConnect = async (): Promise<DbExec> => {
  throw new Error("connect must not be called");
};

describe("stored-form census guards (SF-09)", () => {
  it("prints the target host, database and source variable, password redacted, before it connects", async () => {
    const { run, events } = cli(
      [
        "--database-url-env=CENSUS_URL",
        "--neon-project=project-fixture",
        "--neon-branch=census/fixture",
      ],
      {
        CENSUS_URL: targetUrl(
          "census_reader",
          POOLED_BRANCH_HOST,
          "neondb?sslmode=require",
        ),
        [PRODUCTION_HOSTS_ENV]: PRODUCTION_HOST,
      },
      async () => {
        throw new Error("stop after connect");
      },
    );
    expect(await run).toBe(1);
    const connectAt = events.indexOf("connect");
    const printed = events.slice(0, connectAt);
    expect(connectAt).toBeGreaterThan(0);
    expect(printed).toEqual([
      "log Content stored-form census (read-only)",
      `log Target host: ${POOLED_BRANCH_HOST}`,
      "log Database: neondb",
      "log From env var: CENSUS_URL",
      `log URL: ${targetUrl("census_reader", POOLED_BRANCH_HOST, "neondb?sslmode=require", "***")}`,
      "log Neon project: project-fixture",
      "log Neon branch: census/fixture",
      "log Neon endpoint: ep-census-branch-654321",
    ]);
    expect(events.join("\n")).not.toContain(PASSWORD);
  });

  it("refuses production before connecting, however the host is written", async () => {
    for (const host of [
      PRODUCTION_HOST,
      PRODUCTION_HOST.replace(".us-east-2", "-pooler.us-east-2"),
      PRODUCTION_HOST.toUpperCase(),
    ]) {
      for (const declared of [
        PRODUCTION_HOST,
        "ep-prod-endpoint-123456",
        `other.example.com, ${PRODUCTION_HOST.replace(".us-east-2", "-pooler.us-east-2")}`,
      ]) {
        const { run, events } = cli(
          [
            "--database-url-env=CENSUS_URL",
            "--neon-project=project-fixture",
            "--neon-branch=mislabelled-child",
          ],
          {
            CENSUS_URL: targetUrl("owner", host, "neondb"),
            [PRODUCTION_HOSTS_ENV]: declared,
          },
          neverConnect,
        );
        expect(await run).toBe(1);
        expect(events).not.toContain("connect");
        expect(events[events.length - 1]).toMatch(
          /^log Refused: .* is a production database/,
        );
      }
    }
  });

  it("refuses a Neon branch labelled as production even on an undeclared endpoint", async () => {
    for (const branch of ["production", "Prod", "main"]) {
      const { run, events } = cli(
        [
          "--database-url-env=CENSUS_URL",
          "--neon-project=project-fixture",
          `--neon-branch=${branch}`,
        ],
        {
          CENSUS_URL: targetUrl("owner", BRANCH_HOST, "neondb"),
          [PRODUCTION_HOSTS_ENV]: PRODUCTION_HOST,
        },
        neverConnect,
      );
      expect(await run).toBe(1);
      expect(events).not.toContain("connect");
      expect(events[events.length - 1]).toBe(
        `log Refused: Neon branch "${branch}" is named as a production branch`,
      );
    }
  });

  it("refuses a remote target when production hosts are not declared", async () => {
    const { run, events } = cli(
      ["--database-url-env=CENSUS_URL"],
      { CENSUS_URL: targetUrl("reader", "db.example.com", "content") },
      neverConnect,
    );
    expect(await run).toBe(1);
    expect(events).not.toContain("connect");
    expect(events[events.length - 1]).toContain(
      `${PRODUCTION_HOSTS_ENV} is not set, so a remote target cannot be shown not to be production`,
    );
  });

  it("has no flag that applies changes or overrides the refusal", async () => {
    for (const flag of [
      "--apply",
      "--apply=true",
      "--allow-production",
      "--force",
      "--production-hosts=none",
    ]) {
      const { run, events } = cli(
        ["--database-url-env=CENSUS_URL", flag],
        {
          CENSUS_URL: targetUrl("owner", PRODUCTION_HOST, "neondb"),
          [PRODUCTION_HOSTS_ENV]: PRODUCTION_HOST,
        },
        neverConnect,
      );
      expect(await run).toBe(1);
      expect(events).not.toContain("connect");
    }
  });

  it("reads its target only from the named variable and requires Neon labels", async () => {
    const missing = cli(
      ["--database-url-env=CENSUS_URL"],
      { DATABASE_URL: "pglite:memory" },
      neverConnect,
    );
    expect(await missing.run).toBe(1);
    expect(missing.events[missing.events.length - 1]).toContain(
      "CENSUS_URL is not set",
    );

    const unlabeled = cli(
      ["--database-url-env=CENSUS_URL"],
      {
        CENSUS_URL: targetUrl("reader", BRANCH_HOST, "neondb"),
        [PRODUCTION_HOSTS_ENV]: PRODUCTION_HOST,
      },
      neverConnect,
    );
    expect(await unlabeled.run).toBe(1);
    expect(unlabeled.events[unlabeled.events.length - 1]).toContain(
      "--neon-project and --neon-branch",
    );
  });

  it("names Neon endpoints the same way pooled, direct or bare", () => {
    expect(
      databaseHostIdentity("EP-Abc-1-pooler.c-6.us-east-1.aws.neon.tech"),
    ).toBe("ep-abc-1");
    expect(databaseHostIdentity("ep-abc-1.c-6.us-east-1.aws.neon.tech.")).toBe(
      "ep-abc-1",
    );
    expect(databaseHostIdentity("ep-abc-1")).toBe("ep-abc-1");
    expect(databaseHostIdentity("ep-abc-1.example.com")).toBe(
      "ep-abc-1.example.com",
    );
  });

  it("refuses any statement that is not a plain read", () => {
    for (const sql of [
      "INSERT INTO documents (id) VALUES ('x')",
      "UPDATE documents SET content = ''",
      "DELETE FROM _collab_docs",
      "WITH gone AS (DELETE FROM documents RETURNING id) SELECT * FROM gone",
      "SELECT 1; DROP TABLE documents",
      "SELECT nextval('seq')",
      "SELECT pg_advisory_lock(1)",
      "SELECT id FROM documents FOR UPDATE",
      "SELECT id FROM documents FOR SHARE",
      "SELECT set_config('transaction_read_only', 'off', true)",
      "SELECT pg_terminate_backend(1)",
      "SET TRANSACTION READ WRITE",
      "COMMIT",
    ]) {
      expect(() => readOnlyStatement(sql)).toThrow(CensusRefusal);
    }
    expect(
      readOnlyStatement("SELECT id, created_at, updated_at FROM documents"),
    ).toBeTruthy();
  });

  it("reads columns that exist in Content's schema", () => {
    const columns = (table: Parameters<typeof getTableColumns>[0]) =>
      Object.values(getTableColumns(table)).map((column) => column.name);
    expect(columns(documents)).toEqual(
      expect.arrayContaining([
        "id",
        "content",
        "body_revision",
        "collab_body_revision",
        "trashed_at",
        "source_mode",
        "source_kind",
        "source_path",
      ]),
    );
    expect(columns(documentComments)).toEqual(
      expect.arrayContaining([
        "id",
        "document_id",
        "parent_id",
        "resolved",
        "quoted_text",
      ]),
    );
    expect(columns(documentPreviewDrafts)).toContain("document_id");
  });

  it("refuses a client whose transaction is not read-only or that has none", async () => {
    const ignoresMode: DbExec = {
      execute: async () => ({ rows: [], rowsAffected: 0 }),
      transaction: async (fn) =>
        fn({
          execute: async () => ({
            rows: [{ read_only: "off", isolation: "read committed" }],
            rowsAffected: 0,
          }),
        }),
    };
    await expect(
      withReadOnlySnapshot(ignoresMode, async () => "scanned"),
    ).rejects.toThrow(/not a read-only snapshot/);
    await expect(
      withReadOnlySnapshot(
        { execute: async () => ({ rows: [], rowsAffected: 0 }) },
        async () => "scanned",
      ),
    ).rejects.toThrow(/cannot open a transaction/);
  });
});

const schema = createContentEditorStructuralSchema();

function liveCopyState(markdown: string): string {
  const ydoc = prosemirrorJSONToYDoc(
    schema,
    nfmToDoc(markdown),
    LIVE_BODY_FIELD,
  );
  return Buffer.from(encodeStateAsUpdate(ydoc)).toString("base64");
}

const AGENT_BODY =
  "Agent paragraph with snake\\_case\n\n__bold claim__\n\n- parent\n    - nested child";
const EDITOR_BODY = docToNfm(
  nfmToDoc("Editor paragraph about quarterly-results"),
);
// Canonical bytes that Content reads as literal underscores, not bold.
const MISREAD_BODY = "__misread emphasis__";

const FIXTURE_TABLES = [
  "documents",
  "_collab_docs",
  "agent_review_suggestions",
  "agent_review_suggestion_operations",
  "document_comments",
  "document_preview_drafts",
];

async function createFixture(db: DbExec) {
  // Every `pglite:memory` client in a process is the same database.
  for (const table of FIXTURE_TABLES)
    await db.execute(`DROP TABLE IF EXISTS ${table}`);
  for (const ddl of [
    "CREATE TABLE documents (id TEXT PRIMARY KEY, content TEXT NOT NULL DEFAULT '', body_revision INTEGER NOT NULL DEFAULT 0, collab_body_revision INTEGER, trashed_at TEXT, source_mode TEXT, source_kind TEXT, source_path TEXT)",
    "CREATE TABLE _collab_docs (doc_id TEXT PRIMARY KEY, yjs_state TEXT NOT NULL, text_snapshot TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (NOW()::text))",
    "CREATE TABLE agent_review_suggestions (id TEXT PRIMARY KEY, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, adapter_kind TEXT NOT NULL, adapter_version INTEGER NOT NULL, thread_id TEXT NOT NULL, author_email TEXT, actor_kind TEXT NOT NULL, base_revision TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', summary TEXT NOT NULL, owner_email TEXT, org_id TEXT, visibility TEXT NOT NULL DEFAULT 'private', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, metadata_json TEXT)",
    "CREATE TABLE agent_review_suggestion_operations (id TEXT PRIMARY KEY, suggestion_id TEXT NOT NULL, ordinal INTEGER NOT NULL, operation_kind TEXT NOT NULL, target_id TEXT, before_json TEXT, after_json TEXT, anchor_json TEXT, dependencies_json TEXT, schema_version INTEGER NOT NULL)",
    "CREATE TABLE document_comments (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL DEFAULT 'local@localhost', document_id TEXT NOT NULL, thread_id TEXT NOT NULL, parent_id TEXT, content TEXT NOT NULL, quoted_text TEXT, author_email TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0)",
    "CREATE TABLE document_preview_drafts (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, org_id TEXT NOT NULL DEFAULT '', document_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL)",
  ]) {
    await db.execute(ddl);
  }
  const insert = (sql: string, args: unknown[]) => db.execute({ sql, args });
  await insert(
    "INSERT INTO documents (id, content, body_revision, collab_body_revision, trashed_at, source_mode) VALUES (?, ?, ?, ?, ?, ?)",
    ["page-agent", AGENT_BODY, 3, null, null, null],
  );
  await insert(
    "INSERT INTO documents (id, content, body_revision, collab_body_revision, trashed_at, source_mode) VALUES (?, ?, ?, ?, ?, ?)",
    ["page-editor", EDITOR_BODY, 2, 2, null, null],
  );
  await insert(
    "INSERT INTO documents (id, content, body_revision, collab_body_revision, trashed_at, source_mode) VALUES (?, ?, ?, ?, ?, ?)",
    ["page-trashed", "Trashed \\_body", 1, null, "2026-10-01T00:00:00Z", null],
  );
  await insert(
    "INSERT INTO documents (id, content, body_revision, collab_body_revision, trashed_at, source_mode) VALUES (?, ?, ?, ?, ?, ?)",
    ["page-misread", MISREAD_BODY, 1, null, null, "local"],
  );
  await insert("INSERT INTO _collab_docs (doc_id, yjs_state) VALUES (?, ?)", [
    "page-editor",
    liveCopyState(EDITOR_BODY),
  ]);
  await insert("INSERT INTO _collab_docs (doc_id, yjs_state) VALUES (?, ?)", [
    "page-agent",
    liveCopyState("Older live text the agent edit never reached"),
  ]);
  await insert("INSERT INTO _collab_docs (doc_id, yjs_state) VALUES (?, ?)", [
    "page-deleted-long-ago",
    liveCopyState("Orphaned live copy"),
  ]);
  const changedText = "snake\\_case";
  const from = AGENT_BODY.indexOf(changedText);
  const after = `${AGENT_BODY.slice(0, from)}snake_case_renamed${AGENT_BODY.slice(from + changedText.length)}`;
  await insert(
    "INSERT INTO agent_review_suggestions (id, resource_type, resource_id, adapter_kind, adapter_version, thread_id, actor_kind, base_revision, summary, created_at, updated_at) VALUES (?, 'document', 'page-agent', 'content.document-markdown', 1, 't1', 'agent', 'r3', 'Rename', 'now', 'now')",
    ["suggestion-1"],
  );
  await insert(
    "INSERT INTO agent_review_suggestion_operations (id, suggestion_id, ordinal, operation_kind, target_id, before_json, after_json, anchor_json, schema_version) VALUES (?, 'suggestion-1', 0, 'replace_text', 'body', ?, ?, ?, 1)",
    [
      "operation-1",
      JSON.stringify({ markdown: AGENT_BODY, changedText }),
      JSON.stringify({ markdown: after, changedText: "snake_case_renamed" }),
      JSON.stringify({
        from,
        to: from + changedText.length,
        prefix: AGENT_BODY.slice(0, from),
        suffix: AGENT_BODY.slice(from + changedText.length),
      }),
    ],
  );
  await insert(
    "INSERT INTO document_comments (id, document_id, thread_id, content, quoted_text, author_email) VALUES (?, 'page-agent', ?, 'Comment', ?, 'a@example.com')",
    ["comment-1", "thread-1", "bold claim"],
  );
  await insert(
    "INSERT INTO document_preview_drafts (id, owner_email, document_id, title, content) VALUES (?, 'a@example.com', 'page-agent', 'Draft', 'Draft body')",
    ["draft-1"],
  );
}

describe("stored-form census against a local database", () => {
  let db: DbExec;

  beforeAll(async () => {
    db = await createDbExec({ url: "pglite:memory" });
  });

  beforeEach(async () => {
    await createFixture(db);
  });

  afterAll(async () => {
    await db.close?.();
  });

  it("reads inside a transaction the database itself holds read-only", async () => {
    let raw: DbExec | undefined;
    const capturing: DbExec = {
      execute: (statement) => db.execute(statement),
      transaction: (fn) =>
        db.transaction!((tx) => {
          raw = tx;
          return fn(tx);
        }),
    };
    const outcome = await withReadOnlySnapshot(capturing, async (query) => {
      const [mode] = await query(
        "SELECT current_setting('transaction_read_only') AS read_only",
      );
      await expect(
        raw!.execute("UPDATE documents SET content = 'overwritten'"),
      ).rejects.toThrow(/read-only transaction/);
      return mode.read_only;
    }).catch((error: unknown) => error);
    // The refused UPDATE aborts the transaction, so the snapshot ends in an
    // error rather than a result; what matters is that nothing was written.
    expect(outcome === "on" || outcome instanceof Error).toBe(true);
    const rows = await db.execute("SELECT content FROM documents ORDER BY id");
    expect(rows.rows.map((row) => row.content)).not.toContain("overwritten");
  });

  it("gives the same report on a second run, changes no rows, and prints no page text", async () => {
    const dump = async () =>
      JSON.stringify(
        await Promise.all(
          FIXTURE_TABLES.map(
            async (table) =>
              (await db.execute(`SELECT * FROM ${table} ORDER BY 1`)).rows,
          ),
        ),
      );
    const before = await dump();
    const runOnce = async () => {
      const { run, stdout } = cli(
        ["--database-url-env=CENSUS_URL"],
        { CENSUS_URL: "pglite:memory" },
        async () => ({ ...db, close: async () => {} }),
      );
      expect(await run).toBe(0);
      return stdout.join("");
    };
    const first = await runOnce();
    const second = await runOnce();
    expect(second).toBe(first);
    expect(await dump()).toBe(before);

    for (const text of [
      "Agent paragraph",
      "nested child",
      "quarterly-results",
      "bold claim",
      "Draft body",
      "Orphaned live copy",
      "Older live text",
      "misread emphasis",
    ]) {
      expect(first).not.toContain(text);
    }

    const report = JSON.parse(first);
    expect(report.complete).toBe(true);
    expect(report.scanned).toEqual({
      documents: 4,
      trashed: 1,
      sourceOwned: 1,
      collabRows: 3,
    });
    expect(canonicalizeNfm(EDITOR_BODY)).toBe(EDITOR_BODY);
    expect(canonicalizeNfm(MISREAD_BODY)).toBe(MISREAD_BODY);
    expect(report.bodies.canonical.pages).toBe(2);
    expect(report.bodies.canonicalButMisread).toMatchObject({
      pages: 1,
      sourceOwned: 1,
      pageIds: ["page-misread"],
    });
    expect(report.bodies.nonCanonical).toMatchObject({
      pages: 2,
      trashed: 1,
      pageIds: ["page-agent", "page-trashed"],
    });
    expect(report.bodies.lossy.pageIds).toEqual([
      "page-agent",
      "page-misread",
      "page-trashed",
    ]);
    expect(report.bodies.lossByKind["gfm-strong-dropped"].pageIds).toEqual([
      "page-agent",
      "page-misread",
    ]);
    expect(report.bodies.lossByKind["gfm-list-nesting-lost"].pageIds).toEqual([
      "page-agent",
    ]);
    expect(report.agentFormPages.pages.pageIds).toEqual([
      "page-agent",
      "page-misread",
      "page-trashed",
    ]);
    expect(report.liveCopies.byOutcome.match.pageIds).toEqual(["page-editor"]);
    expect(report.liveCopies.byOutcome.stale.pageIds).toEqual(["page-agent"]);
    expect(report.liveCopies.byOutcome.missing.pageIds).toEqual([
      "page-misread",
      "page-trashed",
    ]);
    expect(report.liveCopies.orphaned).toEqual({
      rows: 1,
      docIds: ["page-deleted-long-ago"],
      docIdsOmitted: 0,
    });
    expect(report.agentFormPages.drafts).toMatchObject({
      items: 1,
      pageIds: ["page-agent"],
    });
    const suggestionTotal = Object.values(
      report.agentFormPages.pendingSuggestions as Record<
        string,
        { items: number }
      >,
    ).reduce((total, bucket) => total + bucket.items, 0);
    expect(suggestionTotal).toBe(1);
    const commentTotal = Object.values(
      report.agentFormPages.commentAnchors as Record<string, { items: number }>,
    ).reduce((total, bucket) => total + bucket.items, 0);
    expect(commentTotal).toBe(1);
  });

  it("reports a section whose table is missing as skipped and the run as incomplete", async () => {
    await db.execute("DROP TABLE document_preview_drafts");
    const { run, stdout } = cli(
      ["--database-url-env=CENSUS_URL"],
      { CENSUS_URL: "pglite:memory" },
      async () => ({ ...db, close: async () => {} }),
    );
    expect(await run).toBe(2);
    const report = JSON.parse(stdout.join(""));
    expect(report.complete).toBe(false);
    expect(report.incompleteReasons).toContain(
      "table document_preview_drafts does not exist",
    );
    expect(report.agentFormPages.drafts).toEqual({
      skipped: "table document_preview_drafts does not exist",
    });
  });
});
