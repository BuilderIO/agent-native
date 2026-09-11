import { invokeAgent } from "../a2a/invoke.js";

export interface ParsedInvokeArgs {
  target?: string;
  prompt?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  contextId?: string;
  selfAppId?: string;
  selfUrl?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  async?: boolean;
  includeInvocationHint?: boolean;
  json: boolean;
  help: boolean;
  errors: string[];
}

export interface InvokeCliIo {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  env?: NodeJS.ProcessEnv;
}

const VALUE_FLAGS = new Set([
  "agent",
  "target",
  "message",
  "prompt",
  "api-key",
  "api-key-env",
  "context-id",
  "self",
  "self-app-id",
  "self-url",
  "timeout-ms",
  "poll-interval-ms",
]);

export function parseInvokeArgs(args: string[]): ParsedInvokeArgs {
  const parsed: ParsedInvokeArgs = {
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
    if (name === "sync") {
      parsed.async = false;
      continue;
    }
    if (name === "async") {
      parsed.async = true;
      continue;
    }
    if (name === "no-hint") {
      parsed.includeInvocationHint = false;
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
      case "agent":
      case "target":
        parsed.target = value;
        break;
      case "message":
      case "prompt":
        parsed.prompt = value;
        break;
      case "api-key":
        parsed.apiKey = value;
        break;
      case "api-key-env":
        parsed.apiKeyEnv = value;
        break;
      case "context-id":
        parsed.contextId = value;
        break;
      case "self":
      case "self-app-id":
        parsed.selfAppId = value;
        break;
      case "self-url":
        parsed.selfUrl = value;
        break;
      case "timeout-ms":
        parsed.timeoutMs = parsePositiveInteger("--timeout-ms", value, parsed);
        break;
      case "poll-interval-ms":
        parsed.pollIntervalMs = parsePositiveInteger(
          "--poll-interval-ms",
          value,
          parsed,
        );
        break;
    }
  }

  if (!parsed.target && positional.length > 0) {
    parsed.target = positional.shift();
  }
  if (!parsed.prompt && positional.length > 0) {
    parsed.prompt = positional.join(" ");
  }

  return parsed;
}

export async function runInvoke(
  args: string[],
  io: InvokeCliIo = {},
): Promise<number> {
  const stdout = io.stdout ?? console.log;
  const stderr = io.stderr ?? console.error;
  const env = io.env ?? process.env;
  const parsed = parseInvokeArgs(args);

  if (parsed.help) {
    stdout(formatInvokeUsage());
    return 0;
  }
  if (!parsed.target) {
    parsed.errors.push("Missing <app-or-url>");
  }
  if (!parsed.prompt) {
    parsed.errors.push('Missing "prompt"');
  }
  if (parsed.errors.length > 0) {
    stderr(parsed.errors.join("\n"));
    stderr("");
    stderr(formatInvokeUsage());
    return 1;
  }

  const apiKey = resolveApiKey(parsed, env);
  if (apiKey.error) {
    stderr(apiKey.error);
    return 1;
  }

  try {
    const result = await invokeAgent({
      target: parsed.target!,
      prompt: parsed.prompt!,
      apiKey: parsed.apiKey ?? apiKey.value,
      contextId: parsed.contextId,
      selfAppId: parsed.selfAppId ?? inferSelfAppId(env),
      selfUrl: parsed.selfUrl ?? env.APP_URL ?? env.BETTER_AUTH_URL,
      async: parsed.async,
      timeoutMs: parsed.timeoutMs,
      pollIntervalMs: parsed.pollIntervalMs,
      includeInvocationHint: parsed.includeInvocationHint,
    });

    if (parsed.json) {
      stdout(
        JSON.stringify(
          {
            target: result.target,
            responseText: result.responseText,
          },
          null,
          2,
        ),
      );
    } else {
      stdout(result.responseText);
    }
    return 0;
  } catch (err) {
    stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

export function formatInvokeUsage(): string {
  return [
    'Usage: agent-native invoke <app-or-url> "prompt" [options]',
    "",
    "Calls another agent-native app over A2A by id, name, or URL.",
    "",
    "Options:",
    "  --agent <id|name|url>        Target agent (alias for positional target)",
    "  --message <text>             Prompt (alias for positional prompt)",
    "  --api-key-env <name>         Read bearer token from an env var",
    "  --api-key <token>            Bearer token value",
    "  --context-id <id>            A2A context id",
    "  --self-app-id <id>           Current app id for self-call prevention",
    "  --self-url <url>             Current app URL for self-call prevention",
    "  --timeout-ms <n>             Async polling timeout",
    "  --poll-interval-ms <n>       Async polling interval",
    "  --sync                       Use one blocking A2A message/send request",
    "  --no-hint                    Send the prompt without the cross-app hint",
    "  --json                       Print target metadata and response as JSON",
  ].join("\n");
}

export function inferSelfAppId(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return (
    normalizeWorkspaceAppId(env.AGENT_NATIVE_WORKSPACE_APP_ID) ??
    normalizeWorkspaceAppId(env.APP_NAME) ??
    normalizeWorkspaceAppId(env.AGENT_APP) ??
    workspaceAppIdFromBasePath(env.APP_BASE_PATH) ??
    workspaceAppIdFromBasePath(env.VITE_APP_BASE_PATH) ??
    undefined
  );
}

function resolveApiKey(
  parsed: Pick<ParsedInvokeArgs, "apiKey" | "apiKeyEnv">,
  env: NodeJS.ProcessEnv,
): { value?: string; error?: string } {
  if (parsed.apiKey) return {};
  if (!parsed.apiKeyEnv) return {};
  const value = env[parsed.apiKeyEnv];
  if (!value) {
    return { error: `Env var ${parsed.apiKeyEnv} is not set` };
  }
  return { value };
}

function parsePositiveInteger(
  flag: string,
  value: string,
  parsed: ParsedInvokeArgs,
): number | undefined {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    parsed.errors.push(`${flag} must be a positive integer`);
    return undefined;
  }
  return n;
}

function normalizeWorkspaceAppId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = trimmed.replace(/^\/+/, "").split("/")[0] ?? "";
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(candidate)) return null;
  return candidate;
}

function workspaceAppIdFromBasePath(value: unknown): string | null {
  return normalizeWorkspaceAppId(value);
}
