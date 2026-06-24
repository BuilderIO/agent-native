import fs from "node:fs";
import path from "node:path";
import { autoDiscoverActions } from "../server/action-discovery.js";
import { createGitHubRepoToolEntries } from "../provider-api/github-repo.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
  runWithRequestContext,
} from "../server/request-context.js";
import { resolveDevUserEmail } from "../scripts/dev-session.js";
import { loadEnv } from "../scripts/utils.js";
import {
  actionsToEngineTools,
  type AgentLoopUsage,
  type ActionEntry,
} from "../agent/production-agent.js";
import { runAgentLoopDirectWithSoftTimeout } from "../agent/run-loop-with-resume.js";
import {
  registerBuiltinEngines,
  resolveEngine,
} from "../agent/engine/index.js";
import { DEFAULT_MODEL } from "../agent/default-model.js";
import type { AgentChatEvent } from "../agent/types.js";
import type { EngineMessage } from "../agent/engine/types.js";
import { captureCliOutput } from "../server/cli-capture.js";

export interface ParsedAgentArgs {
  prompt?: string;
  engine?: string;
  model?: string;
  userEmail?: string;
  orgId?: string;
  softTimeoutMs?: number;
  maxIterations?: number;
  json: boolean;
  help: boolean;
  errors: string[];
}

export interface AgentCliIo {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  env?: NodeJS.ProcessEnv;
}

const VALUE_FLAGS = new Set([
  "message",
  "prompt",
  "engine",
  "model",
  "user",
  "user-email",
  "org",
  "org-id",
  "soft-timeout-ms",
  "max-iterations",
]);

export function parseAgentArgs(args: string[]): ParsedAgentArgs {
  const parsed: ParsedAgentArgs = {
    json: false,
    help: false,
    errors: [],
  };
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const eqIndex = arg.indexOf("=");
    const rawName =
      eqIndex === -1 ? arg.slice("--".length) : arg.slice("--".length, eqIndex);
    const inlineValue = eqIndex === -1 ? undefined : arg.slice(eqIndex + 1);
    const name = rawName.trim();

    if (name === "help" || name === "h") {
      parsed.help = true;
      continue;
    }
    if (name === "json") {
      parsed.json = true;
      continue;
    }
    if (name === "no-soft-timeout") {
      parsed.softTimeoutMs = 0;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) {
      parsed.errors.push(`Unknown option: --${name}`);
      continue;
    }

    const value =
      inlineValue ??
      (args[i + 1] !== undefined && !args[i + 1].startsWith("--")
        ? args[++i]
        : undefined);
    if (value === undefined) {
      parsed.errors.push(`Missing value for --${name}`);
      continue;
    }

    switch (name) {
      case "message":
      case "prompt":
        parsed.prompt = value;
        break;
      case "engine":
        parsed.engine = value;
        break;
      case "model":
        parsed.model = value;
        break;
      case "user":
      case "user-email":
        parsed.userEmail = value;
        break;
      case "org":
      case "org-id":
        parsed.orgId = value;
        break;
      case "soft-timeout-ms":
        parsed.softTimeoutMs = parsePositiveInteger(
          "--soft-timeout-ms",
          value,
          parsed,
        );
        break;
      case "max-iterations":
        parsed.maxIterations = parsePositiveInteger(
          "--max-iterations",
          value,
          parsed,
        );
        break;
    }
  }

  if (!parsed.prompt && positional.length > 0) {
    parsed.prompt = positional.join(" ");
  }

  return parsed;
}

export async function runAgent(
  args: string[],
  io: AgentCliIo = {},
): Promise<number> {
  loadEnv();
  registerBuiltinEngines();

  const stdout = io.stdout ?? console.log;
  const stderr = io.stderr ?? console.error;
  const env = io.env ?? process.env;
  const parsed = parseAgentArgs(args);

  if (parsed.help) {
    stdout(formatAgentUsage());
    return 0;
  }
  if (!parsed.prompt?.trim()) {
    parsed.errors.push('Missing "prompt"');
  }
  if (parsed.errors.length > 0) {
    stderr(parsed.errors.join("\n"));
    stderr("");
    stderr(formatAgentUsage());
    return 1;
  }

  const ownerEmail =
    parsed.userEmail ?? env.AGENT_USER_EMAIL ?? (await resolveDevUserEmail());
  const orgId = parsed.orgId ?? env.AGENT_ORG_ID ?? undefined;

  try {
    const result = await runWithRequestContext(
      { userEmail: ownerEmail, orgId },
      () => runLocalAgentLoop(parsed),
    );
    if (parsed.json) {
      stdout(JSON.stringify(result, null, 2));
    } else {
      stdout(result.responseText.trimEnd());
      if (result.responseText && !result.responseText.endsWith("\n")) {
        stdout("");
      }
    }
    return 0;
  } catch (err) {
    stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

async function runLocalAgentLoop(parsed: ParsedAgentArgs): Promise<{
  responseText: string;
  usage: AgentLoopUsage;
  events: AgentChatEvent[];
  tools: string[];
}> {
  const localActions = await autoDiscoverActions("auto");
  const builtinActions = await createHeadlessBuiltinActions();
  const repoActions = createGitHubRepoToolEntries({
    appId: process.env.AGENT_NATIVE_APP_ID ?? process.env.APP_ID ?? "app",
  });
  const actions = { ...builtinActions, ...localActions, ...repoActions };
  const tools = actionsToEngineTools(actions);
  if (tools.length === 0) {
    throw new Error(
      "No agent-callable actions were found. Add actions/*.ts with defineAction() first.",
    );
  }

  const engine = await resolveEngine({
    engineOption: parsed.engine,
    model: parsed.model,
  });
  const model = parsed.model ?? engine.defaultModel ?? DEFAULT_MODEL;
  const messages: EngineMessage[] = [
    {
      role: "user",
      content: [{ type: "text", text: parsed.prompt!.trim() }],
    },
  ];
  const events: AgentChatEvent[] = [];
  let responseText = "";
  const controller = new AbortController();
  const ownerEmail = getRequestUserEmail();
  const orgId = getRequestOrgId();

  const usage = await runAgentLoopDirectWithSoftTimeout(
    {
      engine,
      model,
      systemPrompt: buildHeadlessSystemPrompt(tools.map((tool) => tool.name)),
      tools,
      actions,
      messages,
      signal: controller.signal,
      ownerEmail,
      orgId,
      maxIterations: parsed.maxIterations,
      send(event) {
        events.push(event);
        if (event.type === "text") {
          responseText += event.text ?? "";
        }
      },
    },
    parsed.softTimeoutMs,
  );

  return {
    responseText,
    usage,
    events,
    tools: tools.map((tool) => tool.name).sort(),
  };
}

function buildHeadlessSystemPrompt(actionNames: string[]): string {
  const instructions = readLocalInstructions();
  const actionList =
    actionNames.length > 0
      ? `Available local actions: ${actionNames.join(", ")}.`
      : "No local actions were discovered.";
  return [
    "You are the app agent for this Agent-Native project.",
    "Use the registered app actions as your source of truth for doing work.",
    "Use docs-search before implementing or answering advanced Agent Native framework questions; it reads the version-matched docs bundled with @agent-native/core.",
    "Use source-search when examples or implementation details matter; it reads the version-matched core and template source corpus bundled with @agent-native/core.",
    "Use connected GitHub repository tools for repo context when a repository is configured; do not assume a local clone or sandbox exists.",
    "You are running headlessly from the command line, so reply with the final useful result in plain text.",
    actionList,
    instructions ? `Project instructions:\n${instructions}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function cliArgsFromToolArgs(args: Record<string, unknown>): string[] {
  const cliArgs: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue;
    const normalized =
      value != null && typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
    cliArgs.push(`--${key}`, normalized);
  }
  return cliArgs;
}

export async function createHeadlessBuiltinActions(): Promise<
  Record<string, ActionEntry>
> {
  const docsSearch = await import("../scripts/docs/search.js");
  const sourceSearch = await import("../scripts/docs/source-search.js");
  return {
    "docs-search": {
      readOnly: true,
      tool: {
        description:
          "Search and read version-matched Agent Native framework documentation bundled in @agent-native/core, plus bundled AGENTS.md and codebase skills. Use --list to see pages, --query to search, and --slug to read a page.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Search term to find relevant docs, for example actions, automations, a2a, database, sharing, or pure-agent apps.",
            },
            slug: {
              type: "string",
              description:
                "Read a specific doc page by slug, for example actions, agent-native-docs, automations, a2a-protocol, or external-agents.",
            },
            list: {
              type: "string",
              description: 'Set to "true" to list all available doc pages.',
              enum: ["true"],
            },
          },
        },
      },
      run: async (args: Record<string, unknown>): Promise<string> => {
        return captureCliOutput(() =>
          docsSearch.default(cliArgsFromToolArgs(args)),
        );
      },
    },
    "source-search": {
      readOnly: true,
      tool: {
        description:
          "Search and read the packaged Agent Native source corpus under node_modules/@agent-native/core/corpus. Use --list for sections, --query to search core/template source, and --path to read a file.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Search term to find relevant core or template source, for example defineAction, useActionQuery, view-screen, or AgentComposerFrame.",
            },
            path: {
              type: "string",
              description:
                "Read a specific corpus file or list a directory, for example templates/plan/AGENTS.md or core/src/action.ts.",
            },
            list: {
              type: "string",
              description: 'Set to "true" to list corpus sections.',
              enum: ["true"],
            },
          },
        },
      },
      run: async (args: Record<string, unknown>): Promise<string> => {
        return captureCliOutput(() =>
          sourceSearch.default(cliArgsFromToolArgs(args)),
        );
      },
    },
  };
}

function readLocalInstructions(): string {
  const candidates = ["AGENTS.md", "CLAUDE.md", "README.md"];
  const chunks: string[] = [];
  for (const name of candidates) {
    const file = path.resolve(process.cwd(), name);
    try {
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, "utf8").trim();
      if (!content) continue;
      chunks.push(`# ${name}\n${content.slice(0, 12_000)}`);
    } catch {
      // Ignore unreadable local instruction files.
    }
  }
  return chunks.join("\n\n");
}

function parsePositiveInteger(
  flag: string,
  value: string,
  parsed: ParsedAgentArgs,
): number | undefined {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    parsed.errors.push(`${flag} must be a positive integer`);
    return undefined;
  }
  return n;
}

export function formatAgentUsage(): string {
  return [
    'Usage: agent-native agent "prompt" [options]',
    "",
    "Runs the production app-agent loop once against this folder's actions/ directory.",
    "",
    "Options:",
    "  --message <text>            Prompt (alias for positional prompt)",
    "  --engine <name>             Agent engine name (defaults to env/settings)",
    "  --model <name>              Model override",
    "  --user-email <email>        Owner identity for scoped actions",
    "  --org-id <id>               Organization id for scoped credentials",
    "  --soft-timeout-ms <n>       Soft timeout before continuation recovery",
    "  --no-soft-timeout           Disable continuation soft timeout wrapper",
    "  --max-iterations <n>        Maximum tool/LLM loop iterations",
    "  --json                      Print response, events, usage, and tools",
  ].join("\n");
}
