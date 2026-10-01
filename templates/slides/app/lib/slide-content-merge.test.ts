// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { mergeSlideContent } from "./slide-content-merge";

const slide = (...children: string[]) =>
  `<div class="fmd-slide" style="padding: 60px;">${children.join("")}</div>`;
const title = (text: string, style = "font-size: 56px;") =>
  `<h1 data-slide-object-id="t" style="${style}">${text}</h1>`;
const body = (text: string) => `<p data-slide-object-id="b">${text}</p>`;
const note = (text: string) => `<p data-slide-object-id="n">${text}</p>`;

describe("mergeSlideContent", () => {
  it("keeps edits to different objects from both writers", () => {
    const base = slide(title("Title"), body("Body"));
    const merged = mergeSlideContent(
      base,
      slide(title("Title by A"), body("Body")),
      slide(title("Title"), body("Body by B")),
    );

    expect(merged).toBe(slide(title("Title by A"), body("Body by B")));
  });

  it("returns null when both writers edit the same text", () => {
    const base = slide(title("Title"), body("Body"));

    expect(
      mergeSlideContent(
        base,
        slide(title("Mine"), body("Body")),
        slide(title("Theirs"), body("Body")),
      ),
    ).toBeNull();
  });

  it("merges style changes to different properties of one object", () => {
    const base = slide(title("Title", "font-size: 56px; color: red;"));
    const merged = mergeSlideContent(
      base,
      slide(title("Title", "font-size: 56px; color: blue;")),
      slide(title("Title", "font-size: 72px; color: red;")),
    );

    expect(merged).toBe(slide(title("Title", "font-size: 72px; color: blue;")));
  });

  it("merges a text edit with a move of the same object", () => {
    const base = slide(title("Title", "left: 10px;"));
    const merged = mergeSlideContent(
      base,
      slide(title("Edited", "left: 10px;")),
      slide(title("Title", "left: 90px;")),
    );

    expect(merged).toBe(slide(title("Edited", "left: 90px;")));
  });

  it("returns null when both writers change the same style property", () => {
    const base = slide(title("Title", "left: 10px;"));

    expect(
      mergeSlideContent(
        base,
        slide(title("Title", "left: 20px;")),
        slide(title("Title", "left: 90px;")),
      ),
    ).toBeNull();
  });

  it("keeps an object one writer added while the other edits another", () => {
    const base = slide(title("Title"), body("Body"));
    const merged = mergeSlideContent(
      base,
      slide(title("Title"), body("Body"), note("Added by A")),
      slide(title("Title"), body("Body by B")),
    );

    expect(merged).toBe(
      slide(title("Title"), body("Body by B"), note("Added by A")),
    );
  });

  it("applies a deletion when the other writer left that object alone", () => {
    const base = slide(title("Title"), body("Body"));
    const merged = mergeSlideContent(
      base,
      slide(body("Body")),
      slide(title("Title"), body("Body by B")),
    );

    expect(merged).toBe(slide(body("Body by B")));
  });

  it("returns null when one writer deletes what the other edited", () => {
    const base = slide(title("Title"), body("Body"));

    expect(
      mergeSlideContent(
        base,
        slide(body("Body")),
        slide(title("Edited"), body("Body")),
      ),
    ).toBeNull();
  });

  it("takes a reorder from one writer and the edits from the other", () => {
    const base = slide(title("Title"), body("Body"));
    const merged = mergeSlideContent(
      base,
      slide(body("Body"), title("Title")),
      slide(title("Title by B"), body("Body")),
    );

    expect(merged).toBe(slide(body("Body"), title("Title by B")));
  });

  it("returns null when both writers reorder", () => {
    const base = slide(title("Title"), body("Body"), note("Note"));

    expect(
      mergeSlideContent(
        base,
        slide(body("Body"), title("Title"), note("Note")),
        slide(note("Note"), title("Title"), body("Body")),
      ),
    ).toBeNull();
  });

  it("returns whichever side changed when the other equals the base", () => {
    const base = slide(title("Title"));
    const changed = slide(title("Changed"));

    expect(mergeSlideContent(base, changed, base)).toBe(changed);
    expect(mergeSlideContent(base, base, changed)).toBe(changed);
  });
});
