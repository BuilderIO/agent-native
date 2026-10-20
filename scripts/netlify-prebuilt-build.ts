import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type NetlifyEnvironmentValue = {
  context?: unknown;
  value?: unknown;
};

type NetlifyEnvironmentVariable = {
  key?: unknown;
  values?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function resolveNetlifyBuildEnvironment(
  variables: unknown,
  context: string,
  inheritedEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (!context) throw new Error("Netlify build context is required.");
  if (!Array.isArray(variables)) {
    throw new Error("Netlify environment response must be an array.");
  }

  const sortedVariables = variables
    .map((candidate): NetlifyEnvironmentVariable => {
      if (
        !isRecord(candidate) ||
        typeof candidate.key !== "string" ||
        candidate.key.length === 0 ||
        !Array.isArray(candidate.values)
      ) {
        throw new Error("Netlify returned a malformed environment variable.");
      }
      for (const value of candidate.values) {
        if (!isRecord(value) || typeof value.context !== "string") {
          throw new Error(
            `Netlify returned malformed values for ${candidate.key}.`,
          );
        }
      }
      return candidate as NetlifyEnvironmentVariable;
    })
    .sort((left, right) => {
      const leftKey = String(left.key).toLowerCase();
      const rightKey = String(right.key).toLowerCase();
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });

  const siteEnvironment: NodeJS.ProcessEnv = {};
  for (const variable of sortedVariables) {
    const key = variable.key as string;
    const values = variable.values as NetlifyEnvironmentValue[];
    const selected = values.find(
      (value) => value.context === "all" || value.context === context,
    );
    if (selected?.value === undefined || selected.value === "") continue;
    if (typeof selected.value !== "string") {
      throw new Error(`Netlify returned a non-string value for ${key}.`);
    }
    siteEnvironment[key] = selected.value;
  }

  const buildEnvironment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(inheritedEnvironment)) {
    if (value !== undefined) buildEnvironment[key] = value;
  }
  return { ...buildEnvironment, ...siteEnvironment };
}

type BuildOptions = {
  envFile: string;
  context: string;
  filter: string;
};

function parseOptions(args: string[]): BuildOptions {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("Expected --env-file, --context, and --filter values.");
    }
    if (options.has(key)) throw new Error(`Duplicate build option: ${key}`);
    options.set(key, value);
  }

  const envFile = options.get("--env-file");
  const context = options.get("--context");
  const filter = options.get("--filter");
  if (!envFile || !context || !filter || options.size !== 3) {
    throw new Error("Expected --env-file, --context, and --filter.");
  }
  return { envFile, context, filter };
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  let result: ReturnType<typeof spawnSync>;
  try {
    const variables = JSON.parse(readFileSync(options.envFile, "utf8"));
    const env = resolveNetlifyBuildEnvironment(variables, options.context);
    result = spawnSync(
      "netlify",
      [
        "build",
        "--context",
        options.context,
        "--filter",
        options.filter,
        "--offline",
      ],
      { env, stdio: "inherit" },
    );
  } finally {
    rmSync(options.envFile, { force: true });
  }

  if (result.error) throw result.error;
  if (result.status === null) {
    throw new Error("Netlify build did not return an exit status.");
  }
  process.exitCode = result.status;
}

const isMainModule =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) main();
