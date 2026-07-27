import { describe, expect, it, vi } from "vitest";

import {
  createSequenceMatcher,
  resolveShortcut,
  shouldIgnoreShortcutTarget,
  SEQUENCE_SHORTCUT_TIMEOUT_MS,
  type KeyboardShortcut,
} from "./use-keyboard-shortcuts";

const noop = () => {};

function nestedEditable(match: string | null) {
  return {
    tagName: "DIV",
    isContentEditable: false,
    closest: (selector: string) => (selector === match ? {} : null),
  };
}

describe("shouldIgnoreShortcutTarget", () => {
  it("ignores native text entry controls", () => {
    expect(shouldIgnoreShortcutTarget({ tagName: "INPUT" })).toBe(true);
    expect(shouldIgnoreShortcutTarget({ tagName: "textarea" })).toBe(true);
    expect(shouldIgnoreShortcutTarget({ tagName: "SELECT" })).toBe(true);
  });

  it("ignores contenteditable surfaces, including nested nodes", () => {
    expect(
      shouldIgnoreShortcutTarget({ tagName: "DIV", isContentEditable: true }),
    ).toBe(true);
    expect(
      shouldIgnoreShortcutTarget(nestedEditable("[contenteditable]")),
    ).toBe(true);
  });

  it("allows ordinary elements", () => {
    expect(shouldIgnoreShortcutTarget({ tagName: "BUTTON" })).toBe(false);
    expect(shouldIgnoreShortcutTarget(nestedEditable(null))).toBe(false);
    expect(shouldIgnoreShortcutTarget(null)).toBe(false);
  });
});

describe("resolveShortcut", () => {
  const shortcuts: KeyboardShortcut[] = [
    { key: "n", handler: noop },
    { key: "?", shift: true, handler: noop },
    { key: "k", meta: true, handler: noop },
  ];

  it("matches an unmodified key regardless of case", () => {
    expect(resolveShortcut({ key: "N" }, shortcuts)?.key).toBe("n");
  });

  it("does not fire while an input or editor is focused", () => {
    expect(
      resolveShortcut({ key: "n", target: { tagName: "INPUT" } }, shortcuts),
    ).toBeNull();
    expect(
      resolveShortcut({ key: "n", target: { tagName: "TEXTAREA" } }, shortcuts),
    ).toBeNull();
    expect(
      resolveShortcut(
        { key: "n", target: { tagName: "DIV", isContentEditable: true } },
        shortcuts,
      ),
    ).toBeNull();
  });

  it("keeps modified and unmodified bindings distinct", () => {
    expect(resolveShortcut({ key: "n", metaKey: true }, shortcuts)).toBeNull();
    expect(resolveShortcut({ key: "k", metaKey: true }, shortcuts)?.key).toBe(
      "k",
    );
    expect(resolveShortcut({ key: "k", ctrlKey: true }, shortcuts)?.key).toBe(
      "k",
    );
    expect(resolveShortcut({ key: "k" }, shortcuts)).toBeNull();
  });

  it("respects the shift requirement and rejects alt", () => {
    expect(resolveShortcut({ key: "?", shiftKey: true }, shortcuts)?.key).toBe(
      "?",
    );
    expect(resolveShortcut({ key: "?" }, shortcuts)).toBeNull();
    expect(resolveShortcut({ key: "n", altKey: true }, shortcuts)).toBeNull();
  });
});

describe("createSequenceMatcher", () => {
  const build = () => {
    const goAccounts = vi.fn();
    const goTasks = vi.fn();
    const matcher = createSequenceMatcher([
      { keys: ["g", "a"], handler: goAccounts },
      { keys: ["g", "t"], handler: goTasks },
    ]);
    return { matcher, goAccounts, goTasks };
  };

  it("reports a pending prefix, then resolves the chord", () => {
    const { matcher, goAccounts, goTasks } = build();

    expect(matcher.push({ key: "g" }, 0)).toEqual({ status: "pending" });

    const result = matcher.push({ key: "A" }, 100);
    expect(result.status).toBe("matched");
    if (result.status === "matched") result.sequence.handler();

    expect(goAccounts).toHaveBeenCalledTimes(1);
    expect(goTasks).not.toHaveBeenCalled();
  });

  it("leaves a key that starts no chord free for a plain binding", () => {
    const { matcher } = build();

    expect(matcher.push({ key: "t" }, 0)).toEqual({ status: "none" });
    expect(matcher.push({ key: "n" }, 10)).toEqual({ status: "none" });
  });

  it("expires the chord once the timeout has elapsed", () => {
    const { matcher } = build();

    expect(matcher.push({ key: "g" }, 0).status).toBe("pending");
    expect(
      matcher.push({ key: "t" }, SEQUENCE_SHORTCUT_TIMEOUT_MS + 1).status,
    ).toBe("none");
  });

  it("still resolves a chord completed just inside the timeout", () => {
    const { matcher } = build();

    matcher.push({ key: "g" }, 0);
    expect(
      matcher.push({ key: "t" }, SEQUENCE_SHORTCUT_TIMEOUT_MS).status,
    ).toBe("matched");
  });

  it("clears the buffer after a match so the next key stands alone", () => {
    const { matcher } = build();

    matcher.push({ key: "g" }, 0);
    expect(matcher.push({ key: "a" }, 10).status).toBe("matched");
    expect(matcher.push({ key: "a" }, 20).status).toBe("none");
  });

  it("never starts a chord from a focused input", () => {
    const { matcher } = build();

    expect(
      matcher.push({ key: "g", target: { tagName: "INPUT" } }, 0).status,
    ).toBe("none");
    expect(matcher.push({ key: "a" }, 10).status).toBe("none");
  });

  it("ignores modified keystrokes without disturbing a pending chord", () => {
    const { matcher } = build();

    matcher.push({ key: "g" }, 0);
    expect(matcher.push({ key: "a", metaKey: true }, 10).status).toBe("none");
    expect(matcher.push({ key: "a" }, 20).status).toBe("matched");
  });

  it("resets on demand", () => {
    const { matcher } = build();

    matcher.push({ key: "g" }, 0);
    matcher.reset();
    expect(matcher.push({ key: "a" }, 10).status).toBe("none");
  });
});
