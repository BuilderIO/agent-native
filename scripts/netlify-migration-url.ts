import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MIGRATION_URL_KEYS = [
  "NETLIFY_DATABASE_URL_UNPOOLED",
  "NETLIFY_DATABASE_URL",
  "DATABASE_URL",
] as const;

const PREFERRED_CONTEXTS: Record<string, readonly string[]> = {
  production: ["production", "all"],
  "deploy-preview": ["deploy-preview", "branch-deploy", "all"],
  "branch-deploy": ["branch-deploy", "all"],
};

type NetlifyEnvironmentVariable = {
  key?: unknown;
  values?: unknown;
};

type NetlifyEnvironmentValue = {
  context?: unknown;
  value?: unknown;
};

type NetlifyDatabaseResponse = {
  connection_string?: unknown;
  connection_strings?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isPostgresUrl = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("postgres");

function resolveNetlifyDatabaseUrl(
  response: NetlifyDatabaseResponse,
): string | undefined {
  if (isPostgresUrl(response.connection_string)) {
    return response.connection_string;
  }
  if (!isRecord(response.connection_strings)) return undefined;
  return Object.values(response.connection_strings).find(isPostgresUrl);
}

export function resolveNetlifyMigrationUrl(
  variables: unknown,
  context: string,
): string | undefined {
  if (isRecord(variables)) {
    return resolveNetlifyDatabaseUrl(variables);
  }
  if (!Array.isArray(variables)) {
    throw new Error("Netlify environment response must be an array.");
  }
  const preferredContexts = PREFERRED_CONTEXTS[context];
  if (!preferredContexts) {
    throw new Error(`Unsupported Netlify deploy context: ${context}`);
  }

  for (const key of MIGRATION_URL_KEYS) {
    const variable = variables.find(
      (candidate): candidate is NetlifyEnvironmentVariable =>
        isRecord(candidate) && candidate.key === key,
    );
    if (!variable || !Array.isArray(variable.values)) continue;

    const selected = preferredContexts
      .map((preferredContext) =>
        variable.values.find(
          (candidate): candidate is NetlifyEnvironmentValue =>
            isRecord(candidate) && candidate.context === preferredContext,
        ),
      )
      .find(Boolean);
    const value = selected?.value;
    if (isPostgresUrl(value)) {
      return value;
    }
  }

  return undefined;
}

function main(): void {
  const context = process.env.BUILD_CONTEXT;
  if (!context) throw new Error("BUILD_CONTEXT is required.");
  const value = resolveNetlifyMigrationUrl(
    JSON.parse(readFileSync(0, "utf8")),
    context,
  );
  if (value) process.stdout.write(value);
}

const isMainModule =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) main();
