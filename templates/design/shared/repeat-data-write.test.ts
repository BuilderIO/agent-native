import { describe, expect, it } from "vitest";

import { readRepeatData } from "./repeat-data";
import {
  duplicateRepeatItem,
  moveRepeatItem,
  removeRepeatItem,
  writeRepeatValue,
} from "./repeat-data-write";

const TODOS = `<body x-data="app()">
  <ul>
    <template x-for="t in todos" :key="t.text">
      <li><span x-text="t.text"></span></li>
    </template>
  </ul>
  <script>
    function app() {
      return {
        todos: [
          {text:'Walk dog', done:false},
          {text:'Buy milk', done:true},
          {text:'Pay rent', done:false},
        ],
      };
    }
  </script>
</body>`;

const BARS = `<body x-data="c()">
  <template x-for="(h,i) in v" :key="i"><div class="bar"></div></template>
  <script>function c(){return{v:[38,52,44]}}</script>
</body>`;

const XFOR = "t in todos";

function labels(html: string, xFor = XFOR): string[] {
  const read = readRepeatData(html, xFor);
  if (read.status !== "read")
    throw new Error(`expected read, got ${read.status}`);
  return read.items.map((item) => {
    if (item.kind === "scalar") return String(item.value);
    return String(item.fields.find((field) => field.key === "text")?.value);
  });
}

describe("writeRepeatValue", () => {
  it("edits one item's text without touching its siblings", () => {
    const written = writeRepeatValue({
      html: TODOS,
      xFor: XFOR,
      index: 1,
      field: "text",
      value: "Buy oat milk",
    });
    expect(written.status).toBe("written");
    if (written.status !== "written") return;

    expect(labels(written.html)).toEqual([
      "Walk dog",
      "Buy oat milk",
      "Pay rent",
    ]);
    expect(written.html).toContain("{text:'Buy oat milk', done:true}");
  });

  it("keeps the document's quote style and escapes the value", () => {
    const written = writeRepeatValue({
      html: TODOS,
      xFor: XFOR,
      index: 0,
      field: "text",
      value: "Walk Ada's dog",
    });
    if (written.status !== "written") throw new Error("expected write");

    expect(written.html).toContain("'Walk Ada\\'s dog'");
    expect(labels(written.html)[0]).toBe("Walk Ada's dog");
  });

  it("writes a boolean field without quoting it", () => {
    const written = writeRepeatValue({
      html: TODOS,
      xFor: XFOR,
      index: 0,
      field: "done",
      value: true,
    });
    if (written.status !== "written") throw new Error("expected write");

    expect(written.html).toContain("{text:'Walk dog', done:true}");
  });

  it("edits a scalar item in place", () => {
    const written = writeRepeatValue({
      html: BARS,
      xFor: "(h,i) in v",
      index: 1,
      value: 90,
    });
    if (written.status !== "written") throw new Error("expected write");

    expect(labels(written.html, "(h,i) in v")).toEqual(["38", "90", "44"]);
  });

  it("refuses a field on a scalar item and a fieldless write on an object", () => {
    expect(
      writeRepeatValue({
        html: BARS,
        xFor: "(h,i) in v",
        index: 0,
        field: "text",
        value: 1,
      }).status,
    ).toBe("refused");
    expect(
      writeRepeatValue({ html: TODOS, xFor: XFOR, index: 0, value: 1 }).status,
    ).toBe("refused");
  });

  it("refuses an unknown field and an out-of-range index by name", () => {
    const badField = writeRepeatValue({
      html: TODOS,
      xFor: XFOR,
      index: 0,
      field: "nope",
      value: 1,
    });
    expect(badField.status === "refused" && badField.reason).toMatch(/nope/);

    const badIndex = writeRepeatValue({
      html: TODOS,
      xFor: XFOR,
      index: 9,
      field: "text",
      value: "x",
    });
    expect(badIndex.status === "refused" && badIndex.reason).toMatch(/9/);
  });

  it("refuses rather than guessing when the data cannot be read", () => {
    const html = `<body><script>const todos = [load()];</script></body>`;
    const written = writeRepeatValue({
      html,
      xFor: XFOR,
      index: 0,
      field: "text",
      value: "x",
    });
    expect(written.status).toBe("refused");
  });
});

describe("moveRepeatItem", () => {
  it("reorders the array, which is what dragging a repeated row means", () => {
    const written = moveRepeatItem({
      html: TODOS,
      xFor: XFOR,
      from: 2,
      to: 0,
    });
    if (written.status !== "written") throw new Error("expected write");

    expect(labels(written.html)).toEqual(["Pay rent", "Walk dog", "Buy milk"]);
  });

  it("is a no-op when the item does not move", () => {
    const written = moveRepeatItem({
      html: TODOS,
      xFor: XFOR,
      from: 1,
      to: 1,
    });
    expect(written.status === "written" && written.html).toBe(TODOS);
  });

  it("refuses a target outside the list instead of clamping", () => {
    const written = moveRepeatItem({
      html: TODOS,
      xFor: XFOR,
      from: 0,
      to: 7,
    });
    expect(written.status).toBe("refused");
  });
});

describe("removeRepeatItem and duplicateRepeatItem", () => {
  it("removes exactly one item", () => {
    const written = removeRepeatItem({ html: TODOS, xFor: XFOR, index: 1 });
    if (written.status !== "written") throw new Error("expected write");

    expect(labels(written.html)).toEqual(["Walk dog", "Pay rent"]);
  });

  it("duplicates an item directly after itself", () => {
    const written = duplicateRepeatItem({ html: TODOS, xFor: XFOR, index: 0 });
    if (written.status !== "written") throw new Error("expected write");

    expect(labels(written.html)).toEqual([
      "Walk dog",
      "Walk dog",
      "Buy milk",
      "Pay rent",
    ]);
  });

  it("leaves the rest of the document byte-identical", () => {
    const written = removeRepeatItem({ html: TODOS, xFor: XFOR, index: 2 });
    if (written.status !== "written") throw new Error("expected write");

    expect(written.html).toContain(`<span x-text="t.text"></span>`);
    expect(written.html.startsWith(`<body x-data="app()">`)).toBe(true);
    expect(written.html.trimEnd().endsWith("</body>")).toBe(true);
  });
});
