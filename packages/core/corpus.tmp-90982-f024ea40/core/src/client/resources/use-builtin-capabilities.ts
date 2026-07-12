import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentNativePath } from "../api-path.js";
import type { McpServerScope } from "./use-mcp-servers.js";

export type BuiltinCapabilityId =
  | "browser-chrome-devtools"
  | "browser-playwright"
  | "computer-use"
  | "screen-memory";

export interface BuiltinCapability {
  id: BuiltinCapabilityId;
  serverId: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  exclusiveGroup?: string;
  available: boolean;
  unavailableReason?: string;
  notes?: string;
  enabled: { user: boolean; org: boolean };
  mergedIds: { user?: string; org?: string };
  status: {
    user?: BuiltinCapabilityStatus;
    org?: BuiltinCapabilityStatus;
  };
}

export type BuiltinCapabilityStatus =
  | { state: "connected"; toolCount: number }
  | { state: "error"; error: string }
  | { state: "unknown" };

export interface BuiltinCapabilitiesList {
  capabilities: BuiltinCapability[];
  user: { enabledIds: BuiltinCapabilityId[] };
  org: {
    enabledIds: BuiltinCapabilityId[];
    orgId: string | null;
    role: string | null;
  };
}

const ENDPOINT = agentNativePath("/_agent-native/mcp/builtin");
export const BUILTIN_CAPABILITIES_KEY = ["mcp-builtin-capabilities"] as const;

export function useBuiltinCapabilities() {
  return useQuery<BuiltinCapabilitiesList>({
    queryKey: BUILTIN_CAPABILITIES_KEY,
    queryFn: async () => {
      const res = await fetch(ENDPOINT, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      return (await res.json()) as BuiltinCapabilitiesList;
    },
    staleTime: 10_000,
  });
}

export function useToggleBuiltinCapability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: BuiltinCapabilityId;
      scope: McpServerScope;
      enabled: boolean;
    }) => {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error || `Update failed (${res.status})`);
      }
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BUILTIN_CAPABILITIES_KEY });
      qc.invalidateQueries({ queryKey: ["mcp-servers"] });
    },
  });
}

export function mcpBuiltinVirtualId(
  scope: McpServerScope,
  capabilityId: string,
): string {
  return `mcp-builtin:${scope}:${capabilityId}`;
}

export function parseMcpBuiltinVirtualId(
  id: string,
): { scope: McpServerScope; capabilityId: BuiltinCapabilityId } | null {
  const m = /^mcp-builtin:(user|org):(.+)$/.exec(id);
  if (!m) return null;
  const capabilityId = m[2] as BuiltinCapabilityId;
  if (
    capabilityId !== "browser-chrome-devtools" &&
    capabilityId !== "browser-playwright" &&
    capabilityId !== "computer-use" &&
    capabilityId !== "screen-memory"
  ) {
    return null;
  }
  return { scope: m[1] as McpServerScope, capabilityId };
}
