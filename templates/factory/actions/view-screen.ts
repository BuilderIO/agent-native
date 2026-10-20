import { defineAction } from "@agent-native/core/action";
import { readAppStateForCurrentTab } from "@agent-native/core/application-state";
import { dispatchActions } from "@agent-native/dispatch/actions";
import { z } from "zod";

import {
  defaultFactoryDefinition,
  listFactoryDefinitions,
  readFactoryDefinition,
} from "../server/lib/factory-definitions.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { getWorkflowStore } from "../server/workflow-host/factory-store.js";
import type { WorkflowRecord } from "../server/workflow/adapter.js";

const WORKFLOW_EDITOR_STATE_KEY = "workflow-editor";
const MAX_LISTED_WORKFLOWS = 25;
const MAX_REPORTED_ISSUES = 10;
const MAX_REPORTED_SELECTION = 20;

async function runDispatchAction(name: string, args: Record<string, unknown>) {
  const action = dispatchActions[name];
  if (!action) throw new Error(`Dispatch action not found: ${name}`);
  return action.run(args);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .slice(0, MAX_REPORTED_SELECTION)
    : [];
}

/**
 * What the open workflow page keeps for the agent: unsaved edits and the
 * problems on the canvas. The page writes it per browser tab and removes it on
 * the way out; one for another workflow is stale and is ignored.
 */
function readEditorState(
  raw: Record<string, unknown> | null,
  workflowId: string,
): Record<string, unknown> | null {
  if (!raw || raw.workflowId !== workflowId) return null;
  const selection = (raw.selection ?? {}) as Record<string, unknown>;
  const issues = Array.isArray(raw.issues)
    ? raw.issues.slice(0, MAX_REPORTED_ISSUES)
    : [];
  return {
    baseVersion: numberField(raw.baseVersion),
    dirty: raw.dirty === true,
    saving: raw.saving === true,
    problemCount: numberField(raw.issueCount) ?? issues.length,
    problems: issues,
    selectedNodeIds: stringList(selection.nodeIds),
    selectedEdgeIds: stringList(selection.edgeIds),
  };
}

function describeOpenWorkflow(
  workflow: WorkflowRecord,
  state: Record<string, unknown>,
  editor: Record<string, unknown> | null,
) {
  const nodeId = stringField(state.nodeId);
  const selected = nodeId
    ? workflow.graph.nodes.find((node) => node.id === nodeId)
    : undefined;
  return {
    id: workflow.id,
    name: workflow.name,
    version: workflow.version,
    enabled: workflow.enabled,
    dryRunCurrent: workflow.lastCleanDryRunVersion === workflow.version,
    nodeCount: workflow.graph.nodes.length,
    edgeCount: workflow.graph.edges.length,
    selection: {
      ...(selected
        ? {
            nodeId: selected.id,
            nodeName: selected.name,
            nodeKind: selected.kind,
          }
        : nodeId
          ? { nodeId, nodeInGraph: false }
          : {}),
      ...(stringField(state.edgeId)
        ? { edgeId: stringField(state.edgeId) }
        : {}),
      ...(stringField(state.runId) ? { runId: stringField(state.runId) } : {}),
    },
    ...(editor ? { editor } : {}),
  };
}

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the factory list, or for an open factory its tab: Workflows (the list, or the open workflow with the selected step, connection or run, whether the page has unsaved edits, and how many problems the canvas shows), Items (the selected item), Activity, Settings. Basic route context is included in <current-screen>; call this for a fresh or fuller snapshot when visible selection details matter.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async (_, context) => {
    const navigation = await readAppStateForCurrentTab("navigation");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    if (
      navigation &&
      typeof navigation === "object" &&
      "view" in navigation &&
      navigation.view === "factory"
    ) {
      const { orgId } = await requireWorkspaceMember(
        workspaceMemberIdentityFromContext(context),
      );
      const state = navigation as Record<string, unknown>;
      if (state.creatingFactory === true) {
        screen.factory = { creating: true };
      } else {
        const factoryId = stringField(state.factoryId);
        const tab =
          stringField(state.factoryTab) ?? (factoryId ? "workflows" : "list");

        if (!factoryId) {
          const rows = await listFactoryDefinitions(orgId);
          const fallback = defaultFactoryDefinition();
          screen.surface = "factory-list";
          screen.factories = [
            ...(rows.some((row) => row.id === fallback.id)
              ? []
              : [{ id: fallback.id, name: fallback.name }]),
            ...rows.map((row) => ({ id: row.id, name: row.name })),
          ];
        } else {
          const row = await readFactoryDefinition(orgId, factoryId);
          const fallback = defaultFactoryDefinition();
          const name =
            row?.name ??
            (factoryId === fallback.id ? fallback.name : factoryId);
          const factory: Record<string, unknown> = {
            id: factoryId,
            name,
            tab,
          };

          if (tab === "workflows") {
            const store = getWorkflowStore();
            const scope = { orgId, factoryId };
            const workflowId = stringField(state.workflowId);
            // A read that fails says so; an empty list and an unreadable one
            // must not look alike to the agent.
            try {
              if (workflowId) {
                const workflow = await store.getWorkflow(scope, workflowId);
                factory.workflow = workflow
                  ? describeOpenWorkflow(
                      workflow,
                      state,
                      readEditorState(
                        await readAppStateForCurrentTab(
                          WORKFLOW_EDITOR_STATE_KEY,
                        ),
                        workflowId,
                      ),
                    )
                  : { id: workflowId, found: false };
              } else {
                const page = await store.listWorkflows(scope, {
                  limit: MAX_LISTED_WORKFLOWS,
                });
                factory.workflows = page.items.map((workflow) => ({
                  id: workflow.id,
                  name: workflow.name,
                  version: workflow.version,
                  enabled: workflow.enabled,
                }));
                if (page.hasMore) factory.workflowsHasMore = true;
              }
            } catch (error) {
              factory.workflowsReadError =
                error instanceof Error ? error.message : String(error);
            }
          } else if (tab === "items") {
            const selectedItemId = stringField(state.factoryItemId);
            if (selectedItemId) factory.selectedItemId = selectedItemId;
          }

          screen.factory = factory;
        }
      }

      if (state.factoryTab === "agents") {
        const [apps, agents] = await Promise.all([
          runDispatchAction("list-workspace-apps", {
            includeAgentCards: false,
          }),
          runDispatchAction("list-workspace-resources", { kind: "agent" }),
        ]);
        screen.factoryAgents = { apps, agents };
      }
    }

    if (
      navigation &&
      typeof navigation === "object" &&
      "view" in navigation &&
      navigation.view === "agents"
    ) {
      const [apps, agents] = await Promise.all([
        runDispatchAction("list-workspace-apps", {
          includeAgentCards: false,
        }),
        runDispatchAction("list-workspace-resources", { kind: "agent" }),
      ]);
      screen.agents = { apps, agents };
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return screen;
  },
});
