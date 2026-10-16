import { pathToFileURL } from "node:url";

import { closeDbExec, createDbExec, type DbExec } from "@agent-native/core/db";

import { runStoredFormCensusScan } from "./stored-form-census-scan.js";

// Read-only census of Content page bodies for the stored-form rebuild (L6a).
// It has no write path: every statement goes through `readOnlyStatement`, the
// whole scan runs in one verified READ ONLY transaction, and production is
// refused before any connection opens. Output is counts, kinds and page IDs,
// never page text.

export const PRODUCTION_HOSTS_ENV = "CONTENT_PRODUCTION_DATABASE_HOSTS";

const USAGE = `Usage: tsx scripts/stored-form-census.ts --database-url-env=<ENV_VAR> [options]

Reads Content page bodies, live copies, suggestions, comments and drafts in one
read-only transaction and prints counts, kinds and page IDs as JSON.

  --database-url-env=<ENV_VAR>  Environment variable holding the target URL. Required;
                                .env files are not loaded.
  --neon-project=<id>           Neon project the target branch belongs to. Required for
  --neon-branch=<name>          a *.neon.tech target, and printed before connecting.
  --max-ids=<n>                 Page IDs listed per bucket (default 50).

Remote targets also need ${PRODUCTION_HOSTS_ENV}: a comma-separated list of the
hosts or Neon endpoint IDs that serve production. A target on that list, or a
Neon branch labelled production, prod or main, is refused, and a remote target
is refused when the list is missing. There is no override.`;

export class CensusRefusal extends Error {
  readonly code = "census_refused";
  constructor(message: string) {
    super(message);
    this.name = "CensusRefusal";
  }
}

export type CensusTarget = {
  url: string;
  sourceEnv: string;
  kind: "pglite" | "local" | "remote";
  host: string;
  database: string;
  redactedUrl: string;
  neon: { project: string; branch: string; endpoint: string } | null;
};

export type CensusOptions = {
  databaseUrlEnv: string;
  neonProject: string | null;
  neonBranch: string | null;
  maxIds: number;
};

type Env = Record<string, string | undefined>;

export function parseCensusArgs(argv: readonly string[]): CensusOptions {
  const values = new Map<string, string>();
  for (const arg of argv) {
    if (arg === "--apply" || arg.startsWith("--apply=")) {
      throw new CensusRefusal(
        "The census is read-only and has no --apply; conversion belongs to the backfill.",
      );
    }
    const match =
      /^--(database-url-env|neon-project|neon-branch|max-ids)=(.*)$/.exec(arg);
    if (!match) throw new CensusRefusal(`Unknown argument: ${arg}\n\n${USAGE}`);
    if (values.has(match[1]))
      throw new CensusRefusal(`--${match[1]} was given twice`);
    values.set(match[1], match[2].trim());
  }
  const databaseUrlEnv = values.get("database-url-env");
  if (!databaseUrlEnv) throw new CensusRefusal(USAGE);
  if (!/^[A-Z_][A-Z0-9_]*$/.test(databaseUrlEnv)) {
    throw new CensusRefusal(
      `--database-url-env takes an environment variable name, not a URL`,
    );
  }
  const rawMaxIds = values.get("max-ids") ?? "50";
  const maxIds = Number(rawMaxIds);
  if (!Number.isInteger(maxIds) || maxIds < 0 || maxIds > 100_000) {
    throw new CensusRefusal(
      `--max-ids must be a whole number from 0 to 100000`,
    );
  }
  return {
    databaseUrlEnv,
    neonProject: values.get("neon-project") || null,
    neonBranch: values.get("neon-branch") || null,
    maxIds,
  };
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * What a host is called for the production comparison. A Neon endpoint is the
 * same database whether it is reached through its pooler or directly, and an
 * operator may declare it by bare endpoint ID.
 */
export function databaseHostIdentity(host: string): string {
  const normalized = host.trim().toLowerCase().replace(/\.$/, "");
  const [first, ...rest] = normalized.split(".");
  const isNeon =
    first?.startsWith("ep-") &&
    (rest.length === 0 || normalized.endsWith(".neon.tech"));
  return isNeon ? first.replace(/-pooler$/, "") : normalized;
}

export function resolveCensusTarget(
  options: CensusOptions,
  env: Env,
): CensusTarget {
  const url = env[options.databaseUrlEnv]?.trim();
  if (!url) {
    throw new CensusRefusal(
      `${options.databaseUrlEnv} is not set; the census reads its target from that variable only`,
    );
  }
  if (url.toLowerCase().startsWith("pglite:")) {
    return {
      url,
      sourceEnv: options.databaseUrlEnv,
      kind: "pglite",
      host: "pglite (local file)",
      database: url.slice("pglite:".length) || "./data/pglite",
      redactedUrl: url,
      neon: null,
    };
  }
  if (!/^postgres(?:ql)?:\/\//i.test(url) || !URL.canParse(url)) {
    throw new CensusRefusal(
      `${options.databaseUrlEnv} does not hold a PostgreSQL or pglite: URL`,
    );
  }
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  if (!host) {
    throw new CensusRefusal(
      `${options.databaseUrlEnv} names no host; socket targets are not supported`,
    );
  }
  const redacted = new URL(url);
  if (redacted.password) redacted.password = "***";
  for (const key of [...redacted.searchParams.keys()]) {
    if (/pass|secret|token|key/i.test(key))
      redacted.searchParams.set(key, "***");
  }
  const isNeonHost = host.endsWith(".neon.tech");
  if (isNeonHost && (!options.neonProject || !options.neonBranch)) {
    throw new CensusRefusal(
      "A Neon target needs --neon-project and --neon-branch so the run records which branch it read",
    );
  }
  return {
    url,
    sourceEnv: options.databaseUrlEnv,
    kind: LOOPBACK_HOSTS.has(host) ? "local" : "remote",
    host,
    database:
      decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "(default)",
    redactedUrl: redacted.toString(),
    neon: isNeonHost
      ? {
          project: options.neonProject!,
          branch: options.neonBranch!,
          endpoint: databaseHostIdentity(host),
        }
      : null,
  };
}

/** Null when the target may be read; otherwise why it is refused. */
export function productionRefusal(
  target: CensusTarget,
  env: Env,
): string | null {
  if (target.kind !== "remote") return null;
  if (target.neon && /^(?:production|prod|main)$/i.test(target.neon.branch)) {
    return `Neon branch "${target.neon.branch}" is named as a production branch`;
  }
  const declared = (env[PRODUCTION_HOSTS_ENV] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (declared.length === 0) {
    return `${PRODUCTION_HOSTS_ENV} is not set, so a remote target cannot be shown not to be production`;
  }
  const identity = databaseHostIdentity(target.host);
  return declared.some((entry) => databaseHostIdentity(entry) === identity)
    ? `${target.host} is a production database (${PRODUCTION_HOSTS_ENV})`
    : null;
}

export function describeCensusTarget(target: CensusTarget): string[] {
  return [
    "Content stored-form census (read-only)",
    `Target host: ${target.host}`,
    `Database: ${target.database}`,
    `From env var: ${target.sourceEnv}`,
    `URL: ${target.redactedUrl}`,
    ...(target.neon
      ? [
          `Neon project: ${target.neon.project}`,
          `Neon branch: ${target.neon.branch}`,
          `Neon endpoint: ${target.neon.endpoint}`,
        ]
      : []),
  ];
}

const READ_STATEMENT = /^\s*(?:SELECT|WITH|SHOW)\b/i;
const WRITE_KEYWORD =
  /\b(?:INSERT|UPDATE|DELETE|MERGE|UPSERT|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COPY|CALL|DO|LOCK|VACUUM|REINDEX|CLUSTER|REFRESH|NOTIFY|LISTEN|PREPARE|EXECUTE|COMMENT|SECURITY|SHARE|nextval|setval|set_config|dblink\w*|lo_\w+|pg_advisory\w*|pg_terminate_backend|pg_cancel_backend)\b/i;

/**
 * The census's only way to the database. A statement that is not a plain
 * read is refused before it is sent, so there is no write path to misuse even
 * if the transaction mode were lost.
 */
export function readOnlyStatement(sql: string): string {
  const isTransactionMode =
    /^\s*SET\s+TRANSACTION\s+ISOLATION\s+LEVEL\s+REPEATABLE\s+READ\s*,\s*READ\s+ONLY\s*$/i.test(
      sql,
    );
  if (isTransactionMode) return sql;
  if (
    !READ_STATEMENT.test(sql) ||
    WRITE_KEYWORD.test(sql) ||
    sql.includes(";")
  ) {
    throw new CensusRefusal(
      `The census only reads; refused statement: ${sql.slice(0, 80)}`,
    );
  }
  return sql;
}

export type CensusQuery = (
  sql: string,
  args?: unknown[],
) => Promise<Record<string, unknown>[]>;

/**
 * Run `scan` in one REPEATABLE READ, READ ONLY transaction and prove the mode
 * took effect before reading anything: a driver that ignored it would make
 * every later count look safe when it was not.
 */
export async function withReadOnlySnapshot<T>(
  db: DbExec,
  scan: (query: CensusQuery) => Promise<T>,
): Promise<T> {
  if (!db.transaction) {
    throw new CensusRefusal(
      "This database client cannot open a transaction, so the census cannot read a consistent read-only snapshot",
    );
  }
  return db.transaction(async (tx) => {
    const query: CensusQuery = async (sql, args = []) =>
      (await tx.execute({ sql: readOnlyStatement(sql), args })).rows as Record<
        string,
        unknown
      >[];
    await query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const [mode] = await query(
      "SELECT current_setting('transaction_read_only') AS read_only, current_setting('transaction_isolation') AS isolation",
    );
    if (mode?.read_only !== "on" || mode?.isolation !== "repeatable read") {
      throw new CensusRefusal(
        `The census transaction is not a read-only snapshot (read_only=${String(mode?.read_only)}, isolation=${String(mode?.isolation)})`,
      );
    }
    return scan(query);
  });
}

export type CensusCliDependencies = {
  argv: readonly string[];
  env: Env;
  log: (line: string) => void;
  out: (text: string) => void;
  connect: (url: string) => Promise<DbExec>;
};

/** Exit code: 0 complete, 2 incomplete report, 1 refused or failed. */
export async function runStoredFormCensusCli(
  deps: CensusCliDependencies,
): Promise<number> {
  let db: DbExec | undefined;
  try {
    const options = parseCensusArgs(deps.argv);
    const target = resolveCensusTarget(options, deps.env);
    for (const line of describeCensusTarget(target)) deps.log(line);
    const refusal = productionRefusal(target, deps.env);
    if (refusal) throw new CensusRefusal(`Refused: ${refusal}`);
    db = await deps.connect(target.url);
    const report = await withReadOnlySnapshot(db, (query) =>
      runStoredFormCensusScan(query, { maxIds: options.maxIds }),
    );
    deps.out(
      `${JSON.stringify(
        {
          target: {
            host: target.host,
            database: target.database,
            sourceEnv: target.sourceEnv,
            neon: target.neon,
          },
          ...report,
        },
        null,
        2,
      )}\n`,
    );
    return report.complete ? 0 : 2;
  } catch (error) {
    deps.log(
      error instanceof CensusRefusal
        ? error.message
        : `Census failed; no report was produced: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  } finally {
    await db?.close?.();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.exitCode = await runStoredFormCensusCli({
      argv: process.argv.slice(2),
      env: process.env,
      log: (line) => process.stderr.write(`${line}\n`),
      out: (text) => process.stdout.write(text),
      connect: (url) => createDbExec({ url }),
    });
  } finally {
    // A pglite: client has no per-exec close and would keep the process alive.
    await closeDbExec();
  }
}
