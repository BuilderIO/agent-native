import { describe, expect, it } from "vitest";

import { findRepeatItemFieldByKey } from "./repeat-data";

/** A derived collection: the rows come from a getter, the items from `tasks`. */
const APP = `<body><script>
function todoApp() {
  return {
    filter: 'all',
    tasks: [
      { id: 1, text: 'Welcome to your todo list', done: false },
      { id: 2, text: 'Check off a task to complete it', done: false },
      { id: 3, text: 'This one is already done', done: true }
    ],
    get filteredTasks() {
      return this.filter === 'all' ? this.tasks : this.tasks.filter(t => !t.done);
    }
  };
}
</script>
<div x-data="todoApp()">
  <template x-for="task in filteredTasks" :key="task.id">
    <li><span x-text="task.text"></span></li>
  </template>
</div></body>`;

describe("finding a row's item when the collection is derived", () => {
  it("finds the field by key, not by position in the filtered list", () => {
    const found = findRepeatItemFieldByKey(APP, "id", "3", "text");

    expect(found.status).toBe("found");
    if (found.status !== "found") return;
    expect(found.field.value).toBe("This one is already done");
    expect(
      APP.slice(found.field.valueSpan.start, found.field.valueSpan.end),
    ).toBe("'This one is already done'");
  });

  it("finds the first item too, so index 0 is not special", () => {
    const found = findRepeatItemFieldByKey(APP, "id", "1", "text");

    expect(found.status === "found" && found.field.value).toBe(
      "Welcome to your todo list",
    );
  });

  it("reports absent for a key no item carries", () => {
    expect(findRepeatItemFieldByKey(APP, "id", "99", "text").status).toBe(
      "absent",
    );
  });

  it("reports absent when the item has no such field", () => {
    expect(findRepeatItemFieldByKey(APP, "id", "1", "title").status).toBe(
      "absent",
    );
  });

  it("refuses when two items across the document share the key", () => {
    const twice = APP.replace(
      "get filteredTasks()",
      "archive: [{ id: 1, text: 'a duplicate id' }],\n    get filteredTasks()",
    );

    expect(findRepeatItemFieldByKey(twice, "id", "1", "text").status).toBe(
      "ambiguous",
    );
  });
});

describe("writing that field", () => {
  it("rewrites only the identified item's value", async () => {
    const { writeRepeatValueByKey } = await import("./repeat-data-write");
    const write = writeRepeatValueByKey({
      html: APP,
      keyField: "id",
      keyValue: "2",
      field: "text",
      value: "Check off a task jkhkjbjk",
    });

    expect(write.status).toBe("written");
    if (write.status !== "written") return;
    expect(write.html).toContain("'Check off a task jkhkjbjk'");
    expect(write.html).toContain("'Welcome to your todo list'");
    expect(write.html).toContain("'This one is already done'");
    expect(write.html).toContain("get filteredTasks()");
  });

  it("refuses an unknown key rather than writing something", async () => {
    const { writeRepeatValueByKey } = await import("./repeat-data-write");
    const write = writeRepeatValueByKey({
      html: APP,
      keyField: "id",
      keyValue: "99",
      field: "text",
      value: "nope",
    });

    expect(write.status).toBe("refused");
  });
});
