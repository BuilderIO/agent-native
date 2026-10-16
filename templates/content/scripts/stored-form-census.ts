import { pathToFileURL } from "node:url";

import { closeDbExec, createDbExec, type DbExec } from "@agent-native/core/db";

import {
  CENSUS_STATEMENTS,
  runStoredFormCensusScan,
} from "./stored-form-census-scan.js";

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

The target is a pglite: file or a Neon branch endpoint (ep-…); any other host,
localhost included, is refused. A Neon target also needs ${PRODUCTION_HOSTS_ENV}:
a comma-separated list of the hosts or Neon endpoint IDs that serve production.
A target on that list, or a Neon branch labelled production, prod or main, is
refused, and so is any Neon target when the list is missing. There is no
override.`;

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
  kind: "pglite" | "remote";
  host: string;
  database: string;
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
    if (!match) {
      // Only the flag name: a mistyped flag may carry a connection URL.
      const name = arg.startsWith("--") ? arg.split("=")[0] : "(positional)";
      throw new CensusRefusal(`Unknown argument: ${name}\n\n${USAGE}`);
    }
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

// One `@` at most, and nothing a parser could read as a second host, path or
// fragment: postgres.js takes the host after the first `@` where `URL` takes
// the last, so a URL two parsers could read differently is refused. IPv6
// literals are refused too; postgres.js reads `[::1]` as the host `[`.
const TARGET_URL =
  /^postgres(?:ql)?:\/\/(?:[^\s@/?#\\]*@)?([^\s@/?#\\:[\]]+)(?::\d{1,5})?(?:\/[^\s@/?#\\]*)?(?:\?[^\s@#\\]*)?$/i;
const PLAIN_HOSTNAME =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
// Each value comes from a fixed list: a driver error can quote the URL, and a
// URL without a password has nothing to redact a misplaced secret by.
const ALLOWED_URL_PARAMETERS = new Map([
  [
    "sslmode",
    new Set([
      "disable",
      "allow",
      "prefer",
      "require",
      "verify-ca",
      "verify-full",
    ]),
  ],
  ["channel_binding", new Set(["disable", "prefer", "require"])],
]);

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
      neon: null,
    };
  }
  const shape = TARGET_URL.exec(url);
  if (!shape || !URL.canParse(url)) {
    throw new CensusRefusal(
      `${options.databaseUrlEnv} must hold a postgres:// URL with one host, at most one @ (percent-encode special characters in the user name and password), an optional port and database, and no fragment, or a pglite: URL`,
    );
  }
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  // The driver must reach exactly the host the refusal checked. Drivers also
  // read `?host=`, decode `%xx` in the host, and split `a,b` into fallbacks,
  // so anything but one plain hostname is refused rather than interpreted.
  if (host !== shape[1].toLowerCase() || !PLAIN_HOSTNAME.test(host)) {
    throw new CensusRefusal(
      `${options.databaseUrlEnv} must name one plain hostname; encoded, multiple, trailing-dot and socket hosts are not supported`,
    );
  }
  // postgres.js keeps `%xx` in a database name where Neon's driver decodes
  // it, and a missing name falls back to PGDATABASE, so either way the name
  // printed could differ from the database read.
  const database = parsed.pathname.slice(1);
  if (!/^[\w-]+$/.test(database)) {
    throw new CensusRefusal(
      `${options.databaseUrlEnv} must name its database in letters, digits, _ and -`,
    );
  }
  // The parameter's name and value are not printed: either could be a
  // misplaced password.
  for (const [key, value] of parsed.searchParams) {
    const values = ALLOWED_URL_PARAMETERS.get(key);
    if (!values) {
      throw new CensusRefusal(
        `${options.databaseUrlEnv} has a URL parameter other than ${[...ALLOWED_URL_PARAMETERS.keys()].join(" and ")}, which are the only ones supported`,
      );
    }
    if (!values.has(value)) {
      throw new CensusRefusal(
        `${options.databaseUrlEnv} sets ${key} to a value it does not take (${[...values].join(", ")})`,
      );
    }
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
    kind: "remote",
    host,
    database,
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
  if (target.kind === "pglite") return null;
  // A host name cannot show what is behind it: localhost or any alias may be
  // a tunnel to production. A named Neon endpoint can be checked against the
  // declared production endpoints; local runs use a pglite: file.
  if (!target.neon?.endpoint.startsWith("ep-")) {
    return `${target.host} is not a Neon endpoint; the census reads only a pglite: file or a Neon branch endpoint`;
  }
  if (/^(?:production|prod|main)$/i.test(target.neon.branch)) {
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

/**
 * Only fields the census has checked, never the URL itself: its user name and
 * parameter values are not checked and could hold a misplaced secret.
 */
export function describeCensusTarget(target: CensusTarget): string[] {
  return [
    "Content stored-form census (read-only)",
    `Target host: ${target.host}`,
    `Database: ${target.database}`,
    `From env var: ${target.sourceEnv}`,
    ...(target.neon
      ? [
          `Neon project: ${target.neon.project}`,
          `Neon branch: ${target.neon.branch}`,
          `Neon endpoint: ${target.neon.endpoint}`,
        ]
      : []),
  ];
}

const SET_SNAPSHOT_MODE =
  "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY";
// Core ends a Neon transaction after 30 idle seconds, and Content's parser
// can take longer than that on one large body, between the scan's pings.
const SET_IDLE_LIMIT =
  "SET LOCAL idle_in_transaction_session_timeout = '10min'";
export const SNAPSHOT_MODE_CHECK =
  "SELECT current_setting('transaction_read_only') AS read_only, current_setting('transaction_isolation') AS isolation, current_setting('idle_in_transaction_session_timeout') AS idle_limit";

/** Every statement the census may send, verbatim. */
export const CENSUS_ALLOWED_STATEMENTS: ReadonlySet<string> = new Set([
  SET_SNAPSHOT_MODE,
  SET_IDLE_LIMIT,
  SNAPSHOT_MODE_CHECK,
  ...Object.values(CENSUS_STATEMENTS),
]);

/**
 * The census's only way to the database. A statement that is not one of the
 * census's own fixed reads is refused before it is sent, so there is no write
 * path to misuse even if the transaction mode were lost. Values travel as
 * bound parameters, never in the statement text.
 */
export function readOnlyStatement(sql: string): string {
  if (!CENSUS_ALLOWED_STATEMENTS.has(sql)) {
    throw new CensusRefusal(
      `The census sends only its own fixed reads; refused statement: ${sql.slice(0, 80)}`,
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
    await query(SET_SNAPSHOT_MODE);
    await query(SET_IDLE_LIMIT);
    const [mode] = await query(SNAPSHOT_MODE_CHECK);
    if (
      mode?.read_only !== "on" ||
      mode?.isolation !== "repeatable read" ||
      mode?.idle_limit !== "10min"
    ) {
      throw new CensusRefusal(
        `The census transaction is not a read-only snapshot with its idle limit (read_only=${String(mode?.read_only)}, isolation=${String(mode?.isolation)}, idle_limit=${String(mode?.idle_limit)})`,
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

// The whole user info: a URL without a password can still carry a secret as
// its user name.
const URL_CREDENTIALS = /\/\/[^\s@/]*@/g;

/** `text` with URL credentials and each of `secrets` replaced. */
export function redactCredentials(
  text: string,
  ...secrets: readonly string[]
): string {
  const redacted = text.replace(URL_CREDENTIALS, "//***@");
  return secrets
    .flatMap((secret) => [secret, safeDecode(secret)])
    .filter((secret) => secret.length > 0)
    .reduce((value, secret) => value.split(secret).join("***"), redacted);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function credentialsIn(url: string | undefined): {
  user: string;
  password: string;
} {
  if (!url || !URL.canParse(url)) return { user: "", password: "" };
  const { username, password } = new URL(url);
  return { user: username, password };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Exit code: 0 complete, 2 incomplete report, 1 refused or failed. */
export async function runStoredFormCensusCli(
  deps: CensusCliDependencies,
): Promise<number> {
  let db: DbExec | undefined;
  let credentials = { user: "", password: "" };
  // Driver errors and odd URLs can quote the password anywhere.
  const shown = (text: string) => redactCredentials(text, credentials.password);
  const log = (line: string) => deps.log(shown(line));
  // A driver error can also quote the user name alone ("password
  // authentication failed for user …"), which may be a pasted secret. Only
  // failures hide it: no other line prints it, and a common name such as
  // `census` would garble the target lines.
  const logFailure = (line: string) =>
    deps.log(redactCredentials(line, credentials.password, credentials.user));
  let exitCode: number;
  try {
    const options = parseCensusArgs(deps.argv);
    credentials = credentialsIn(deps.env[options.databaseUrlEnv]?.trim());
    const target = resolveCensusTarget(options, deps.env);
    for (const line of describeCensusTarget(target)) log(line);
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
            host: shown(target.host),
            database: shown(target.database),
            sourceEnv: target.sourceEnv,
            neon: target.neon && {
              project: shown(target.neon.project),
              branch: shown(target.neon.branch),
              endpoint: shown(target.neon.endpoint),
            },
          },
          ...report,
        },
        null,
        2,
      )}\n`,
    );
    exitCode = report.complete ? 0 : 2;
  } catch (error) {
    if (error instanceof CensusRefusal) log(error.message);
    else
      logFailure(`Census failed; no report was produced: ${messageOf(error)}`);
    exitCode = 1;
  }
  try {
    await db?.close?.();
  } catch (error) {
    logFailure(`Closing the database connection failed: ${messageOf(error)}`);
    exitCode = 1;
  }
  return exitCode;
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
    await closeDbExec().catch((error: unknown) => {
      process.stderr.write(
        `${redactCredentials(`Closing database clients failed: ${messageOf(error)}`)}\n`,
      );
      process.exitCode = 1;
    });
  }
}
