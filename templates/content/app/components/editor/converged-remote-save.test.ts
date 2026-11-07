import { describe, expect, it } from "vitest";

import { convergedContentNeedsSave } from "./converged-remote-save";

// create-document keeps an agent's blank line between paragraphs; the editor
// holds the same page one block per line.
const stored = "First about oranges.\n\nSecond about pears.";
const editor = "First about oranges.\nSecond about pears.";

describe("convergedContentNeedsSave", () => {
  it("skips text the stored body already holds", () => {
    expect(
      convergedContentNeedsSave({
        live: stored,
        saved: stored,
        attempted: null,
      }),
    ).toBe(false);
  });

  it("skips text it already tried to save", () => {
    const live = "First about oranges.\nSecond about plums.";
    expect(
      convergedContentNeedsSave({ live, saved: stored, attempted: live }),
    ).toBe(false);
  });

  it("skips the editor's spelling of a stored blank-line page", () => {
    expect(
      convergedContentNeedsSave({
        live: editor,
        saved: stored,
        attempted: null,
      }),
    ).toBe(false);
  });

  it("saves text the stored body lacks", () => {
    expect(
      convergedContentNeedsSave({
        live: "First about oranges.\nSecond about plums.",
        saved: stored,
        attempted: null,
      }),
    ).toBe(true);
  });

  it("saves a new block on a stored blank-line page", () => {
    expect(
      convergedContentNeedsSave({
        live: `${editor}\nThird about figs.`,
        saved: stored,
        attempted: editor,
      }),
    ).toBe(true);
  });
});
