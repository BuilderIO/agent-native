import { createDbExec, type DbExec } from "@agent-native/core/db";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { getTableColumns } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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
  CENSUS_ALLOWED_STATEMENTS,
  CensusRefusal,
  PRODUCTION_HOSTS_ENV,
  SNAPSHOT_MODE_CHECK,
  databaseHostIdentity,
  readOnlyStatement,
  redactCredentials,
  runStoredFormCensusCli,
  withReadOnlySnapshot,
} from "./stored-form-census";
import { CENSUS_STATEMENTS } from "./stored-form-census-scan";

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

/** Flags for a Neon child branch, the only remote target the census reads. */
const BRANCH_ARGS = [
  "--database-url-env=CENSUS_URL",
  "--neon-project=project-fixture",
  "--neon-branch=census/fixture",
];

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
      "log Neon project: project-fixture",
      "log Neon branch: census/fixture",
      "log Neon endpoint: ep-census-branch-654321",
    ]);
    expect(events.join("\n")).not.toContain(PASSWORD);
    // The URL's user name and parameter values are unchecked, so never shown.
    expect(events.join("\n")).not.toMatch(/census_reader|sslmode/);
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
      BRANCH_ARGS,
      { CENSUS_URL: targetUrl("reader", BRANCH_HOST, "neondb") },
      neverConnect,
    );
    expect(await run).toBe(1);
    expect(events).not.toContain("connect");
    expect(events[events.length - 1]).toContain(
      `${PRODUCTION_HOSTS_ENV} is not set, so a remote target cannot be shown not to be production`,
    );
  });

  it("refuses any host but a Neon endpoint, loopback included", async () => {
    // A tunnel on localhost, or any alias, can lead to production.
    for (const host of [
      "localhost",
      "127.0.0.1",
      "db.example.com",
      "console.neon.tech",
    ]) {
      const { run, events } = cli(
        BRANCH_ARGS,
        {
          CENSUS_URL: targetUrl("reader", host, "content"),
          [PRODUCTION_HOSTS_ENV]: PRODUCTION_HOST,
        },
        neverConnect,
      );
      expect(await run, host).toBe(1);
      expect(events).not.toContain("connect");
      expect(events[events.length - 1], host).toBe(
        `log Refused: ${host} is not a Neon endpoint; the census reads only a pglite: file or a Neon branch endpoint`,
      );
    }
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

  it("refuses a URL whose driver could reach a host other than the one checked", async () => {
    const local = targetUrl("reader", "localhost", "content");
    for (const [url, reason] of [
      // postgres.js reads the host after the first `@`, URL after the last.
      [
        local.replace("@localhost", `@${PRODUCTION_HOST},ignored@localhost`),
        "must hold a postgres:// URL",
      ],
      [
        local.replace("@localhost", `@${PRODUCTION_HOST}@localhost`),
        "must hold a postgres:// URL",
      ],
      [`${local}#@${PRODUCTION_HOST}`, "must hold a postgres:// URL"],
      [local.replace("localhost", "[::1]"), "must hold a postgres:// URL"],
      [
        targetUrl("reader", BRANCH_HOST, `neondb?host=${PRODUCTION_HOST}`),
        "has a URL parameter other than sslmode and channel_binding",
      ],
      [
        targetUrl("reader", BRANCH_HOST, "neondb?options=-c%20x%3Dy"),
        "has a URL parameter other than sslmode and channel_binding",
      ],
      [
        targetUrl("reader", PRODUCTION_HOST.replace(/^e/, "%65"), "neondb"),
        "must name one plain hostname",
      ],
      [
        targetUrl("reader", `${BRANCH_HOST},${PRODUCTION_HOST}`, "neondb"),
        "must name one plain hostname",
      ],
      [
        targetUrl("reader", `${PRODUCTION_HOST}.`, "neondb"),
        "must name one plain hostname",
      ],
    ]) {
      const { run, events } = cli(
        [
          "--database-url-env=CENSUS_URL",
          "--neon-project=project-fixture",
          "--neon-branch=census/fixture",
        ],
        { CENSUS_URL: url, [PRODUCTION_HOSTS_ENV]: PRODUCTION_HOST },
        neverConnect,
      );
      expect(await run, url).toBe(1);
      expect(events).not.toContain("connect");
      expect(events[events.length - 1], url).toContain(reason);
      expect(events.join("\n")).not.toContain(PASSWORD);
    }
  });

  it("refuses a database name the drivers could read differently", async () => {
    for (const path of ["", "census%2Ddb"]) {
      const { run, events } = cli(
        BRANCH_ARGS,
        {
          CENSUS_URL: targetUrl("reader", BRANCH_HOST, path),
          [PRODUCTION_HOSTS_ENV]: PRODUCTION_HOST,
        },
        neverConnect,
      );
      expect(await run, path).toBe(1);
      expect(events).not.toContain("connect");
      expect(events[events.length - 1], path).toContain(
        "must name its database",
      );
    }
  });

  it("never prints the password, from a mistyped flag or a driver error", async () => {
    const url = targetUrl("reader", BRANCH_HOST, "neondb");
    const mistyped = cli(
      ["--database-url-env=CENSUS_URL", `--database-url=${url}`],
      { CENSUS_URL: url, [PRODUCTION_HOSTS_ENV]: PRODUCTION_HOST },
      neverConnect,
    );
    expect(await mistyped.run).toBe(1);
    expect(mistyped.events.join("\n")).not.toContain(PASSWORD);
    expect(mistyped.events[mistyped.events.length - 1]).toContain(
      "Unknown argument: --database-url\n",
    );

    const failing = cli(
      [
        "--database-url-env=CENSUS_URL",
        "--neon-project=project-fixture",
        "--neon-branch=census/fixture",
      ],
      { CENSUS_URL: url, [PRODUCTION_HOSTS_ENV]: PRODUCTION_HOST },
      async (target) => {
        throw new Error(`could not reach ${target}; password ${PASSWORD}`);
      },
    );
    expect(await failing.run).toBe(1);
    const failure = failing.events[failing.events.length - 1];
    expect(failure).toContain("Census failed; no report was produced");
    expect(failure).not.toContain(PASSWORD);

    expect(redactCredentials(`see ${url} now`)).toBe(
      `see postgres://***@${BRANCH_HOST}/neondb now`,
    );

    // A URL with no password can still carry a secret as its user name, and
    // Postgres quotes the user name alone when authentication fails.
    const passwordless = cli(
      BRANCH_ARGS,
      {
        CENSUS_URL: targetUrl(PASSWORD, BRANCH_HOST, "neondb", ""),
        [PRODUCTION_HOSTS_ENV]: PRODUCTION_HOST,
      },
      async (target) => {
        throw new Error(
          `could not reach ${target}; password authentication failed for user "${new URL(target).username}"`,
        );
      },
    );
    expect(await passwordless.run).toBe(1);
    expect(passwordless.events.join("\n")).toContain(
      "password authentication failed for user",
    );
    expect(passwordless.events.join("\n")).not.toContain(PASSWORD);

    // The password may also sit where the target lines and refusals print.
    for (const misplaced of [
      targetUrl(PASSWORD, BRANCH_HOST, "neondb"),
      targetUrl("reader", BRANCH_HOST, PASSWORD),
      targetUrl("reader", BRANCH_HOST, `neondb?${PASSWORD}=1`),
      targetUrl("reader", BRANCH_HOST, `neondb?sslmode=${PASSWORD}`),
    ]) {
      const { run, events } = cli(
        BRANCH_ARGS,
        { CENSUS_URL: misplaced, [PRODUCTION_HOSTS_ENV]: PRODUCTION_HOST },
        async () => {
          throw new Error("stop after connect");
        },
      );
      expect(await run).toBe(1);
      expect(events.join("\n"), misplaced).not.toContain(PASSWORD);
    }

    const closing = cli(
      BRANCH_ARGS,
      {
        CENSUS_URL: targetUrl("reader", BRANCH_HOST, "neondb"),
        [PRODUCTION_HOSTS_ENV]: PRODUCTION_HOST,
      },
      async (target) => ({
        execute: async () => ({ rows: [], rowsAffected: 0 }),
        close: async () => {
          throw new Error(`could not close ${target}`);
        },
      }),
    );
    expect(await closing.run).toBe(1);
    const closeFailure = closing.events[closing.events.length - 1];
    expect(closeFailure).toContain("Closing the database connection failed");
    expect(closeFailure).not.toContain(PASSWORD);
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

  it("sends only its own fixed statements, each a plain read", () => {
    const notPlainRead = (sql: string) =>
      !/^SELECT\s/.test(sql) ||
      /;|\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COPY|CALL|DO|INTO|FOR\s+(?:UPDATE|SHARE|NO\s+KEY|KEY))\b|\b(?:nextval|setval|set_config|pg_advisory\w*|pg_notify|pg_terminate_backend|pg_cancel_backend|lo_\w+|dblink\w*)\s*\(/i.test(
        sql,
      );
    for (const sql of [
      "INSERT INTO documents (id) VALUES ('x')",
      "UPDATE documents SET content = ''",
      "DELETE FROM _collab_docs",
      "WITH gone AS (DELETE FROM documents RETURNING id) SELECT * FROM gone",
      "SELECT 1; DROP TABLE documents",
      "SELECT 1 INTO copied",
      "SELECT nextval('seq')",
      "SELECT pg_advisory_lock(1)",
      "SELECT pg_notify('channel', 'payload')",
      "SELECT id FROM documents FOR UPDATE",
      "SELECT id FROM documents FOR SHARE",
      "SELECT set_config('transaction_read_only', 'off', true)",
      "SELECT pg_terminate_backend(1)",
      "SET TRANSACTION READ WRITE",
      "COMMIT",
    ]) {
      expect(() => readOnlyStatement(sql), sql).toThrow(CensusRefusal);
      expect(notPlainRead(sql), sql).toBe(true);
    }
    // The list is exact: a harmless read the census does not make is refused.
    expect(() => readOnlyStatement("SELECT id FROM documents")).toThrow(
      CensusRefusal,
    );
    for (const sql of Object.values(CENSUS_STATEMENTS)) {
      expect(readOnlyStatement(sql)).toBe(sql);
      expect(notPlainRead(sql), sql).toBe(false);
    }
    expect([...CENSUS_ALLOWED_STATEMENTS].filter(notPlainRead)).toEqual([
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
      "SET LOCAL idle_in_transaction_session_timeout = '10min'",
    ]);
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
  // Neither can be accepted, so neither has an anchor to keep or lose.
  for (const id of ["suggestion-no-operations", "suggestion-title"]) {
    await insert(
      "INSERT INTO agent_review_suggestions (id, resource_type, resource_id, adapter_kind, adapter_version, thread_id, actor_kind, base_revision, summary, created_at, updated_at) VALUES (?, 'document', 'page-agent', 'content.document-markdown', 1, 't1', 'agent', 'r3', 'Retitle', 'now', 'now')",
      [id],
    );
  }
  await insert(
    "INSERT INTO agent_review_suggestion_operations (id, suggestion_id, ordinal, operation_kind, target_id, before_json, after_json, anchor_json, schema_version) VALUES (?, 'suggestion-title', 0, 'replace_text', 'title', ?, ?, '{}', 1)",
    [
      "operation-title",
      JSON.stringify({ markdown: "Old title" }),
      JSON.stringify({ markdown: "New title" }),
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
    let mode: Record<string, unknown> | undefined;
    let write: unknown = "not attempted";
    await withReadOnlySnapshot(capturing, async (query) => {
      [mode] = await query(SNAPSHOT_MODE_CHECK);
      write = await raw!
        .execute("UPDATE documents SET content = 'overwritten'")
        .then(
          () => "written",
          (error: unknown) => error,
        );
    }).catch(() => {
      // The refused UPDATE aborts the transaction, so ending it can fail.
    });
    expect(mode).toEqual({
      read_only: "on",
      isolation: "repeatable read",
      idle_limit: "10min",
    });
    expect(write).toBeInstanceOf(Error);
    expect((write as Error).message).toMatch(/read-only transaction/);
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
    const suggestions = report.agentFormPages.pendingSuggestions as Record<
      string,
      { items: number; pageIds: string[] }
    >;
    expect(suggestions.notAcceptable).toMatchObject({
      items: 2,
      pageIds: ["page-agent"],
    });
    expect(
      Object.values(suggestions).reduce(
        (total, bucket) => total + bucket.items,
        0,
      ),
    ).toBe(3);
    const commentTotal = Object.values(
      report.agentFormPages.commentAnchors as Record<string, { items: number }>,
    ).reduce((total, bucket) => total + bucket.items, 0);
    expect(commentTotal).toBe(1);
  });

  it("never prints the password in a completed report", async () => {
    const { run, events, stdout } = cli(
      BRANCH_ARGS,
      {
        CENSUS_URL: targetUrl("reader", BRANCH_HOST, PASSWORD),
        [PRODUCTION_HOSTS_ENV]: PRODUCTION_HOST,
      },
      async () => ({ ...db, close: async () => {} }),
    );
    expect(await run).toBe(0);
    expect(events.join("\n")).not.toContain(PASSWORD);
    expect(stdout.join("")).not.toContain(PASSWORD);
    expect(JSON.parse(stdout.join("")).target.database).toBe("***");
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

  it("counts what it could not judge as not judged and the run as incomplete", async () => {
    await db.execute({
      sql: "INSERT INTO documents (id, content) VALUES (?, ?)",
      args: ["page-huge", "word ".repeat(120_000)],
    });
    // Content's parser is quadratic in line length and the GFM reader in
    // nesting, so a long or deeply nested line in a body or a live copy is
    // counted without being parsed.
    const longLine = "word ".repeat(7_000).trim();
    await db.execute({
      sql: "INSERT INTO documents (id, content) VALUES (?, ?), (?, ?)",
      args: ["page-long-line", longLine, "page-deep", `${"> ".repeat(101)}x`],
    });
    await db.execute({
      sql: "UPDATE _collab_docs SET yjs_state = ? WHERE doc_id = ?",
      args: [liveCopyState(longLine), "page-agent"],
    });
    await db.execute({
      sql: "UPDATE _collab_docs SET yjs_state = ? WHERE doc_id = ?",
      args: ["!!not a live copy!!", "page-editor"],
    });
    await db.execute(
      "UPDATE agent_review_suggestion_operations SET anchor_json = '{not json' WHERE suggestion_id = 'suggestion-1'",
    );
    await db.execute({
      sql: "INSERT INTO document_comments (id, document_id, thread_id, content, quoted_text, author_email) VALUES ('comment-huge', 'page-agent', 't-huge', 'Too long', ?, 'reader@example.com')",
      args: ["quote ".repeat(50_000)],
    });
    const { run, stdout } = cli(
      ["--database-url-env=CENSUS_URL"],
      { CENSUS_URL: "pglite:memory" },
      async () => ({ ...db, close: async () => {} }),
    );
    expect(await run).toBe(2);
    const report = JSON.parse(stdout.join(""));
    expect(report.complete).toBe(false);
    expect(report.bodies.tooLarge.pageIds).toEqual(["page-huge"]);
    expect(report.bodies.pastParserLimits.pageIds).toEqual([
      "page-deep",
      "page-long-line",
    ]);
    expect(report.liveCopies.byOutcome.unreadable.pageIds).toEqual([
      "page-editor",
    ]);
    expect(report.liveCopies.byOutcome.pastParserLimits.pageIds).toEqual([
      "page-agent",
    ]);
    expect(report.agentFormPages.pendingSuggestions.unreadable).toMatchObject({
      items: 1,
      pageIds: ["page-agent"],
    });
    expect(report.incompleteReasons).toEqual([
      "bodies over 262144 bytes, not classified: 1",
      "bodies with a line over 32768 characters or nested over 100 levels, not classified: 2",
      "unreadable live copies: 1",
      "live copies over 262144 characters, or with a line over 32768 characters or nested over 100 levels, not compared: 1",
      "pages with suggestions that could not be read or resolved: 1",
      "pages with comment quotes over 262144 bytes, not checked: 1",
    ]);
  });

  it("judges suggestions by Content's accept rule and leaves repeated quotes unjudged", async () => {
    // Canonicalizing reads the code span as a fence, so the editor text
    // changes from "notea``bnote" to "notenote".
    const body = "note\n\n`a``b`\n\nnote";
    await db.execute({
      sql: "INSERT INTO documents (id, content) VALUES (?, ?)",
      args: ["page-repeat", body],
    });
    for (const [id, before, after] of [
      // Applies now without an anchor because the body is unchanged.
      ["suggestion-whole", body, "note"],
      ["suggestion-older", "older text", "newer text"],
      ["suggestion-huge", "x".repeat(5 * 1024 * 1024), "y"],
    ]) {
      await db.execute({
        sql: "INSERT INTO agent_review_suggestions (id, resource_type, resource_id, adapter_kind, adapter_version, thread_id, actor_kind, base_revision, summary, created_at, updated_at) VALUES (?, 'document', 'page-repeat', 'content.document-markdown', 1, 't2', 'agent', 'r0', 'Edit', 'now', 'now')",
        args: [id],
      });
      await db.execute({
        sql: "INSERT INTO agent_review_suggestion_operations (id, suggestion_id, ordinal, operation_kind, target_id, before_json, after_json, schema_version) VALUES (?, ?, 0, 'replace_text', 'body', ?, ?, 1)",
        args: [
          `${id}-operation`,
          id,
          JSON.stringify({ markdown: before }),
          JSON.stringify({ markdown: after }),
        ],
      });
    }
    for (const [id, quote] of [
      ["comment-repeat", "note"],
      ["comment-code", "a``b"],
    ]) {
      await db.execute({
        sql: "INSERT INTO document_comments (id, document_id, thread_id, content, quoted_text, author_email) VALUES (?, 'page-repeat', ?, 'Comment', ?, 'a@example.com')",
        args: [id, id, quote],
      });
    }
    const { run, stdout } = cli(
      ["--database-url-env=CENSUS_URL"],
      { CENSUS_URL: "pglite:memory" },
      async () => ({ ...db, close: async () => {} }),
    );
    expect(await run).toBe(2);
    const report = JSON.parse(stdout.join(""));
    const suggestions = report.agentFormPages.pendingSuggestions;
    expect(suggestions.strandedByCanonicalize.pageIds).toContain("page-repeat");
    expect(suggestions.alreadyUnanchored).toMatchObject({
      items: 1,
      pageIds: ["page-repeat"],
    });
    expect(suggestions.tooLarge).toMatchObject({
      items: 1,
      pageIds: ["page-repeat"],
    });
    const comments = report.agentFormPages.commentAnchors;
    expect(comments.ambiguous).toMatchObject({
      items: 1,
      pageIds: ["page-repeat"],
    });
    expect(comments.strandedByCanonicalize.pageIds).toContain("page-repeat");
    expect(report.incompleteReasons).toEqual([
      "pages with suggestions over 4194304 bytes, not judged: 1",
      "pages with comments whose repeated quote may land elsewhere: 1",
    ]);
  });

  it("reads every row across pages, including one whose id is empty", async () => {
    await db.execute(
      "INSERT INTO documents (id, content) SELECT 'bulk-' || lpad(i::text, 3, '0'), 'Plain words' FROM generate_series(0, 249) AS i",
    );
    await db.execute({
      sql: "INSERT INTO documents (id, content) VALUES (?, ?)",
      args: ["", "__empty id__"],
    });
    await db.execute(
      "INSERT INTO document_comments (id, document_id, thread_id, content, quoted_text, author_email) SELECT 'bulk-comment-' || lpad(i::text, 3, '0'), 'page-agent', 't', 'c', 'bold claim', 'a@example.com' FROM generate_series(0, 449) AS i",
    );
    const census = async () => {
      const { run, stdout } = cli(
        ["--database-url-env=CENSUS_URL", "--max-ids=1000"],
        { CENSUS_URL: "pglite:memory" },
        async () => ({ ...db, close: async () => {} }),
      );
      expect(await run).toBe(0);
      return JSON.parse(stdout.join(""));
    };

    const report = await census();
    expect(report.scanned.documents).toBe(4 + 250 + 1);
    expect(report.bodies.canonicalButMisread.pageIds).toContain("");
    const comments = Object.values(
      report.agentFormPages.commentAnchors as Record<string, { items: number }>,
    ).reduce((total, bucket) => total + bucket.items, 0);
    expect(comments).toBe(1 + 450);

    // A live copy whose page is gone, under the same empty id.
    await db.execute({ sql: "DELETE FROM documents WHERE id = ?", args: [""] });
    await db.execute({
      sql: "INSERT INTO _collab_docs (doc_id, yjs_state) VALUES (?, ?)",
      args: ["", liveCopyState("Orphan with an empty id")],
    });
    expect((await census()).liveCopies.orphaned.docIds).toEqual([
      "",
      "page-deleted-long-ago",
    ]);
  });

  it("keeps its snapshot alive while classifying outlasts the idle timeout", async () => {
    const sent: string[] = [];
    const recording: DbExec = {
      ...db,
      close: async () => {},
      transaction: (fn) =>
        db.transaction!((tx) =>
          fn({
            ...tx,
            execute: (statement) => {
              sent.push(
                typeof statement === "string" ? statement : statement.sql,
              );
              return tx.execute(statement);
            },
          }),
        ),
    };
    let clock = Date.now();
    const now = vi
      .spyOn(Date, "now")
      .mockImplementation(() => (clock += 11_000));
    try {
      const { run } = cli(
        ["--database-url-env=CENSUS_URL"],
        { CENSUS_URL: "pglite:memory" },
        async () => recording,
      );
      expect(await run).toBe(0);
    } finally {
      now.mockRestore();
    }
    expect(sent).toContain(CENSUS_STATEMENTS.keepalive);
  });
});
