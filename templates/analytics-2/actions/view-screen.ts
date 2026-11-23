import { defineAction } from "@agent-native/core/action";
import {
  readAppState,
  readAppStateForCurrentTab,
} from "@agent-native/core/application-state";
import { getRequestRunContext } from "@agent-native/core/server";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { requireReadableProject } from "../server/lib/project-action-access.js";
import {
  findRecentQueryProject,
  recentQueryProjectSchema,
  type RecentQueryProject,
} from "../server/lib/recent-query-project.js";
import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { resolvePublishedProjectAccess } from "../server/model/project-access.js";
import {
  canEditProject,
  projectAccessLevel,
} from "../server/model/project-grant-access.js";
import { readProjectRelease } from "../server/model/project-releases.js";
import { listProjectRows } from "../server/model/projects-store.js";
import {
  currentNotebookThreadScope,
  requireNotebookThreadBinding,
} from "../server/model/thread-projects.js";
import {
  notebookEditingSchema,
  notebookEditingSummarySchema,
} from "../shared/notebook-editing.js";
import {
  notebookCellIdSchema,
  notebookProjectIdSchema,
  revisionSchema,
} from "../shared/notebook-snapshot-contract.js";
import getDataDbtMetadata from "./get-data-dbt-metadata.js";

const dataTableDbtSchema = z.strictObject({
  connectionId: z.string(),
  tableId: z.string(),
  status: z.enum(["ready", "unavailable"]),
  description: z.string().max(4000).nullable(),
  truncated: z.boolean(),
});

const notebookReviewFocus = z.strictObject({
  projectId: notebookProjectIdSchema,
  threadId: z.string().min(1).max(128),
  cellId: notebookCellIdSchema.nullable(),
  revision: revisionSchema,
});

const schedulePanelSchema = z.strictObject({
  projectId: z.string().min(1).max(128),
  releaseId: z.string().min(1).max(128),
  panel: z.literal("schedules"),
  tab: z.enum(["notifications", "run-log"]),
});

export default defineAction({
  mcpTool: true,
  description:
    "Agent-only. Refresh navigation, selection, selected table dbt documentation, notebook editing/review context, schedule tab, and when no project is open, recentQueryProject (newest SQL notebook for 'that query').",
  schema: z.object({}),
  outputSchema: z.union([
    z.string(),
    z
      .object({
        navigation: z.record(z.string(), z.unknown()).optional(),
        selection: z.record(z.string(), z.unknown()).optional(),
        editing: notebookEditingSchema.optional(),
        editingSummary: notebookEditingSummarySchema.optional(),
        threadId: z.string().optional(),
        notebookReview: notebookReviewFocus.optional(),
        schedulePanel: schedulePanelSchema.optional(),
        recentQueryProject: recentQueryProjectSchema.optional(),
        availableProjects: z
          .object({
            projects: z.array(z.object({ id: z.string(), title: z.string() })),
            total: z.number(),
            truncated: z.boolean(),
          })
          .optional(),
        dataTableDbt: dataTableDbtSchema.optional(),
      })
      .strict(),
  ]),
  http: false,
  readOnly: true,
  run: async (_input, context) => {
    const navigation = await readAppState("navigation");

    const screen: {
      navigation?: Record<string, unknown>;
      selection?: Record<string, unknown>;
      editing?: z.infer<typeof notebookEditingSchema>;
      editingSummary?: z.infer<typeof notebookEditingSummarySchema>;
      threadId?: string;
      notebookReview?: z.infer<typeof notebookReviewFocus>;
      schedulePanel?: z.infer<typeof schedulePanelSchema>;
      recentQueryProject?: RecentQueryProject;
      availableProjects?: {
        projects: Array<{ id: string; title: string }>;
        total: number;
        truncated: boolean;
      };
      dataTableDbt?: z.infer<typeof dataTableDbtSchema>;
    } = {};
    if (navigation) screen.navigation = navigation;
    if (
      navigation?.resourceKind === "data-connection" &&
      navigation.dataResourceKind === "table" &&
      typeof navigation.resourceId === "string" &&
      typeof navigation.dataResourceId === "string"
    ) {
      const input = {
        connectionId: navigation.resourceId,
        tableId: navigation.dataResourceId,
      };
      screen.dataTableDbt = {
        ...input,
        status: "unavailable",
        description: null,
        truncated: false,
      };
      try {
        const result = await getDataDbtMetadata.run(input, context);
        if (
          result.connectionId === input.connectionId &&
          result.tableId === input.tableId
        ) {
          const description = result.metadata?.description ?? null;
          screen.dataTableDbt = {
            ...input,
            status: "ready",
            description: description?.slice(0, 4000) ?? null,
            truncated: (description?.length ?? 0) > 4000,
          };
        }
      } catch {}
    }
    const threadId = context?.threadId ?? getRequestRunContext()?.threadId;
    if (threadId) screen.threadId = threadId;
    const selection = await readAppStateForCurrentTab("selection");
    if (
      selection &&
      navigation?.resourceKind === "project" &&
      selection.projectId === navigation.resourceId
    )
      screen.selection = selection;

    const review = await readAppStateForCurrentTab("notebook-review");
    if (
      threadId &&
      review?.threadId === threadId &&
      navigation?.resourceKind === "project" &&
      review.projectId === navigation.resourceId
    ) {
      const focus = notebookReviewFocus.parse(review);
      await requireNotebookThreadBinding(
        await currentNotebookThreadScope(context),
        focus,
      );
      screen.notebookReview = focus;
    }

    const editing = await readAppStateForCurrentTab("notebook-editing");
    if (
      editing &&
      navigation?.resourceKind === "project" &&
      editing.projectId === navigation.resourceId
    ) {
      const snapshot = notebookEditingSchema.parse(editing);
      const { scope, project } = await requireReadableProject(
        snapshot.projectId,
      );
      if (canEditProject(await projectAccessLevel(scope, project))) {
        const isAutomaticScreenRead =
          context?.caller === "tool" && !context.toolCallId;
        if (isAutomaticScreenRead) {
          screen.editingSummary = notebookEditingSummarySchema.parse(snapshot);
        } else {
          screen.editing = snapshot;
        }
      }
    }

    if (
      typeof navigation?.view === "string" &&
      ["home", "home/all", "home/archive", "home/trash"].includes(
        navigation.view,
      )
    ) {
      const workspace = await requireCurrentWorkspace();
      const projects = await listProjectRows({
        ownerEmail: workspace.ownerEmail,
        orgId: workspace.orgId,
        trashed: navigation.view === "home/trash",
        archived: navigation.view === "home/archive",
        search: "",
      });
      screen.availableProjects = {
        projects: projects.slice(0, 20).map(({ id, title }) => ({ id, title })),
        total: projects.length,
        truncated: projects.length > 20,
      };
    }

    const isPublishedAppView =
      typeof navigation?.view === "string" &&
      navigation.view.startsWith("app/");

    if (
      navigation &&
      navigation.resourceKind !== "project" &&
      !isPublishedAppView
    ) {
      const recentQueryProject = await findRecentQueryProject(
        await requireCurrentWorkspace(),
      );
      if (recentQueryProject) screen.recentQueryProject = recentQueryProject;
    }

    if (isPublishedAppView) {
      const panel = schedulePanelSchema.safeParse(
        await readAppStateForCurrentTab("published-app-schedule"),
      );
      if (
        panel.success &&
        navigation.resourceKind === "project" &&
        panel.data.projectId === navigation.resourceId &&
        (navigation.releaseId === undefined ||
          panel.data.releaseId === navigation.releaseId)
      ) {
        const workspace = await requireCurrentWorkspace();
        await ensureAnalyticsDatabase();
        const db = getDb();
        const access = await resolvePublishedProjectAccess(
          workspace,
          panel.data.projectId,
          db,
        );
        if (
          access &&
          (await readProjectRelease(db, {
            orgId: workspace.orgId,
            projectId: access.project.id,
            releaseId: panel.data.releaseId,
          }))
        )
          screen.schedulePanel = panel.data;
      }
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return screen;
  },
});
