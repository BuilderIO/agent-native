#!/usr/bin/env tsx
/**
 * Provider diagnostic for the MCP catalogs the template apps advertise. It is
 * not proof that a host works: it reaches each provider through OpenRouter's
 * chat-completions `tools[].function.parameters`, which is not the field
 * Claude Code, Codex or Gemini CLI fill (see the header of
 * `src/mcp/provider-schema-conformance.ts`). OpenRouter converts the schema
 * for each provider, and Gemini's path there is the OpenAPI-subset
 * `parameters`, so an acceptance here says the provider took this
 * translation, and a rejection points at a schema to look at. Whether a host
 * accepts a catalog is checked by connecting that host.
 *
 * Local only, never in CI: it spends OpenRouter credits.
 *
 *   OPENROUTER_API_KEY=... pnpm exec tsx packages/core/scripts/mcp-provider-smoke.ts \
 *     [--apps content,design] [--modes default,full] [--dry-run]
 *
 * For each app, catalog mode and provider it sends the catalog's tools in a
 * tools-only request. Providers cap tools per request, so a catalog larger
 * than CHUNK_SIZE goes out in slices. One slice per catalog forces a call to
 * an app action, preferring one with required arguments, and the returned
 * arguments are validated against that action's own input schema, the one
 * its handler enforces. Each check ends in one outcome:
 *
 * - `accepted`: every slice and the forced call were accepted, and the
 *   arguments pass the action's schema.
 * - `rejected`: the provider refused a slice of the catalog. That is an
 *   error whose `error.metadata.error_type` is `invalid_request`, or with no
 *   `error_type` a 400, the way OpenRouter passes on a provider's refusal of
 *   a request.
 * - `forced-rejected`: the catalog was accepted, but naming the tool in
 *   `tool_choice` was refused the same way. Gemini documents that forced mode
 *   "may reject very large or deeply nested schemas". The call is retried on
 *   auto so the arguments are still checked, but the outcome stays
 *   forced-rejected.
 * - `narrowed`: the action accepts the arguments but the advertised schema
 *   does not, so a host that validates against it would refuse a good call.
 * - `invalid-arguments`: no tool call came back, a forced request came back
 *   calling another tool, or the arguments fail the action's schema.
 * - `unchecked`: a request failed for a reason other than its schemas, and
 *   nothing the check did learn failed. That is no answer at all, or any
 *   error that is not a refusal: a key that is refused or lacks credits
 *   (401, 402, 403), a rate limit (429), a timeout or an unavailable provider
 *   (5xx), and every other `error_type`.
 *
 * A check that failed is reported as its failure even when another of its
 * requests went unchecked, and how many did is kept apart in
 * `uncheckedRequests`. The run exits 1 when any check failed, that is ended
 * in an outcome other than `accepted` or `unchecked`. Otherwise it exits 2
 * when it could not check everything asked: `--dry-run`, which writes the
 * catalogs and sends nothing, a flag it does not understand, an `--apps` or
 * `--modes` with a missing or empty value, no OPENROUTER_API_KEY, an app it
 * does not know or whose catalogs do not load, an app named in `--apps`
 * without one of the `--modes`, a mode an app advertises whose catalog did
 * not load, a catalog with no tools, a catalog with no forced-call
 * candidate, no catalog or provider check at all, an unchecked request, or
 * anything else that stopped the run early. Every app and catalog is loaded
 * before any request, and a selection with an unknown app, a mode a named app
 * does not advertise, a catalog that did not load, one with no tools, or one
 * with no forced-call candidate sends nothing. Once requests go out, the run
 * can still end incomplete only through what comes back: a request that ends
 * unchecked, known only once it is answered, or an error that stops the run.
 * The requests sent by then have spent their credits. A mode that an app
 * picked by default does not advertise is skipped, and listed under
 * `skipped` in the log and the results. It exits 0 only when every catalog
 * was sent and accepted and a forced call's arguments were checked in each,
 * so a run that inspected less is never reported as a pass. Results and
 * pinned model ids land in `.tmp/mcp-provider-smoke/`, with
 * credential-shaped strings redacted.
 *
 * The deterministic counterpart is each template's
 * `server/mcp-provider-schemas.spec.ts`, which checks the same catalogs against
 * pinned provider rules without a network.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Tool } from "@modelcontextprotocol/server";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import Ajv2020 from "ajv/dist/2020.js";
import { createServer } from "vite";

import { validateActionArgs } from "../src/action.js";
import type { ActionEntry } from "../src/agent/production-agent.js";
import {
  loadTemplateMcpConformance,
  MCP_CATALOG_MODES,
  type McpCatalogMode,
} from "../src/mcp/provider-schema-conformance.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const CHUNK_SIZE = 128;
// `provider.only` pins the first-party API so OpenRouter cannot route the
// request to a reseller whose schema validator differs.
const PROVIDERS = [
  { id: "anthropic", model: "anthropic/claude-haiku-4.5", only: "Anthropic" },
  { id: "openai", model: "openai/gpt-5.4-nano", only: "OpenAI" },
  {
    id: "gemini",
    model: "google/gemini-3.5-flash-lite",
    only: "Google AI Studio",
  },
] as const;
type Provider = (typeof PROVIDERS)[number];

type Outcome =
  | "accepted"
  | "rejected"
  | "forced-rejected"
  | "narrowed"
  | "invalid-arguments"
  | "unchecked";

// A check reports the first of these that applies. Every failure comes
// before `unchecked`: a request that failed for a reason other than its
// schemas says nothing about them, so it must not hide a failure another
// request found.
const OUTCOME_ORDER: Outcome[] = [
  "rejected",
  "forced-rejected",
  "narrowed",
  "invalid-arguments",
  "unchecked",
  "accepted",
];

interface CheckRecord extends Record<string, unknown> {
  outcome: Outcome;
  /** Requests in this check that failed for a reason other than their schemas. */
  uncheckedRequests: number;
}

export interface TemplateCatalogs {
  /** Every mode the template advertises, before `--modes` selects. */
  modes: McpCatalogMode[];
  catalogs: { mode: McpCatalogMode; tools: Tool[] }[];
  actions: Record<string, ActionEntry>;
}

/** What a run reads from outside the script, so a test can replace it. */
export interface SmokeEnvironment {
  key: string | undefined;
  outDir: string;
  templateApps: () => string[];
  loadCatalogs: (
    app: string,
    only?: McpCatalogMode[],
  ) => Promise<TemplateCatalogs>;
  log: (line: string) => void;
}

interface Flags {
  apps?: string[];
  modes?: McpCatalogMode[];
  dryRun: boolean;
}

/**
 * The comma-separated names after `flag`. A missing or empty one is refused,
 * not read as no selection: leaving out `--apps` sends every app's catalogs,
 * so a dropped value would run, and pay for, all of them.
 */
function namesAfter(flag: string, value: string | undefined): string[] {
  const names =
    value === undefined || value.startsWith("--") ? [] : value.split(",");
  if (names.length === 0 || names.includes("")) {
    throw new Error(`${flag} needs a comma-separated list of names.`);
  }
  return names;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--apps") flags.apps = namesAfter(arg, argv[++i]);
    else if (arg === "--modes") {
      const modes = namesAfter(arg, argv[++i]);
      const unknown = modes.filter(
        (mode) => !(MCP_CATALOG_MODES as readonly string[]).includes(mode),
      );
      if (unknown.length > 0) {
        throw new Error(
          `Unknown catalog mode ${unknown.join(", ")}; expected ${MCP_CATALOG_MODES.join(", ")}.`,
        );
      }
      flags.modes = modes as McpCatalogMode[];
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return flags;
}

const CREDENTIAL_PATTERNS: [RegExp, string][] = [
  [/\bsk-[A-Za-z0-9_-]{8,}/g, "[redacted]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]"],
  [
    /\b((?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?)[^\s"',}]{6,}/gi,
    "$1[redacted]",
  ],
  [/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]"],
];

/**
 * Replaces the run's key, and anything shaped like a credential, in every
 * string of `value`. Provider errors can echo request headers or arguments
 * back, and these results are pasted into reviews.
 */
function redact<T>(value: T, secrets: string[]): T {
  if (typeof value === "string") {
    let out: string = value;
    for (const secret of secrets) {
      if (secret) out = out.split(secret).join("[redacted]");
    }
    for (const [pattern, replacement] of CREDENTIAL_PATTERNS) {
      out = out.replace(pattern, replacement);
    }
    return out as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, secrets)) as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redact(item, secrets)]),
    ) as T;
  }
  return value;
}

const repoRoot = path.resolve(import.meta.dirname, "../../..");

function templateApps(): string[] {
  const templates = path.join(repoRoot, "templates");
  return readdirSync(templates).filter((app) =>
    existsSync(path.join(templates, app, "actions")),
  );
}

async function loadCatalogs(
  app: string,
  only?: McpCatalogMode[],
): Promise<TemplateCatalogs> {
  const root = path.join(repoRoot, "templates", app);
  // The template's Vitest config carries its path aliases without the
  // production plugin stack, which is what its own conformance spec runs on.
  const vite = await createServer({
    root,
    configFile: path.join(root, "vitest.config.ts"),
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const template = await loadTemplateMcpConformance(root, (file) =>
      vite.ssrLoadModule(file),
    );
    const catalogs: { mode: McpCatalogMode; tools: Tool[] }[] = [];
    for (const mode of template.modes) {
      if (only && !only.includes(mode)) continue;
      catalogs.push({ mode, tools: await template.listCatalog(mode) });
    }
    return { modes: template.modes, catalogs, actions: template.actions };
  } finally {
    await vite.close();
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function isComposedRoot(entry: ActionEntry): boolean {
  const parameters = entry.tool?.parameters ?? {};
  return ["anyOf", "oneOf", "allOf"].some((key) => key in parameters);
}

/**
 * The app action to force a call to: one with required arguments whose
 * composed root was flattened, then any with required arguments, then any
 * other. Required arguments only make the call say more; an action whose
 * arguments are all optional still has its forced call and returned
 * arguments checked. Only an action with an input schema is chosen, because
 * the arguments are checked against it, so framework tools such as
 * tool-search never are.
 */
function forcedTool(tools: Tool[], actions: Record<string, ActionEntry>) {
  const candidates = tools.filter((tool) => {
    const action = actions[tool.name];
    return (
      action !== undefined &&
      (isStandardSchema(action.schema) || action.tool.parameters !== undefined)
    );
  });
  const withRequired = candidates.filter(
    (tool) =>
      Array.isArray(tool.inputSchema.required) &&
      tool.inputSchema.required.length > 0,
  );
  return (
    withRequired.find((tool) => isComposedRoot(actions[tool.name]!)) ??
    withRequired[0] ??
    candidates[0]
  );
}

interface CallResult {
  /** The error's `code`, else the HTTP status; 0 when no response came back. */
  status: number;
  ok: boolean;
  /** Whether the provider refused the request; see `isRefusal`. */
  refused: boolean;
  error?: string;
  toolCall?: { name: string; arguments: string };
}

/**
 * Whether an error is the provider refusing the request, the only failure
 * that says something about the schemas. OpenRouter passes a refusal on as a
 * 400, but reports other errors such as `context_length_exceeded` as a 400
 * too, so its `error_type`, when it sends one, decides.
 */
function isRefusal(status: number, errorType: unknown): boolean {
  return errorType === undefined
    ? status === 400
    : errorType === "invalid_request";
}

type Choice = { kind: "none" } | { kind: "forced" | "requested"; tool: Tool };

async function callProvider(
  key: string,
  provider: Provider,
  tools: Tool[],
  choice: Choice,
): Promise<CallResult> {
  try {
    return await postToProvider(key, provider, tools, choice);
  } catch (error) {
    return {
      ok: false,
      status: 0,
      refused: false,
      error: `request failed before a provider answered: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function postToProvider(
  key: string,
  provider: Provider,
  tools: Tool[],
  choice: Choice,
): Promise<CallResult> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      provider: { only: [provider.only], allow_fallbacks: false },
      messages: [
        {
          role: "user",
          content:
            choice.kind === "none"
              ? "Reply with the single word ok."
              : `Call the ${choice.tool.name} tool once with plausible example arguments.`,
        },
      ],
      tools: tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description ?? "",
          parameters: tool.inputSchema,
        },
      })),
      tool_choice:
        choice.kind === "forced"
          ? { type: "function", function: { name: choice.tool.name } }
          : choice.kind === "requested"
            ? "auto"
            : "none",
      max_tokens: choice.kind === "none" ? 16 : 4000,
    }),
  });
  const text = await response.text();
  let body: {
    error?: {
      code?: unknown;
      message?: string;
      metadata?: { error_type?: unknown };
    };
    choices?: {
      message?: {
        tool_calls?: { function: { name: string; arguments: string } }[];
      };
    }[];
  };
  try {
    body = JSON.parse(text);
  } catch (error) {
    // A refusal is OpenRouter's JSON error; anything else is a proxy or an
    // outage page.
    return {
      ok: false,
      status: response.status,
      refused: false,
      error: `response is not JSON (${error instanceof Error ? error.message : String(error)}): ${text.slice(0, 600)}`,
    };
  }
  if (!response.ok || body.error) {
    // An error raised once generation started comes back as a 200, with the
    // real status only in `error.code`.
    const status =
      typeof body.error?.code === "number" ? body.error.code : response.status;
    return {
      ok: false,
      status,
      refused: isRefusal(status, body.error?.metadata?.error_type),
      error: JSON.stringify(body.error ?? body).slice(0, 600),
    };
  }
  return {
    ok: true,
    status: response.status,
    refused: false,
    toolCall: body.choices?.[0]?.message?.tool_calls?.[0]?.function,
  };
}

const ajv = new Ajv2020({ strict: false, validateFormats: false });

function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  return (
    typeof value === "object" &&
    value !== null &&
    "~standard" in value &&
    typeof (value as StandardSchemaV1)["~standard"]?.validate === "function"
  );
}

interface ArgumentCheck {
  /** Whether the action's own schema, the one its handler runs, accepts them. */
  valid: boolean;
  /** Whether the advertised copy accepts them; it must whenever `valid` is. */
  advertisedValid?: boolean;
  errors?: string;
}

async function checkArguments(
  tool: Tool,
  action: ActionEntry,
  raw: string | undefined,
): Promise<ArgumentCheck> {
  if (raw === undefined)
    return { valid: false, errors: "no tool call returned" };
  let args: unknown;
  try {
    args = JSON.parse(raw || "{}");
  } catch {
    return { valid: false, errors: "arguments are not JSON" };
  }
  const advertised = ajv.compile(tool.inputSchema);
  const advertisedValid = advertised(args);
  if (isStandardSchema(action.schema)) {
    try {
      await validateActionArgs(action.schema, args, action.tool?.parameters);
      return { valid: true, advertisedValid };
    } catch (error) {
      return {
        valid: false,
        advertisedValid,
        errors: (error instanceof Error ? error.message : String(error)).slice(
          0,
          400,
        ),
      };
    }
  }
  if (!action.tool?.parameters) return { valid: true, advertisedValid };
  const declared = ajv.compile(action.tool.parameters);
  const valid = declared(args);
  return {
    valid,
    advertisedValid,
    errors: valid ? undefined : ajv.errorsText(declared.errors).slice(0, 400),
  };
}

function worst(outcomes: Outcome[]): Outcome {
  return (
    OUTCOME_ORDER.find((outcome) => outcomes.includes(outcome)) ?? "accepted"
  );
}

interface SmokeRun {
  results: CheckRecord[];
  couldNotRun: string[];
  /** Modes asked for that an app picked by default does not advertise. */
  skipped: string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs the diagnostic and returns its exit code: 1 when any check failed,
 * otherwise 2 when anything asked for went unchecked, and 0 only when every
 * check ran and was accepted.
 */
export async function runProviderSmoke(
  argv: string[],
  env: SmokeEnvironment,
): Promise<0 | 1 | 2> {
  const runDate = new Date().toISOString();
  const run: SmokeRun = { results: [], couldNotRun: [], skipped: [] };
  try {
    await runChecks(parseFlags(argv), env, run);
  } catch (error) {
    // The checks made before the run stopped still decide a failure.
    run.couldNotRun.push(`the run stopped: ${errorMessage(error)}`);
  }
  return report(run, env, runDate);
}

async function runChecks(flags: Flags, env: SmokeEnvironment, run: SmokeRun) {
  const key = env.key ?? "";
  if (!flags.dryRun && !key) {
    run.couldNotRun.push(
      "OPENROUTER_API_KEY is not set; set it, or pass --dry-run",
    );
    return;
  }
  let selected = 0;
  const work: {
    app: string;
    mode: McpCatalogMode;
    tools: Tool[];
    actions: Record<string, ActionEntry>;
    force: Tool | undefined;
  }[] = [];

  const known = env.templateApps();
  for (const app of flags.apps ?? []) {
    if (!known.includes(app)) {
      run.couldNotRun.push(`"${app}" is not a template app with actions`);
    }
  }
  for (const app of (flags.apps ?? known).filter((app) =>
    known.includes(app),
  )) {
    let template: TemplateCatalogs;
    try {
      template = await env.loadCatalogs(app, flags.modes);
    } catch (error) {
      run.couldNotRun.push(
        `${app}'s catalogs did not load: ${errorMessage(error)}`,
      );
      continue;
    }
    const { modes, catalogs, actions } = template;
    const unserved = (mode: string) => {
      const reason = `${app} has no ${mode} catalog; it advertises ${modes.join(", ") || "none"}`;
      // Every template is in the default list, so only a named app must
      // serve every mode asked for.
      if (flags.apps) run.couldNotRun.push(reason);
      else run.skipped.push(reason);
    };
    const loaded = catalogs.map((catalog) => catalog.mode);
    if (!flags.modes && modes.length === 0) unserved("MCP");
    for (const mode of flags.modes ?? modes) {
      if (loaded.includes(mode)) continue;
      if (modes.includes(mode)) {
        run.couldNotRun.push(
          `${app} advertises a ${mode} catalog, but it did not load`,
        );
      } else unserved(mode);
    }
    for (const { mode, tools } of catalogs) {
      selected++;
      if (tools.length === 0) {
        run.couldNotRun.push(`${app} ${mode} lists no tools`);
        continue;
      }
      const force = forcedTool(tools, actions);
      if (!force) {
        run.couldNotRun.push(
          `${app} ${mode} has no forced-call candidate, an app action with an input schema, so no call's arguments would be checked`,
        );
      }
      work.push({ app, mode, tools, actions, force });
    }
  }

  // A selection that cannot be checked in full exits 2 whatever the
  // providers answer, so nothing is sent for any of it.
  const requests = flags.dryRun || run.couldNotRun.length === 0 ? work : [];
  for (const { app, mode, tools, actions, force } of requests) {
    const slices = chunks(tools, CHUNK_SIZE);
    if (flags.dryRun) {
      mkdirSync(path.join(env.outDir, "catalogs"), { recursive: true });
      const file = path.join(env.outDir, "catalogs", `${app}-${mode}.json`);
      writeFileSync(file, JSON.stringify(tools, null, 2));
      env.log(
        `${app} ${mode}: ${tools.length} tools in ${slices.length} slice(s), would force ${force?.name ?? "nothing"}; wrote ${file}`,
      );
      continue;
    }
    const forcedSlice = force
      ? slices.findIndex((slice) => slice.includes(force))
      : -1;

    const checkProvider = async (provider: Provider): Promise<CheckRecord> => {
      const record: Record<string, unknown> = {
        app,
        mode,
        provider: provider.id,
        model: provider.model,
        tools: tools.length,
        slices: slices.length,
        forced: force?.name,
      };
      const outcomes: Outcome[] = [];
      const notes: string[] = [];
      for (const [index, slice] of slices.entries()) {
        if (!force || index !== forcedSlice) {
          const result = await callProvider(key, provider, slice, {
            kind: "none",
          });
          if (!result.ok) {
            outcomes.push(result.refused ? "rejected" : "unchecked");
            notes.push(`slice ${index}: ${result.status} ${result.error}`);
          }
          continue;
        }
        let result = await callProvider(key, provider, slice, {
          kind: "forced",
          tool: force,
        });
        let retriedOnAuto = false;
        if (result.refused) {
          outcomes.push("forced-rejected");
          notes.push(`forced ${force.name}: ${result.status} ${result.error}`);
          result = await callProvider(key, provider, slice, {
            kind: "requested",
            tool: force,
          });
          retriedOnAuto = true;
          record.retriedOnAuto = true;
        }
        if (!result.ok) {
          outcomes.push(result.refused ? "rejected" : "unchecked");
          notes.push(`slice ${index}: ${result.status} ${result.error}`);
          continue;
        }
        // On auto a model may call a lookup tool first; its arguments are
        // checked against the action it actually called. A forced request
        // answered with another tool ignored `tool_choice`, and the forced
        // tool's arguments went unchecked.
        const calledName = result.toolCall?.name;
        const called = slice.find((tool) => tool.name === calledName);
        const action = called ? actions[called.name] : undefined;
        record.calledTool = calledName;
        const check: ArgumentCheck =
          !retriedOnAuto &&
          calledName !== undefined &&
          calledName !== force.name
            ? {
                valid: false,
                errors: `forced ${force.name}, but ${calledName} was called`,
              }
            : called && action
              ? await checkArguments(called, action, result.toolCall?.arguments)
              : {
                  valid: false,
                  errors: called
                    ? `${called.name} is not an app action`
                    : "no tool from the slice was called",
                };
        record.arguments = check;
        if (!check.valid) outcomes.push("invalid-arguments");
        if (check.valid && check.advertisedValid === false) {
          outcomes.push("narrowed");
        }
      }
      return {
        ...record,
        outcome: worst(outcomes),
        uncheckedRequests: outcomes.filter((outcome) => outcome === "unchecked")
          .length,
        ...(notes.length > 0 ? { notes } : {}),
      };
    };

    for (const record of await Promise.all(PROVIDERS.map(checkProvider))) {
      const safe = redact(record, [key]);
      run.results.push(safe);
      const args = safe.arguments as ArgumentCheck | undefined;
      env.log(
        `${app} ${mode} ${safe.provider}: ${safe.outcome} (${tools.length} tools` +
          (force
            ? `; forced ${force.name}${safe.retriedOnAuto ? ", retried on auto" : ""}, called ${safe.calledTool ?? "nothing"}${args && !args.valid ? `: ${args.errors}` : ""}`
            : "") +
          ")",
      );
      for (const note of (safe.notes as string[] | undefined) ?? []) {
        env.log(`  ${note}`);
      }
    }
  }

  if (selected === 0) run.couldNotRun.push("no catalog matched the selection");
  else if (flags.dryRun) {
    run.couldNotRun.push(
      "--dry-run sends no request, so every catalog is unchecked",
    );
  } else if (run.results.length === 0) {
    run.couldNotRun.push("no provider check ran");
  }
}

function report(
  run: SmokeRun,
  env: SmokeEnvironment,
  runDate: string,
): 0 | 1 | 2 {
  const { results } = run;
  const tally = Object.fromEntries(
    OUTCOME_ORDER.map((outcome) => [outcome, 0]),
  ) as Record<Outcome, number>;
  for (const result of results) tally[result.outcome]++;
  const failed = results.length - tally.accepted - tally.unchecked;
  const incomplete = results.filter(
    (result) => result.uncheckedRequests > 0,
  ).length;
  const couldNotRun = redact(
    incomplete > 0
      ? [
          ...run.couldNotRun,
          `${incomplete} check(s) sent a request that failed for a reason other than its schemas`,
        ]
      : run.couldNotRun,
    [env.key ?? ""],
  );
  const { skipped } = run;
  for (const reason of skipped) env.log(`Skipped: ${reason}`);
  for (const reason of couldNotRun) env.log(`Could not run: ${reason}`);

  if (results.length > 0) {
    mkdirSync(env.outDir, { recursive: true });
    const outFile = path.join(
      env.outDir,
      `${runDate.replace(/[:.]/g, "-")}.json`,
    );
    writeFileSync(
      outFile,
      JSON.stringify(
        { runDate, providers: PROVIDERS, tally, couldNotRun, skipped, results },
        null,
        2,
      ),
    );
    env.log(
      `\n${results.length} checks: ${OUTCOME_ORDER.map((outcome) => `${tally[outcome]} ${outcome}`).join(", ")}. Results: ${outFile}`,
    );
  }
  const exitCode = failed > 0 ? 1 : couldNotRun.length > 0 ? 2 : 0;
  env.log(
    `${["Passed", "Failed", "Could not run"][exitCode]} (exit ${exitCode}): ${failed} check(s) failed, ${couldNotRun.length} could-not-run reason(s), ${skipped.length} skipped mode(s).`,
  );
  return exitCode;
}

/**
 * Whether `argv1`, the script node was asked to run, is the module at
 * `moduleUrl`. Node resolves symlinks before it loads the module, so a run
 * through a linked path only matches once both sides are resolved.
 */
export function isEntryPoint(
  moduleUrl: string,
  argv1: string | undefined,
): boolean {
  if (!argv1 || !existsSync(argv1)) return false;
  return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argv1);
}

// Only a direct run executes; the spec imports `runProviderSmoke`.
if (isEntryPoint(import.meta.url, process.argv[1])) {
  process.exitCode = await runProviderSmoke(process.argv.slice(2), {
    key: process.env.OPENROUTER_API_KEY,
    outDir: path.join(repoRoot, ".tmp/mcp-provider-smoke"),
    templateApps,
    loadCatalogs,
    log: (line) => console.log(line),
  });
}
