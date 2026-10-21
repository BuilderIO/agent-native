/**
 * Org App Directory — pure logic for `GET /_agent-native/org/apps`.
 *
 * Dispatch is the workspace control plane / identity authority. This module
 * lets a SIBLING org app (mail, calendar, …) ask Dispatch "which agent-native
 * apps belong to my org and what are their A2A endpoint URLs?" so cross-app
 * auto-wiring needs zero manual setup on each app.
 *
 * The HTTP wiring (session/route mounting, request reading) lives in
 * `server/plugins/org-apps-directory.ts`. This file stays pure so it is
 * trivially unit-testable with no Nitro / DB dependencies.
 *
 * Authentication is performed by Core's A2A verifier in the HTTP handler.
 * This module contains only transport-independent response and cache logic.
 */

export const ORG_APPS_PATH = "/_agent-native/org/apps";

export function extractBearerToken(
  authHeader: string | null | undefined,
): string | null {
  if (typeof authHeader !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const tok = m?.[1]?.trim();
  return tok && tok.length > 0 ? tok : null;
}

export interface OrgAppDirectoryEntry {
  id: string;
  name: string;
  url: string;
  a2aUrl: string;
  description?: string;
  whenToUse?: string[];
  capabilities?: string;
}

export interface OrgAppDirectoryResponse {
  org: string;
  apps: OrgAppDirectoryEntry[];
}

const A2A_ENDPOINT_PATH = "/_agent-native/a2a";

export function toA2aUrl(appUrl: string): string {
  const trimmed = appUrl.replace(/\/+$/, "");
  return `${trimmed}${A2A_ENDPOINT_PATH}`;
}

export interface DiscoveredAppLike {
  id: string;
  name: string;
  description?: string;
  whenToUse?: string[];
  url: string;
  source?: "workspace" | "org-directory" | "remote-agent" | "builtin";
}

export function buildOrgAppsResponse(input: {
  org: string;
  apps: DiscoveredAppLike[];
  selfId?: string;
}): OrgAppDirectoryResponse {
  const seen = new Set<string>();
  const apps: OrgAppDirectoryEntry[] = [];
  for (const app of input.apps) {
    if (!app || typeof app.id !== "string" || !app.id.trim()) continue;
    if (input.selfId && app.id === input.selfId) continue;
    const url = typeof app.url === "string" ? app.url.trim() : "";
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(app.id)) continue;
    seen.add(app.id);
    const entry: OrgAppDirectoryEntry = {
      id: app.id,
      name: typeof app.name === "string" && app.name.trim() ? app.name : app.id,
      url: url.replace(/\/+$/, ""),
      a2aUrl: toA2aUrl(url),
    };
    const cap =
      typeof app.description === "string" && app.description.trim()
        ? app.description.trim()
        : undefined;
    if (cap) {
      entry.description = cap;
      entry.capabilities = cap;
    }
    if (Array.isArray(app.whenToUse)) {
      const whenToUse = app.whenToUse
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
      if (whenToUse.length) entry.whenToUse = whenToUse;
    }
    apps.push(entry);
  }
  apps.sort((a, b) => a.id.localeCompare(b.id));
  return { org: input.org, apps };
}
