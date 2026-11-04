import { describe, expect, it } from "vitest";

import { MAX_STEP_OUTPUT_BYTES } from "../items.js";
import {
  chain,
  normalizedItem,
  ran,
  sourceResult,
  stepOf,
} from "../testing/engine-fixtures.js";
import { ok } from "../testing/fakes.js";
import { makeHost, seedWorkflow } from "../testing/make-host.js";

const blob = (bytes: number) => ({ blob: "x".repeat(bytes) });

const lookup = (name: string) =>
  [
    name,
    "lookup",
    { operation: "test.read", args: { key: { mode: "fixed", value: "k" } } },
  ] as const;

async function setup(
  nodes: (readonly [string, "lookup", Record<string, unknown>])[],
  items = 1,
  labels: Record<string, string> = {},
) {
  const test = makeHost();
  const graph = chain(nodes.map((node) => [...node]));
  const { id } = await seedWorkflow(test, {
    ...graph,
    nodes: graph.nodes.map((node) =>
      labels[node.id] === undefined
        ? node
        : { ...node, label: labels[node.id] },
    ),
  });
  test.operations.script(
    "test.items",
    sourceResult(
      Array.from({ length: items }, (_, index) => normalizedItem(`m${index}`)),
    ),
  );
  return { test, id };
}

describe("a step that would hand on more than one step may hold", () => {
  it("fails naming the step, what is attached, and what to do about it", async () => {
    const { test, id } = await setup([
      lookup("lookupA"),
      lookup("lookupB"),
      lookup("lookupC"),
    ]);
    test.operations.always("test.read", ok(blob(30_000)));

    const result = await ran(test, id);

    // Two answers still fit on the item; the third pushes it past the cap.
    expect(stepOf(result, "lookupB").status).toBe("succeeded");
    const failed = stepOf(result, "lookupC");
    expect(failed.status).toBe("failed");
    expect(failed.error?.code).toBe("output_over_cap");
    const message = failed.error?.message ?? "";
    expect(message).toContain('"lookupC"');
    expect(message).toContain("65536 bytes");
    expect(message).toContain("nodes.lookupA");
    expect(message).toContain("nodes.lookupB");
    expect(message).toMatch(/narrow the request/i);
    expect(message).toMatch(/split the work/i);
    expect(message).toMatch(/not raised/i);
    expect(result.run.status).toBe("failed");
    expect(result.run.error).toEqual({
      code: "output_over_cap",
      message,
    });
    expect(result.clean).toBe(false);
  });

  it("uses the step's label when it has one, beside its name", async () => {
    const { test, id } = await setup(
      [lookup("lookupA"), lookup("lookupB"), lookup("lookupC")],
      1,
      { lookupC: "Read the pull requests" },
    );
    test.operations.always("test.read", ok(blob(30_000)));

    const result = await ran(test, id);

    expect(stepOf(result, "lookupC").error?.message).toContain(
      '"Read the pull requests" (lookupC)',
    );
  });

  it("counts every item the step emits, so a few big answers fail one step", async () => {
    const { test, id } = await setup([lookup("lookupA")], 3);
    test.operations.always("test.read", ok(blob(25_000)));

    const result = await ran(test, id);

    const failed = stepOf(result, "lookupA");
    expect(failed.error?.code).toBe("output_over_cap");
    expect(failed.error?.message).toContain("3 items");
    expect(failed.error?.message).toContain('"lookupA"');
  });

  it("says what measured it, in the details a caller can read", async () => {
    const { test, id } = await setup([
      lookup("lookupA"),
      lookup("lookupB"),
      lookup("lookupC"),
    ]);
    test.operations.always("test.read", ok(blob(30_000)));

    const result = await ran(test, id);

    const message = stepOf(result, "lookupC").error?.message ?? "";
    expect(message).toMatch(/earlier step's result still attached/);
    expect(message).toContain(`${MAX_STEP_OUTPUT_BYTES} bytes`);
    expect(message).toMatch(/Largest: nodes\.\w+ \(\d+ bytes\)/);
  });
});

describe("one answer that is over the cap by itself", () => {
  it("fails that item naming the step and the operation, and says what to do", async () => {
    const { test, id } = await setup([lookup("read")]);
    test.operations.always("test.read", ok(blob(70_000)));

    const result = await ran(test, id);

    const failed = stepOf(result, "read");
    expect(failed.status).toBe("failed");
    expect(failed.error?.code).toBe("output_over_cap");
    const message = failed.error?.message ?? "";
    expect(message).toContain('"read"');
    expect(message).toContain("test.read");
    expect(message).toMatch(/narrow the request/i);
    expect(result.run.counts.itemFailures).toBe(1);
  });
});

describe("what stays as it was", () => {
  it("lets two answers that fit through, with nothing said", async () => {
    const { test, id } = await setup([lookup("lookupA"), lookup("lookupB")]);
    test.operations.always("test.read", ok(blob(20_000)));

    const result = await ran(test, id);

    expect(stepOf(result, "lookupB").status).toBe("succeeded");
    expect(result.clean).toBe(true);
  });
});
