import { fail } from "@agent-native/core/action";
import { getRequestContext } from "@agent-native/core/server";
import {
  createWorkspaceCredentialActions,
  readWorkspaceCredentialProfile,
  resolveWorkspaceConnectionCredentialForApp,
  WorkspaceCredentialError,
  type WorkspaceCredentialServiceOptions,
} from "@agent-native/core/workspace-connections";
import type { z } from "zod";

import { ANALYTICS_CONTROL_IDS } from "../../shared/analytics-control-ids.js";
import {
  postgresEndpointSchema,
  type postgresConnectionCreateSchema,
  type postgresConnectionUpdateSchema,
} from "../../shared/postgres-connection-form.js";
import {
  createPostgresConnector,
  isPostgresProviderEnabled,
  postgresEndpointAuthority,
  type PostgresConnectionConfig,
} from "../execution/postgres-connector.js";
import { requireCurrentWorkspaceCapability } from "../lib/analytics-capabilities.js";
import { requireCurrentWorkspace } from "../lib/workspace-access.js";
import { connectionIncludedForAgent } from "./data-connections.js";
import {
  readDataResourceMetadata,
  readResourcePolicyRevision,
} from "./data-resource-metadata.js";
import { warehouseEditOperation } from "./workspace-warehouse-edit-form.js";

export const POSTGRES_PASSWORD = "POSTGRES_PASSWORD";
export const POSTGRES_CA_CERTIFICATE = "POSTGRES_CA_CERTIFICATE";
const appId = "analytics-2";

export function requirePostgresProvider() {
  if (!isPostgresProviderEnabled())
    fail("PostgreSQL connections are unavailable.", {
      errorCode: "postgres_provider_unavailable",
      statusCode: 503,
    });
}

export async function requirePostgresSetup() {
  const current = await requireCurrentWorkspaceCapability(
    ANALYTICS_CONTROL_IDS.postgresConnectionCreate,
  );
  if (current.request.orgScope === "personal")
    fail("Select a workspace to continue.", {
      errorCode: "workspace_required",
      statusCode: 403,
    });
  requirePostgresProvider();
  return { orgId: current.orgId, ownerEmail: current.ownerEmail };
}

function denied(): never {
  fail("You don’t have access to this data connection.", {
    errorCode: "data_connection_unavailable",
    statusCode: 403,
  });
}

function unreadable(): never {
  fail("The saved PostgreSQL connection could not be read.", {
    errorCode: "data_connection_credentials_unreadable",
    statusCode: 503,
  });
}

export async function readPostgresConnectionProfile(connectionId: string) {
  requirePostgresProvider();
  const profile = await readWorkspaceCredentialProfile({
    appId,
    provider: "postgres",
    connectionId,
    requestContext: getRequestContext(),
  }).catch((error: unknown) => {
    if (error instanceof WorkspaceCredentialError && error.code === "forbidden")
      denied();
    unreadable();
  });
  if (!profile?.active) denied();
  const address = endpoint(profile.connection.config);
  let endpointGeneration: string;
  try {
    endpointGeneration = postgresEndpointAuthority(address);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "warehouse_endpoint_not_allowed"
    )
      denied();
    unreadable();
  }
  return { ...profile, address, endpointGeneration };
}

async function savedPostgresCredential(
  profile: Awaited<ReturnType<typeof readPostgresConnectionProfile>>,
  key: string,
) {
  if (!profile.connection.credentialRefs.some((ref) => ref.key === key))
    return undefined;
  const resolved = await resolveWorkspaceConnectionCredentialForApp({
    appId,
    provider: "postgres",
    connectionId: profile.connection.id,
    key,
    recordUsage: false,
  });
  if (resolved.status === "resolved" && resolved.value) return resolved.value;
  if (resolved.status === "error") unreadable();
  return denied();
}

function endpoint(config: Record<string, unknown>) {
  const parsed = postgresEndpointSchema.safeParse({
    host: config.host,
    port: config.port,
    database: config.database,
    username: config.username,
  });
  if (!parsed.success || config.tls !== "verify-full") unreadable();
  return parsed.data;
}

function requireSameEndpoint(
  stored: Record<string, unknown>,
  submitted: z.infer<typeof postgresEndpointSchema>,
) {
  const previous = endpoint(stored);
  if (
    previous.host !== submitted.host ||
    previous.port !== submitted.port ||
    previous.database !== submitted.database ||
    previous.username !== submitted.username
  )
    fail("Re-enter the password when changing connection details.", {
      errorCode: "postgres_password_required",
      statusCode: 400,
      details: { field: "password" },
    });
}

export async function resolveNotebookPostgresConnection(
  connectionId: string,
  caller: string,
): Promise<{ config: PostgresConnectionConfig; generation: string }> {
  const current = await requireCurrentWorkspace();
  if (current.request.orgScope === "personal") denied();
  const before = await readPostgresConnectionProfile(connectionId);
  if (before.connection.orgId !== current.orgId) denied();
  const scope = { orgId: current.orgId, ownerEmail: current.ownerEmail };
  const options = { bypassCache: true };
  const policyRevision = await readResourcePolicyRevision(
    scope,
    connectionId,
    options,
  );
  if (caller !== "frontend") {
    const metadata = await readDataResourceMetadata(
      scope,
      connectionId,
      undefined,
      options,
    );
    if (
      metadata.resources.some(
        (resource) =>
          resource.kind !== "connection" && resource.aiUsage === "excluded",
      ) ||
      !(await connectionIncludedForAgent(before.connection, options))
    )
      denied();
  }
  const [password, caCertificate] = await Promise.all([
    savedPostgresCredential(before, POSTGRES_PASSWORD),
    savedPostgresCredential(before, POSTGRES_CA_CERTIFICATE),
  ]);
  if (!password) denied();
  const after = await readPostgresConnectionProfile(connectionId);
  if (
    after.revision !== before.revision ||
    after.endpointGeneration !== before.endpointGeneration ||
    policyRevision !==
      (await readResourcePolicyRevision(scope, connectionId, options))
  )
    denied();
  return {
    config: { ...after.address, password, caCertificate },
    generation: `${after.revision}:${after.endpointGeneration}:${policyRevision}`,
  };
}

function createPostgresWarehouseActions(
  beforeUpdateCommit?: WorkspaceCredentialServiceOptions["beforeUpdateCommit"],
) {
  return createWorkspaceCredentialActions({
    appId,
    provider: {
      id: "postgres",
      label: "Postgres",
      credentialKeys: [
        {
          key: POSTGRES_PASSWORD,
          label: "Password",
          required: true,
          preserveWhitespace: true,
        },
        { key: POSTGRES_CA_CERTIFICATE, label: "SSL CA certificate" },
      ],
      configurationFields: [
        { key: "host", label: "Host" },
        { key: "port", label: "Port" },
        { key: "database", label: "Database" },
        { key: "username", label: "Username" },
        { key: "tls", label: "TLS" },
        { key: "descriptionJson", label: "Description" },
        { key: "includeForAI", label: "Include schema data for AI" },
        { key: "warehouseEditOperation", label: "Warehouse form operation" },
      ],
    },
    validationTimeoutMs: 10_000,
    ...(beforeUpdateCommit ? { beforeUpdateCommit } : {}),
    validateCredentials: async ({ config, secretValues, signal }) => {
      const password = secretValues.find(
        ({ key }) => key === POSTGRES_PASSWORD,
      )?.secret;
      if (!password) denied();
      const caCertificate = secretValues.find(
        ({ key }) => key === POSTGRES_CA_CERTIFICATE,
      )?.secret;
      await createPostgresConnector(
        { ...endpoint(config), password, caCertificate },
        requirePostgresProvider,
      ).validate(signal);
    },
  });
}

export const postgresWarehouseActions = createPostgresWarehouseActions();

function privateForm(
  input:
    | z.infer<typeof postgresConnectionCreateSchema>
    | z.infer<typeof postgresConnectionUpdateSchema>,
) {
  const { credential, caCertificate, ...config } = input.form;
  return {
    name: input.name,
    config: {
      ...config,
      ...(input.description === undefined
        ? {}
        : { descriptionJson: JSON.stringify(input.description) }),
      ...(input.includeForAI === undefined
        ? {}
        : { includeForAI: input.includeForAI }),
    },
    secretValues: [
      ...(credential.kind === "replace"
        ? [{ key: POSTGRES_PASSWORD, secret: credential.value }]
        : []),
      ...(caCertificate
        ? [{ key: POSTGRES_CA_CERTIFICATE, secret: caCertificate }]
        : []),
    ],
  };
}

export async function createPostgresWarehouseConnection(
  input: z.infer<typeof postgresConnectionCreateSchema>,
) {
  await requirePostgresSetup();
  return postgresWarehouseActions.create.run(
    { ...privateForm(input), operationId: input.requestId },
    { caller: "frontend" },
  );
}

export async function updatePostgresWarehouseConnection(
  input: z.infer<typeof postgresConnectionUpdateSchema>,
  beforeUpdateCommit: WorkspaceCredentialServiceOptions["beforeUpdateCommit"],
) {
  const scope = await requirePostgresSetup();
  const profile = await readPostgresConnectionProfile(input.connectionId);
  if (input.form.credential.kind === "keep")
    requireSameEndpoint(profile.connection.config, input.form);
  const edit = privateForm(input);
  const operation = warehouseEditOperation(scope, input.requestId);
  if (profile.connection.config.warehouseEditOperation === operation) {
    const savedSecrets = await Promise.all(
      edit.secretValues.map(({ key }) => savedPostgresCredential(profile, key)),
    );
    if (
      profile.connection.label !== edit.name ||
      Object.entries(edit.config).some(
        ([key, value]) => profile.connection.config[key] !== value,
      ) ||
      edit.secretValues.some(
        ({ secret }, index) => secret !== savedSecrets[index],
      )
    )
      fail("The connection update ID has already been used.", {
        errorCode: "data_connection_operation_reused",
        statusCode: 409,
      });
    return { connectionId: input.connectionId };
  }
  return createPostgresWarehouseActions(beforeUpdateCommit).update.run(
    {
      connectionId: input.connectionId,
      revision: input.revision,
      ...edit,
      config: { ...edit.config, warehouseEditOperation: operation },
    },
    { caller: "frontend" },
  );
}

export async function testPostgresWarehouseConnection(
  form: z.infer<typeof postgresConnectionUpdateSchema>["form"],
  connectionId: string | undefined,
  signal: AbortSignal,
) {
  await requirePostgresSetup();
  const profile = connectionId
    ? await readPostgresConnectionProfile(connectionId)
    : undefined;
  const { credential, tls, caCertificate, ...address } = form;
  let password: string;
  if (credential.kind === "replace") {
    password = credential.value;
  } else {
    if (!connectionId || !profile) denied();
    requireSameEndpoint(profile.connection.config, address);
    const saved = await savedPostgresCredential(profile, POSTGRES_PASSWORD);
    if (!saved) denied();
    password = saved;
  }
  const authority =
    caCertificate ??
    (profile
      ? await savedPostgresCredential(profile, POSTGRES_CA_CERTIFICATE)
      : undefined);
  return createPostgresConnector(
    { ...address, password, caCertificate: authority },
    async () => {
      await requirePostgresSetup();
      if (
        connectionId &&
        (await readPostgresConnectionProfile(connectionId)).revision !==
          profile?.revision
      )
        denied();
    },
  ).validate(signal);
}
