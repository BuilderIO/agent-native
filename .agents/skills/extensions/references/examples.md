# Extension Examples

Worked HTML examples for extensions. For the model + when-to-use overview, see
`../SKILL.md`. For the full helper/global API tables, see `api.md`.

## API Status Dashboard

Checks the health of multiple endpoints and shows green/red status:

```html
<div
  class="p-6"
  x-data="{
  endpoints: [
    { name: 'API', url: 'https://api.example.com/health' },
    { name: 'Auth', url: 'https://auth.example.com/health' },
    { name: 'CDN', url: 'https://cdn.example.com/health' }
  ],
  results: [],
  loading: true
}"
  x-init="
  Promise.all(endpoints.map(ep =>
    extensionFetch(ep.url).then(r => ({ ...ep, ok: r.ok })).catch(() => ({ ...ep, ok: false }))
  )).then(r => { results = r; loading = false })
"
>
  <h2 class="text-lg font-bold mb-4">Service Status</h2>
  <template x-if="loading"
    ><p class="text-muted-foreground">Checking...</p></template
  >
  <div class="space-y-2">
    <template x-for="r in results" :key="r.name">
      <div class="flex items-center justify-between rounded-lg border p-3">
        <span class="font-medium" x-text="r.name"></span>
        <span
          x-bind:class="r.ok ? 'text-green-600' : 'text-red-600'"
          x-text="r.ok ? 'Healthy' : 'Down'"
        ></span>
      </div>
    </template>
  </div>
</div>
```

## Weather Widget

Fetches current weather for a city:

```html
<div
  class="p-6"
  x-data="{ city: 'San Francisco', weather: null, loading: false }"
  x-init="
  loading = true;
  extensionFetch('https://api.weatherapi.com/v1/current.json?q=' + encodeURIComponent(city) + '&key=${keys.WEATHER_API_KEY}')
    .then(r => r.json()).then(d => { weather = d; loading = false })
"
>
  <div class="space-y-4">
    <div class="flex gap-2">
      <input
        type="text"
        x-model="city"
        class="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
        placeholder="City name"
      />
      <button
        x-on:click="loading = true; extensionFetch('https://api.weatherapi.com/v1/current.json?q=' + encodeURIComponent(city) + '&key=${keys.WEATHER_API_KEY}').then(r => r.json()).then(d => { weather = d; loading = false })"
        class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground cursor-pointer"
      >
        Search
      </button>
    </div>
    <template x-if="loading"
      ><p class="text-muted-foreground">Loading...</p></template
    >
    <template x-if="weather && !loading">
      <div class="rounded-lg border p-4">
        <p
          class="text-2xl font-bold"
          x-text="weather.current.temp_f + '°F'"
        ></p>
        <p
          class="text-muted-foreground"
          x-text="weather.current.condition.text"
        ></p>
        <p
          class="text-sm text-muted-foreground"
          x-text="weather.location.name + ', ' + weather.location.region"
        ></p>
      </div>
    </template>
  </div>
</div>
```

## Todo List (using extensionData)

Full CRUD app using the built-in `extensionData` store — no SQL, no schema
files, no actions. Data is automatically scoped per-extension and per-user:

```html
<div
  class="p-6"
  x-data="{
  todos: [],
  newTodo: '',
  loading: true,
  async init() {
    const items = await extensionData.list('todos');
    this.todos = items.map(i => ({ id: i.id, ...JSON.parse(i.data) }));
    this.loading = false;
  },
  async addTodo() {
    if (!this.newTodo.trim()) return;
    const id = crypto.randomUUID();
    const data = { title: this.newTodo.trim(), completed: false };
    await extensionData.set('todos', id, data);
    this.todos.unshift({ id, ...data });
    this.newTodo = '';
  },
  async toggle(todo) {
    todo.completed = !todo.completed;
    await extensionData.set('todos', todo.id, { title: todo.title, completed: todo.completed });
  },
  async remove(id) {
    await extensionData.remove('todos', id);
    this.todos = this.todos.filter(t => t.id !== id);
  }
}"
>
  <h2 class="text-lg font-semibold mb-4">Todo List</h2>
  <div class="flex gap-2 mb-4">
    <input
      x-model="newTodo"
      type="text"
      placeholder="What needs to be done?"
      class="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
      @keydown.enter="addTodo()"
    />
    <button
      @click="addTodo()"
      class="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground cursor-pointer hover:bg-primary/90"
    >
      Add
    </button>
  </div>
  <div x-show="loading" class="text-sm text-muted-foreground">Loading...</div>
  <div class="space-y-2">
    <template x-for="todo in todos" :key="todo.id">
      <div class="flex items-center gap-3 rounded-md border p-3">
        <button
          @click="toggle(todo)"
          class="cursor-pointer"
          :class="todo.completed ? 'text-green-500' : 'text-muted-foreground'"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <template x-if="todo.completed">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3" />
            </template>
            <template x-if="!todo.completed">
              <circle cx="12" cy="12" r="10" />
            </template>
          </svg>
        </button>
        <span
          class="flex-1 text-sm"
          :class="todo.completed && 'line-through text-muted-foreground'"
          x-text="todo.title"
        ></span>
        <button
          @click="remove(todo.id)"
          class="text-muted-foreground hover:text-destructive cursor-pointer text-xs"
        >
          Remove
        </button>
      </div>
    </template>
  </div>
  <p
    x-show="!loading && todos.length === 0"
    class="text-sm text-muted-foreground text-center py-8"
  >
    No todos yet. Add one above!
  </p>
</div>
```

## Quick Notes

Persistent notes using localStorage -- no API key needed:

```html
<div
  class="p-6"
  x-data="{
  notes: JSON.parse(localStorage.getItem('quick-notes') || '[]'),
  draft: '',
  save() {
    if (!this.draft.trim()) return;
    this.notes.unshift({ id: Date.now(), text: this.draft, date: new Date().toLocaleDateString() });
    this.draft = '';
    localStorage.setItem('quick-notes', JSON.stringify(this.notes));
  },
  remove(id) {
    this.notes = this.notes.filter(n => n.id !== id);
    localStorage.setItem('quick-notes', JSON.stringify(this.notes));
  }
}"
>
  <div class="space-y-4">
    <div class="flex gap-2">
      <input
        type="text"
        x-model="draft"
        x-on:keydown.enter="save()"
        class="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
        placeholder="Add a note..."
      />
      <button
        x-on:click="save()"
        class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground cursor-pointer"
      >
        Add
      </button>
    </div>
    <div class="space-y-2">
      <template x-for="note in notes" :key="note.id">
        <div class="flex items-start justify-between rounded-lg border p-3">
          <div>
            <p class="text-sm" x-text="note.text"></p>
            <p class="text-xs text-muted-foreground" x-text="note.date"></p>
          </div>
          <button
            x-on:click="remove(note.id)"
            class="text-muted-foreground hover:text-destructive text-sm cursor-pointer"
          >
            Remove
          </button>
        </div>
      </template>
      <template x-if="notes.length === 0">
        <p class="text-sm text-muted-foreground">No notes yet.</p>
      </template>
    </div>
  </div>
</div>
```
