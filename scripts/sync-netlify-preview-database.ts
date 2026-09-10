import path from "node:path";
import { pathToFileURL } from "node:url";

import { requestNetlifyApi } from "./netlify-api-request.ts";

const PREVIEW_CONTEXT = "deploy-preview";
const DATABASE_ENV_KEY_PATTERN = /(?:^|_)DATABASE_URL(?:_UNPOOLED)?$/;

type JsonRecord = Record<string, unknown>;

type Requester = (url: string, options?: RequestInit) => Promise<Response>;

export type DatabaseEnvVariable = {
  key: string;
  value: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function isPostgresUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return ["postgres:", "postgresql:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function netlifyEnvUrl(
  accountId: string,
  siteId: string,
  key?: string,
): string {
  const encodedAccount = encodeURIComponent(accountId);
  const encodedSite = encodeURIComponent(siteId);
  const keyPath = key ? `/${encodeURIComponent(key)}` : "";
  return `https://api.netlify.com/api/v1/accounts/${encodedAccount}/env${keyPath}?site_id=${encodedSite}`;
}

export function productionDatabaseVariables(
  input: unknown,
): DatabaseEnvVariable[] {
  if (!Array.isArray(input)) {
    throw new Error("Netlify environment response must be an array.");
  }

  const seenKeys = new Set<string>();
  const variables: DatabaseEnvVariable[] = [];
  for (const candidate of input) {
    if (
      !isRecord(candidate) ||
      typeof candidate.key !== "string" ||
      !DATABASE_ENV_KEY_PATTERN.test(candidate.key)
    ) {
      continue;
    }
    if (seenKeys.has(candidate.key)) {
      throw new Error(
        `Netlify returned duplicate environment key ${candidate.key}.`,
      );
    }
    seenKeys.add(candidate.key);

    const values = Array.isArray(candidate.values) ? candidate.values : [];
    const production = values.find(
      (value) => isRecord(value) && value.context === "production",
    );
    const all = values.find(
      (value) => isRecord(value) && value.context === "all",
    );
    const selected = production ?? all;
    if (!isRecord(selected) || selected.value === undefined) continue;
    if (!isPostgresUrl(selected.value)) {
      throw new Error(
        `${candidate.key}: production Netlify database value is missing or not PostgreSQL.`,
      );
    }
    variables.push({ key: candidate.key, value: selected.value });
  }
  return variables;
}

async function readJson(response: Response, label: string): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}.`);
  }
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

export async function mirrorProductionDatabaseVariables({
  accountId,
  siteId,
  token,
  request = requestNetlifyApi,
}: {
  accountId: string;
  siteId: string;
  token: string;
  request?: Requester;
}): Promise<string[]> {
  if (!accountId.trim()) throw new Error("Netlify account id is required.");
  if (!siteId.trim()) throw new Error("Netlify site id is required.");
  if (!token.trim()) throw new Error("Netlify auth token is required.");

  const headers = {
    Authorization: `Bearer ${token}`,
    "User-Agent": "agent-native-netlify-preview-database-sync",
  };
  const response = await request(netlifyEnvUrl(accountId, siteId), { headers });
  const variables = productionDatabaseVariables(
    await readJson(response, "Netlify environment lookup"),
  );
  if (variables.length === 0) {
    throw new Error(
      `No production PostgreSQL database environment variable found for Netlify site ${siteId}.`,
    );
  }

  for (const variable of variables) {
    const update = await request(
      netlifyEnvUrl(accountId, siteId, variable.key),
      {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          context: PREVIEW_CONTEXT,
          value: variable.value,
        }),
      },
    );
    await update.arrayBuffer();
    if (!update.ok) {
      throw new Error(
        `${variable.key}: deploy-preview environment update failed with HTTP ${update.status}.`,
      );
    }
  }

  return variables.map(({ key }) => key);
}

async function main(): Promise<void> {
  const token = process.env.NETLIFY_AUTH_TOKEN?.trim();
  const accountId = process.env.NETLIFY_ACCOUNT_ID?.trim();
  const siteId = process.env.NETLIFY_SITE_ID?.trim();
  if (!token) throw new Error("NETLIFY_AUTH_TOKEN is required.");
  if (!accountId) throw new Error("NETLIFY_ACCOUNT_ID is required.");
  if (!siteId) throw new Error("NETLIFY_SITE_ID is required.");

  const keys = await mirrorProductionDatabaseVariables({
    accountId,
    siteId,
    token,
  });
  console.log(
    `Mirrored ${keys.length} production database environment variable(s) into deploy-preview context: ${keys.join(", ")}`,
  );
}

const isMainModule =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
