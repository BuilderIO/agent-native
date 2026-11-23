import { expect, it } from "vitest";

import { insertCommands, notebookLetter } from "./notebook-commands";

it("QA-A2-NBLETTER-01: a shortcut letter follows the character the key types, not its physical QWERTY position", () => {
  expect(notebookLetter({ code: "KeyX", key: "q" })).toBe("Q");
  expect(notebookLetter({ code: "KeyQ", key: "a" })).toBe("A");
  expect(notebookLetter({ code: "KeyA", key: "Q" })).toBe("Q");
});

it("QA-A2-NBLETTER-02: Option-composed, dead and non-Latin keys fall back to the physical letter", () => {
  expect(notebookLetter({ code: "KeyA", key: "å" })).toBe("A");
  expect(notebookLetter({ code: "KeyE", key: "Dead" })).toBe("E");
  expect(notebookLetter({ code: "KeyF", key: "а" })).toBe("F");
  expect(notebookLetter({ code: "KeyI", key: "ı" })).toBe("I");
});

it("QA-A2-NBLETTER-03: named and digit keys are unchanged", () => {
  expect(notebookLetter({ code: "Escape", key: "Escape" })).toBe("ESCAPE");
  expect(notebookLetter({ code: "Digit1", key: "1" })).toBe("1");
  expect(notebookLetter({ code: "Enter", key: "Enter" })).toBe("ENTER");
});

it("QA-A2-NBLETTER-04: insert and notebook command letters are unique", () => {
  const keys = insertCommands.map(({ key }) => key);
  expect(new Set(keys).size).toBe(keys.length);
});
