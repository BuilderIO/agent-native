// Script to update the Todo tool content with properly escaped HTML
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const content = `<div
  x-data="todoApp()"
  x-init="init()"
  class="min-h-screen bg-background text-foreground p-6"
>
  <div class="max-w-2xl mx-auto">

    <!-- Header -->
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Todo</h1>
        <p class="text-sm text-muted-foreground mt-0.5" x-text="summaryText()"></p>
      </div>
      <div class="flex items-center gap-2">
        <button x-on:click="filter = 'all'" x-bind:class="filter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'" class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer">All</button>
        <button x-on:click="filter = 'active'" x-bind:class="filter === 'active' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'" class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer">Active</button>
        <button x-on:click="filter = 'done'" x-bind:class="filter === 'done' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'" class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer">Done</button>
      </div>
    </div>

    <!-- Add Todo -->
    <div class="rounded-xl border bg-card p-4 mb-4 shadow-sm">
      <form x-on:submit.prevent="addTodo()" class="space-y-3">
        <input x-model="newText" type="text" placeholder="Add a new task…" class="w-full rounded-lg border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
        <div class="flex items-center gap-3">
          <select x-model="newPriority" class="flex-1 rounded-lg border bg-background px-3 py-2 text-xs focus:outline-none cursor-pointer">
            <option value="none">No priority</option>
            <option value="low">🟢 Low</option>
            <option value="medium">🟡 Medium</option>
            <option value="high">🔴 High</option>
          </select>
          <input x-model="newDue" type="date" class="flex-1 rounded-lg border bg-background px-3 py-2 text-xs focus:outline-none cursor-pointer" />
          <input x-model="newTag" type="text" placeholder="Tag (optional)" class="flex-1 rounded-lg border bg-background px-3 py-2 text-xs focus:outline-none" />
          <button type="submit" class="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer whitespace-nowrap">Add Task</button>
        </div>
      </form>
    </div>

    <!-- Tag filter bar -->
    <template x-if="allTags().length > 0">
      <div class="flex flex-wrap gap-2 mb-4">
        <button x-on:click="activeTag = null" x-bind:class="activeTag === null ? 'bg-primary/15 text-primary border-primary/30' : 'bg-muted text-muted-foreground hover:bg-muted/80'" class="px-2.5 py-1 rounded-full text-xs border font-medium transition-colors cursor-pointer">All tags</button>
        <template x-for="tag in allTags()" :key="tag">
          <button x-on:click="activeTag = activeTag === tag ? null : tag" x-bind:class="activeTag === tag ? 'bg-primary/15 text-primary border-primary/30' : 'bg-muted text-muted-foreground hover:bg-muted/80'" class="px-2.5 py-1 rounded-full text-xs border font-medium transition-colors cursor-pointer" x-text="'#' + tag"></button>
        </template>
      </div>
    </template>

    <!-- Todo list -->
    <div class="space-y-2">
      <template x-if="filteredTodos().length === 0">
        <div class="text-center py-16 text-muted-foreground">
          <div class="text-4xl mb-3">✓</div>
          <p class="text-sm font-medium">Nothing here</p>
          <p class="text-xs mt-1" x-text="filter === 'done' ? 'Complete some tasks first.' : filter === 'active' ? 'All tasks done!' : 'Add your first task above.'"></p>
        </div>
      </template>

      <template x-for="todo in filteredTodos()" :key="todo.id">
        <div class="group rounded-xl border bg-card px-4 py-3.5 shadow-sm transition-all hover:shadow-md" x-bind:class="todo.done ? 'opacity-60' : ''">
          <div class="flex items-start gap-3">

            <!-- Checkbox -->
            <button x-on:click="toggleTodo(todo.id)" class="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all cursor-pointer" x-bind:class="todo.done ? 'bg-primary border-primary' : 'border-muted-foreground hover:border-primary'">
              <template x-if="todo.done">
                <svg class="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
              </template>
            </button>

            <!-- Content -->
            <div class="flex-1 min-w-0">
              <template x-if="editingId !== todo.id">
                <div>
                  <p class="text-sm font-medium leading-snug" x-bind:class="todo.done ? 'line-through text-muted-foreground' : ''" x-text="todo.text" x-on:dblclick="startEdit(todo)"></p>
                  <div class="flex flex-wrap items-center gap-2 mt-1.5">
                    <template x-if="todo.priority !== 'none'">
                      <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium" x-bind:class="{ 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400': todo.priority === 'high', 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400': todo.priority === 'medium', 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400': todo.priority === 'low' }" x-text="todo.priority.charAt(0).toUpperCase() + todo.priority.slice(1)"></span>
                    </template>
                    <template x-if="todo.due">
                      <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium" x-bind:class="isOverdue(todo) ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-muted text-muted-foreground'" x-text="formatDate(todo.due) + (isOverdue(todo) ? ' · Overdue' : '')"></span>
                    </template>
                    <template x-if="todo.tag">
                      <span class="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium" x-text="'#' + todo.tag"></span>
                    </template>
                    <span class="text-xs text-muted-foreground/50" x-text="relativeTime(todo.createdAt)"></span>
                  </div>
                </div>
              </template>
              <template x-if="editingId === todo.id">
                <div class="space-y-2">
                  <input x-model="editText" type="text" class="w-full rounded-lg border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" x-on:keydown.enter="saveEdit()" x-on:keydown.escape="editingId = null" x-init="$el.focus()" />
                  <div class="flex gap-2">
                    <button x-on:click="saveEdit()" class="rounded-md bg-primary text-primary-foreground px-3 py-1 text-xs font-medium cursor-pointer">Save</button>
                    <button x-on:click="editingId = null" class="rounded-md bg-muted text-muted-foreground px-3 py-1 text-xs font-medium cursor-pointer">Cancel</button>
                  </div>
                </div>
              </template>
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button x-on:click="startEdit(todo)" class="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer" title="Edit">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              </button>
              <button x-on:click="deleteTodo(todo.id)" class="p-1.5 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 text-muted-foreground hover:text-red-600 transition-colors cursor-pointer" title="Delete">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Footer -->
    <template x-if="todos.filter(t => t.done).length > 0">
      <div class="mt-6 flex justify-end">
        <button x-on:click="clearDone()" class="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">Clear completed</button>
      </div>
    </template>
  </div>

  <script>
    function todoApp() {
      return {
        todos: [],
        newText: "",
        newPriority: "none",
        newDue: "",
        newTag: "",
        filter: "all",
        activeTag: null,
        editingId: null,
        editText: "",

        init() {
          const saved = localStorage.getItem("an-todos");
          if (saved) this.todos = JSON.parse(saved);
        },

        save() {
          localStorage.setItem("an-todos", JSON.stringify(this.todos));
        },

        addTodo() {
          const text = this.newText.trim();
          if (!text) return;
          this.todos.unshift({
            id: Date.now().toString(),
            text,
            done: false,
            priority: this.newPriority,
            due: this.newDue,
            tag: this.newTag.trim().replace(/^#/, ""),
            createdAt: Date.now()
          });
          this.newText = "";
          this.newPriority = "none";
          this.newDue = "";
          this.newTag = "";
          this.save();
        },

        toggleTodo(id) {
          const t = this.todos.find(t => t.id === id);
          if (t) { t.done = !t.done; this.save(); }
        },

        deleteTodo(id) {
          this.todos = this.todos.filter(t => t.id !== id);
          this.save();
        },

        clearDone() {
          this.todos = this.todos.filter(t => !t.done);
          this.save();
        },

        startEdit(todo) {
          this.editingId = todo.id;
          this.editText = todo.text;
        },

        saveEdit() {
          const text = this.editText.trim();
          if (!text) return;
          const t = this.todos.find(t => t.id === this.editingId);
          if (t) { t.text = text; this.save(); }
          this.editingId = null;
        },

        filteredTodos() {
          return this.todos.filter(t => {
            if (this.filter === "active" && t.done) return false;
            if (this.filter === "done" && !t.done) return false;
            if (this.activeTag && t.tag !== this.activeTag) return false;
            return true;
          });
        },

        allTags() {
          return [...new Set(this.todos.map(t => t.tag).filter(Boolean))];
        },

        summaryText() {
          const active = this.todos.filter(t => !t.done).length;
          const total = this.todos.length;
          if (total === 0) return "No tasks yet";
          return active + " of " + total + " remaining";
        },

        isOverdue(todo) {
          if (!todo.due || todo.done) return false;
          return new Date(todo.due) < new Date(new Date().toDateString());
        },

        formatDate(dateStr) {
          if (!dateStr) return "";
          const d = new Date(dateStr + "T00:00:00");
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const diff = Math.round((d - today) / 86400000);
          if (diff === 0) return "Today";
          if (diff === 1) return "Tomorrow";
          if (diff === -1) return "Yesterday";
          return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        },

        relativeTime(ts) {
          if (!ts) return "";
          const diff = Date.now() - ts;
          const mins = Math.floor(diff / 60000);
          if (mins < 1) return "just now";
          if (mins < 60) return mins + "m ago";
          const hrs = Math.floor(mins / 60);
          if (hrs < 24) return hrs + "h ago";
          const days = Math.floor(hrs / 24);
          return days + "d ago";
        }
      };
    }
  </script>
</div>`;

// Write content to a temp file for reading
import { writeFileSync } from 'fs';
writeFileSync('/tmp/todo-content.txt', content, 'utf8');
console.log('Content written to /tmp/todo-content.txt');
console.log('Content length:', content.length);
