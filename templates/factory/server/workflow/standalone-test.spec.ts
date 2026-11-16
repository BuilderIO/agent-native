import { describe, expect, it } from "vitest";

import type { NodeKind } from "./contract.js";
import { canTestWithoutItems } from "./standalone-test.js";
import {
  aiWritten,
  candidateNode,
  fixed,
  fromPath,
  parseNode,
  rule,
} from "./story-graphs.fixture.js";

const lookup = (args: Record<string, unknown>) =>
  parseNode("lookup", { operation: "test.read", args });

describe("canTestWithoutItems", () => {
  it("is true for a lookup that reads only fixed values, the settings and the run", () => {
    expect(canTestWithoutItems(lookup({}))).toBe(true);
    expect(canTestWithoutItems(lookup({ key: fixed("static") }))).toBe(true);
    expect(
      canTestWithoutItems(lookup({ key: fromPath("settings.extras.repo") })),
    ).toBe(true);
    expect(canTestWithoutItems(lookup({ key: fromPath("run.id") }))).toBe(true);
    expect(
      canTestWithoutItems(
        lookup({ key: fixed("{{ settings.extras.repo }}/{{ run.mode }}") }),
      ),
    ).toBe(true);
  });

  it("is false once a field reads the item or an earlier step", () => {
    expect(canTestWithoutItems(lookup({ key: fromPath("item.title") }))).toBe(
      false,
    );
    expect(
      canTestWithoutItems(lookup({ key: fromPath("nodes.read.name") })),
    ).toBe(false);
    expect(
      canTestWithoutItems(lookup({ key: fixed("Review {{ item.title }}") })),
    ).toBe(false);
    expect(
      canTestWithoutItems(
        lookup({
          a: fixed("{{ settings.extras.repo }}"),
          b: fromPath("item.url"),
        }),
      ),
    ).toBe(false);
  });

  it("is false when a model writes a field from the item", () => {
    expect(
      canTestWithoutItems(lookup({ key: aiWritten("Pick the thread.") })),
    ).toBe(false);
  });

  it("is false for a path that does not parse, which the validator reports", () => {
    const broken = candidateNode("lookup", {
      operation: "test.read",
      args: { key: fromPath("item..title") },
    });
    expect(canTestWithoutItems(broken as never)).toBe(false);
  });

  it("is false for every other kind of step, whatever it reads", () => {
    const others: [NodeKind, unknown][] = [
      ["action", { operation: "test.write", args: { text: fixed("hello") } }],
      ["filter", { combinator: "all", rules: [rule("settings.x", "isTrue")] }],
      ["split", { field: "settings.extras.list" }],
      [
        "wait",
        {
          wait: "condition",
          operation: "test.read",
          args: {},
          rule: rule("nodes.x.ok", "isTrue"),
          everyMinutes: 15,
          limitHours: 24,
        },
      ],
      ["end", { outcome: "done" }],
    ];
    for (const [kind, settings] of others) {
      expect(canTestWithoutItems(parseNode(kind, settings)), kind).toBe(false);
    }
  });
});
