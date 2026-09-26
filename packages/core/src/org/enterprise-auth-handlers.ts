import {
  createError,
  defineEventHandler,
  getRequestURL,
  getRouterParam,
  type H3Event,
} from "h3";

import { getAppConfig } from "../app-config/index.js";
import { getDbExec } from "../db/client.js";
import { getConfiguredAppBasePath } from "../server/app-base-path.js";
import { getAppProductionUrl } from "../server/app-url.js";
import { getBetterAuth } from "../server/better-auth-instance.js";
import { publicFrameworkPath } from "../server/framework-route-prefix.js";
import { readBody } from "../server/h3-helpers.js";
import { getOrgContext } from "./context.js";

const ADMIN_ROLES = new Set(["owner", "admin"]);

type BetterAuthApi = Record<
  string,
  (input: Record<string, unknown>) => Promise<unknown>
>;

function requestHeaders(event: H3Event): Headers {
  return new Headers(event.headers);
}

async function requireOrgAdmin(event: H3Event) {
  const { getSession } = await import("../server/auth.js");
  const session = await getSession(event);
  if (!session?.email) {
    throw createError({ statusCode: 401, message: "Authentication required" });
  }
  const org = await getOrgContext(event);
  if (!org.orgId || !org.role || !ADMIN_ROLES.has(org.role)) {
    throw createError({
      statusCode: 403,
      message:
        "Only organization owners and admins may manage identity providers",
    });
  }
  return { session, org };
}

function ensureFeatureEnabled(feature: "sso" | "scim"): void {
  if (!getAppConfig().access[feature].enabled) {
    throw createError({
      statusCode: 404,
      message: `${feature.toUpperCase()} is not enabled for this deployment`,
    });
  }
}

function authApi(auth: unknown): BetterAuthApi {
  const api = (auth as { api?: unknown })?.api;
  if (!api || typeof api !== "object") {
    throw createError({
      statusCode: 503,
      message: "Authentication is unavailable",
    });
  }
  return api as BetterAuthApi;
}

function isMissingBetterAuthOrganizationMembership(error: unknown): boolean {
  const value = error as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
    body?: { message?: unknown };
  };
  const code = String(value.code ?? value.status ?? "").toUpperCase();
  const message = String(value.message ?? value.body?.message ?? "");
  return (
    (code === "BAD_REQUEST" || code === "400") &&
    /not a member of the organization/i.test(message)
  );
}

function isBetterAuthProviderAccessDenied(error: unknown): boolean {
  const value = error as {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
    body?: { message?: unknown };
  };
  const code = String(
    value.code ?? value.status ?? value.statusCode ?? "",
  ).toUpperCase();
  const message = String(value.message ?? value.body?.message ?? "");
  return (
    code === "FORBIDDEN" ||
    code === "403" ||
    /(?:do not|don't|does not) have access to this provider/i.test(message)
  );
}

type VerificationRecord = {
  identifier?: unknown;
  value?: unknown;
  expiresAt?: unknown;
};

async function verifyDomainForFrameworkProvider(
  provider: SSOProviderRow,
): Promise<void> {
  if (provider.domain_verified === true) {
    throw createError({
      statusCode: 409,
      message: "Domain has already been verified",
    });
  }

  const identifier = `_better-auth-token-${provider.provider_id}`;
  if (identifier.length > 63) {
    throw createError({
      statusCode: 400,
      message:
        "Verification identifier exceeds the DNS label limit of 63 characters",
    });
  }

  const auth = await getBetterAuth();
  const authContext = await (
    auth as unknown as {
      $context?: Promise<{
        internalAdapter?: {
          findVerificationValue?: (
            key: string,
          ) => Promise<VerificationRecord | null>;
        };
      }>;
    }
  ).$context;
  const verification =
    (await authContext?.internalAdapter?.findVerificationValue?.(identifier)) ??
    null;
  const expiresAt = new Date(String(verification?.expiresAt ?? ""));
  if (
    !verification ||
    typeof verification.value !== "string" ||
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() <= Date.now()
  ) {
    throw createError({
      statusCode: 404,
      message: "No pending domain verification exists",
    });
  }

  const domains = provider.domain
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (domains.length === 0 || domains.some((domain) => /[/:\\]/.test(domain))) {
    throw createError({ statusCode: 400, message: "Invalid domain" });
  }

  const dns = await import("node:dns/promises");
  const expected = `${identifier}=${verification.value}`;
  for (const domain of domains) {
    let records: string[][];
    try {
      records = await dns.resolveTxt(`${identifier}.${domain}`);
    } catch {
      throw createError({
        statusCode: 502,
        message: `Unable to verify domain ownership for ${domain}. Try again later`,
      });
    }
    const matches = records
      .map((record) => record.join(""))
      .some((record) => {
        const normalized = record.trim();
        return normalized === expected || normalized === verification.value;
      });
    if (!matches) {
      throw createError({
        statusCode: 502,
        message: `Unable to verify domain ownership for ${domain}. Try again later`,
      });
    }
  }

  const updated = await getDbExec().execute({
    sql: `UPDATE sso_provider
          SET domain_verified = TRUE
          WHERE provider_id = ?
            AND organization_id = ?
            AND domain = ?
            AND (domain_verified IS NULL OR domain_verified = FALSE)`,
    args: [provider.provider_id, provider.organization_id, provider.domain],
  });
  if (Number(updated.rowsAffected ?? 0) !== 1) {
    throw createError({
      statusCode: 409,
      message: "SSO provider changed while verification was in progress",
    });
  }
}

function authRoot(event: H3Event): string {
  const origin = getAppProductionUrl(event).replace(/\/$/, "");
  const basePath = getConfiguredAppBasePath();
  return publicFrameworkPath(`${origin}${basePath}/_agent-native/auth/ba`);
}

function providerIdFromEvent(event: H3Event): string {
  const routed = getRouterParam(event, "providerId");
  if (routed) return decodeURIComponent(routed);
  const path = getRequestURL(event).pathname;
  const match = path.match(
    /(?:\/sso\/providers\/|^\/)([^/]+)(?:\/verify)?\/?$/,
  );
  if (!match?.[1]) {
    throw createError({ statusCode: 400, message: "providerId is required" });
  }
  return decodeURIComponent(match[1]);
}

function connectionIdFromEvent(event: H3Event): string {
  const routed = getRouterParam(event, "connectionId");
  if (routed) return decodeURIComponent(routed);
  const path = getRequestURL(event).pathname;
  const match = path.match(/(?:\/scim\/|^\/)([^/]+)\/?$/);
  if (!match?.[1]) {
    throw createError({ statusCode: 400, message: "connectionId is required" });
  }
  return decodeURIComponent(match[1]);
}

type SSOProviderRow = {
  id: string;
  issuer: string;
  oidc_config: string | null;
  saml_config: string | null;
  provider_id: string;
  organization_id: string | null;
  domain: string;
  domain_verified: boolean | null;
};

function providerSummary(row: SSOProviderRow, event: H3Event) {
  const providerType = row.saml_config ? "saml" : "oidc";
  return {
    providerId: row.provider_id,
    issuer: row.issuer,
    domain: row.domain,
    domainVerified: row.domain_verified === true,
    type: providerType as "oidc" | "saml",
    redirectURI: `${authRoot(event)}/sso/callback/${encodeURIComponent(row.provider_id)}`,
    spMetadataUrl:
      providerType === "saml"
        ? `${authRoot(event)}/sso/saml2/sp/metadata?providerId=${encodeURIComponent(row.provider_id)}`
        : "",
  };
}

async function listOrganizationSSOProviders(event: H3Event, orgId: string) {
  const result = await getDbExec().execute({
    sql: `SELECT id, issuer, oidc_config, saml_config, provider_id,
                 organization_id, domain, domain_verified
          FROM sso_provider
          WHERE organization_id = ?
          ORDER BY provider_id ASC`,
    args: [orgId],
  });
  return result.rows.map((row) =>
    providerSummary(row as unknown as SSOProviderRow, event),
  );
}

export const listSSOProvidersHandler = defineEventHandler(
  async (event: H3Event) => {
    ensureFeatureEnabled("sso");
    const { org } = await requireOrgAdmin(event);
    return {
      enabled: true,
      providers: await listOrganizationSSOProviders(event, org.orgId!),
    };
  },
);

export const createSSOProviderHandler = defineEventHandler(
  async (event: H3Event) => {
    ensureFeatureEnabled("sso");
    const { session, org } = await requireOrgAdmin(event);
    const body = await readBody<{
      providerId?: string;
      issuer?: string;
      domain?: string;
      type?: "oidc" | "saml";
      oidcConfig?: Record<string, unknown>;
      samlConfig?: Record<string, unknown>;
    }>(event);
    const providerId = body.providerId?.trim();
    const issuer = body.issuer?.trim();
    const domain = body.domain?.trim().toLowerCase();
    if (!providerId || !issuer || !domain || !body.type) {
      throw createError({
        statusCode: 400,
        message: "providerId, issuer, domain, and type are required",
      });
    }
    const orgRow = (
      await getDbExec().execute({
        sql: `SELECT allowed_domain FROM organizations WHERE id = ?`,
        args: [org.orgId],
      })
    ).rows[0];
    const allowedDomain =
      typeof orgRow?.allowed_domain === "string"
        ? orgRow.allowed_domain.trim().toLowerCase()
        : "";
    if (!org.orgId || !allowedDomain) {
      throw createError({
        statusCode: 400,
        message: "Set an allowed organization domain before configuring SSO",
      });
    }
    if (domain !== allowedDomain) {
      throw createError({
        statusCode: 400,
        message: "The SSO domain must match the organization's allowed domain",
      });
    }
    const providerPayload: Record<string, unknown> = {
      providerId,
      issuer,
      domain,
      organizationId: org.orgId,
    };
    if (body.type === "oidc") {
      if (!body.oidcConfig) {
        throw createError({
          statusCode: 400,
          message: "OIDC configuration is required",
        });
      }
      providerPayload.oidcConfig = body.oidcConfig;
    } else {
      if (!body.samlConfig) {
        throw createError({
          statusCode: 400,
          message: "SAML configuration is required",
        });
      }
      providerPayload.samlConfig = body.samlConfig;
    }
    try {
      const providerAPI = authApi(await getBetterAuth());
      let result: unknown;
      try {
        result = await providerAPI.registerSSOProvider({
          headers: requestHeaders(event),
          body: providerPayload,
        });
      } catch (error) {
        if (!isMissingBetterAuthOrganizationMembership(error)) throw error;
        const frameworkOnlyPayload = { ...providerPayload };
        delete frameworkOnlyPayload.organizationId;
        result = await providerAPI.registerSSOProvider({
          headers: requestHeaders(event),
          body: frameworkOnlyPayload,
        });
      }
      await getDbExec().execute({
        sql: `UPDATE sso_provider
              SET organization_id = ?
              WHERE provider_id = ?
                AND (organization_id IS NULL OR organization_id = ?)`,
        args: [org.orgId, providerId, org.orgId],
      });
      const providers = await listOrganizationSSOProviders(event, org.orgId);
      const provider = providers.find((item) => item.providerId === providerId);
      if (!provider) {
        throw createError({
          statusCode: 502,
          message: "SSO provider was not persisted",
        });
      }
      const verificationToken =
        result && typeof result === "object"
          ? (result as { domainVerificationToken?: unknown })
              .domainVerificationToken
          : undefined;
      return {
        provider,
        ...(typeof verificationToken === "string"
          ? { domainVerificationToken: verificationToken }
          : {}),
        registeredBy: session.email,
      };
    } catch (error) {
      if (error && typeof error === "object" && "statusCode" in error)
        throw error;
      throw createError({
        statusCode: 400,
        message:
          error instanceof Error
            ? error.message
            : "Unable to register SSO provider",
      });
    }
  },
);

export const verifySSOProviderHandler = defineEventHandler(
  async (event: H3Event) => {
    ensureFeatureEnabled("sso");
    const { org } = await requireOrgAdmin(event);
    const providerId = providerIdFromEvent(event);
    const provider = (
      await getDbExec().execute({
        sql: `SELECT provider_id, organization_id, domain, domain_verified
              FROM sso_provider
              WHERE provider_id = ? AND organization_id = ?`,
        args: [providerId, org.orgId],
      })
    ).rows[0] as unknown as SSOProviderRow | undefined;
    if (!provider)
      throw createError({ statusCode: 404, message: "SSO provider not found" });
    try {
      await authApi(await getBetterAuth()).verifyDomain({
        headers: requestHeaders(event),
        body: { providerId },
      });
    } catch (error) {
      if (isBetterAuthProviderAccessDenied(error)) {
        await verifyDomainForFrameworkProvider(provider);
        const providers = await listOrganizationSSOProviders(event, org.orgId!);
        return {
          provider:
            providers.find((item) => item.providerId === providerId) ?? null,
        };
      }
      if (error && typeof error === "object" && "statusCode" in error)
        throw error;
      throw createError({
        statusCode: 502,
        message:
          error instanceof Error
            ? error.message
            : "Unable to verify SSO domain",
      });
    }
    const providers = await listOrganizationSSOProviders(event, org.orgId!);
    return {
      provider:
        providers.find((item) => item.providerId === providerId) ?? null,
    };
  },
);

export const deleteSSOProviderHandler = defineEventHandler(
  async (event: H3Event) => {
    ensureFeatureEnabled("sso");
    const { org } = await requireOrgAdmin(event);
    const providerId = providerIdFromEvent(event);
    const row = (
      await getDbExec().execute({
        sql: `SELECT provider_id FROM sso_provider
              WHERE provider_id = ? AND organization_id = ?`,
        args: [providerId, org.orgId],
      })
    ).rows[0];
    if (!row)
      throw createError({ statusCode: 404, message: "SSO provider not found" });
    const requiredProvider = (
      await getDbExec().execute({
        sql: `SELECT required_auth_provider FROM organizations WHERE id = ?`,
        args: [org.orgId],
      })
    ).rows[0]?.required_auth_provider;
    if (requiredProvider === `sso:${providerId}`) {
      throw createError({
        statusCode: 409,
        message:
          "Clear this organization's required SSO provider before removing it",
      });
    }
    try {
      await authApi(await getBetterAuth()).deleteSSOProvider({
        headers: requestHeaders(event),
        body: { providerId },
      });
    } catch (error) {
      if (!isBetterAuthProviderAccessDenied(error)) throw error;
      const db = getDbExec();
      if (db.transaction) {
        await db.transaction(async (tx) => {
          await tx.execute({
            sql: `DELETE FROM "account" WHERE provider_id = ?`,
            args: [providerId],
          });
          await tx.execute({
            sql: `DELETE FROM sso_provider
                  WHERE provider_id = ? AND organization_id = ?`,
            args: [providerId, org.orgId],
          });
        });
      } else {
        await db.execute({
          sql: `DELETE FROM "account" WHERE provider_id = ?`,
          args: [providerId],
        });
        await db.execute({
          sql: `DELETE FROM sso_provider
                WHERE provider_id = ? AND organization_id = ?`,
          args: [providerId, org.orgId],
        });
      }
    }
    return { ok: true };
  },
);

export const getSCIMHandler = defineEventHandler(async (event: H3Event) => {
  ensureFeatureEnabled("scim");
  const { org } = await requireOrgAdmin(event);
  const result = await authApi(
    await getBetterAuth(),
  ).listSCIMManagedConnections({
    headers: requestHeaders(event),
    body: { provisioningDomainId: org.orgId },
  });
  if (
    !result ||
    typeof result !== "object" ||
    !Array.isArray((result as { connections?: unknown }).connections)
  ) {
    throw createError({
      statusCode: 502,
      message: "SCIM connections could not be read",
    });
  }
  const connections = (
    result as { connections: Array<Record<string, unknown>> }
  ).connections;
  return {
    enabled: true,
    endpoint: `${authRoot(event)}/scim/v2`,
    connections: connections.map((connection) => ({
      connectionId: String(connection.connectionId ?? connection.id ?? ""),
      status: String(connection.status ?? "active"),
      createdAt:
        connection.createdAt instanceof Date
          ? connection.createdAt.toISOString()
          : String(connection.createdAt ?? ""),
    })),
  };
});

export const createSCIMHandler = defineEventHandler(async (event: H3Event) => {
  ensureFeatureEnabled("scim");
  const { session, org } = await requireOrgAdmin(event);
  const result = await authApi(
    await getBetterAuth(),
  ).createSCIMManagedConnection({
    headers: requestHeaders(event),
    body: {
      scopes: [
        "scim.users.read",
        "scim.users.write",
        "scim.groups.read",
        "scim.groups.write",
      ],
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      creationRequestId: newIdempotencyId(),
      provisioningDomainId: org.orgId,
      actorId: session.email,
    },
  });
  if (!result || typeof result !== "object") {
    throw createError({
      statusCode: 502,
      message: "SCIM connection was not created",
    });
  }
  const value = result as {
    connection?: Record<string, unknown>;
    token?: unknown;
  };
  if (typeof value.token !== "string" || !value.connection) {
    throw createError({
      statusCode: 502,
      message: "SCIM did not return a one-time token",
    });
  }
  return {
    connection: {
      connectionId: String(
        value.connection.connectionId ?? value.connection.id ?? "",
      ),
      status: String(value.connection.status ?? "active"),
      createdAt:
        value.connection.createdAt instanceof Date
          ? value.connection.createdAt.toISOString()
          : String(value.connection.createdAt ?? ""),
    },
    token: value.token,
  };
});

export const deleteSCIMHandler = defineEventHandler(async (event: H3Event) => {
  ensureFeatureEnabled("scim");
  const { session, org } = await requireOrgAdmin(event);
  const connectionId = connectionIdFromEvent(event);
  const result = await authApi(
    await getBetterAuth(),
  ).decommissionSCIMManagedConnection({
    headers: requestHeaders(event),
    body: {
      connectionId,
      provisioningDomainId: org.orgId,
      actorId: session.email,
    },
  });
  return result ?? { ok: true };
});

function newIdempotencyId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}
