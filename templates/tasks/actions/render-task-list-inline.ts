import {
  ACTION_CHAT_UI_INLINE_EXTENSION_RENDERER,
  defineAction,
} from "@agent-native/core";
import { z } from "zod";

export const TASK_LIST_INLINE_CONTENT = `
<script>
  document.addEventListener("alpine:init", () => {
    Alpine.data("taskListWidget", () => ({
      tasks: [],
      draft: "",
      includeDone: false,
      isLoading: true,
      isSaving: false,
      pending: {},
      error: "",
      hasCompletedTasks: false,
      init() {
        this.includeDone = Boolean(window.slotContext?.includeDone);
        window.onSlotContext?.((context) => {
          if (context?.includeDone === undefined) return;
          this.includeDone = Boolean(context.includeDone);
          void this.refresh();
        });
        void this.refresh();
      },
      parseResult(result) {
        if (typeof result === "string") {
          try {
            return JSON.parse(result);
          } catch {
            return {};
          }
        }
        return result && typeof result === "object" ? result : {};
      },
      async refresh() {
        this.isLoading = true;
        this.error = "";
        try {
          const data = this.parseResult(
            await appAction("list-tasks", { includeDone: this.includeDone }),
          );
          this.tasks = Array.isArray(data.tasks) ? data.tasks : [];
          this.hasCompletedTasks = data.hasCompletedTasks === true;
        } catch (error) {
          this.error = error?.message || "Could not load tasks.";
        } finally {
          this.isLoading = false;
        }
      },
      summaryLabel() {
        if (this.isLoading) return "Loading your task list…";
        const remaining = this.tasks.filter((task) => !task.done).length;
        return this.includeDone
          ? this.tasks.length + " shown · " + remaining + " remaining"
          : remaining + " remaining";
      },
      setIncludeDone(value) {
        this.includeDone = Boolean(value);
        void this.refresh();
      },
      async toggle(task, done) {
        const previous = task.done;
        task.done = Boolean(done);
        this.pending[task.id] = true;
        this.error = "";
        try {
          await appAction("update-task", { taskId: task.id, done: task.done });
          if (!this.includeDone && task.done) {
            this.tasks = this.tasks.filter((item) => item.id !== task.id);
          }
          this.hasCompletedTasks = this.hasCompletedTasks || task.done;
        } catch (error) {
          task.done = previous;
          this.error = error?.message || "Could not update that task.";
        } finally {
          delete this.pending[task.id];
        }
      },
      async addTask() {
        const title = this.draft.trim();
        if (!title || this.isSaving) return;
        this.isSaving = true;
        this.error = "";
        try {
          await appAction("create-task", { title });
          this.draft = "";
          await this.refresh();
        } catch (error) {
          this.error = error?.message || "Could not add that task.";
        } finally {
          this.isSaving = false;
        }
      },
    }));
  });
</script>

<div x-data="taskListWidget" class="w-full max-w-xl rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <h2 class="text-sm font-semibold">Tasks</h2>
      <p class="mt-1 text-xs text-muted-foreground" x-text="summaryLabel()"></p>
    </div>
    <button
      type="button"
      class="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      @click="refresh()"
      :disabled="isLoading"
    >Refresh</button>
  </div>

  <form class="mt-4 flex gap-2" @submit.prevent="addTask()">
    <input
      x-model="draft"
      class="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
      aria-label="New task"
      placeholder="Add a task"
      :disabled="isSaving"
    />
    <button
      type="submit"
      class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="isSaving || !draft.trim()"
    >Add</button>
  </form>

  <label class="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
    <input
      type="checkbox"
      class="size-3.5 accent-primary"
      :checked="includeDone"
      @change="setIncludeDone($event.target.checked)"
    />
    <span>Show completed</span>
  </label>

  <div x-show="error" class="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
    <span x-text="error"></span>
  </div>

  <div x-show="isLoading" class="mt-4 space-y-2" aria-label="Loading tasks">
    <div class="h-10 animate-pulse rounded-md bg-muted"></div>
    <div class="h-10 animate-pulse rounded-md bg-muted"></div>
  </div>

  <div x-show="!isLoading && tasks.length === 0" class="mt-5 rounded-lg border border-dashed border-border px-3 py-5 text-center">
    <p class="text-sm font-medium" x-text="hasCompletedTasks && !includeDone ? 'All tasks complete' : 'No tasks yet'"></p>
    <p class="mt-1 text-xs text-muted-foreground" x-text="hasCompletedTasks && !includeDone ? 'Show completed to review them.' : 'Add a task above to get started.'"></p>
  </div>

  <ul x-show="!isLoading && tasks.length > 0" class="mt-4 divide-y divide-border rounded-lg border border-border" aria-label="Tasks list">
    <template x-for="task in tasks" :key="task.id">
      <li class="flex items-center gap-3 px-3 py-3" :class="task.done ? 'text-muted-foreground' : ''">
        <input
          type="checkbox"
          class="size-4 shrink-0 accent-primary"
          :checked="task.done"
          :disabled="pending[task.id]"
          @change="toggle(task, $event.target.checked)"
          :aria-label="task.done ? 'Mark ' + task.title + ' incomplete' : 'Mark ' + task.title + ' complete'"
        />
        <span class="min-w-0 flex-1 break-words text-sm" :class="task.done ? 'line-through' : ''" x-text="task.title"></span>
      </li>
    </template>
  </ul>
</div>
`;

export default defineAction({
  description:
    "Render the current task list as an interactive widget inline in chat without navigating away from the current page. Use when the user asks to see, review, or manage tasks while they are not on /tasks.",
  schema: z.object({
    includeDone: z
      .boolean()
      .default(false)
      .describe("When true, show completed tasks in the widget."),
  }),
  http: false,
  readOnly: true,
  chatUI: {
    renderer: ACTION_CHAT_UI_INLINE_EXTENSION_RENDERER,
    title: "Task list",
    description: "Render the task list inline in the conversation.",
  },
  run: async (args) => ({
    ok: true,
    inlineExtension: {
      mode: "transient" as const,
      id: `tasks-inline-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      name: "Task list",
      description: args.includeDone ? "Open and completed tasks" : "Open tasks",
      content: TASK_LIST_INLINE_CONTENT,
      context: { includeDone: args.includeDone },
      initialHeight: 360,
    },
  }),
});
