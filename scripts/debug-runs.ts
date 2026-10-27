import { execFileSync } from "node:child_process";
import {
  existsSync,
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const USAGE = `Find and read agent chat runs for debugging (read-only).

  pnpm exec tsx scripts/debug-runs.ts find <runId | email | objectId | app URL> [--app NAME] [--days 30] [--limit 20]
  pnpm exec tsx scripts/debug-runs.ts show <runId | threadId> [--app NAME]

Databases come from <APP>_DATABASE_URL in the repo-root .env and DATABASE_URL in templates/<app>/.env.
"show" writes .tmp/debug-runs/<app>-<threadId>.md (transcript) and .json (raw thread + live rows).`;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATEMENT_TIMEOUT_MS = 30_000;
const MAX_FIELD_CHARS = 4_000;
const SESSION_GAP_MS = 30 * 60_000;
const EXTERNAL_CALLERS = ["mcp", "webmcp", "a2a"];

type Row = Record<string, unknown>;
type Tx = { unsafe: (query: string, params?: unknown[]) => Promise<Row[]> };
type Sql = {
  begin: <T>(mode: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;
  end: () => Promise<void>;
};
type Source = { app: string; url: string };

export type RunSummary = {
  runId: string;
  turnId?: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  model?: string;
  error?: string;
  screen?: string;
};

export type Input =
  | { kind: "run"; value: string; startedAt?: number }
  | { kind: "email"; value: string }
  | { kind: "object"; value: string; app?: string };

const isRecord = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;
const records = (value: unknown): Row[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

export function classifyInput(raw: string): Input {
  const value = raw.trim();
  const run = /^run-(\d{13})-/.exec(value);
  if (run) return { kind: "run", value, startedAt: Number(run[1]) };
  if (/^[^@\s/]+@[^@\s/]+$/.test(value)) {
    return { kind: "email", value: value.toLowerCase() };
  }
  if (/^https?:\/\//.test(value)) {
    const url = new URL(value);
    const labels = url.hostname
      .replace(/\.agent-native\.com$/, "")
      .split(".")
      .filter((label) => label !== "beta" && label !== "www");
    const id = url.pathname
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent)
      .reverse()
      .find((segment) => /\d|[A-Z_-]/.test(segment) && segment.length >= 6);
    if (!id) throw new Error(`No object id found in the path of ${value}`);
    const app = url.hostname.endsWith("agent-native.com")
      ? labels.at(-1)
      : undefined;
    return { kind: "object", value: id, app };
  }
  return { kind: "object", value };
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  return records(content)
    .map((part) => str(part.text) ?? "")
    .join("");
}

function errorText(error: unknown): string | undefined {
  if (!isRecord(error)) return str(error);
  const code = str(error.errorCode) ?? str(error.code);
  const message = [str(error.message), str(error.details)]
    .filter(Boolean)
    .join(" — ");
  return [code, message].filter(Boolean).join(": ") || undefined;
}

// Older threads predate agentKit and run ids; their transcript still lives in `messages`.
export function summarizeRuns(threadData: Row): RunSummary[] {
  const runs = new Map<string, RunSummary>();
  const upsert = (runId: string | undefined, patch: Partial<RunSummary>) => {
    if (!runId) return;
    const current = runs.get(runId) ?? { runId, status: "unknown" };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) Object.assign(current, { [key]: value });
    }
    runs.set(runId, current);
  };

  const agentKit = isRecord(threadData.agentKit) ? threadData.agentKit : {};
  for (const run of records(agentKit.runs)) {
    upsert(str(run.id), {
      status: str(run.status),
      startedAt: str(run.startedAt),
      completedAt: str(run.completedAt),
      error: errorText(run.error),
    });
  }

  for (const entry of records(threadData.messages)) {
    const message = isRecord(entry.message) ? entry.message : {};
    const metadata = isRecord(message.metadata) ? message.metadata : {};
    const custom = isRecord(metadata.custom) ? metadata.custom : {};
    if (message.role === "user") {
      const runId = str(custom.submittedRunId);
      upsert(runId, {
        turnId: str(custom.submittedTurnId),
        startedAt:
          runId && runs.has(runId) ? undefined : str(message.createdAt),
      });
      continue;
    }
    const runError = isRecord(custom.runError) ? custom.runError : undefined;
    const status = isRecord(message.status) ? message.status : {};
    // agentKit can still say "running" for a run that died; the message's error is the later record.
    upsert(str(metadata.runId) ?? str(runError?.runId), {
      turnId: str(custom.turnId),
      error: errorText(runError),
      ...(runError || status.reason === "error" ? { status: "failed" } : {}),
    });
  }

  const prompts = isRecord(threadData._debugPrompts)
    ? threadData._debugPrompts
    : {};
  for (const debug of records(threadData._debugRuns)) {
    const prompt = str(prompts[str(debug.systemPromptHash) ?? ""]);
    upsert(str(debug.runId), {
      model: str(debug.model),
      screen: prompt
        ? /<current-screen>([\s\S]*?)<\/current-screen>/
            .exec(prompt)?.[1]
            ?.trim()
        : undefined,
    });
  }

  return [...runs.values()].sort((a, b) =>
    (a.startedAt ?? a.runId).localeCompare(b.startedAt ?? b.runId),
  );
}

function cap(value: unknown, where: string): string {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (text === undefined) return "";
  if (text.length <= MAX_FIELD_CHARS) return text;
  return `${text.slice(0, MAX_FIELD_CHARS)}\n[+${(text.length - MAX_FIELD_CHARS).toLocaleString()} chars; full value in ${where}]`;
}

const fence = (body: string) =>
  `\`\`\`\n${body.replaceAll("```", "ˋˋˋ")}\n\`\`\``;

export function renderTranscript(threadData: Row, jsonPath: string): string {
  const out: string[] = [];
  // shortcut: branches (edits/regenerations) render in storage order, not as a tree; follow parentId in the .json if a branch matters.
  for (const entry of records(threadData.messages)) {
    const message = isRecord(entry.message) ? entry.message : {};
    const metadata = isRecord(message.metadata) ? message.metadata : {};
    const custom = isRecord(metadata.custom) ? metadata.custom : {};
    const runId = str(metadata.runId) ?? str(custom.submittedRunId);
    out.push(
      `## ${String(message.role)} · ${str(message.createdAt) ?? "?"}${runId ? ` · ${runId}` : ""}`,
    );
    const parts =
      typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : records(message.content);
    for (const part of parts) {
      if (part.type === "text") out.push(cap(part.text, jsonPath));
      else if (part.type === "reasoning")
        out.push(`> reasoning\n${fence(cap(part.text, jsonPath))}`);
      else if (part.type === "tool-call") {
        out.push(
          `### tool ${String(part.toolName)} (${String(part.toolCallId)})`,
        );
        out.push(`args:\n${fence(cap(part.args ?? part.argsText, jsonPath))}`);
        out.push(
          part.result === undefined
            ? "result: (none recorded — the run ended before this call returned)"
            : `result:\n${fence(cap(part.result, jsonPath))}`,
        );
      } else out.push(`(${String(part.type)} part)`);
    }
    const runError = errorText(custom.runError);
    if (runError) out.push(`**run error:** ${runError}`);
    out.push("");
  }
  return out.join("\n\n");
}

function readEnv(file: string): Map<string, string> {
  const vars = new Map<string, string>();
  if (!existsSync(file)) return vars;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) vars.set(match[1], match[2].trim().replace(/^["']|["']$/g, ""));
  }
  return vars;
}

function discoverSources(onlyApp?: string): Source[] {
  // Worktrees start without the gitignored .env; fall back to the main checkout's.
  const mainCheckout = path.dirname(
    execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    ).trim(),
  );
  const byApp = new Map<string, string>();
  for (const root of [...new Set([ROOT, mainCheckout])]) {
    for (const [key, url] of readEnv(path.join(root, ".env"))) {
      const match = /^([A-Z0-9_]+)_DATABASE_URL$/.exec(key);
      const app = match?.[1].toLowerCase().replaceAll("_", "-");
      if (app && url && !key.includes("UNPOOLED") && !byApp.has(app)) {
        byApp.set(app, url);
      }
    }
    const templates = path.join(root, "templates");
    if (!existsSync(templates)) continue;
    for (const app of readdirSync(templates)) {
      const url = readEnv(path.join(templates, app, ".env")).get(
        "DATABASE_URL",
      );
      if (url && !byApp.has(app)) byApp.set(app, url);
    }
  }
  const sources = [...byApp].map(([app, url]) => ({ app, url }));
  const selected = onlyApp ? sources.filter((s) => s.app === onlyApp) : sources;
  if (!selected.length) {
    throw new Error(
      onlyApp
        ? `No database URL configured for app "${onlyApp}". Known: ${sources.map((s) => s.app).join(", ")}`
        : "No app database URLs found in .env files.",
    );
  }
  return selected;
}

async function connect(url: string): Promise<Sql> {
  const coreRequire = createRequire(
    path.join(ROOT, "packages/core/package.json"),
  );
  const postgres = (await import(
    pathToFileURL(coreRequire.resolve("postgres")).href
  )) as {
    default: (url: string, options: Record<string, unknown>) => Sql;
  };
  return postgres.default(url, { max: 1, onnotice: () => {} });
}

// Neon's pooler drops session SETs between transactions, so read-only is enforced per transaction.
async function readOnly<T>(sql: Sql, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin("read only", async (tx) => {
    await tx.unsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    return fn(tx);
  });
}

// Older app databases lack the client-attribution columns, so read whichever exist.
const AUDIT_ROW = `to_jsonb(a) - 'input' AS row`;
const auditRows = async (tx: Tx, query: string, params: unknown[]) =>
  (await tx.unsafe(query, params)).map((r) => r.row as Row);

const AUDIT_CAP = 2000;

// Queries fetch the newest AUDIT_CAP + 1 rows so an over-full window is reported, not silently clipped.
const newestFirst = (rows: Row[]) => ({
  rows: rows.slice(0, AUDIT_CAP).reverse(),
  truncated: rows.length > AUDIT_CAP,
});

const likeArg = (value: string) => `%${value.replace(/[\\%_]/g, "\\$&")}%`;

async function threadsForRun(tx: Tx, input: Extract<Input, { kind: "run" }>) {
  const live = await tx.unsafe(
    `SELECT thread_id FROM agent_runs WHERE id = $1
     UNION SELECT thread_id FROM agent_trace_summaries WHERE run_id = $1`,
    [input.value],
  );
  if (live.length)
    return live.map((r) => ({
      id: String(r.thread_id),
      via: "agent_runs/traces",
    }));
  if (!input.startedAt) return [];
  // agent_runs is pruned after 1-7 days; the run id's timestamp bounds the thread scan instead.
  const rows = await tx.unsafe(
    `SELECT id FROM chat_threads WHERE created_at <= $1 AND updated_at >= $1 AND thread_data LIKE $2`,
    [input.startedAt, likeArg(input.value)],
  );
  return rows.map((r) => ({ id: String(r.id), via: "thread_data" }));
}

async function ownersOf(tx: Tx, id: string) {
  const tables = await tx.unsafe(
    `SELECT c.table_name FROM information_schema.columns c
     JOIN information_schema.columns o
       ON o.table_schema = c.table_schema AND o.table_name = c.table_name AND o.column_name = 'owner_email'
     WHERE c.table_schema = 'public' AND c.column_name = 'id' AND c.data_type = 'text'`,
  );
  if (!tables.length) return [];
  const union = tables
    .map(
      (t) =>
        `SELECT '${String(t.table_name)}' AS table_name, owner_email FROM "${String(t.table_name)}" WHERE id = $1`,
    )
    .join(" UNION ALL ");
  return tx.unsafe(union, [id]);
}

async function findInApp(
  sql: Sql,
  input: Input,
  sinceMs: number,
  limit: number,
  singleApp: boolean,
) {
  return readOnly(sql, async (tx) => {
    const matches = new Map<string, string>();
    const add = (id: string, via: string) => {
      if (!matches.has(id)) matches.set(id, via);
    };
    let owners: Row[] = [];
    let audit: Row[] = [];
    let auditError: string | undefined;
    let auditTruncated = false;

    if (input.kind === "run") {
      for (const match of await threadsForRun(tx, input))
        add(match.id, match.via);
    } else if (input.kind === "email") {
      const rows = await tx.unsafe(
        `SELECT id FROM chat_threads WHERE owner_email = $1 AND updated_at >= $2 ORDER BY updated_at DESC LIMIT $3`,
        [input.value, sinceMs, limit + 1],
      );
      for (const r of rows) add(String(r.id), "owner_email");
      ({ rows: audit, truncated: auditTruncated } = newestFirst(
        await auditRows(
          tx,
          `SELECT ${AUDIT_ROW} FROM agent_audit_log a WHERE actor_email = $1 AND created_at >= $2 AND caller = ANY($3)
           ORDER BY created_at DESC LIMIT ${AUDIT_CAP + 1}`,
          [input.value, sinceMs, EXTERNAL_CALLERS],
        ),
      ));
    } else {
      for (const r of await tx.unsafe(
        `SELECT id FROM chat_threads WHERE scope_id = $1 ORDER BY updated_at DESC LIMIT $2`,
        [input.value, limit],
      )) {
        add(String(r.id), "scope_id");
      }
      owners = await ownersOf(tx, input.value);
      for (const owner of new Set(
        owners.map((o) => str(o.owner_email)).filter(Boolean),
      )) {
        const rows = await tx.unsafe(
          `SELECT id FROM chat_threads WHERE owner_email = $1 AND updated_at >= $2 AND (id = $3 OR thread_data LIKE $4)
           ORDER BY updated_at DESC LIMIT $5`,
          [owner, sinceMs, input.value, likeArg(input.value), limit],
        );
        for (const r of rows)
          add(
            String(r.id),
            r.id === input.value ? "thread id" : "owner thread mentions id",
          );
      }
      // An unindexed scan of audit inputs (1+ GB in some apps), so only where the object can be.
      if (singleApp || owners.length || matches.size) {
        try {
          await tx.unsafe("SAVEPOINT audit_scan");
          ({ rows: audit, truncated: auditTruncated } = newestFirst(
            await auditRows(
              tx,
              `SELECT ${AUDIT_ROW} FROM agent_audit_log a WHERE created_at >= $1 AND input LIKE $2 ORDER BY created_at DESC LIMIT ${AUDIT_CAP + 1}`,
              [sinceMs, likeArg(input.value)],
            ),
          ));
        } catch (error) {
          await tx.unsafe("ROLLBACK TO SAVEPOINT audit_scan");
          auditError = `${error instanceof Error ? error.message : String(error)}; retry with a smaller --days`;
        }
        for (const r of audit)
          if (str(r.thread_id))
            add(String(r.thread_id), "audit input mentions id");
      }
    }

    const ids = [...matches.keys()].slice(0, limit);
    const threads = ids.length
      ? await tx.unsafe(
          `SELECT id, title, owner_email, scope_type, scope_id, created_at, updated_at, message_count, thread_data
           FROM chat_threads WHERE id = ANY($1) ORDER BY updated_at DESC`,
          [ids],
        )
      : [];
    return {
      owners: owners.map((o) => ({
        table: o.table_name,
        ownerEmail: o.owner_email,
      })),
      threads: threads.map((t) => ({
        threadId: t.id,
        matchedBy: matches.get(String(t.id)),
        title: t.title,
        ownerEmail: t.owner_email,
        scope: t.scope_type
          ? `${String(t.scope_type)}:${String(t.scope_id)}`
          : null,
        createdAt: new Date(Number(t.created_at)).toISOString(),
        updatedAt: new Date(Number(t.updated_at)).toISOString(),
        messageCount: t.message_count,
        ...parseRuns(String(t.thread_data)),
      })),
      unlistedThreads: Math.max(0, matches.size - ids.length),
      ...(auditError ? { auditError } : {}),
      ...(auditTruncated
        ? {
            auditTruncated: `only the newest ${AUDIT_CAP} audit rows in the window are included`,
          }
        : {}),
      externalAgentSessions: groupSessions(
        audit.filter(
          (r) =>
            !str(r.thread_id) && EXTERNAL_CALLERS.includes(String(r.caller)),
        ),
      ),
      uiSessions: groupSessions(
        audit.filter(
          (r) =>
            !str(r.thread_id) && !EXTERNAL_CALLERS.includes(String(r.caller)),
        ),
      ),
    };
  });
}

function parseRuns(
  threadData: string,
): { runs: Omit<RunSummary, "screen">[] } | { threadDataError: string } {
  try {
    return {
      runs: summarizeRuns(JSON.parse(threadData) as Row).map(
        ({ screen: _screen, ...run }) => run,
      ),
    };
  } catch (error) {
    return {
      threadDataError: error instanceof Error ? error.message : String(error),
    };
  }
}

function groupSessions(rows: Row[]) {
  const sessions: Row[] = [];
  const open = new Map<string, Row>();
  for (const row of rows) {
    const at = Number(row.created_at);
    const key = `${String(row.actor_email)}|${String(row.oauth_client_id ?? row.reported_client_name ?? row.caller)}`;
    const current = open.get(key);
    if (current && at - Number(current.lastAt) <= SESSION_GAP_MS) {
      current.lastAt = at;
      current.calls = Number(current.calls) + 1;
      if (row.status !== "success") current.failed = Number(current.failed) + 1;
      const actions = current.actions as Record<string, number>;
      actions[String(row.action)] = (actions[String(row.action)] ?? 0) + 1;
      continue;
    }
    const session: Row = {
      actorEmail: row.actor_email,
      caller: row.caller,
      client: row.reported_client_name ?? row.oauth_client_id ?? null,
      firstAt: at,
      lastAt: at,
      calls: 1,
      failed: row.status === "success" ? 0 : 1,
      actions: { [String(row.action)]: 1 },
    };
    open.set(key, session);
    sessions.push(session);
  }
  return sessions.map((s) => ({
    ...s,
    firstAt: new Date(Number(s.firstAt)).toISOString(),
    lastAt: new Date(Number(s.lastAt)).toISOString(),
  }));
}

async function versionRows(tx: Tx, threadId: string) {
  const tables = await tx.unsafe(
    `SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'chat_context'`,
  );
  const out: Row[] = [];
  for (const [i, t] of tables.entries()) {
    let rows: Row[];
    try {
      await tx.unsafe(`SAVEPOINT version_scan_${i}`);
      rows = await tx.unsafe(
        `SELECT * FROM "${String(t.table_name)}" WHERE chat_context LIKE $1 LIMIT 200`,
        [likeArg(threadId)],
      );
    } catch (error) {
      await tx.unsafe(`ROLLBACK TO SAVEPOINT version_scan_${i}`);
      out.push({
        table: t.table_name,
        scanError: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    for (const row of rows) {
      out.push({
        table: t.table_name,
        ...Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            typeof value === "string" && value.length > 500
              ? `[${value.length.toLocaleString()} chars omitted]`
              : value,
          ]),
        ),
      });
    }
  }
  return out;
}

async function show(sources: Source[], raw: string) {
  const input = classifyInput(raw);
  const unreadable: string[] = [];
  for (const source of sources) {
    const sql = await connect(source.url);
    let found;
    try {
      found = await readOnly(sql, async (tx) => {
        const threadId =
          input.kind === "run"
            ? (await threadsForRun(tx, input))[0]?.id
            : str(
                (
                  await tx.unsafe(`SELECT id FROM chat_threads WHERE id = $1`, [
                    input.value,
                  ])
                )[0]?.id,
              );
        if (!threadId) return null;
        const [thread] = await tx.unsafe(
          `SELECT * FROM chat_threads WHERE id = $1`,
          [threadId],
        );
        const createdAt = Number(thread.created_at);
        const updatedAt = Number(thread.updated_at);
        const liveRuns = await tx.unsafe(
          `SELECT id, status, turn_id, started_at, completed_at, terminal_reason, error_code, error_detail, abort_reason, dispatch_mode
           FROM agent_runs WHERE thread_id = $1 ORDER BY started_at`,
          [threadId],
        );
        return {
          thread,
          liveRuns,
          runEvents: liveRuns.length
            ? await tx.unsafe(
                `SELECT run_id, seq, event_data FROM agent_run_events
                 WHERE run_id = ANY($1) AND (event_data LIKE '{"type":"tool_done"%' OR event_data LIKE '{"type":"error"%' OR event_data LIKE '{"type":"done"%')
                 ORDER BY run_id, seq LIMIT 200`,
                [liveRuns.map((r) => r.id)],
              )
            : [],
          failedSpans: await tx.unsafe(
            `SELECT run_id, span_type, name, status, error_message, duration_ms, created_at
             FROM agent_trace_spans WHERE thread_id = $1 AND status = 'error' ORDER BY created_at LIMIT 200`,
            [threadId],
          ),
          versions: await versionRows(tx, threadId),
          audit: await tx.unsafe(
            `SELECT created_at, action, caller, status, error_code, summary, run_id, turn_id, left(input, 2000) AS input
             FROM agent_audit_log WHERE thread_id = $1 AND created_at BETWEEN $2 AND $3 ORDER BY created_at LIMIT 1000`,
            [threadId, createdAt - 60_000, updatedAt + 60_000],
          ),
        };
      });
    } catch (error) {
      unreadable.push(
        `${source.app} (${error instanceof Error ? error.message : String(error)})`,
      );
      continue;
    } finally {
      await sql.end();
    }
    if (!found) continue;

    const { thread, ...live } = found;
    const threadData = JSON.parse(String(thread.thread_data)) as Row;
    const runs = summarizeRuns(threadData);
    const dir = path.join(ROOT, ".tmp/debug-runs");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const base = path.join(dir, `${source.app}-${String(thread.id)}`);
    const { thread_data: _threadData, ...threadRow } = thread;
    writeFileSync(
      `${base}.json`,
      JSON.stringify(
        { app: source.app, thread: threadRow, threadData, runs, ...live },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    writeFileSync(
      `${base}.md`,
      [
        `# ${source.app} thread ${String(thread.id)}: ${String(thread.title) || "(untitled)"}`,
        `owner: ${String(thread.owner_email)} · scope: ${thread.scope_type ? `${String(thread.scope_type)}:${String(thread.scope_id)}` : "none"} · created ${new Date(Number(thread.created_at)).toISOString()} · updated ${new Date(Number(thread.updated_at)).toISOString()}`,
        `## runs\n${fence(JSON.stringify(runs, null, 2))}`,
        `## live run rows (pruned after 1-7 days)\n${fence(JSON.stringify(live.liveRuns, null, 2))}`,
        // thread_data is written when a run settles, so a running run's tool calls exist only here.
        `## live tool and terminal events\n${fence(cap(live.runEvents, `${base}.json`))}`,
        `## failed trace spans (30-day retention)\n${fence(JSON.stringify(live.failedSpans, null, 2))}`,
        `## versions written by this thread\n${fence(JSON.stringify(live.versions, null, 2))}`,
        `## audited actions (${live.audit.length})\n${fence(cap(live.audit, `${base}.json`))}`,
        `# transcript\n\n${renderTranscript(threadData, `${base}.json`)}`,
      ].join("\n\n"),
      { mode: 0o600 },
    );
    chmodSync(`${base}.json`, 0o600);
    chmodSync(`${base}.md`, 0o600);
    console.log(
      JSON.stringify(
        {
          app: source.app,
          threadId: thread.id,
          transcript: `${base}.md`,
          raw: `${base}.json`,
          runs: runs.map(({ screen: _screen, ...run }) => run),
        },
        null,
        2,
      ),
    );
    return;
  }
  throw new Error(
    `No thread found for ${raw} in: ${sources.map((s) => s.app).join(", ")}${
      unreadable.length ? `. Could not read: ${unreadable.join("; ")}` : ""
    }`,
  );
}

async function find(
  sources: Source[],
  raw: string,
  days: number,
  limit: number,
) {
  const input = classifyInput(raw);
  const sinceMs = Date.now() - days * 86_400_000;
  const scoped =
    input.kind === "object" && input.app
      ? sources.filter((s) => s.app === input.app)
      : [];
  const targets = scoped.length ? scoped : sources;
  const results = await Promise.all(
    targets.map(async (source) => {
      const sql = await connect(source.url);
      try {
        return {
          app: source.app,
          ...(await findInApp(
            sql,
            input,
            sinceMs,
            limit,
            targets.length === 1,
          )),
        };
      } catch (error) {
        return {
          app: source.app,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        await sql.end();
      }
    }),
  );
  const hits = results.filter(
    (r) =>
      "error" in r ||
      r.threads.length ||
      r.owners.length ||
      r.externalAgentSessions.length ||
      r.uiSessions.length,
  );
  console.log(
    JSON.stringify(
      {
        input,
        sinceDays: days,
        appsSearched: results.map((r) => r.app),
        results: hits,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const [command, target, ...rest] = process.argv.slice(2);
  const flag = (name: string) => {
    const index = rest.indexOf(`--${name}`);
    return index === -1 ? undefined : rest[index + 1];
  };
  if (!target || (command !== "find" && command !== "show")) {
    console.error(USAGE);
    process.exit(1);
  }
  const days = Number(flag("days") ?? 30);
  const limit = Number(flag("limit") ?? 20);
  if (!(days > 0) || !(limit > 0))
    throw new Error("--days and --limit must be positive numbers");
  const sources = discoverSources(flag("app"));
  if (command === "find") await find(sources, target, days, limit);
  else await show(sources, target);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
