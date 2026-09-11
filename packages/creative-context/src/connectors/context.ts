import {
  putPrivateBlob,
  readPrivateBlob,
} from "@agent-native/core/private-blob";
import { createProviderApiRuntime } from "@agent-native/core/provider-api";
import {
  listWorkspaceConnectionsForApp,
  resolveWorkspaceConnectionForApp,
} from "@agent-native/core/workspace-connections";

import { LayeredRenderedPageProvider } from "./rendered-page.js";
import type { ContextConnectorExecutionContext } from "./types.js";

const CREATIVE_CONTEXT_PROVIDER_IDS = [
  "figma",
  "google_drive",
  "google_slides",
  "notion",
] as const;

export interface CreateContextConnectorExecutionContextOptions {
  appId: string;
  ownerEmail?: string;
  signal?: AbortSignal;
}

export function createDefaultContextConnectorExecutionContext(
  options: CreateContextConnectorExecutionContextOptions,
): ContextConnectorExecutionContext {
  const appId = options.appId.trim();
  if (!appId) throw new Error("appId is required.");
  return {
    appId,
    ownerEmail: options.ownerEmail,
    signal: options.signal,
    providerApi: createProviderApiRuntime({
      appId,
      providerIds: CREATIVE_CONTEXT_PROVIDER_IDS,
      localCredentialSource: "creative_context",
    }),
    resolveConnection: createWorkspaceConnectionResolver(appId),
    renderedPages: new LayeredRenderedPageProvider(),
    putPrivateBlob,
    readPrivateBlob,
  };
}

export function createWorkspaceConnectionResolver(appId: string) {
  const normalizedAppId = appId.trim();
  if (!normalizedAppId) throw new Error("appId is required.");
  return async (
    provider: string,
    requestedConnectionId?: string,
  ): Promise<string | undefined> => {
    if (!requestedConnectionId) {
      const candidates = (
        await listWorkspaceConnectionsForApp({
          appId: normalizedAppId,
          provider,
        })
      ).filter((connection) => connection.status === "connected");
      if (candidates.length === 1) return candidates[0].id;
      if (candidates.length === 0) {
        throw new Error(
          `No connected ${provider} workspace connection is granted to ${normalizedAppId}.`,
        );
      }
      throw new Error(
        `Multiple ${provider} workspace connections are granted to ${normalizedAppId}; select a connectionId explicitly.`,
      );
    }
    const resolved = await resolveWorkspaceConnectionForApp({
      appId: normalizedAppId,
      provider,
      connectionId: requestedConnectionId,
      requireConnected: true,
    });
    if (!resolved.available || !resolved.connection) {
      throw new Error(resolved.reason);
    }
    return resolved.connection.id;
  };
}
