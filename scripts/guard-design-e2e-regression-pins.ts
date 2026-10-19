import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DESIGN_E2E_REGRESSION_SHARDS,
  DESIGN_E2E_REGRESSION_PINS,
  findDesignE2ERegressionPinCoverageViolations,
  parseDesignE2ERegressionPins,
  resolveDesignE2ERegressionPin,
  type DesignE2ERegressionPin,
  type DesignE2ERegressionPinException,
} from "./design-e2e-regression-pins.ts";
import {
  GUARD_EXIT_COULD_NOT_RUN,
  resolveDiffBase,
} from "./lib/changed-lines.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const MANIFEST_PATH = "scripts/design-e2e-regression-pins.ts";
const EXCEPTIONS_PATH = "scripts/design-e2e-coverage-exceptions.json";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function resolveDesignE2ECoverageBase(cwd: string): string {
  const isPullRequest = ["pull_request", "pull_request_target"].includes(
    process.env.GITHUB_EVENT_NAME ?? "",
  );
  if (
    isPullRequest &&
    !process.env.GUARD_DIFF_BASE?.trim() &&
    !process.env.GITHUB_BASE_REF?.trim()
  ) {
    const error = new Error(
      "GitHub pull request runs must provide GITHUB_BASE_REF so coverage is compared with the PR target",
    );
    Object.assign(error, { exitCode: GUARD_EXIT_COULD_NOT_RUN });
    throw error;
  }
  const base = resolveDiffBase(cwd);
  if (!base || base === "main") {
    const error = new Error(
      "could not determine the PR base from an origin ref; fetch the target branch or set GUARD_DIFF_BASE",
    );
    Object.assign(error, { exitCode: GUARD_EXIT_COULD_NOT_RUN });
    throw error;
  }
  try {
    return git(["merge-base", base, "HEAD"], cwd).trim();
  } catch {
    const error = new Error(`could not resolve merge-base for ${base}`);
    Object.assign(error, { exitCode: GUARD_EXIT_COULD_NOT_RUN });
    throw error;
  }
}

export function loadBasePins(
  cwd: string,
  baseCommit: string,
): DesignE2ERegressionPin[] {
  let source: string;
  try {
    source = git(["show", `${baseCommit}:${MANIFEST_PATH}`], cwd);
  } catch {
    const error = new Error(`could not read ${MANIFEST_PATH} at ${baseCommit}`);
    Object.assign(error, { exitCode: GUARD_EXIT_COULD_NOT_RUN });
    throw error;
  }

  try {
    return parseDesignE2ERegressionPins(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const unavailable = new Error(
      `could not parse ${MANIFEST_PATH} at ${baseCommit}: ${detail}`,
    );
    Object.assign(unavailable, { exitCode: GUARD_EXIT_COULD_NOT_RUN });
    throw unavailable;
  }
}

function parsePinExceptions(source: string): DesignE2ERegressionPinException[] {
  try {
    const registry = JSON.parse(source) as { pins?: unknown } | null;
    if (!registry || !Array.isArray(registry.pins)) {
      throw new Error("pins must be an array");
    }
    const pins: DesignE2ERegressionPinException[] = [];
    for (const [index, value] of registry.pins.entries()) {
      const candidate = value as {
        action?: unknown;
        from?: unknown;
        to?: unknown;
        reason?: unknown;
        evidence?: unknown;
        owner?: unknown;
      } | null;
      const from = candidate?.from as
        | { file?: unknown; title?: unknown; shard?: unknown }
        | null
        | undefined;
      const to = candidate?.to as
        | { file?: unknown; title?: unknown; shard?: unknown }
        | null
        | undefined;
      if (
        !candidate ||
        typeof candidate !== "object" ||
        typeof candidate.action !== "string" ||
        !["remove", "rename", "lane-move"].includes(candidate.action) ||
        !from ||
        typeof from !== "object" ||
        typeof from.file !== "string" ||
        !from.file.trim() ||
        typeof from.title !== "string" ||
        !from.title.trim() ||
        typeof candidate.reason !== "string" ||
        !candidate.reason.trim() ||
        typeof candidate.evidence !== "string" ||
        !candidate.evidence.trim() ||
        (candidate.action === "rename" &&
          (!to ||
            typeof to !== "object" ||
            typeof to.file !== "string" ||
            !to.file.trim() ||
            typeof to.title !== "string" ||
            !to.title.trim())) ||
        (candidate.action === "lane-move" &&
          (!to ||
            typeof to !== "object" ||
            typeof to.file !== "string" ||
            !to.file.trim() ||
            typeof to.title !== "string" ||
            !to.title.trim() ||
            from.file !== to.file ||
            from.title !== to.title ||
            typeof from.shard !== "string" ||
            !(DESIGN_E2E_REGRESSION_SHARDS as readonly string[]).includes(
              from.shard,
            ) ||
            typeof to.shard !== "string" ||
            !(DESIGN_E2E_REGRESSION_SHARDS as readonly string[]).includes(
              to.shard,
            ) ||
            from.shard === to.shard ||
            typeof candidate.owner !== "string" ||
            !candidate.owner.trim()))
      ) {
        throw new Error(`pins entry ${index + 1} has invalid metadata`);
      }
      pins.push(value as DesignE2ERegressionPinException);
    }
    return pins;
  } catch (error) {
    throw new Error(
      `${EXCEPTIONS_PATH} must contain a valid pins array: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readPinExceptions(cwd: string): DesignE2ERegressionPinException[] {
  try {
    return parsePinExceptions(
      readFileSync(path.join(cwd, EXCEPTIONS_PATH), "utf8"),
    );
  } catch (error) {
    throw new Error(
      `${EXCEPTIONS_PATH} must contain a valid pins array: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function loadBasePinExceptions(
  cwd: string,
  baseCommit: string,
): DesignE2ERegressionPinException[] {
  try {
    const pathInTree = git(
      ["ls-tree", "-r", "--name-only", baseCommit, "--", EXCEPTIONS_PATH],
      cwd,
    ).trim();
    if (!pathInTree) return [];
    const source = git(["show", `${baseCommit}:${EXCEPTIONS_PATH}`], cwd);
    return parsePinExceptions(source);
  } catch (error) {
    const unavailable = new Error(
      `could not read valid ${EXCEPTIONS_PATH} at ${baseCommit}: ${error instanceof Error ? error.message : String(error)}`,
    );
    Object.assign(unavailable, { exitCode: GUARD_EXIT_COULD_NOT_RUN });
    throw unavailable;
  }
}

export async function checkDesignE2ERegressionPins(
  options: {
    cwd?: string;
    basePins?: DesignE2ERegressionPin[];
    headPins?: DesignE2ERegressionPin[];
    exceptions?: DesignE2ERegressionPinException[];
    baseExceptions?: DesignE2ERegressionPinException[];
  } = {},
): Promise<string[]> {
  const cwd = options.cwd ?? REPO_ROOT;
  let basePins = options.basePins;
  let baseCommit: string | undefined;
  if (!basePins) {
    baseCommit = resolveDesignE2ECoverageBase(cwd);
    basePins = loadBasePins(cwd, baseCommit);
  }
  const headPins = options.headPins ?? [...DESIGN_E2E_REGRESSION_PINS];
  const exceptions = options.exceptions ?? readPinExceptions(cwd);
  const baseExceptions =
    options.baseExceptions ??
    (baseCommit ? loadBasePinExceptions(cwd, baseCommit) : []);
  const violations = findDesignE2ERegressionPinCoverageViolations(
    basePins,
    headPins,
    exceptions,
    baseExceptions,
  );

  for (const pin of headPins) {
    try {
      resolveDesignE2ERegressionPin(pin);
    } catch (error) {
      violations.push(
        `${pin.file} / ${pin.title}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return violations;
}

async function main(): Promise<void> {
  try {
    const violations = await checkDesignE2ERegressionPins();
    if (violations.length > 0) {
      console.error("guard:design-e2e-regression-pins failed:");
      for (const violation of violations) console.error(`  ${violation}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `guard:design-e2e-regression-pins: ${DESIGN_E2E_REGRESSION_PINS.length} protected tests resolve and remain covered.`,
    );
  } catch (error) {
    const exitCode =
      error && typeof error === "object" && "exitCode" in error
        ? Number(error.exitCode)
        : 1;
    console.error(
      `guard:design-e2e-regression-pins could not run: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = exitCode;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main();
}
