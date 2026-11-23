import { fail } from "@agent-native/core/action";
import {
  createProviderApiRuntime,
  defaultProviderApiCredentialResolver,
  listCustomProviders,
  listProviderApiIdsForTemplateUse,
  type ProviderApiId,
  type ProviderApiCredentialLookupOptions,
  type ProviderApiRequestArgs,
  type ProviderApiRuntime,
} from "@agent-native/core/provider-api";
import { getCredentialContext } from "@agent-native/core/server";
import { resolveWorkspaceConnectionCredentialForApp } from "@agent-native/core/workspace-connections";

import { classifyBigQueryApiUrl } from "./bigquery-api-url.js";

export const ANALYTICS_2_APP_ID = "analytics-2";
export const ANALYTICS_2_PROVIDER_API_IDS =
  listProviderApiIdsForTemplateUse("analytics");

const HUBSPOT_CONNECTION_REQUIRED_NOTE =
  "Select the granted HubSpot connection for each request; Analytics 2 does not use an unbound HubSpot credential.";
const BIGQUERY_METADATA_ONLY_NOTE =
  "Analytics 2 allows only GET metadata for an exact table in an admin-curated semantic-model allow-list. Use run-bigquery-query for SQL and table rows; its job project comes from the model's single project-qualified allow-list, never a local default.";

function applyProviderCatalogPolicy(entry: unknown): unknown {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return entry;
  }

  const catalogEntry = entry as Record<string, unknown>;
  const id = catalogEntry.id;
  if (id !== "bigquery" && id !== "hubspot") return entry;

  const notes = Array.isArray(catalogEntry.notes)
    ? catalogEntry.notes.filter(
        (note): note is string => typeof note === "string",
      )
    : [];
  const policyNote =
    id === "bigquery"
      ? BIGQUERY_METADATA_ONLY_NOTE
      : HUBSPOT_CONNECTION_REQUIRED_NOTE;

  return {
    ...catalogEntry,
    requiresConnectionId: true,
    ...(id === "bigquery" ? { examples: [], placeholders: [] } : {}),
    notes: notes.includes(policyNote) ? notes : [...notes, policyNote],
  };
}

export function applyAnalytics2ProviderApiCatalogPolicy(
  entries: readonly unknown[],
): unknown[] {
  return entries.map(applyProviderCatalogPolicy);
}

export function applyAnalytics2ProviderApiDocsPolicy<T>(result: T): T {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }

  const docsResult = result as Record<string, unknown>;
  if (!docsResult.catalog) return result;

  return {
    ...docsResult,
    catalog: applyProviderCatalogPolicy(docsResult.catalog),
  } as T;
}

async function resolveAnalytics2ProviderCredential(
  options: ProviderApiCredentialLookupOptions,
) {
  if (
    options.provider === "bigquery" &&
    options.key === "BIGQUERY_PROJECT_ID"
  ) {
    return null;
  }
  if (options.workspaceProvider !== "hubspot") {
    return defaultProviderApiCredentialResolver(options);
  }

  if (!options.connectionId?.trim()) return null;

  const result = await resolveWorkspaceConnectionCredentialForApp({
    appId: ANALYTICS_2_APP_ID,
    provider: "hubspot",
    key: options.key,
    connectionId: options.connectionId,
    userEmail: options.ctx.userEmail,
    ...(options.ctx.orgId === undefined ? {} : { orgId: options.ctx.orgId }),
    ...(options.ctx.credentialScope === "org"
      ? { credentialScope: "org" as const }
      : {}),
  });

  if (result.status === "error") {
    throw new Error(
      "HubSpot connection credentials could not be read. Retry or reconnect the selected connection.",
    );
  }
  if (!result.available || !result.value || !result.provenance) return null;

  const scope = result.provenance.secretScope;
  const scopeId =
    scope === "user"
      ? options.ctx.userEmail
      : scope === "org" || scope === "workspace"
        ? (options.ctx.orgId ?? undefined)
        : undefined;
  return {
    key: result.provenance.resolvedKey,
    value: result.value,
    source: "workspace_connection",
    provider: result.provider,
    ...(result.provenance.connectionId === undefined
      ? {}
      : { connectionId: result.provenance.connectionId }),
    ...(result.provenance.connectionLabel === undefined
      ? {}
      : { connectionLabel: result.provenance.connectionLabel }),
    scope,
    ...(scopeId === undefined ? {} : { scopeId }),
  };
}

export function assertAnalytics2ProviderRequestUrl(
  provider: string,
  url: URL,
): void {
  const classification = classifyBigQueryApiUrl(url.href);
  if (classification === "invalid") {
    fail("The provider request URL is invalid.", {
      errorCode: "provider_request_url_invalid",
      statusCode: 400,
    });
  }
  if (provider.toLowerCase() !== "bigquery" && classification === "bigquery") {
    fail(
      "Use run-bigquery-query with a semantic model for BigQuery SQL and table-row reads.",
      {
        errorCode: "bigquery_semantic_query_required",
        statusCode: 400,
      },
    );
  }
}

function providerRequestUrl(baseUrl: string, path: string): URL {
  const base = new URL(baseUrl);
  const trimmedPath = path.trim();
  if (/^https?:\/\//i.test(trimmedPath)) return new URL(trimmedPath);

  const basePath = base.pathname.replace(/\/+$/, "");
  const requestPath = trimmedPath.replace(/^\/+/, "");
  const baseSegments = basePath.split("/").filter(Boolean);
  const requestSegments = requestPath.split("/").filter(Boolean);
  const pathAlreadyIncludesBase =
    baseSegments.length > 0 &&
    requestSegments.length >= baseSegments.length &&
    baseSegments.every((segment, index) => requestSegments[index] === segment);
  const pathname = pathAlreadyIncludesBase
    ? `/${requestPath}`
    : `${basePath}/${requestPath}`;
  return new URL(pathname, base.origin);
}

async function assertAnalytics2ProviderRequest(
  runtime: ProviderApiRuntime,
  args: ProviderApiRequestArgs,
): Promise<void> {
  const directUrl = args.path.trim();
  if (/^https?:\/\//i.test(directUrl)) {
    let url: URL;
    try {
      url = new URL(directUrl);
    } catch {
      fail("The provider request URL is invalid.", {
        errorCode: "provider_request_url_invalid",
        statusCode: 400,
      });
    }
    assertAnalytics2ProviderRequestUrl(args.provider, url);
    return;
  }

  const [catalogEntry] = (await runtime.listCatalog(args.provider)) as Array<{
    id?: unknown;
    defaultBaseUrl?: unknown;
  }>;
  if (
    catalogEntry?.id !== args.provider ||
    typeof catalogEntry.defaultBaseUrl !== "string"
  ) {
    return;
  }

  let url: URL;
  try {
    url = providerRequestUrl(catalogEntry.defaultBaseUrl, args.path);
  } catch {
    fail("The provider request URL is invalid.", {
      errorCode: "provider_request_url_invalid",
      statusCode: 400,
    });
  }
  assertAnalytics2ProviderRequestUrl(args.provider, url);
}

function createAnalytics2Runtime(
  organizationConnectionId?: string,
  options: { singleAttemptUnsafeRequests?: boolean } = {},
) {
  const providerRuntime = createProviderApiRuntime({
    // The provider token cache is keyed by app and organization, so each
    // connection needs its own cache namespace.
    appId: organizationConnectionId
      ? `${ANALYTICS_2_APP_ID}:${encodeURIComponent(organizationConnectionId)}`
      : ANALYTICS_2_APP_ID,
    providerIds: ANALYTICS_2_PROVIDER_API_IDS,
    localCredentialSource: "analytics_2_local",
    ...(options.singleAttemptUnsafeRequests
      ? { unsafeRequestPolicy: "single-attempt" as const }
      : {}),
    resolveCredential: async (options) => {
      if (
        !organizationConnectionId ||
        options.key !== "GOOGLE_APPLICATION_CREDENTIALS_JSON"
      ) {
        return resolveAnalytics2ProviderCredential(options);
      }
      const result = await resolveWorkspaceConnectionCredentialForApp({
        appId: ANALYTICS_2_APP_ID,
        provider: "bigquery",
        key: options.key,
        connectionId: organizationConnectionId,
        userEmail: options.ctx.userEmail,
        ...(options.ctx.orgId === undefined
          ? {}
          : { orgId: options.ctx.orgId }),
        credentialScope: "org",
      });
      if (
        !result.available ||
        !result.value ||
        !result.provenance ||
        (result.provenance.secretScope !== "org" &&
          result.provenance.secretScope !== "workspace")
      ) {
        fail("The organization connection credential is unavailable.", {
          errorCode: "bigquery_connection_unavailable",
          statusCode: 409,
        });
      }
      const organizationScopeId = options.ctx.orgId ?? undefined;
      return {
        key: result.provenance.resolvedKey,
        value: result.value,
        source: "workspace_connection" as const,
        provider: result.provider,
        ...(result.provenance.connectionId === undefined
          ? {}
          : { connectionId: result.provenance.connectionId }),
        ...(result.provenance.connectionLabel === undefined
          ? {}
          : { connectionLabel: result.provenance.connectionLabel }),
        scope: result.provenance.secretScope,
        ...(organizationScopeId === undefined
          ? {}
          : { scopeId: organizationScopeId }),
      };
    },
    getCredentialContext: () => {
      const context = getCredentialContext();
      if (!context) {
        throw new Error(
          "Analytics 2 provider requests require an authenticated request context.",
        );
      }
      return context;
    },
    getCustomProviders: async () => {
      const context = getCredentialContext();
      if (!context) return [];
      const orgProviders = context.orgId
        ? await listCustomProviders("org", context.orgId)
        : [];
      const userProviders = await listCustomProviders(
        "user",
        context.userEmail,
      );
      const seen = new Set<string>();
      return [...orgProviders, ...userProviders].filter((provider) => {
        if (seen.has(provider.id)) return false;
        seen.add(provider.id);
        return true;
      });
    },
  });

  const runtime: ProviderApiRuntime = {
    ...providerRuntime,
    executeRequest: async (args) => {
      await assertAnalytics2ProviderRequest(providerRuntime, args);
      return providerRuntime.executeRequest(args);
    },
  };
  return runtime;
}

const runtime = createAnalytics2Runtime();
// The workspace query starts a BigQuery job, so its runtime must submit once:
// a retried POST can start a second billed job whose id is lost. The same
// runtime is reused so its quota governor and credential cache are shared.
let organizationQueryRuntime: ProviderApiRuntime | null = null;
const organizationConnectionRuntimes = new Map<string, ProviderApiRuntime>();

export function getAnalytics2ProviderApiRuntime() {
  return runtime;
}

/**
 * The runtime the workspace warehouse query uses when the connection is the
 * organization's default BigQuery connection rather than a named one.
 */
export function getAnalytics2OrganizationQueryProviderApiRuntime() {
  organizationQueryRuntime ??= createAnalytics2Runtime(undefined, {
    singleAttemptUnsafeRequests: true,
  });
  return organizationQueryRuntime;
}

export function getAnalytics2OrganizationConnectionRuntime(
  connectionId: string,
) {
  const key = connectionId.trim();
  let connectionRuntime = organizationConnectionRuntimes.get(key);
  if (!connectionRuntime) {
    connectionRuntime = createAnalytics2Runtime(key);
    organizationConnectionRuntimes.set(key, connectionRuntime);
  }
  return connectionRuntime;
}

export function listAnalytics2ProviderApiIds(): ProviderApiId[] {
  return [...ANALYTICS_2_PROVIDER_API_IDS];
}
