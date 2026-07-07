import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

import {
  DESIGN_AGENT_CONTEXT_ENDPOINT,
  DESIGN_AGENT_RESOURCE_KIND,
} from "../../shared/agent-readable.js";
import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

function isLocalDevRuntime(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    !process.env.NETLIFY &&
    !process.env.VERCEL &&
    !process.env.AWS_LAMBDA_FUNCTION_NAME &&
    !process.env.CF_PAGES
  );
}

function isLoopbackHttpUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "::1" ||
      host === "[::1]" ||
      /^127(?:\.\d{1,3}){3}$/.test(host)
    );
  } catch {
    return false;
  }
}

function isLoopbackLocalhostDesign(design: any): boolean {
  if (!isLocalDevRuntime()) return false;
  let data: any;
  try {
    data = typeof design?.data === "string" ? JSON.parse(design.data) : null;
  } catch {
    return false;
  }
  if (!data || data.sourceMode !== "localhost") return false;

  const metadataEntries = Object.values(
    data.localhostScreens ?? data.screenMetadata ?? {},
  ) as any[];
  if (metadataEntries.length === 0) return false;

  return metadataEntries.every((entry) => {
    if (!entry || entry.sourceType !== "localhost") return false;
    const previewUrl = entry.previewUrl ?? entry.url;
    if (!isLoopbackHttpUrl(previewUrl)) return false;
    return !entry.bridgeUrl || isLoopbackHttpUrl(entry.bridgeUrl);
  });
}

registerShareableResource({
  type: "design",
  resourceTable: schema.designs,
  sharesTable: schema.designShares,
  displayName: "Design",
  titleColumn: "title",
  getResourcePath: (design) => `/design/${design.id}`,
  agentReadable: {
    resourceKind: DESIGN_AGENT_RESOURCE_KIND,
    getContextPath: () => DESIGN_AGENT_CONTEXT_ENDPOINT,
  },
  getDb,
  publicAccessRole: (design) =>
    isLoopbackLocalhostDesign(design) ? "editor" : "viewer",
});

registerShareableResource({
  type: "design-system",
  resourceTable: schema.designSystems,
  sharesTable: schema.designSystemShares,
  displayName: "Design System",
  titleColumn: "title",
  getResourcePath: (designSystem) =>
    `/design-systems?designSystemId=${designSystem.id}`,
  getDb,
});
