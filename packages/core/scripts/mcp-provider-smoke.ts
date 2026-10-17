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
 * an app action with required arguments, and the returned arguments are
 * validated against that action's own input schema, the one its handler
 * enforces. Each check ends in one outcome:
 *
 * - `accepted`: every slice and the forced call were accepted, and the
 *   arguments pass the action's schema.
 * - `rejected`: the provider refused a slice of the catalog.
 * - `forced-rejected`: the catalog was accepted, but naming the tool in
 *   `tool_choice` was refused. Gemini documents that forced mode "may reject
 *   very large or deeply nested schemas". The call is retried on auto so the
 *   arguments are still checked, but the outcome stays forced-rejected.
 * - `narrowed`: the action accepts the arguments but the advertised schema
 *   does not, so a host that validates against it would refuse a good call.
 * - `invalid-arguments`: no tool call came back, or its arguments fail the
 *   action's schema.
 * - `unreachable`: the request failed before a provider answered; this says
 *   nothing about the schemas.
 *
 * Only `accepted` counts as passing. Results and pinned model ids land in
 * `.tmp/mcp-provider-smoke/`, with credential-shaped strings redacted.
 *
 * The deterministic counterpart is each template's
 * `server/mcp-provider-schemas.spec.ts`, which checks the same catalogs against
 * pinned provider rules without a network.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

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
const CHUNK_SIZE = 128;
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
  | "unreachable";

// Most severe first: a check reports the first of these that applies.
const OUTCOME_ORDER: Outcome[] = [
  "rejected",
  "unreachable",
  "forced-rejected",
  "narrowed",
  "invalid-arguments",
  "accepted",
];

interface Flags {
  apps?: string[];
  modes?: McpCatalogMode[];
  dryRun: boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--apps") flags.apps = argv[++i]?.split(",");
    else if (arg === "--modes") {
      const modes = argv[++i]?.split(",") ?? [];
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

async function loadCatalogs(app: string, only?: McpCatalogMode[]) {
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
    return { catalogs, actions: template.actions };
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
 * The app action to force a call to: one whose composed root was flattened
 * when the catalog has one, otherwise the first with required arguments.
 * Framework tools such as tool-search have no action schema to check
 * arguments against, so they are never chosen.
 */
function forcedTool(tools: Tool[], actions: Record<string, ActionEntry>) {
  const candidates = tools.filter(
    (tool) =>
      actions[tool.name] &&
      Array.isArray(tool.inputSchema.required) &&
      tool.inputSchema.required.length > 0,
  );
  return (
    candidates.find((tool) => isComposedRoot(actions[tool.name]!)) ??
    candidates[0]
  );
}

interface CallResult {
  /** 0 when the request failed before a provider answered. */
  status: number;
  ok: boolean;
  error?: string;
  toolCall?: { name: string; arguments: string };
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
    error?: { message?: string; metadata?: unknown };
    choices?: {
      message?: {
        tool_calls?: { function: { name: string; arguments: string } }[];
      };
    }[];
  };
  try {
    body = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      status: response.status,
      error: `response is not JSON (${error instanceof Error ? error.message : String(error)}): ${text.slice(0, 600)}`,
    };
  }
  if (!response.ok || body.error) {
    return {
      ok: false,
      status: response.status,
      error: JSON.stringify(body.error ?? body).slice(0, 600),
    };
  }
  return {
    ok: true,
    status: response.status,
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

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const key = process.env.OPENROUTER_API_KEY ?? "";
  if (!flags.dryRun && !key) {
    throw new Error("Set OPENROUTER_API_KEY, or pass --dry-run.");
  }
  const runDate = new Date().toISOString();
  const outDir = path.join(repoRoot, ".tmp/mcp-provider-smoke");
  const results: Record<string, unknown>[] = [];
  const tally = Object.fromEntries(
    OUTCOME_ORDER.map((outcome) => [outcome, 0]),
  ) as Record<Outcome, number>;

  for (const app of flags.apps ?? templateApps()) {
    const { catalogs, actions } = await loadCatalogs(app, flags.modes);
    for (const { mode, tools } of catalogs) {
      const force = forcedTool(tools, actions);
      const slices = chunks(tools, CHUNK_SIZE);
      if (flags.dryRun) {
        mkdirSync(path.join(outDir, "catalogs"), { recursive: true });
        const file = path.join(outDir, "catalogs", `${app}-${mode}.json`);
        writeFileSync(file, JSON.stringify(tools, null, 2));
        console.log(
          `${app} ${mode}: ${tools.length} tools in ${slices.length} slice(s), would force ${force?.name ?? "nothing"}; wrote ${file}`,
        );
        continue;
      }
      const forcedSlice = force
        ? slices.findIndex((slice) => slice.includes(force))
        : -1;

      const checkProvider = async (provider: Provider) => {
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
              outcomes.push(result.status === 0 ? "unreachable" : "rejected");
              notes.push(`slice ${index}: ${result.status} ${result.error}`);
            }
            continue;
          }
          let result = await callProvider(key, provider, slice, {
            kind: "forced",
            tool: force,
          });
          if (!result.ok && result.status !== 0) {
            outcomes.push("forced-rejected");
            notes.push(
              `forced ${force.name}: ${result.status} ${result.error}`,
            );
            result = await callProvider(key, provider, slice, {
              kind: "requested",
              tool: force,
            });
            record.retriedOnAuto = true;
          }
          if (!result.ok) {
            outcomes.push(result.status === 0 ? "unreachable" : "rejected");
            notes.push(`slice ${index}: ${result.status} ${result.error}`);
            continue;
          }
          // On auto a model may call a lookup tool first; its arguments are
          // checked against the action it actually called.
          const called = slice.find(
            (tool) => tool.name === result.toolCall?.name,
          );
          const action = called ? actions[called.name] : undefined;
          record.calledTool = result.toolCall?.name;
          const check: ArgumentCheck =
            called && action
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
        record.outcome = worst(outcomes);
        if (notes.length > 0) record.notes = notes;
        return record;
      };

      for (const record of await Promise.all(PROVIDERS.map(checkProvider))) {
        const outcome = record.outcome as Outcome;
        tally[outcome]++;
        const safe = redact(record, [key]);
        results.push(safe);
        const args = safe.arguments as ArgumentCheck | undefined;
        console.log(
          `${app} ${mode} ${safe.provider}: ${outcome} (${tools.length} tools` +
            (force
              ? `; forced ${force.name}${safe.retriedOnAuto ? ", retried on auto" : ""}, called ${safe.calledTool ?? "nothing"}${args && !args.valid ? `: ${args.errors}` : ""}`
              : "") +
            ")",
        );
        for (const note of (safe.notes as string[] | undefined) ?? []) {
          console.log(`  ${note}`);
        }
      }
    }
  }

  if (flags.dryRun) return;
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${runDate.replace(/[:.]/g, "-")}.json`);
  writeFileSync(
    outFile,
    JSON.stringify({ runDate, providers: PROVIDERS, tally, results }, null, 2),
  );
  console.log(
    `\n${results.length} checks: ${OUTCOME_ORDER.map((outcome) => `${tally[outcome]} ${outcome}`).join(", ")}. Results: ${outFile}`,
  );
  if (results.length !== tally.accepted) process.exitCode = 1;
}

await main();
