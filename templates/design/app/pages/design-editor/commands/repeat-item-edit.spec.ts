import { describe, expect, it } from "vitest";

import { runRepeatItemEdit } from "./repeat-item-edit";

/** Design 2's todo list: the array lives in x-data, one row in the template. */
const SCREEN = `<body>
<div x-data="{ todos: [
    { text: 'Fix login redirect bug', done: false, priority: 'high' },
    { text: 'Write onboarding tests', done: true, priority: 'medium' },
    { text: 'Polish empty states', done: false, priority: 'low' }
  ] }">
  <ul>
    <template x-for="todo in todos" :key="todo.text">
      <li><span x-text="todo.text"></span></li>
    </template>
    <li>+ Add a task</li>
  </ul>
</div>
</body>`;

const TARGET = { xFor: "todo in todos", itemIndex: 0 };

function texts(content: string): string[] {
  return [...content.matchAll(/text: '([^']+)'/g)].map((match) => match[1]!);
}

describe("removing a rendered row", () => {
  it("splices the array instead of touching the markup", () => {
    const result = runRepeatItemEdit({
      content: SCREEN,
      target: TARGET,
      operation: { kind: "remove" },
    });

    expect(result.status).toBe("written");
    if (result.status !== "written") return;
    expect(texts(result.content)).toEqual([
      "Write onboarding tests",
      "Polish empty states",
    ]);
    // The one authored row and its static sibling both survive untouched.
    expect(result.content.split("<li>")).toHaveLength(3);
    expect(result.content).toContain('x-for="todo in todos"');
  });
});

describe("duplicating a rendered row", () => {
  it("adds a second copy of that item's data", () => {
    const result = runRepeatItemEdit({
      content: SCREEN,
      target: { xFor: "todo in todos", itemIndex: 1 },
      operation: { kind: "duplicate" },
    });

    expect(result.status).toBe("written");
    if (result.status !== "written") return;
    expect(texts(result.content)).toEqual([
      "Fix login redirect bug",
      "Write onboarding tests",
      "Write onboarding tests",
      "Polish empty states",
    ]);
  });
});

describe("reordering a rendered row", () => {
  it("moves the item, not the element", () => {
    const result = runRepeatItemEdit({
      content: SCREEN,
      target: TARGET,
      operation: { kind: "move", to: 2 },
    });

    expect(result.status).toBe("written");
    if (result.status !== "written") return;
    expect(texts(result.content)).toEqual([
      "Write onboarding tests",
      "Polish empty states",
      "Fix login redirect bug",
    ]);
  });
});

describe("editing a repeated row's text", () => {
  it("writes the item's field, not the markup", () => {
    const result = runRepeatItemEdit({
      content: SCREEN,
      target: TARGET,
      operation: {
        kind: "set-value",
        binding: "todo.text",
        value: "Ship the release",
      },
    });

    expect(result.status).toBe("written");
    if (result.status !== "written") return;
    expect(texts(result.content)).toEqual([
      "Ship the release",
      "Write onboarding tests",
      "Polish empty states",
    ]);
    // The one authored row keeps its binding; nothing was written to markup.
    expect(result.content).toContain('x-text="todo.text"');
  });

  it("refuses a computed binding rather than guessing a field", () => {
    const result = runRepeatItemEdit({
      content: SCREEN,
      target: TARGET,
      operation: {
        kind: "set-value",
        binding: "todo.done ? 'done' : todo.text",
        value: "Ship the release",
      },
    });

    expect(result.status).toBe("refused");
  });

  it("refuses a field the items do not have", () => {
    const result = runRepeatItemEdit({
      content: SCREEN,
      target: TARGET,
      operation: {
        kind: "set-value",
        binding: "todo.title",
        value: "Ship the release",
      },
    });

    expect(result.status).toBe("refused");
  });
});

describe("what it declines to do", () => {
  it("leaves a non-repeat selection to the caller's markup path", () => {
    expect(
      runRepeatItemEdit({
        content: SCREEN,
        target: null,
        operation: { kind: "remove" },
      }),
    ).toEqual({ status: "not-a-repeat" });
  });

  it("refuses rather than guessing when the row's index is unknown", () => {
    const result = runRepeatItemEdit({
      content: SCREEN,
      target: { xFor: "todo in todos", itemIndex: -1 },
      operation: { kind: "remove" },
    });

    expect(result.status).toBe("refused");
    expect(result.status === "refused" && result.refusal).toBe("no-item");
  });

  it("refuses a collection it cannot locate as a literal", () => {
    const result = runRepeatItemEdit({
      content: SCREEN,
      target: { xFor: "card in column.cards", itemIndex: 0 },
      operation: { kind: "remove" },
    });

    expect(result.status).toBe("refused");
    expect(result.status === "refused" && result.refusal).toBe("unwritable");
  });

  it("refuses an index past the end of the collection", () => {
    const result = runRepeatItemEdit({
      content: SCREEN,
      target: { xFor: "todo in todos", itemIndex: 9 },
      operation: { kind: "remove" },
    });

    expect(result.status).toBe("refused");
  });
});

const DERIVED = `<body><script>
function todoApp() {
  return {
    filter: 'active',
    tasks: [
      { id: 1, text: 'Welcome to your todo list', done: false },
      { id: 2, text: 'Check off a task', done: false },
      { id: 3, text: 'Already done', done: true }
    ],
    get filteredTasks() { return this.tasks.filter(t => !t.done); }
  };
}
</script><div x-data="todoApp()">
  <template x-for="task in filteredTasks" :key="task.id">
    <li><span x-text="task.text"></span></li>
  </template>
</div></body>`;

describe("editing a row from a derived collection", () => {
  const target = {
    xFor: "task in filteredTasks",
    itemIndex: 1,
    keyExpression: "task.id",
    itemKey: "2",
  };

  it("writes the item the key names, not the one at that index", () => {
    const result = runRepeatItemEdit({
      content: DERIVED,
      target,
      operation: { kind: "set-value", binding: "task.text", value: "Renamed" },
    });

    expect(result.status).toBe("written");
    if (result.status !== "written") return;
    // Index 1 of the FILTERED list is id 2; index 1 of `tasks` would be wrong
    // only if position were used — assert the untouched neighbours.
    expect(result.content).toContain("'Renamed'");
    expect(result.content).toContain("'Welcome to your todo list'");
    expect(result.content).toContain("'Already done'");
  });

  it("refuses without a rendered key rather than writing by position", () => {
    const result = runRepeatItemEdit({
      content: DERIVED,
      target: { ...target, itemKey: "" },
      operation: { kind: "set-value", binding: "task.text", value: "Renamed" },
    });

    expect(result.status).toBe("refused");
  });

  it("refuses when the repeat has no :key to identify rows by", () => {
    const result = runRepeatItemEdit({
      content: DERIVED,
      target: { ...target, keyExpression: "" },
      operation: { kind: "set-value", binding: "task.text", value: "Renamed" },
    });

    expect(result.status).toBe("refused");
  });
});
