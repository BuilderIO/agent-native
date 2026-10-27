import { accessFilter } from "@agent-native/core/sharing";
import { resolveWorkspaceConnectionForApp } from "@agent-native/core/workspace-connections";
import { and, inArray } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import {
  isConnectedCrmProvider,
  type ConnectedCrmProvider,
} from "./adapter.js";

const CRM_APP_ID = "crm";

const HUBSPOT_OBJECT_TYPE_IDS: Record<string, string> = {
  contact: "0-1",
  contacts: "0-1",
  company: "0-2",
  companies: "0-2",
  deal: "0-3",
  deals: "0-3",
  ticket: "0-5",
  tickets: "0-5",
};

export type ProviderRecordLinkUnavailableReason =
  | "missing-portal-id"
  | "unsupported-object-type"
  | "invalid-remote-id"
  | "missing-instance-url"
  | "workspace-connection-unavailable";

export type ProviderRecordLink =
  | { available: true; url: string }
  | { available: false; reason: ProviderRecordLinkUnavailableReason };

const HUBSPOT_PORTAL_ID = /^\d{1,20}$/;
const HUBSPOT_OBJECT_TYPE_ID = /^\d{1,4}-\d{1,10}$/;
const HUBSPOT_REMOTE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SALESFORCE_OBJECT_API_NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const SALESFORCE_RECORD_ID = /^[A-Za-z0-9]{15,18}$/;

function hubSpotObjectTypeId(objectType: string): string | null {
  const normalized = objectType.trim().toLowerCase();
  if (HUBSPOT_OBJECT_TYPE_ID.test(normalized)) return normalized;
  return HUBSPOT_OBJECT_TYPE_IDS[normalized] ?? null;
}

function salesforceOrigin(configured: string): string | null {
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const trustedHost =
    host === "salesforce.com" ||
    host.endsWith(".salesforce.com") ||
    host.endsWith(".force.com");
  if (
    url.protocol !== "https:" ||
    !trustedHost ||
    url.port ||
    url.username ||
    url.password
  ) {
    return null;
  }
  return url.origin;
}

export function buildProviderRecordUrl(input: {
  provider: ConnectedCrmProvider;
  objectType: string;
  remoteId: string;
  portalId?: string | null;
  instanceUrl?: string | null;
}): ProviderRecordLink {
  const remoteId = input.remoteId.trim();
  if (input.provider === "hubspot") {
    const portalId = input.portalId?.trim();
    if (!portalId || !HUBSPOT_PORTAL_ID.test(portalId)) {
      return { available: false, reason: "missing-portal-id" };
    }
    const objectTypeId = hubSpotObjectTypeId(input.objectType);
    if (!objectTypeId) {
      return { available: false, reason: "unsupported-object-type" };
    }
    if (!HUBSPOT_REMOTE_ID.test(remoteId)) {
      return { available: false, reason: "invalid-remote-id" };
    }
    return {
      available: true,
      url: `https://app.hubspot.com/contacts/${portalId}/record/${objectTypeId}/${remoteId}`,
    };
  }

  const configured = input.instanceUrl?.trim();
  if (!configured) return { available: false, reason: "missing-instance-url" };
  const origin = salesforceOrigin(configured);
  if (!origin) return { available: false, reason: "missing-instance-url" };
  const objectApiName = input.objectType.trim();
  if (!SALESFORCE_OBJECT_API_NAME.test(objectApiName)) {
    return { available: false, reason: "unsupported-object-type" };
  }
  if (!SALESFORCE_RECORD_ID.test(remoteId)) {
    return { available: false, reason: "invalid-remote-id" };
  }
  return {
    available: true,
    url: `${origin}/lightning/r/${objectApiName}/${remoteId}/view`,
  };
}

type ConnectionLinkContext =
  | { portalId: string | null; instanceUrl?: undefined }
  | { instanceUrl: string | null; portalId?: undefined }
  | { unavailable: ProviderRecordLinkUnavailableReason };

async function connectionLinkContext(input: {
  provider: ConnectedCrmProvider;
  accountId: string | null;
  workspaceConnectionId: string | null;
}): Promise<ConnectionLinkContext> {
  if (input.provider === "hubspot") return { portalId: input.accountId };
  const resolved = await resolveWorkspaceConnectionForApp({
    appId: CRM_APP_ID,
    provider: "salesforce",
    ...(input.workspaceConnectionId
      ? { connectionId: input.workspaceConnectionId }
      : {}),
  });
  if (!resolved.available || !resolved.connection) {
    return { unavailable: "workspace-connection-unavailable" };
  }
  const config = resolved.connection.config as
    | Record<string, unknown>
    | undefined;
  const instanceUrl = ["instanceUrl", "instance_url", "salesforceInstanceUrl"]
    .map((key) => config?.[key])
    .find(
      (value): value is string => typeof value === "string" && !!value.trim(),
    );
  return { instanceUrl: instanceUrl ?? null };
}

function linkFromContext(
  context: ConnectionLinkContext,
  record: {
    provider: ConnectedCrmProvider;
    objectType: string;
    remoteId: string;
  },
): ProviderRecordLink {
  if ("unavailable" in context) {
    return { available: false, reason: context.unavailable };
  }
  return buildProviderRecordUrl({
    provider: record.provider,
    objectType: record.objectType,
    remoteId: record.remoteId,
    portalId: context.portalId ?? null,
    instanceUrl: context.instanceUrl ?? null,
  });
}

export async function resolveProviderRecordLink(input: {
  provider: ConnectedCrmProvider;
  objectType: string;
  remoteId: string;
  accountId: string | null;
  workspaceConnectionId: string | null;
}): Promise<ProviderRecordLink> {
  return linkFromContext(await connectionLinkContext(input), input);
}

export async function resolveProviderRecordLinks(
  recordIds: string[],
): Promise<Map<string, ProviderRecordLink>> {
  const links = new Map<string, ProviderRecordLink>();
  const ids = [...new Set(recordIds)];
  if (!ids.length) return links;
  const db = getDb();
  const records = await db
    .select({
      id: schema.crmRecords.id,
      connectionId: schema.crmRecords.connectionId,
      provider: schema.crmRecords.provider,
      objectType: schema.crmRecords.objectType,
      remoteId: schema.crmRecords.remoteId,
    })
    .from(schema.crmRecords)
    .where(
      and(
        inArray(schema.crmRecords.id, ids),
        accessFilter(schema.crmRecords, schema.crmRecordShares),
      ),
    );
  const connectedRecords = records.filter((record) =>
    isConnectedCrmProvider(record.provider),
  );
  if (!connectedRecords.length) return links;
  const connections = await db
    .select({
      id: schema.crmConnections.id,
      accountId: schema.crmConnections.accountId,
      workspaceConnectionId: schema.crmConnections.workspaceConnectionId,
    })
    .from(schema.crmConnections)
    .where(
      and(
        inArray(schema.crmConnections.id, [
          ...new Set(connectedRecords.map((record) => record.connectionId)),
        ]),
        accessFilter(schema.crmConnections, schema.crmConnectionShares),
      ),
    );
  const connectionById = new Map(
    connections.map((connection) => [connection.id, connection]),
  );
  const contextByConnectionId = new Map<string, ConnectionLinkContext>();
  for (const record of connectedRecords) {
    const connection = connectionById.get(record.connectionId);
    if (!connection) continue;
    const provider = record.provider as ConnectedCrmProvider;
    let context = contextByConnectionId.get(record.connectionId);
    if (!context) {
      context = await connectionLinkContext({
        provider,
        accountId: connection.accountId,
        workspaceConnectionId: connection.workspaceConnectionId,
      });
      contextByConnectionId.set(record.connectionId, context);
    }
    links.set(record.id, linkFromContext(context, { ...record, provider }));
  }
  return links;
}
