/**
 * Unit tests for applyFieldOps — the server-side read-modify-write merge
 * for form fields.
 *
 * Run with:
 *   pnpm --filter forms exec vitest --run --config vitest.config.ts server/lib/merge-fields.spec.ts
 */

import { it } from "vitest";
import type { FormField } from "../../shared/types.js";
import { applyFieldOps } from "./merge-fields.js";

function check(name: string, fn: () => void) {
  it(name, fn);
}

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function field(id: string, label = `Field ${id}`): FormField {
  return { id, type: "text", label, required: false };
}

const base: FormField[] = [field("a"), field("b"), field("c")];

// ---------------------------------------------------------------------------
// upsert
// ---------------------------------------------------------------------------

check("upsert of existing field updates it in-place", () => {
  const result = applyFieldOps(base, [
    { op: "upsert", field: { ...field("b"), label: "Updated B" } },
  ]);
  assert(result.length === 3, `expected 3 fields, got ${result.length}`);
  assert(
    result[1].label === "Updated B",
    `expected "Updated B", got ${result[1].label}`,
  );
  assert(result[0].id === "a", "order: first should be a");
  assert(result[2].id === "c", "order: last should be c");
});

check("upsert of new field appends it", () => {
  const result = applyFieldOps(base, [{ op: "upsert", field: field("d") }]);
  assert(result.length === 4, `expected 4, got ${result.length}`);
  assert(result[3].id === "d", "new field should be last");
});

check("two concurrent upserts on different fields both survive", () => {
  // Simulates two clients each sending an upsert for their own field.
  const result = applyFieldOps(base, [
    { op: "upsert", field: { ...field("a"), label: "Updated A" } },
    { op: "upsert", field: { ...field("c"), label: "Updated C" } },
  ]);
  assert(result.length === 3, `expected 3, got ${result.length}`);
  assert(result[0].label === "Updated A", `a: ${result[0].label}`);
  assert(result[1].id === "b", "b untouched");
  assert(result[2].label === "Updated C", `c: ${result[2].label}`);
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

check("remove deletes the target field", () => {
  const result = applyFieldOps(base, [{ op: "remove", id: "b" }]);
  assert(result.length === 2, `expected 2, got ${result.length}`);
  assert(
    result.every((f) => f.id !== "b"),
    "b should be gone",
  );
  assert(result[0].id === "a", "a first");
  assert(result[1].id === "c", "c second");
});

check("remove of non-existent id is a no-op", () => {
  const result = applyFieldOps(base, [{ op: "remove", id: "zzz" }]);
  assert(result.length === 3, `expected 3, got ${result.length}`);
});

check(
  "remove+update on different fields: remove wins for its field, update wins for its field",
  () => {
    // Client A removes 'b'; client B updates 'a'. Both ops applied in order.
    const result = applyFieldOps(base, [
      { op: "remove", id: "b" },
      { op: "upsert", field: { ...field("a"), label: "Updated A" } },
    ]);
    assert(result.length === 2, `expected 2, got ${result.length}`);
    assert(
      result.every((f) => f.id !== "b"),
      "b removed",
    );
    assert(result[0].label === "Updated A", "a updated");
  },
);

check("remove does not resurrect a field that was already removed", () => {
  // Remove 'b' twice — the second remove is a no-op.
  const result = applyFieldOps(base, [
    { op: "remove", id: "b" },
    { op: "remove", id: "b" },
  ]);
  assert(result.length === 2, `expected 2, got ${result.length}`);
});

// ---------------------------------------------------------------------------
// reorder
// ---------------------------------------------------------------------------

check("reorder rearranges listed fields", () => {
  const result = applyFieldOps(base, [{ op: "reorder", ids: ["c", "a", "b"] }]);
  assert(result.length === 3, `expected 3, got ${result.length}`);
  assert(result[0].id === "c", `first: ${result[0].id}`);
  assert(result[1].id === "a", `second: ${result[1].id}`);
  assert(result[2].id === "b", `third: ${result[2].id}`);
});

check("reorder appends unlisted fields after listed ones", () => {
  // 'd' was added by a concurrent upsert; it is not in the reorder list.
  const extended = [...base, field("d")];
  const result = applyFieldOps(extended, [{ op: "reorder", ids: ["b", "a"] }]);
  assert(result.length === 4, `expected 4, got ${result.length}`);
  assert(result[0].id === "b", `0: ${result[0].id}`);
  assert(result[1].id === "a", `1: ${result[1].id}`);
  // c and d were unlisted → appended in their original order.
  assert(result[2].id === "c", `2: ${result[2].id}`);
  assert(result[3].id === "d", `3: ${result[3].id}`);
});

// ---------------------------------------------------------------------------
// immutability
// ---------------------------------------------------------------------------

check("does not mutate the input array", () => {
  const original = [field("x"), field("y")];
  const copy = original.slice();
  applyFieldOps(original, [{ op: "remove", id: "x" }]);
  assert(original.length === copy.length, "input length changed");
  assert(original[0].id === "x", "input[0] changed");
});
