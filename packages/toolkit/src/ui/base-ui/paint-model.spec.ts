import { expect, it } from "vitest";

import {
  createPaintStackEdit,
  equalPaintStacks,
  type Paint,
} from "./paint-model.js";

function gradient(id: string): Extract<Paint, { kind: "linear" }> {
  return {
    id,
    kind: "linear",
    visible: true,
    angle: 45,
    opacity: 70,
    stops: [
      {
        id: id + "-start",
        color: { token: "ink", value: "currentColor" },
        offset: 40,
      },
      { id: id + "-end", color: { value: "transparent" }, offset: 40 },
    ],
  };
}
it("compares authored values even for hidden paints and overlapping stops", () => {
  const a = gradient("a"),
    b = gradient("b");
  expect(equalPaintStacks([a], [b])).toBe(true);
  const [first, second] = b.stops;
  expect(equalPaintStacks([a], [{ ...b, stops: [second, first] }])).toBe(false);
  for (const color of [
    { value: "currentColor" },
    { value: "black", token: "ink" },
  ]) {
    expect(
      equalPaintStacks(
        [{ ...a, visible: false }],
        [{ ...b, visible: false, stops: [{ ...first, color }, second] }],
      ),
    ).toBe(false);
  }
});
it("keeps local identities through insertion, removal and reordering, including colliding IDs", () => {
  const a = gradient("a"),
    b = gradient("b");
  const top: Paint = {
    kind: "solid",
    id: "top",
    visible: true,
    opacity: 100,
    color: { value: "red" },
  };
  const localTop = { ...top, id: "local-top" };
  const [first, second] = a.stops;
  const source = [top, a],
    local = [localTop, b];
  const next = [
    { ...a, stops: [second, { ...first, id: b.stops[1].id, offset: 50 }] },
    { ...top, id: b.id },
    top,
  ];
  const update = createPaintStackEdit(source, next);
  const result = update(local);
  expect(result.map((paint) => paint.id)).toEqual(["b", "b-1", "local-top"]);
  expect(result[0]).toEqual({
    ...b,
    stops: [b.stops[1], { ...first, id: b.stops[1].id + "-1", offset: 50 }],
  });
  expect(result[2]).toBe(localTop);
  expect(equalPaintStacks(result, next)).toBe(true);
  expect(update(source)).toBe(next);
});
