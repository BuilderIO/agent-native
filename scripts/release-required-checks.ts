import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export type RequiredCheckStatus = {
  name: string;
  bucket: string;
};

type RequiredCheckState =
  | { status: "pending"; missing: string[]; pending: string[] }
  | { status: "passed" }
  | { status: "failed"; reason: string };

type WaitForRequiredChecksOptions = {
  readRequiredContexts: () => Promise<string[]>;
  readStatuses: () => Promise<RequiredCheckStatus[]>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  intervalMs?: number;
};

export function requiredContextsFromRules(rules: unknown): string[] {
  if (!Array.isArray(rules)) {
    throw new Error("GitHub returned invalid branch rules for main.");
  }

  const contexts = new Set<string>();
  for (const candidate of rules) {
    if (candidate === null || typeof candidate !== "object") {
      throw new Error("GitHub returned an invalid branch rule for main.");
    }
    const rule = candidate as {
      type?: unknown;
      parameters?: { required_status_checks?: unknown };
    };
    if (rule?.type !== "required_status_checks") continue;
    const requiredChecks = rule.parameters?.required_status_checks;
    if (!Array.isArray(requiredChecks)) {
      throw new Error(
        "GitHub returned an invalid required-check rule for main.",
      );
    }
    for (const candidateCheck of requiredChecks) {
      if (candidateCheck === null || typeof candidateCheck !== "object") {
        throw new Error("GitHub returned an invalid required check for main.");
      }
      const check = candidateCheck as { context?: unknown };
      if (typeof check?.context !== "string" || check.context.trim() === "") {
        throw new Error(
          "GitHub returned a required check without a context name.",
        );
      }
      contexts.add(check.context);
    }
  }

  if (contexts.size === 0) {
    throw new Error(
      "No required status checks are configured for main; refusing release PR merge.",
    );
  }
  return [...contexts].sort();
}

export function evaluateRequiredChecks(
  requiredContexts: string[],
  statuses: RequiredCheckStatus[],
): RequiredCheckState {
  const required = new Set(requiredContexts);
  if (required.size === 0) {
    return {
      status: "failed",
      reason: "No required status checks are configured for main.",
    };
  }

  const byName = new Map<string, string>();
  for (const check of statuses) {
    if (!required.has(check.name)) continue;
    if (byName.has(check.name)) {
      return {
        status: "failed",
        reason: `GitHub returned more than one result for required check ${check.name}.`,
      };
    }
    byName.set(check.name, check.bucket);
  }

  const failed = [...required].filter((name) => {
    const bucket = byName.get(name);
    return (
      bucket !== undefined &&
      bucket !== "pass" &&
      bucket !== "skipping" &&
      bucket !== "pending"
    );
  });
  if (failed.length > 0) {
    return {
      status: "failed",
      reason: `Required release PR checks are not green: ${failed.join(", ")}.`,
    };
  }

  const missing = [...required].filter((name) => !byName.has(name));
  const pending = [...required].filter(
    (name) => byName.get(name) === "pending",
  );
  if (missing.length > 0 || pending.length > 0) {
    return { status: "pending", missing, pending };
  }
  return { status: "passed" };
}

export async function waitForRequiredChecks({
  readRequiredContexts,
  readStatuses,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  timeoutMs = 150 * 60_000,
  intervalMs = 15_000,
}: WaitForRequiredChecksOptions): Promise<void> {
  const requiredContexts = await readRequiredContexts();
  if (requiredContexts.length === 0) {
    throw new Error(
      "No required status checks are configured for main; refusing release PR merge.",
    );
  }

  const deadline = now() + timeoutMs;
  let lastState: RequiredCheckState = {
    status: "pending",
    missing: requiredContexts,
    pending: [],
  };

  while (true) {
    lastState = evaluateRequiredChecks(requiredContexts, await readStatuses());
    if (lastState.status === "passed") return;
    if (lastState.status === "failed") throw new Error(lastState.reason);

    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(intervalMs, remaining));
  }

  const waiting = [
    ...lastState.missing.map((name) => `${name} (not reported)`),
    ...lastState.pending,
  ];
  throw new Error(
    `Timed out waiting for required release PR checks: ${waiting.join(", ")}.`,
  );
}

function ghJson<T>(args: string[]): T {
  const stdout = execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout) as T;
}

function readRequiredContexts(repo: string): string[] {
  const rules = ghJson<unknown[]>(["api", `repos/${repo}/rules/branches/main`]);
  return requiredContextsFromRules(rules);
}

function readStatuses(prNumber: string, repo: string): RequiredCheckStatus[] {
  try {
    const statuses = ghJson<unknown>([
      "pr",
      "checks",
      prNumber,
      "--repo",
      repo,
      "--required",
      "--json",
      "name,bucket",
    ]);
    if (
      !Array.isArray(statuses) ||
      !statuses.every(
        (status) =>
          status !== null &&
          typeof status === "object" &&
          "name" in status &&
          typeof status.name === "string" &&
          "bucket" in status &&
          typeof status.bucket === "string",
      )
    ) {
      throw new Error(
        "GitHub returned invalid required release PR check results.",
      );
    }
    return statuses as RequiredCheckStatus[];
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr ?? "")
        : "";
    if (/no checks reported/i.test(stderr)) return [];
    throw error;
  }
}

async function main(): Promise<void> {
  const [mode, prNumber, repo] = process.argv.slice(2);
  if (!(["wait", "verify"] as string[]).includes(mode) || !prNumber || !repo) {
    throw new Error(
      "Usage: release-required-checks.ts <wait|verify> <pr-number> <owner/repo>",
    );
  }

  const readCurrentContexts = async () => readRequiredContexts(repo);
  const readCurrentStatuses = async () => readStatuses(prNumber, repo);

  if (mode === "wait") {
    await waitForRequiredChecks({
      readRequiredContexts: readCurrentContexts,
      readStatuses: readCurrentStatuses,
    });
    return;
  }

  const state = evaluateRequiredChecks(
    await readCurrentContexts(),
    await readCurrentStatuses(),
  );
  if (state.status !== "passed") {
    throw new Error(
      state.status === "failed"
        ? state.reason
        : `Required release PR checks are missing or pending: ${[
            ...state.missing,
            ...state.pending,
          ].join(", ")}.`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `::error::${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
