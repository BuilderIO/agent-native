import {
  NoWriteError,
  defineAction,
  defineActionErrors,
} from "@agent-native/core/action";
import {
  AgentNavigationRefusedError,
  buildAgentNavigationKeptResult,
  evaluateAgentNavigation,
  readAppStateForCurrentTab,
  resolveCurrentRequestStateTab,
  withAuthorizedAgentNavigation,
} from "@agent-native/core/application-state";
import { z } from "zod";

import {
  dataBrowserResourcePath,
  focusedResource,
  normalizeAnalyticsNavigationPath,
  pathFromView,
  resourcePath,
} from "../app/lib/navigation-contract.js";
import {
  isUnavailableAnalyticsRoute,
  resolveRoute,
} from "../app/routes/routing/registry.js";
import {
  agentNavigationKeptSchema,
  agentOpenIntentSchema,
  queueAnalyticsNavigation,
} from "../server/agent-navigation.js";
import { requireCapability } from "../server/lib/analytics-capabilities.js";
import { findProjectsByTitle } from "../server/lib/find-project-by-title.js";
import { requireReadableProject } from "../server/lib/project-action-access.js";
import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import {
  listCollections,
  type CollectionNode,
} from "../server/model/collections-store.js";
import { listDataConnections } from "../server/model/data-connections.js";
import { ANALYTICS_CONTROL_IDS } from "../shared/analytics-control-ids.js";
import { capabilityScopeRefSchema } from "../shared/capabilities.js";
import getThreadSummary from "./get-thread-summary.js";

const errors = defineActionErrors("invalid_navigation", "browser_tab_missing");

export default defineAction({
  mcpTool: true,
  description:
    'Open a project, thread, collection, data connection (or table/schema via dataConnectionId + tableId/schemaId), or workspace view in the current tab. Views: "home" (/home, recent projects), "all" (/home/all, all projects), "archive" (/home/archive), "search" (/home/search), "trash", "data", "threads", "collections", "library". Pass intent: "open" when opening a specific item. To open a named project pass projectTitle (never the search view): it lands straight on that project.',
  schema: z
    .object({
      kind: z
        .enum(["project", "thread", "collection", "data-connection"])
        .optional()
        .describe("Resource kind; pair with id."),
      id: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Resource ID; pair with kind."),
      projectId: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Project to open."),
      projectTitle: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "Title of the project to open when its id is not known; resolved on the server. Never guess an id.",
        ),
      threadId: z.string().trim().min(1).optional().describe("Thread to open."),
      collectionId: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Collection to open."),
      dataConnectionId: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Data connection to open."),
      tableId: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "Table ID from list-connection-datasets (with dataConnectionId).",
        ),
      schemaId: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "Schema ID from list-connection-datasets (with dataConnectionId).",
        ),
      view: z
        .string()
        .optional()
        .describe(
          'View: "home" (recent), "all", "archive", "search", "trash", "data", "threads", "collections", "library", "settings".',
        ),
      path: z
        .string()
        .optional()
        .describe("App-local path, such as a search result's href."),
      intent: agentOpenIntentSchema,
      navigationMode: z.enum(["open", "reveal", "keep"]).optional(),
      screen: z.enum(["home", "project"]).optional(),
      params: z
        .object({ projectId: z.string().trim().min(1).optional() })
        .strict()
        .optional(),
    })
    .strict(),
  outputSchema: z.union([
    z.object({ path: z.string(), message: z.string() }),
    agentNavigationKeptSchema.extend({
      reason: z.enum([
        "detail-requires-open-intent",
        "write-keeps-view",
        "navigation-mode-keep",
      ]),
    }),
  ]),
  errors,
  http: false,
  retrySafe: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (
    {
      kind: givenKind,
      id: givenId,
      projectId: givenProjectId,
      projectTitle,
      threadId,
      collectionId,
      dataConnectionId,
      tableId,
      schemaId,
      view: givenView,
      path,
      intent,
      navigationMode,
      screen,
      params,
    },
    context,
  ) => {
    if (params && !screen)
      errors.fail("params requires a screen.", "invalid_navigation");
    if (
      screen &&
      (givenView ||
        path ||
        givenKind ||
        givenId ||
        givenProjectId ||
        projectTitle ||
        threadId ||
        collectionId ||
        dataConnectionId)
    )
      errors.fail(
        "Pass a screen or another target, not both.",
        "invalid_navigation",
      );
    if (screen === "project" && !params?.projectId)
      errors.fail(
        "The project screen requires params.projectId.",
        "invalid_navigation",
      );
    if (screen === "home" && params?.projectId)
      errors.fail("The home screen takes no parameters.", "invalid_navigation");
    const view = screen === "home" ? "home" : givenView;
    let projectId = screen === "project" ? params?.projectId : givenProjectId;
    if (projectTitle) {
      if (projectId)
        errors.fail(
          "Pass projectId or projectTitle, not both.",
          "invalid_navigation",
        );
      const matches = await findProjectsByTitle(projectTitle);
      const [only] = matches;
      if (!only || matches.length !== 1)
        errors.fail(
          matches.length
            ? `${matches.length} projects match "${projectTitle}": ${matches
                .slice(0, 5)
                .map((p) => `"${p.title}" (${p.id})`)
                .join(", ")}. Pass one projectId.`
            : `No project is named "${projectTitle}". Do not create one to open it.`,
          "invalid_navigation",
        );
      projectId = only?.id;
    }
    if (tableId && schemaId)
      errors.fail("Pass tableId or schemaId, not both.", "invalid_navigation");
    if ((tableId || schemaId) && !dataConnectionId)
      errors.fail(
        "Pass dataConnectionId together with tableId or schemaId.",
        "invalid_navigation",
      );
    // A resource's own id field names its kind, so kind and id may be left out.
    const named = (
      [
        ["project", projectId],
        ["thread", threadId],
        ["collection", collectionId],
        ["data-connection", dataConnectionId],
      ] as const
    ).filter(([, value]) => value !== undefined);
    if (named.length > 1)
      errors.fail(
        "Pass one of projectId, threadId, collectionId or dataConnectionId, not several.",
        "invalid_navigation",
      );
    if (named.length === 1 && (givenKind || givenId))
      errors.fail(
        "Pass kind and id, or one of projectId, threadId, collectionId or dataConnectionId, not both.",
        "invalid_navigation",
      );
    if ((givenKind && !givenId) || (givenId && !givenKind))
      errors.fail(
        "Both kind and id are required to open a resource, or pass projectId, threadId, collectionId or dataConnectionId alone.",
        "invalid_navigation",
      );
    const kind = givenKind ?? named[0]?.[0];
    const id = givenId ?? named[0]?.[1];
    if (
      path &&
      (!path.startsWith("/") || path.startsWith("//") || path.includes("\\"))
    ) {
      errors.fail("Path must be an app-local path.", "invalid_navigation");
    }
    if ((kind || id) && (view || path))
      errors.fail(
        "Provide kind and id, or a view or path, not both.",
        "invalid_navigation",
      );
    if (view && (!/^[a-zA-Z0-9_/-]+$/.test(view) || view.startsWith("//")))
      errors.fail("View must name an app-local route.", "invalid_navigation");
    if (
      id === "." ||
      id === ".." ||
      tableId === "." ||
      tableId === ".." ||
      schemaId === "." ||
      schemaId === ".."
    )
      errors.fail(
        "Resource ID must identify a resource.",
        "invalid_navigation",
      );
    const requested =
      kind === "data-connection" && id && (tableId || schemaId)
        ? dataBrowserResourcePath(
            id,
            tableId ? "table" : "schema",
            (tableId ?? schemaId)!,
          )
        : kind && id
          ? resourcePath(kind, id)
          : (path ?? (view ? pathFromView(view) : undefined));
    if (!requested)
      return errors.fail(
        "Pass a resource id (projectId, threadId, collectionId or dataConnectionId), a view, or a path.",
        "invalid_navigation",
      );
    const parsed = new URL(requested, "https://navigation.invalid");
    if (parsed.origin !== "https://navigation.invalid")
      errors.fail("Path must be an app-local path.", "invalid_navigation");
    const mountedAppIds = context?.appId
      ? [context.appId, "analytics-2"]
      : ["analytics-2"];
    const normalizedPathname = normalizeAnalyticsNavigationPath(
      parsed.pathname,
      mountedAppIds,
    );
    const normalizedDestination = `${normalizedPathname}${parsed.search}${parsed.hash}`;
    const resolved = resolveRoute(normalizedDestination);
    const destination =
      resolved.frame === "redirect" && resolved.to
        ? resolved.to
        : normalizedDestination;
    const canonicalParsed = new URL(destination, "https://navigation.invalid");
    const route = resolved.to ? resolveRoute(resolved.to) : resolved;
    if (isUnavailableAnalyticsRoute(route))
      throw new NoWriteError("This page is unavailable.", {
        errorCode: "missing_backing",
        statusCode: 404,
      });
    if (route.view === "data") {
      const current = await requireCurrentWorkspace();
      await requireCapability(
        ANALYTICS_CONTROL_IDS.dataBrowse,
        capabilityScopeRefSchema.parse({
          kind: "workspace",
          workspaceId: current.orgId,
        }),
      );
    }
    const resource =
      focusedResource(normalizedPathname) ??
      focusedResource(canonicalParsed.pathname);
    if (resource && "resourceStatus" in resource)
      errors.fail(
        "Path contains an invalid resource ID.",
        "invalid_navigation",
      );
    const target =
      resource && "resourceKind" in resource
        ? { kind: resource.resourceKind, id: resource.resourceId }
        : undefined;
    if (target) {
      if (target.kind === "project") {
        const { scope } = await requireReadableProject(target.id);
        if (route.frame === "project" && route.view === "app")
          await requireCapability(
            ANALYTICS_CONTROL_IDS.editProject,
            capabilityScopeRefSchema.parse({
              kind: "project",
              workspaceId: scope.orgId,
              projectId: target.id,
            }),
          );
        if (route.frame === "published-app")
          await requireCapability(
            ANALYTICS_CONTROL_IDS.openPublishedApp,
            capabilityScopeRefSchema.parse({
              kind: "release",
              workspaceId: scope.orgId,
              projectId: target.id,
              releaseId: route.params.version ?? "latest",
            }),
          );
      } else if (target.kind === "thread")
        await getThreadSummary.run({ threadId: target.id }, context);
      else if (target.kind === "collection") {
        const current = await requireCurrentWorkspace();
        const tree = await listCollections({
          ownerEmail: current.ownerEmail,
          orgId: current.orgId,
        });
        const contains = (nodes: CollectionNode[]): boolean =>
          nodes.some(
            (node) => node.id === target.id || contains(node.children),
          );
        if (!contains(tree))
          throw new NoWriteError(
            "Collection not found in the active workspace.",
            { errorCode: "not_found", statusCode: 404 },
          );
      } else {
        const connections = await listDataConnections();
        if (!connections.some((connection) => connection.id === target.id))
          throw new NoWriteError(
            "Data connection not found in the active workspace.",
            { errorCode: "not_found", statusCode: 404 },
          );
      }
    }
    if (route.frame === "published-app") {
      const current = await requireCurrentWorkspace();
      await requireCapability(
        ANALYTICS_CONTROL_IDS.openPublishedApp,
        capabilityScopeRefSchema.parse({
          kind: "release",
          workspaceId: current.orgId,
          projectId: route.params.projectLocator,
          releaseId: route.params.version ?? "latest",
        }),
      );
    }
    const isDetailTarget = Boolean(target) || route.frame === "published-app";
    const refusal = evaluateAgentNavigation(
      {
        path: destination,
        ...(target ? { kind: target.kind, id: target.id } : {}),
      },
      {
        ctx: context,
        intent: navigationMode ?? intent,
        isDetailView: () => isDetailTarget,
        isNavigateAction: true,
      },
    );
    if (refusal) {
      if (refusal.reason === "read-only-action") {
        throw new AgentNavigationRefusedError(refusal.message, {
          reason: refusal.reason,
        });
      }
      return buildAgentNavigationKeptResult(
        refusal.reason,
        await readAppStateForCurrentTab("navigation"),
      );
    }
    if (context?.caller === "tool" || context?.caller === "mcp") {
      const { tabId } = await resolveCurrentRequestStateTab();
      if (!tabId)
        return errors.fail(
          "No browser tab of this app is open, so the page was not opened.",
          "browser_tab_missing",
        );
    }
    await withAuthorizedAgentNavigation(() =>
      queueAnalyticsNavigation(destination),
    );
    return {
      path: destination,
      message: "Navigation requested.",
    };
  },
});
