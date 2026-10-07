#!/usr/bin/env tsx
/**
 * Live check that real model providers accept every MCP catalog the template
 * apps advertise. Local only, never in CI: it spends OpenRouter credits.
 *
 *   OPENROUTER_API_KEY=... pnpm exec tsx packages/core/scripts/mcp-provider-smoke.ts \
 *     [--apps content,design] [--modes default,full] [--dry-run]
 *
 * For each app, catalog mode and provider it sends the catalog's tools in a
 * tools-only request. Providers cap tools per request, so a catalog larger
 * than CHUNK_SIZE goes out in slices; every slice must be accepted. One slice
 * per catalog forces a call to a tool with required arguments (falling back to
 * asking for it on auto when forced mode refuses the schema; see `Choice`),
 * and the returned arguments are validated against that tool's advertised
 * schema. Results and pinned model ids land in `.tmp/mcp-provider-smoke/`.
 *
 * The deterministic counterpart is each template's
 * `server/mcp-provider-schemas.spec.ts`, which checks the same catalogs against
 * pinned provider rules without a network.
 */
import { mkdirSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import { createServer } from "vite";

import {
  conformanceMcpConfig,
  listMcpCatalogTools,
  loadTemplateMcpActions,
  type McpCatalogMode,
  type McpDirectoryProfileFixture,
} from "../src/mcp/provider-schema-conformance.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const CHUNK_SIZE = 128;
const MODES: McpCatalogMode[] = [
  "default",
  "full",
  "app",
  "oauth-read",
  "directory",
];
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

type Tool = Awaited<ReturnType<typeof listMcpCatalogTools>>[number];

interface Flags {
  apps?: string[];
  modes: McpCatalogMode[];
  dryRun: boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { modes: MODES, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--apps") flags.apps = argv[++i]?.split(",");
    else if (arg === "--modes") {
      flags.modes = (argv[++i]?.split(",") ?? []) as McpCatalogMode[];
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return flags;
}

const repoRoot = path.resolve(import.meta.dirname, "../../..");

function templateApps(): string[] {
  const templates = path.join(repoRoot, "templates");
  return readdirSync(templates).filter((app) =>
    existsSync(path.join(templates, app, "actions")),
  );
}

async function loadCatalogs(app: string, modes: McpCatalogMode[]) {
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
    const actions = await loadTemplateMcpActions(root, (file) =>
      vite.ssrLoadModule(file),
    );
    const config = conformanceMcpConfig(app, actions);
    const profilePath = path.join(
      root,
      "server/lib/chatgpt-directory-tools.ts",
    );
    const profile = existsSync(profilePath)
      ? (
          (await vite.ssrLoadModule(profilePath)) as {
            CHATGPT_DIRECTORY_PROFILE: McpDirectoryProfileFixture;
          }
        ).CHATGPT_DIRECTORY_PROFILE
      : undefined;
    const composedRoots = new Set(
      Object.entries(actions)
        .filter(([, action]) => {
          const parameters = action.tool?.parameters ?? {};
          return ["anyOf", "oneOf", "allOf"].some((key) => key in parameters);
        })
        .map(([name]) => name),
    );
    const catalogs: { mode: McpCatalogMode; tools: Tool[] }[] = [];
    for (const mode of modes) {
      if (mode === "directory" && !profile) continue;
      catalogs.push({
        mode,
        tools: await listMcpCatalogTools(config, mode, profile),
      });
    }
    return { catalogs, composedRoots };
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

/**
 * The tool to force a call to: one whose composed root was flattened when the
 * catalog has one, otherwise the first tool with required arguments.
 */
function forcedTool(tools: Tool[], composedRoots: Set<string>) {
  const required = (tool: Tool) =>
    Array.isArray(tool.inputSchema.required) &&
    tool.inputSchema.required.length > 0;
  return (
    tools.find((tool) => composedRoots.has(tool.name) && required(tool)) ??
    tools.find(required)
  );
}

interface CallResult {
  ok: boolean;
  status: number;
  error?: string;
  toolCall?: { name: string; arguments: string };
}

/**
 * `forced` names the tool in `tool_choice`. `requested` leaves `tool_choice` on
 * auto and asks for the call in the prompt: Gemini's forced mode compiles the
 * schema into its constrained decoder and rejects schemas over an
 * undocumented size budget (for example `maxItems: 1000`) that it accepts in
 * auto mode, which is how hosts send tools.
 */
type Choice = { kind: "none" } | { kind: "forced" | "requested"; tool: Tool };

async function callProvider(
  key: string,
  provider: (typeof PROVIDERS)[number],
  tools: Tool[],
  choice: Choice,
): Promise<CallResult> {
  try {
    return await postToProvider(key, provider, tools, choice);
  } catch (error) {
    // A transport failure says nothing about the schemas; report it as such.
    return {
      ok: false,
      status: 0,
      error: `request failed before a provider answered: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function postToProvider(
  key: string,
  provider: (typeof PROVIDERS)[number],
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

function validateArguments(tool: Tool, raw: string | undefined) {
  if (raw === undefined)
    return { valid: false, errors: "no tool call returned" };
  let args: unknown;
  try {
    args = JSON.parse(raw || "{}");
  } catch {
    return { valid: false, errors: "arguments are not JSON" };
  }
  const validate = ajv.compile(tool.inputSchema);
  const valid = validate(args);
  return {
    valid,
    errors: valid ? undefined : ajv.errorsText(validate.errors).slice(0, 400),
  };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const key = process.env.OPENROUTER_API_KEY;
  if (!flags.dryRun && !key) {
    throw new Error("Set OPENROUTER_API_KEY, or pass --dry-run.");
  }
  const runDate = new Date().toISOString();
  const outDir = path.join(repoRoot, ".tmp/mcp-provider-smoke");
  const results: Record<string, unknown>[] = [];
  let failures = 0;

  for (const app of flags.apps ?? templateApps()) {
    const { catalogs, composedRoots } = await loadCatalogs(app, flags.modes);
    for (const { mode, tools } of catalogs) {
      const force = forcedTool(tools, composedRoots);
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
      const checkProvider = async (provider: (typeof PROVIDERS)[number]) => {
        const outcome: Record<string, unknown> = {
          app,
          mode,
          provider: provider.id,
          model: provider.model,
          tools: tools.length,
          slices: slices.length,
          forced: force?.name,
        };
        const rejected: string[] = [];
        for (const [index, slice] of slices.entries()) {
          let result: CallResult;
          if (force && index === forcedSlice) {
            const choice = { kind: "forced", tool: force } as const;
            result = await callProvider(key!, provider, slice, choice);
            outcome.callMode = "forced";
            if (!result.ok) {
              outcome.forcedRejection = `${result.status} ${result.error}`;
              outcome.callMode = "requested";
              result = await callProvider(key!, provider, slice, {
                kind: "requested",
                tool: force,
              });
            }
            if (result.ok) {
              // On auto a model may reasonably call a lookup tool first; its
              // arguments are checked against the tool it actually called.
              const called = slice.find(
                (tool) => tool.name === result.toolCall?.name,
              );
              outcome.calledTool = result.toolCall?.name;
              outcome.arguments = called
                ? validateArguments(called, result.toolCall?.arguments)
                : { valid: false, errors: "no tool from the slice was called" };
            }
          } else {
            result = await callProvider(key!, provider, slice, {
              kind: "none",
            });
          }
          if (!result.ok) {
            rejected.push(`slice ${index}: ${result.status} ${result.error}`);
          }
        }
        outcome.accepted = rejected.length === 0;
        if (rejected.length > 0) outcome.rejected = rejected;
        return { outcome, rejected };
      };
      for (const { outcome, rejected } of await Promise.all(
        PROVIDERS.map(checkProvider),
      )) {
        const argumentsValid =
          !force || (outcome.arguments as { valid?: boolean })?.valid === true;
        if (!outcome.accepted || !argumentsValid) failures++;
        results.push(outcome);
        console.log(
          `${app} ${mode} ${outcome.provider}: ${outcome.accepted ? "accepted" : "REJECTED"} ${tools.length} tools` +
            (force
              ? `; ${outcome.callMode} ${force.name}, called ${outcome.calledTool ?? "nothing"}: ${argumentsValid ? "valid arguments" : `INVALID ${JSON.stringify(outcome.arguments)}`}`
              : ""),
        );
        if (outcome.forcedRejection) {
          console.log(`  forced call rejected: ${outcome.forcedRejection}`);
        }
        for (const line of rejected) console.log(`  ${line}`);
      }
    }
  }

  if (flags.dryRun) return;
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${runDate.replace(/[:.]/g, "-")}.json`);
  writeFileSync(
    outFile,
    JSON.stringify(
      {
        runDate,
        providers: PROVIDERS,
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    `\n${results.length} checks, ${failures} failed. Results: ${outFile}`,
  );
  if (failures > 0) process.exitCode = 1;
}

await main();
