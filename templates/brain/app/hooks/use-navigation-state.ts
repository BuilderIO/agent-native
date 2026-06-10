import {
  appBasePath,
  appPath,
  useAgentRouteState,
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
  useAgentRouteState<NavigationState>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,
    getNavigationState: ({ pathname, search }) => {
      const localPathname = routerPath(pathname);
      const params = new URLSearchParams(search);
      return {
        view: viewFromPath(localPathname),
        path: appPath(`${localPathname}${search}`),
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
    },
    getCommandPath: (navCommand) => {
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
      return `${path}${params.size ? `?${params.toString()}` : ""}`;
    },
  });
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
