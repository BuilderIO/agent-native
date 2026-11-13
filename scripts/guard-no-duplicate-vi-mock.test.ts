import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findDuplicateMocks } from "./guard-no-duplicate-vi-mock.ts";

describe("findDuplicateMocks", () => {
  it("reports a path mocked twice, with both lines", () => {
    const source = [
      'import { vi } from "vitest";',
      'vi.mock("@agent-native/core/client/use-action", () => ({',
      "  useActionMutation: () => ({}),",
      "}));",
      'vi.mock("@agent-native/core/client/use-action", async () => ({',
      "  useActionMutation: vi.fn(),",
      "}));",
      'vi.mock("./other", () => ({}));',
    ].join("\n");

    assert.deepEqual(findDuplicateMocks("a.spec.tsx", source), [
      {
        file: "a.spec.tsx",
        specifier: "@agent-native/core/client/use-action",
        lines: [2, 5],
      },
    ]);
  });

  it("counts a mock nested in a describe, since Vitest hoists it too", () => {
    const source = [
      'vi.mock("./dep", () => ({ who: () => "top" }));',
      'describe("b", () => {',
      '  vi.mock("./dep", () => ({ who: () => "nested" }));',
      "});",
    ].join("\n");

    assert.deepEqual(findDuplicateMocks("b.spec.ts", source), [
      { file: "b.spec.ts", specifier: "./dep", lines: [1, 3] },
    ]);
  });

  it("treats vi.mock(import(...)) as the same path as a string", () => {
    const source = [
      'vi.mock(import("./dep"), () => ({}));',
      "vi.mock(`./dep`, () => ({}));",
    ].join("\n");

    assert.deepEqual(findDuplicateMocks("c.spec.ts", source), [
      { file: "c.spec.ts", specifier: "./dep", lines: [1, 2] },
    ]);
  });

  it("allows repeated vi.doMock and vi.unmock, which run when called", () => {
    const source = [
      'vi.mock("./dep", () => ({}));',
      'it("one", async () => {',
      '  vi.doMock("./dep", () => ({ value: 1 }));',
      "});",
      'it("two", async () => {',
      '  vi.doMock("./dep", () => ({ value: 2 }));',
      '  vi.unmock("./dep");',
      '  vi.unmock("./dep");',
      "});",
    ].join("\n");

    assert.deepEqual(findDuplicateMocks("d.spec.ts", source), []);
  });

  it("ignores vi.mock text inside strings and comments", () => {
    const source = [
      'vi.mock("./dep", () => ({}));',
      '// vi.mock("./dep", () => ({}));',
      'const fixture = `vi.mock("./dep", () => ({}));`;',
      "const other = 'vi.mock(\"./dep\")';",
    ].join("\n");

    assert.deepEqual(findDuplicateMocks("e.test.ts", source), []);
  });
});
