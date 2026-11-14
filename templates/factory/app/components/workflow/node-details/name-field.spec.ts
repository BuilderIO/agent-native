import { describe, expect, it } from "vitest";

import { nameKeyAction } from "./name-field";

describe("nameKeyAction", () => {
  it("commits and closes on Enter in a modal opened to rename", () => {
    expect(nameKeyAction("Enter", true, false)).toBe("commit-and-close");
  });

  it("only leaves the field on Enter in a modal opened for the step", () => {
    expect(nameKeyAction("Enter", false, false)).toBe("leave");
  });

  it("reverts on Escape either way, leaving the modal to the caller", () => {
    expect(nameKeyAction("Escape", true, false)).toBe("revert");
    expect(nameKeyAction("Escape", false, false)).toBe("revert");
  });

  it("ignores every other key", () => {
    expect(nameKeyAction("a", true, false)).toBeNull();
    expect(nameKeyAction("Tab", false, false)).toBeNull();
  });

  it("leaves the keys of an input method's composition alone", () => {
    expect(nameKeyAction("Enter", true, true)).toBeNull();
    expect(nameKeyAction("Enter", false, true)).toBeNull();
    expect(nameKeyAction("Escape", true, true)).toBeNull();
  });
});
