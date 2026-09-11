import path from "node:path";
import { pathToFileURL } from "node:url";

import { requestNetlifyApi } from "./netlify-api-request.ts";

const PREVIEW_CONTEXT = "branch-deploy";
const LEGACY_PREVIEW_CONTEXT = "deploy-preview";
const PREVIEW_CONTEXTS = [PREVIEW_CONTEXT, LEGACY_PREVIEW_CONTEXT];
const DATABASE_ENV_KEY_PATTERN = /(?:^|_)DATABASE_URL(?:_UNPOOLED)?$/;
const DATABASE_SCOPES = ["builds", "functions", "runtime"];

type JsonRecord = Record<string, unknown>;

type Requester = (url: string, options?: RequestInit) => Promise<Response>;

type NetlifyEnvValue = {
  context: string;
  context_parameter?: string;
  id?: string;
};

type NetlifyEnvVariable = {
  key: string;
  values: NetlifyEnvValue[];
};

export type PreviewDatabaseVariable = {
  key: string;
  value: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function isPostgresUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!URL.canParse(value)) return false;
  return ["postgres:", "postgresql:"].includes(new URL(value).protocol);
}

function netlifyEnvUrl(
  accountId: string,
  siteId: string,
  key?: string,
  valueId?: string,
): string {
  const encodedAccount = encodeURIComponent(accountId);
  const encodedSite = encodeURIComponent(siteId);
  const keyPath = key ? `/${encodeURIComponent(key)}` : "";
  const valuePath = valueId ? `/value/${encodeURIComponent(valueId)}` : "";
  return `https://api.netlify.com/api/v1/accounts/${encodedAccount}/env${keyPath}${valuePath}?site_id=${encodedSite}`;
}

function appEnvPrefix(sourceTemplate: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(sourceTemplate)) {
    throw new Error(`Unsupported preview app template ${sourceTemplate}.`);
  }
  return sourceTemplate.toUpperCase().replaceAll("-", "_");
}

function unpooledDatabaseUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.hostname = url.hostname.replace(/-pooler(?=\.)/i, "");
  return url.toString();
}

export function previewDatabaseVariables({
  databaseUrl,
  existingKeys,
  sourceTemplate,
}: {
  databaseUrl: string;
  existingKeys?: Iterable<string>;
  sourceTemplate: string;
}): PreviewDatabaseVariable[] {
  if (!isPostgresUrl(databaseUrl)) {
    throw new Error("Preview database URL must be a PostgreSQL URL.");
  }

  const unpooled = unpooledDatabaseUrl(databaseUrl);
  const variables: PreviewDatabaseVariable[] = [
    { key: "DATABASE_URL", value: databaseUrl },
    { key: "DATABASE_URL_UNPOOLED", value: unpooled },
    { key: "NETLIFY_DATABASE_URL", value: databaseUrl },
    { key: "NETLIFY_DATABASE_URL_UNPOOLED", value: unpooled },
  ];
  const keys = new Set(existingKeys);
  const prefix = appEnvPrefix(sourceTemplate);
  for (const suffix of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
    const key = `${prefix}_${suffix}`;
    if (keys.has(key)) {
      variables.push({
        key,
        value: suffix.endsWith("UNPOOLED") ? unpooled : databaseUrl,
      });
    }
  }
  return variables;
}

export function parseNetlifyDatabaseVariables(
  input: unknown,
): NetlifyEnvVariable[] {
  if (!Array.isArray(input)) {
    throw new Error("Netlify environment response must be an array.");
  }

  const seenKeys = new Set<string>();
  const variables: NetlifyEnvVariable[] = [];
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

    if (!Array.isArray(candidate.values)) {
      throw new Error(`${candidate.key}: Netlify returned invalid values.`);
    }
    const values: NetlifyEnvValue[] = [];
    for (const value of candidate.values) {
      if (!isRecord(value) || typeof value.context !== "string") {
        throw new Error(
          `${candidate.key}: Netlify returned invalid value metadata.`,
        );
      }
      values.push({
        context: value.context,
        ...(typeof value.context_parameter === "string"
          ? { context_parameter: value.context_parameter }
          : {}),
        ...(typeof value.id === "string" ? { id: value.id } : {}),
      });
    }
    variables.push({ key: candidate.key, values });
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

async function assertResponse(
  response: Response,
  label: string,
): Promise<void> {
  await response.arrayBuffer();
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}.`);
  }
}

async function deletePreviewValue({
  accountId,
  key,
  request,
  siteId,
  token,
  value,
}: {
  accountId: string;
  key: string;
  request: Requester;
  siteId: string;
  token: string;
  value: NetlifyEnvValue;
}): Promise<void> {
  if (!value.id) {
    throw new Error(`${key}: preview value has no Netlify id.`);
  }
  const response = await request(
    netlifyEnvUrl(accountId, siteId, key, value.id),
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "agent-native-netlify-preview-database-sync",
      },
    },
  );
  if (response.status === 404) {
    await response.arrayBuffer();
    return;
  }
  await assertResponse(response, `${key} preview value deletion`);
}

export async function mirrorProductionDatabaseVariables({
  accountId,
  databaseUrl,
  request = requestNetlifyApi,
  siteId,
  sourceTemplate,
  token,
}: {
  accountId: string;
  databaseUrl: string;
  request?: Requester;
  siteId: string;
  sourceTemplate: string;
  token: string;
}): Promise<{ mirroredKeys: string[]; removedKeys: string[] }> {
  if (!accountId.trim()) throw new Error("Netlify account id is required.");
  if (!siteId.trim()) throw new Error("Netlify site id is required.");
  if (!token.trim()) throw new Error("Netlify auth token is required.");

  const headers = {
    Authorization: `Bearer ${token}`,
    "User-Agent": "agent-native-netlify-preview-database-sync",
  };
  const response = await request(netlifyEnvUrl(accountId, siteId), { headers });
  const existing = parseNetlifyDatabaseVariables(
    await readJson(response, "Netlify environment metadata lookup"),
  );
  const desired = previewDatabaseVariables({
    databaseUrl,
    existingKeys: existing.map(({ key }) => key),
    sourceTemplate,
  });
  const desiredKeys = new Set(desired.map(({ key }) => key));
  const existingByKey = new Map(
    existing.map((variable) => [variable.key, variable]),
  );
  const removedKeys = new Set<string>();

  for (const variable of desired) {
    let current = existingByKey.get(variable.key);
    if (!current) {
      const createResponse = await request(netlifyEnvUrl(accountId, siteId), {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify([
          {
            key: variable.key,
            scopes: DATABASE_SCOPES,
            is_secret: true,
            values: [{ context: PREVIEW_CONTEXT, value: variable.value }],
          },
        ]),
      });
      const createStatus = createResponse.status;
      await createResponse.arrayBuffer();
      if (createResponse.ok) continue;
      if (createStatus !== 409) {
        throw new Error(
          `${variable.key} branch-deploy environment creation failed with HTTP ${createStatus}.`,
        );
      }

      // Another PR can create the key after the metadata lookup. Re-read the
      // metadata and update that key so concurrent previews converge.
      const refreshedResponse = await request(
        netlifyEnvUrl(accountId, siteId),
        {
          headers,
        },
      );
      const refreshed = parseNetlifyDatabaseVariables(
        await readJson(
          refreshedResponse,
          "Netlify environment metadata refresh after concurrent creation",
        ),
      );
      current = refreshed.find(({ key }) => key === variable.key);
      if (!current) {
        throw new Error(
          `${variable.key}: concurrent environment creation returned HTTP 409 but the key is still missing.`,
        );
      }
    }

    const previewValues = current.values.filter(
      ({ context, context_parameter }) =>
        context === PREVIEW_CONTEXT && !context_parameter,
    );
    await assertResponse(
      await request(netlifyEnvUrl(accountId, siteId, variable.key), {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          context: PREVIEW_CONTEXT,
          value: variable.value,
        }),
      }),
      `${variable.key} branch-deploy environment update`,
    );

    for (const value of [
      ...previewValues.slice(1),
      ...current.values.filter(
        ({ context, context_parameter }) =>
          context === LEGACY_PREVIEW_CONTEXT && !context_parameter,
      ),
    ]) {
      await deletePreviewValue({
        accountId,
        key: variable.key,
        request,
        siteId,
        token,
        value,
      });
    }
  }

  // Keep an already-live preview usable if a later cleanup request fails. All
  // desired values are written before stale preview-only database keys are
  // removed.
  for (const variable of existing) {
    if (desiredKeys.has(variable.key)) continue;
    for (const value of variable.values.filter(
      ({ context, context_parameter }) =>
        PREVIEW_CONTEXTS.includes(context) && !context_parameter,
    )) {
      await deletePreviewValue({
        accountId,
        key: variable.key,
        request,
        siteId,
        token,
        value,
      });
      removedKeys.add(variable.key);
    }
  }

  return {
    mirroredKeys: desired.map(({ key }) => key),
    removedKeys: [...removedKeys],
  };
}

async function main(): Promise<void> {
  const token = process.env.NETLIFY_AUTH_TOKEN?.trim();
  const accountId = process.env.NETLIFY_ACCOUNT_ID?.trim();
  const databaseUrl = process.env.NETLIFY_PREVIEW_DATABASE_URL?.trim();
  const siteId = process.env.NETLIFY_SITE_ID?.trim();
  const sourceTemplate = process.env.NETLIFY_SOURCE_TEMPLATE?.trim();
  if (!token) throw new Error("NETLIFY_AUTH_TOKEN is required.");
  if (!accountId) throw new Error("NETLIFY_ACCOUNT_ID is required.");
  if (!databaseUrl)
    throw new Error("NETLIFY_PREVIEW_DATABASE_URL is required.");
  if (!siteId) throw new Error("NETLIFY_SITE_ID is required.");
  if (!sourceTemplate) throw new Error("NETLIFY_SOURCE_TEMPLATE is required.");

  const result = await mirrorProductionDatabaseVariables({
    accountId,
    databaseUrl,
    siteId,
    sourceTemplate,
    token,
  });
  console.log(
    `Mirrored ${result.mirroredKeys.length} production database variable(s) into branch-deploy context: ${result.mirroredKeys.join(", ")}`,
  );
  if (result.removedKeys.length > 0) {
    console.log(
      `Removed stale preview database override(s): ${result.removedKeys.join(", ")}`,
    );
  }
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
