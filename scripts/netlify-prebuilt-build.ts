import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type NetlifyEnvironmentValue = {
  context?: unknown;
  context_parameter?: unknown;
  value?: unknown;
};

type NetlifyEnvironmentVariable = {
  is_secret?: unknown;
  key?: unknown;
  scopes?: unknown;
  values?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function resolveNetlifyBuildEnvironment(
  variables: unknown,
  context: string,
  inheritedEnvironment: NodeJS.ProcessEnv = process.env,
  branch?: string,
): NodeJS.ProcessEnv {
  if (!context) throw new Error("Netlify build context is required.");
  if (context === "branch-deploy" && !branch) {
    throw new Error("Netlify branch-deploy builds require an explicit branch.");
  }
  if (!Array.isArray(variables)) {
    throw new Error("Netlify environment response must be an array.");
  }

  const sortedVariables = variables
    .map((candidate): NetlifyEnvironmentVariable => {
      if (
        !isRecord(candidate) ||
        typeof candidate.key !== "string" ||
        candidate.key.length === 0 ||
        !Array.isArray(candidate.values) ||
        (candidate.scopes !== undefined && !Array.isArray(candidate.scopes)) ||
        (candidate.is_secret !== undefined &&
          typeof candidate.is_secret !== "boolean")
      ) {
        throw new Error("Netlify returned a malformed environment variable.");
      }
      if (
        Array.isArray(candidate.scopes) &&
        candidate.scopes.some((scope) => typeof scope !== "string")
      ) {
        throw new Error(
          `Netlify returned malformed scopes for ${candidate.key}.`,
        );
      }
      for (const value of candidate.values) {
        if (!isRecord(value) || typeof value.context !== "string") {
          throw new Error(
            `Netlify returned malformed values for ${candidate.key}.`,
          );
        }
        if (
          value.context_parameter !== undefined &&
          value.context_parameter !== null &&
          typeof value.context_parameter !== "string"
        ) {
          throw new Error(
            `Netlify returned malformed context parameters for ${candidate.key}.`,
          );
        }
        if (
          value.value !== undefined &&
          value.value !== null &&
          typeof value.value !== "string"
        ) {
          throw new Error(
            `Netlify returned a non-string value for ${candidate.key}.`,
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
    const scopes = variable.scopes as string[] | undefined;
    if (scopes && !scopes.includes("builds")) continue;
    const values = variable.values as NetlifyEnvironmentValue[];
    const uniqueMatch = (
      matches: NetlifyEnvironmentValue[],
      description: string,
    ): NetlifyEnvironmentValue | undefined => {
      if (matches.length > 1) {
        throw new Error(
          `Netlify returned ambiguous ${description} values for ${key}.`,
        );
      }
      return matches[0];
    };
    const branchValues =
      context === "branch-deploy"
        ? values.filter(
            (value) =>
              (value.context === "branch" ||
                value.context === "branch-deploy") &&
              value.context_parameter === branch,
          )
        : [];
    const branchValue = uniqueMatch(branchValues, `branch ${branch}`);
    const contextValue = branchValue
      ? undefined
      : uniqueMatch(
          values.filter(
            (value) =>
              value.context === context &&
              (context !== "branch-deploy" ||
                value.context_parameter === undefined ||
                value.context_parameter === null),
          ),
          `context ${context}`,
        );
    const selected =
      branchValue ??
      contextValue ??
      uniqueMatch(
        values.filter((value) => value.context === "all"),
        "all-context",
      );
    if (!selected) continue;
    if (variable.is_secret === true) {
      if (
        key === "ANALYTICS_DATABASE_URL" &&
        !inheritedEnvironment.ANALYTICS_DATABASE_URL_SECRET
      ) {
        throw new Error(
          `Netlify secret build variable ${key} is masked and has no ANALYTICS_DATABASE_URL_SECRET offline build input.`,
        );
      }
      continue;
    }
    if (selected.value === undefined || selected.value === null) {
      throw new Error(
        `Netlify returned no payload for selected variable ${key}.`,
      );
    }
    if (typeof selected.value !== "string") {
      throw new Error(`Netlify returned a non-string value for ${key}.`);
    }
    siteEnvironment[key] = selected.value;
  }

  const buildEnvironment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(inheritedEnvironment)) {
    if (value !== undefined) buildEnvironment[key] = value;
  }
  const environment = { ...buildEnvironment, ...siteEnvironment };
  if (context === "branch-deploy" && branch) {
    environment.BRANCH = branch;
  }
  return environment;
}

type BuildOptions = {
  branch?: string;
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
  const branch = options.get("--branch");
  if (!envFile || !context || !filter || options.size !== (branch ? 4 : 3)) {
    throw new Error("Expected --env-file, --context, and --filter.");
  }
  if (context === "branch-deploy" && !branch) {
    throw new Error("Netlify branch-deploy builds require --branch.");
  }
  return branch
    ? { envFile, context, filter, branch }
    : { envFile, context, filter };
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  let result: ReturnType<typeof spawnSync>;
  try {
    const variables = JSON.parse(readFileSync(options.envFile, "utf8"));
    const env = resolveNetlifyBuildEnvironment(
      variables,
      options.context,
      process.env,
      options.branch,
    );
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
