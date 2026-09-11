import { describe, expect, it } from "vitest";

import { readRepeatData } from "./repeat-data";
import { removeRepeatItem } from "./repeat-data-write";

/** Two objects own a `cards` array — matching by leaf name picks one at random. */
const NESTED = `<body><div x-data="{
  columns: [
    { name: 'To do', cards: [{ title: 'a' }, { title: 'b' }] },
    { name: 'Done', cards: [{ title: 'c' }] }
  ],
  sidebar: { cards: [{ title: 'unrelated' }] }
}">
  <template x-for="column in columns">
    <template x-for="card in column.cards"><p x-text="card.title"></p></template>
  </template>
</div></body>`;

const TWICE = `<body>
  <script>const todos = [{ text: 'one' }];</script>
  <div x-data="{ todos: [{ text: 'two' }] }">
    <template x-for="todo in todos"><li x-text="todo.text"></li></template>
  </div>
</body>`;

describe("a collection that cannot be located to exactly one array", () => {
  it("refuses a nested collection instead of writing whichever matched first", () => {
    const read = readRepeatData(NESTED, "card in column.cards");

    expect(read.status).toBe("unsupported");
    expect(read.status === "unsupported" && read.reason).toContain("nested");
  });

  it("refuses to remove an item from a nested collection", () => {
    const write = removeRepeatItem({
      html: NESTED,
      xFor: "card in column.cards",
      index: 0,
    });

    expect(write.status).toBe("refused");
  });

  it("leaves the document untouched when it refuses", () => {
    const write = removeRepeatItem({
      html: NESTED,
      xFor: "card in column.cards",
      index: 0,
    });

    expect(write.status === "written" && write.html).toBeFalsy();
    expect(NESTED).toContain("{ title: 'unrelated' }");
  });

  it("refuses a name declared more than once", () => {
    const read = readRepeatData(TWICE, "todo in todos");

    expect(read.status).toBe("unsupported");
    expect(read.status === "unsupported" && read.reason).toContain("2 times");
  });

  it("still reads a collection declared exactly once", () => {
    const single = `<body><div x-data="{ todos: [{ text: 'one' }, { text: 'two' }] }">
      <template x-for="todo in todos"><li x-text="todo.text"></li></template>
    </div></body>`;

    const read = readRepeatData(single, "todo in todos");
    expect(read.status).toBe("read");
    expect(read.status === "read" && read.items).toHaveLength(2);
  });
});
