import { spawn } from "node:child_process";

import type {
  SubscriptionStatus,
  SubscriptionTelemetry,
} from "../../shared/subscription-status.js";

export const DEFAULT_CLAUDE_AUTH_STATUS_TIMEOUT_MS = 10_000;

const CLAUDE_AUTH_STATUS_ARGS = ["auth", "status", "--json"] as const;
const MAX_STATUS_OUTPUT_CHARS = 64 * 1024;

export interface ClaudeProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export interface ClaudeProcessExecutorOptions {
  timeoutMs: number;
}

export type ClaudeProcessExecutor = (
  command: string,
  args: readonly string[],
  options: ClaudeProcessExecutorOptions,
) => Promise<ClaudeProcessResult>;

export interface ReadClaudeSubscriptionStatusOptions {
  execute?: ClaudeProcessExecutor;
  timeoutMs?: number;
}

export type ClaudeSubscriptionLoginLaunchSpec =
  | {
      ok: true;
      command: string;
      args: string[];
    }
  | {
      ok: false;
      error: string;
    };

type CommandAvailable = (command: string) => boolean;

const LINUX_TERMINAL_CANDIDATES = [
  {
    command: "x-terminal-emulator",
    args: ["-e", "claude", "auth", "login", "--claudeai"],
  },
  {
    command: "gnome-terminal",
    args: ["--", "claude", "auth", "login", "--claudeai"],
  },
  {
    command: "konsole",
    args: ["-e", "claude", "auth", "login", "--claudeai"],
  },
  {
    command: "xfce4-terminal",
    args: ["--command", "claude auth login --claudeai"],
  },
  {
    command: "xterm",
    args: ["-e", "claude", "auth", "login", "--claudeai"],
  },
] as const;

export async function readClaudeSubscriptionStatus(
  options: ReadClaudeSubscriptionStatusOptions = {},
): Promise<SubscriptionStatus> {
  const result: ClaudeProcessResult = await (
    options.execute ?? executeClaudeProcess
  )("claude", CLAUDE_AUTH_STATUS_ARGS, {
    timeoutMs: options.timeoutMs ?? DEFAULT_CLAUDE_AUTH_STATUS_TIMEOUT_MS,
  }).catch(
    (): ClaudeProcessResult => ({
      exitCode: null,
      stdout: "",
      stderr: "",
    }),
  );
  if (result.timedOut || result.exitCode !== 0) return unavailableStatus();

  const raw = parseAuthStatus(result.stdout);
  if (!raw || typeof raw.loggedIn !== "boolean") return unavailableStatus();
  const authMethod = stringValue(raw.authMethod);
  if (!raw.loggedIn) {
    return {
      schemaVersion: 1,
      providerId: "claude",
      connectionState: "needs-sign-in",
      authMethod,
      telemetry: connectionOnlyTelemetry({ account: true, plan: true }),
    };
  }
  const subscription = isClaudeSubscriptionAuthMethod(authMethod);
  return {
    schemaVersion: 1,
    providerId: "claude",
    connectionState: "connected",
    authMethod,
    ...(stringValue(raw.email)
      ? { account: { email: stringValue(raw.email) } }
      : {}),
    ...(subscription && stringValue(raw.subscriptionType)
      ? { plan: { type: stringValue(raw.subscriptionType) } }
      : {}),
    ...(!subscription
      ? {
          connectionMessage:
            "Claude Code is authenticated with API or console billing, not a Claude subscription.",
        }
      : {}),
    telemetry: subscription
      ? claudeLiveUsageUnsupportedTelemetry()
      : connectionOnlyTelemetry({ account: true, plan: false }),
  };
}

export function isClaudeSubscriptionStatus(
  status: SubscriptionStatus,
): boolean {
  return (
    status.providerId === "claude" &&
    status.connectionState === "connected" &&
    isClaudeSubscriptionAuthMethod(status.authMethod)
  );
}

export function getClaudeSubscriptionLoginLaunchSpec(
  platform: string,
  commandAvailable: CommandAvailable = () => true,
): ClaudeSubscriptionLoginLaunchSpec {
  if (platform === "darwin") {
    return {
      ok: true,
      command: "/usr/bin/osascript",
      args: [
        "-e",
        'tell application "Terminal" to do script "claude auth login --claudeai"',
        "-e",
        'tell application "Terminal" to activate',
      ],
    };
  }
  if (platform === "win32") {
    return {
      ok: true,
      command: "cmd.exe",
      args: ["/d", "/k", "claude auth login --claudeai"],
    };
  }
  if (platform === "linux") {
    const terminal = LINUX_TERMINAL_CANDIDATES.find((candidate) =>
      commandAvailable(candidate.command),
    );
    if (terminal) {
      return { ok: true, command: terminal.command, args: [...terminal.args] };
    }
    return {
      ok: false,
      error:
        "No supported terminal emulator was found. Install a terminal emulator and try again.",
    };
  }
  return {
    ok: false,
    error: `Opening a terminal is not supported on ${platform}.`,
  };
}

function unavailableStatus(): SubscriptionStatus {
  return {
    schemaVersion: 1,
    providerId: "claude",
    connectionState: "unavailable",
    telemetry: connectionOnlyTelemetry({ account: false, plan: false }),
  };
}

function connectionOnlyTelemetry(
  capabilities: Pick<SubscriptionTelemetry["capabilities"], "account" | "plan">,
): SubscriptionTelemetry {
  return {
    state: "unavailable",
    source: "connection-only",
    capabilities: {
      account: capabilities.account,
      plan: capabilities.plan,
      rateLimits: false,
      modelTierRateLimits: false,
      contextWindow: false,
      credits: false,
      liveUpdates: false,
    },
    meters: [],
  };
}

function claudeLiveUsageUnsupportedTelemetry(): SubscriptionTelemetry {
  return {
    ...connectionOnlyTelemetry({ account: true, plan: true }),
    state: "unsupported",
    error: {
      message:
        "Claude Code does not expose live plan usage to non-interactive sessions.",
    },
  };
}

function isClaudeSubscriptionAuthMethod(
  authMethod: string | undefined,
): boolean {
  return authMethod?.toLowerCase().replaceAll(/[^a-z]/g, "") === "claudeai";
}

function parseAuthStatus(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function executeClaudeProcess(
  command: string,
  args: readonly string[],
  options: ClaudeProcessExecutorOptions,
): Promise<ClaudeProcessResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;
    const finish = (result: ClaudeProcessResult) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(result);
    };
    try {
      const child = spawn(command, args, {
        detached: false,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        finish({ exitCode: null, stdout, stderr, timedOut: true });
      }, options.timeoutMs);
      child.stdout?.on("data", (chunk) => {
        stdout = appendBoundedOutput(stdout, chunk.toString());
      });
      child.stderr?.on("data", (chunk) => {
        stderr = appendBoundedOutput(stderr, chunk.toString());
      });
      child.once("error", () => {
        finish({ exitCode: null, stdout, stderr, timedOut });
      });
      child.once("close", (exitCode) => {
        finish({ exitCode, stdout, stderr, timedOut });
      });
    } catch {
      resolve({ exitCode: null, stdout, stderr });
    }
  });
}

function appendBoundedOutput(current: string, next: string): string {
  if (current.length >= MAX_STATUS_OUTPUT_CHARS) return current;
  return `${current}${next}`.slice(0, MAX_STATUS_OUTPUT_CHARS);
}
