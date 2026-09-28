import { describe, expect, it } from "vitest";

import {
  readRepeatData,
  repeatCollectionExpression,
  repeatDataItemLabel,
} from "./repeat-data";

const SCALARS_HTML = `<body x-data="chart()">
  <div class="chart">
    <template x-for="(h,i) in v" :key="i">
      <div class="bar" :style="'height:'+h+'%'"></div>
    </template>
  </div>
  <script>
    function chart() {
      return { v:[38,52,44,61,58,70,66,80,74,62,55,48] };
    }
  </script>
</body>`;

const OBJECTS_HTML = `<body x-data="board()">
  <template x-for="(d, idx) in departures" :key="idx">
    <tr><td x-text="d.route"></td><td x-text="d.guests"></td></tr>
  </template>
  <script>
    function board() {
      return {
        departures: [
          {route:'Ridgeline Traverse', date:'Sat, Sept 12', guests:6, guide:'J. Okafor', status:'Confirmed', badge:'bg-emerald-100 text-emerald-800'},
          {route:'Cutback Ridge Loop', date:'Sun, Sept 13', guests:4, guide:'M. Alvarez', status:'Pending', badge:'bg-amber-100 text-amber-800'},
        ],
      };
    }
  </script>
</body>`;

describe("repeatCollectionExpression", () => {
  it("reads the collection out of every x-for shape the generator emits", () => {
    expect(repeatCollectionExpression("item in items")).toBe("items");
    expect(repeatCollectionExpression("(h,i) in v")).toBe("v");
    expect(repeatCollectionExpression("(d, idx) in departures")).toBe(
      "departures",
    );
    expect(repeatCollectionExpression("p in col.items")).toBe("col.items");
  });

  it("refuses a computed collection instead of guessing a name", () => {
    expect(repeatCollectionExpression("x in items.filter(f)")).toBeNull();
    expect(repeatCollectionExpression("i in 5")).toBeNull();
  });
});

describe("readRepeatData", () => {
  it("reads a scalar array and spans each value for a one-instance edit", () => {
    const read = readRepeatData(SCALARS_HTML, "(h,i) in v");
    expect(read.status).toBe("read");
    if (read.status !== "read") return;

    expect(read.collection).toBe("v");
    expect(read.items).toHaveLength(12);
    expect(
      read.items.map((item) => item.kind === "scalar" && item.value),
    ).toEqual([38, 52, 44, 61, 58, 70, 66, 80, 74, 62, 55, 48]);

    const seventh = read.items[6]!;
    expect(SCALARS_HTML.slice(seventh.span.start, seventh.span.end)).toBe("66");
  });

  it("reads flat objects and spans each field value, not the whole field", () => {
    const read = readRepeatData(OBJECTS_HTML, "(d, idx) in departures");
    expect(read.status).toBe("read");
    if (read.status !== "read") return;

    expect(read.items).toHaveLength(2);
    const first = read.items[0]!;
    expect(first.kind).toBe("object");
    if (first.kind !== "object") return;

    expect(first.fields.map((field) => field.key)).toEqual([
      "route",
      "date",
      "guests",
      "guide",
      "status",
      "badge",
    ]);
    const route = first.fields[0]!;
    expect(route.value).toBe("Ridgeline Traverse");
    expect(OBJECTS_HTML.slice(route.valueSpan.start, route.valueSpan.end)).toBe(
      "'Ridgeline Traverse'",
    );
  });

  it("reports a missing collection rather than showing an empty repeat", () => {
    const read = readRepeatData(SCALARS_HTML, "x in missing");
    expect(read.status).toBe("not-found");
    expect(read.status === "not-found" && read.reason).toMatch(/missing/);
  });

  it("reports unsupported data rather than a partial list", () => {
    const html = `<body><script>const rows = [loadOne(), 2];</script></body>`;
    const read = readRepeatData(html, "r in rows");

    expect(read.status).toBe("unsupported");
    expect(read.status === "unsupported" && read.reason).toMatch(/literal/);
  });

  it("does not mistake the x-for in markup for a declaration", () => {
    const html = `<body><template x-for="d in departures"><i></i></template></body>`;
    expect(readRepeatData(html, "d in departures").status).toBe("not-found");
  });
});

describe("repeatDataItemLabel", () => {
  it("names an object row by its :key field", () => {
    const read = readRepeatData(OBJECTS_HTML, "(d, idx) in departures");
    if (read.status !== "read") throw new Error("expected read");

    expect(repeatDataItemLabel(read.items[0]!, "d.route")).toBe(
      "Ridgeline Traverse",
    );
  });

  it("falls back to the first string field when the key is not a label", () => {
    const read = readRepeatData(OBJECTS_HTML, "(d, idx) in departures");
    if (read.status !== "read") throw new Error("expected read");

    expect(repeatDataItemLabel(read.items[1]!, "idx")).toBe(
      "Cutback Ridge Loop",
    );
  });

  it("names a scalar row by its value", () => {
    const read = readRepeatData(SCALARS_HTML, "(h,i) in v");
    if (read.status !== "read") throw new Error("expected read");

    expect(repeatDataItemLabel(read.items[0]!)).toBe("38");
  });
});
