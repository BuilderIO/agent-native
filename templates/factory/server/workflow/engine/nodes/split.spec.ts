import { describe, expect, it } from "vitest";

import {
  chain,
  eventsOf,
  normalizedItem,
  ran,
  sourceResult,
  stepOf,
} from "../../testing/engine-fixtures.js";
import { aiPerItem, ok } from "../../testing/fakes.js";
import { makeHost, seedWorkflow } from "../../testing/make-host.js";

const say = (value: string) =>
  [
    "say",
    "action",
    {
      operation: "test.write",
      args: { text: { mode: "fixed", value } },
    },
  ] as const;

async function setup(
  field: string,
  tail = [say("{{ item.id }}|{{ item.title }}|{{ nodes.read.tag }}")],
) {
  const test = makeHost();
  const { id } = await seedWorkflow(
    test,
    chain([
      [
        "read",
        "lookup",
        {
          operation: "test.read",
          args: { key: { mode: "path", path: "item.id" } },
        },
      ],
      ["split", "split", { field }],
      ...tail.map((node) => [...node] as never),
    ]),
  );
  test.operations.script("test.items", sourceResult([normalizedItem("a")]));
  test.operations.always("test.write", ok(null, { externalRef: "r" }));
  return { test, id };
}

describe("a split", () => {
  it("makes one item per entry, and each child still reads what its parent carried", async () => {
    const { test, id } = await setup("nodes.read.rows");
    test.operations.script(
      "test.read",
      ok({ tag: "carried", rows: [{ title: "first" }, { title: "second" }] }),
    );

    const result = await ran(test, id);

    expect(stepOf(result, "split").ports.out.itemIds).toEqual(["a#0", "a#1"]);
    expect(
      test.operations.callsTo("test.write").map((call) => call.fields.text),
    ).toEqual(["a#0|first|carried", "a#1|second|carried"]);
    expect(
      (await eventsOf(test, id, "a")).find((event) => event.nodeId === "split"),
    ).toMatchObject({
      kind: "output",
      summary: "split into 2 items",
    });
    expect((await eventsOf(test, id, "a#1"))[0]).toMatchObject({
      kind: "output",
      summary: "split from a",
    });
  });

  it("lets an entry keep its own id, so a list of reports splits back into the reports", async () => {
    const { test, id } = await setup("nodes.read.rows");
    test.operations.script(
      "test.read",
      ok({ tag: "t", rows: [{ id: "report-9", title: "nine" }, "plain"] }),
    );

    const result = await ran(test, id);

    expect(stepOf(result, "split").ports.out.itemIds).toEqual([
      "report-9",
      "a#1",
    ]);
  });

  it("wraps an entry that is not an object, so it can still be read", async () => {
    const { test, id } = await setup("nodes.read.rows", [
      say("v={{ item.value }}"),
    ]);
    test.operations.script("test.read", ok({ tag: "t", rows: ["x", 2] }));

    await ran(test, id);

    expect(
      test.operations.callsTo("test.write").map((call) => call.fields.text),
    ).toEqual(["v=x", "v=2"]);
  });

  it("makes nothing from an empty list, and says it split into none", async () => {
    const { test, id } = await setup("nodes.read.rows");
    test.operations.script("test.read", ok({ tag: "t", rows: [] }));

    const result = await ran(test, id);

    expect(stepOf(result, "split").ports.out.count).toBe(0);
    expect(
      (await eventsOf(test, id, "a")).find((event) => event.nodeId === "split")
        ?.summary,
    ).toBe("split into 0 items");
  });

  it.each([
    ["a path with no value", "nodes.read.nope", /has no value here/],
    ["a field that is not a list", "nodes.read.tag", /is not a list/],
  ])("fails an item with %s", async (_name, field, message) => {
    const { test, id } = await setup(field);
    test.operations.script("test.read", ok({ tag: "t", rows: [] }));

    const result = await ran(test, id);

    const step = stepOf(result, "split");
    expect(step.error).toMatchObject({
      code: "expression_failed",
      message: expect.stringMatching(message),
    });
    expect(step.ports.out.count).toBe(0);
  });

  it("marks a child as an inbox row only when its parent stood for that row", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([
        ["group", "combine", { mode: "groupBy", key: "item.extras.task" }],
        ["split", "split", { field: "item.reports" }],
      ]),
    );
    test.operations.script(
      "test.items",
      sourceResult([
        normalizedItem("r1", { extras: { task: "t" } }),
        normalizedItem("r2", { extras: { task: "t" } }),
      ]),
    );

    await ran(test, id);

    // The group is not a row, but its reports are: ending the children ends r1 and r2.
    expect(
      test.statuses.written.map((entry) => [entry.itemId, entry.status]),
    ).toEqual([
      ["r1", "resolved"],
      ["r2", "resolved"],
    ]);
  });

  it("works on what a model returned: a whole-list answer split into one item per group", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([
        [
          "group",
          "ai",
          {
            instruction: "Group these.",
            mode: "wholeList",
            result: { groups: { type: "array" } },
          },
        ],
        ["split", "split", { field: "nodes.group.groups" }],
        [...say("{{ item.name }}")],
      ]),
    );
    test.operations.script(
      "test.items",
      sourceResult([normalizedItem("a"), normalizedItem("b")]),
    );
    test.operations.always("test.write", ok(null, { externalRef: "r" }));
    test.ai.respond(() => ({
      ok: true,
      mode: "wholeList",
      usage: { modelCalls: 1 },
      fields: { groups: [{ name: "g1" }, { name: "g2" }] },
    }));
    void aiPerItem;

    const result = await ran(test, id);

    expect(stepOf(result, "split").ports.out.count).toBe(2);
    expect(
      test.operations.callsTo("test.write").map((call) => call.fields.text),
    ).toEqual(["g1", "g2"]);
  });
});
