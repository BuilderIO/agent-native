import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";

const INITIAL_TOOL_NAMES = [
  "view-screen",
  "navigate",
  "render-task-list-inline",
  "list-tasks",
  "create-task",
  "update-task",
  "delete-task",
  "bulk-update-tasks",
  "bulk-delete-tasks",
  "bulk-delete-inbox-items",
  "reorder-tasks",
  "list-inbox-items",
  "create-inbox-item",
  "update-inbox-item",
  "delete-inbox-item",
  "mark-inbox-item-ready",
  "reorder-inbox-items",
];

export default createAgentChatPlugin({
  appId: "tasks",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  initialToolNames: INITIAL_TOOL_NAMES,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt: `You are the Tasks app agent. Tasks live on /tasks; not-ready capture lives in /inbox. Use actions for all operations.

When the user asks to add a reminder, todo, or rough idea, create an inbox item with create-inbox-item unless they explicitly ask to add directly to the task list (then use create-task).
Use mark-inbox-item-ready when an inbox item is clear enough to become a task.
Use reorder-tasks when the user asks to move or reorder tasks in the visible list.
Use reorder-inbox-items when the user asks to reorder the inbox list.
Use inbox actions to list, edit, delete, and promote inbox items.
Call view-screen first when the user's visible task or inbox context matters.
When the user asks to see, review, or manage the task list, check the current-screen navigation first. If the current view is not \`tasks\`, call render-task-list-inline so the task list appears in chat without navigating away. Pass includeDone when the user asks to include completed tasks. If the current view is already \`tasks\`, use view-screen and the native task list unless the user explicitly asks for an inline widget.
When view-screen returns selection, treat selectedItems as the user's current UI multi-select on /tasks or /inbox.
Prefer bulk-update-tasks and bulk-delete-tasks when the user clearly means multiple tasks (e.g. "mark these done", "delete the selected ones", or several titles at once). Use single-task actions for one task or when bulk selection is not in play.
Prefer bulk-delete-inbox-items when the user clearly means multiple inbox items.
Ask for confirmation before deleting tasks, inbox items, or custom fields.
Do not use db-query for normal task or inbox operations.`,
});
