/**
 * See what the user is currently looking at on screen.
 *
 * Usage:
 *   pnpm action view-screen
 */

import { defineAction } from "@agent-native/core/action";
import { readAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";

import {
  getCustomField,
  listCustomFields,
  type FieldConfig,
  type FieldDefinition,
} from "../server/custom-fields/store.js";
import {
  listTaskFieldValues,
  type TaskFieldValue,
} from "../server/custom-fields/task-fields.js";
import { getInboxItem, listInboxItems } from "../server/inbox/store.js";
import { getTask, listTasks, requireUserEmail } from "../server/tasks/store.js";
import { getTaskCardFieldIds } from "../server/user-config/store.js";
import { buildListViewScreen } from "./view-screen-helpers.js";

/** Max tasks in the agent tool payload (token budget). The UI may show more rows; */
const AGENT_TASKS_LIST_CAP = 25;
const AGENT_INBOX_ITEMS_LIST_CAP = 25;
const AGENT_FIELDS_LIST_CAP = 25;

type TaskSummary = { id: string; title: string; done: boolean };
type InboxItemSummary = { id: string; title: string };
type FieldSummary = {
  id: string;
  title: string;
  type: string;
  config: FieldConfig;
};

const navigationStateSchema = z.object({
  view: z.string(),
  path: z.string().optional(),
  includeDone: z.boolean().optional(),
  taskId: z.string().optional(),
  inboxItemId: z.string().optional(),
  fieldId: z.string().optional(),
});

const listSelectionStateSchema = z.object({
  selectionMode: z.boolean(),
  selectedIds: z.array(z.string()),
});

function toTaskSummary(task: TaskSummary): TaskSummary {
  return { id: task.id, title: task.title, done: task.done };
}

function toInboxItemSummary(item: InboxItemSummary): InboxItemSummary {
  return { id: item.id, title: item.title };
}

function toFieldSummary(field: FieldDefinition): FieldSummary {
  return {
    id: field.id,
    title: field.title,
    type: field.type,
    config: field.config,
  };
}

function toTaskFieldValueSummary(field: TaskFieldValue) {
  return {
    id: field.id,
    title: field.title,
    type: field.type,
    value: field.value,
  };
}

async function readParsedAppState<T>(
  key: string,
  schema: z.ZodType<T>,
): Promise<T | undefined> {
  const raw = await readAppStateForCurrentTab(key);
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export default defineAction({
  description:
    "Inspect the current Tasks screen. Returns navigation, visible items, the selected item, and active bulk selection.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async (_args, ctx) => {
    const navigation = await readParsedAppState(
      "navigation",
      navigationStateSchema,
    );

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    const ownerEmail = requireUserEmail(ctx?.userEmail);

    if (navigation?.view === "tasks") {
      const tasksSelection = await readParsedAppState(
        "tasksSelection",
        listSelectionStateSchema,
      );
      const visibleFieldIds = await getTaskCardFieldIds({ ownerEmail });
      Object.assign(
        screen,
        await buildListViewScreen({
          ownerEmail,
          cap: AGENT_TASKS_LIST_CAP,
          fetchItems: (email) =>
            listTasks({
              ownerEmail: email,
              includeDone: navigation.includeDone === true,
            }),
          toSummary: toTaskSummary,
          getById: (id) => getTask({ ownerEmail, id }),
          selection: {
            highlightId: navigation.taskId,
            bulkIds:
              tasksSelection?.selectionMode &&
              tasksSelection.selectedIds.length > 0
                ? tasksSelection.selectedIds
                : undefined,
          },
        }),
      );
      if (visibleFieldIds.length > 0) {
        const { fields } = await listCustomFields({
          ownerEmail,
          fieldIds: visibleFieldIds,
        });
        screen.visibleTaskFields = fields.map(toFieldSummary);
      }

      if (navigation.taskId && "selectedItem" in screen) {
        screen.selectedTaskFields = (
          await listTaskFieldValues({
            ownerEmail,
            taskId: navigation.taskId,
          })
        ).map(toTaskFieldValueSummary);
      }
    }

    if (navigation?.view === "inbox") {
      const inboxSelection = await readParsedAppState(
        "inboxSelection",
        listSelectionStateSchema,
      );
      Object.assign(
        screen,
        await buildListViewScreen({
          ownerEmail,
          cap: AGENT_INBOX_ITEMS_LIST_CAP,
          fetchItems: (email) => listInboxItems({ ownerEmail: email }),
          toSummary: toInboxItemSummary,
          getById: (id) => getInboxItem({ ownerEmail, id }),
          selection: {
            highlightId: navigation.inboxItemId,
            bulkIds:
              inboxSelection?.selectionMode &&
              inboxSelection.selectedIds.length > 0
                ? inboxSelection.selectedIds
                : undefined,
          },
          resolveSelectedMiss: async (id) => {
            const promotedTask = await getTask({ ownerEmail, id });
            if (!promotedTask) return null;
            return {
              ...toTaskSummary(promotedTask),
              inListSnapshot: false,
              promotedFromInbox: true,
            };
          },
        }),
      );
    }

    if (navigation?.view === "fields") {
      Object.assign(
        screen,
        await buildListViewScreen({
          ownerEmail,
          cap: AGENT_FIELDS_LIST_CAP,
          fetchItems: async (email) =>
            (await listCustomFields({ ownerEmail: email })).fields,
          toSummary: toFieldSummary,
          getById: (id) => getCustomField({ ownerEmail, fieldId: id }),
          selection: { highlightId: navigation.fieldId },
        }),
      );
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return screen;
  },
});
