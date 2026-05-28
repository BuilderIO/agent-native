import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  agentNativePath,
  appBasePath,
  appPath,
} from "@agent-native/core/client";
import { pathFromView, viewFromPath, type BrainView } from "@/lib/brain";
import { TAB_ID } from "@/lib/tab-id";

export interface NavigationState {
  view: BrainView;
  path?: string;
  query?: string;
  source?: string;
  sourceType?: string;
  type?: string;
  provider?: string;
  status?: string;
  issue?: string;
  askQuestion?: string;
  limit?: number;
  priority?: string;
  sourceId?: string;
  knowledgeId?: string;
  captureId?: string;
  proposalId?: string;
  selectedKnowledgeId?: string;
  reviewItemId?: string;
  settingsSection?: string;
  extensionId?: string;
  _ts?: number;
}

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    const localPathname = routerPath(location.pathname);
    const params = new URLSearchParams(location.search);
    const state: NavigationState = {
      view: viewFromPath(localPathname),
      path: appPath(`${localPathname}${location.search}`),
      query: params.get("q") || undefined,
      source: params.get("source") || undefined,
      sourceType: params.get("type") || undefined,
      type: params.get("type") || undefined,
      provider: params.get("provider") || undefined,
      status: params.get("status") || undefined,
      issue: params.get("issue") || undefined,
      askQuestion: params.get("ask") || undefined,
      limit: parseLimit(params.get("limit")),
      priority: params.get("priority") || undefined,
      sourceId: params.get("sourceId") || undefined,
      selectedKnowledgeId: params.get("knowledgeId") || undefined,
      reviewItemId: params.get("reviewItemId") || undefined,
      settingsSection: params.get("section") || undefined,
      extensionId: extensionIdFromPath(localPathname),
    };

    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        "X-Request-Source": TAB_ID,
      },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname, location.search]);

  const { data: navCommand } = useQuery<NavigationState | null>({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/application-state/navigate"),
        { headers: { "X-Request-Source": TAB_ID } },
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data ? { ...data, _ts: Date.now() } : null;
    },
    refetchInterval: 2_000,
    structuralSharing: false,
  });

  useEffect(() => {
    if (!navCommand) return;

    fetch(agentNativePath("/_agent-native/application-state/navigate"), {
      method: "DELETE",
      headers: {
        "X-Agent-Native-CSRF": "1",
        "X-Request-Source": TAB_ID,
      },
    }).catch(() => {});

    const params = new URLSearchParams();
    if (navCommand.query) params.set("q", navCommand.query);
    if (navCommand.source) params.set("source", navCommand.source);
    if (navCommand.type || navCommand.sourceType) {
      params.set("type", navCommand.type ?? navCommand.sourceType ?? "");
    }
    if (navCommand.provider) params.set("provider", navCommand.provider);
    if (navCommand.status) params.set("status", navCommand.status);
    if (navCommand.issue) params.set("issue", navCommand.issue);
    if (navCommand.askQuestion) params.set("ask", navCommand.askQuestion);
    if (navCommand.limit) params.set("limit", String(navCommand.limit));
    if (navCommand.priority) params.set("priority", navCommand.priority);
    if (navCommand.sourceId) params.set("sourceId", navCommand.sourceId);
    const knowledgeId =
      navCommand.knowledgeId ?? navCommand.selectedKnowledgeId;
    if (knowledgeId) {
      params.set("knowledgeId", knowledgeId);
    }
    // Captures have no dedicated detail route — they live in the Search
    // surface. Deep links from ask-brain / search-everything use
    // `view: "capture"` + `captureId`; carry the id through and resolve the
    // view to /search below so the user lands where captures are shown.
    if (navCommand.captureId) {
      params.set("captureId", navCommand.captureId);
    }
    const proposalId = navCommand.proposalId ?? navCommand.reviewItemId;
    if (proposalId) {
      params.set("reviewItemId", proposalId);
    }
    if (navCommand.settingsSection) {
      params.set("section", navCommand.settingsSection);
    }

    const path = routerPath(
      navCommand.path ||
        pathFromNavView(
          navCommand.view,
          navCommand.captureId,
          navCommand.extensionId,
        ),
    );
    navigate(`${path}${params.size ? `?${params.toString()}` : ""}`);
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}

/**
 * Resolve a navigate command `view` to a router path. `view: "capture"` (or any
 * command that only carries a `captureId`) resolves to the Search surface,
 * since Brain has no standalone capture-detail route.
 */
function pathFromNavView(
  view?: string,
  captureId?: string,
  extensionId?: string,
): string {
  if (view === "capture" || (!view && captureId)) return "/search";
  if (view === "extensions" && extensionId) {
    return `/extensions/${encodeURIComponent(extensionId)}`;
  }
  return pathFromView(view);
}

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function routerPath(path: string): string {
  const basePath = appBasePath();
  if (!basePath) return path;
  let result = path;
  for (let i = 0; i < 4; i += 1) {
    if (result === basePath) return "/";
    if (!result.startsWith(`${basePath}/`)) break;
    result = result.slice(basePath.length) || "/";
  }
  return result;
}

function extensionIdFromPath(pathname: string): string | undefined {
  const match = pathname.match(/^\/extensions\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}
