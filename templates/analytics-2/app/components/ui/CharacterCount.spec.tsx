import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CharacterCount } from "./CharacterCount";

describe("CharacterCount", () => {
  it("stays hidden until the field is half full", () => {
    expect(renderToStaticMarkup(<CharacterCount count={4} max={10} />)).toBe(
      "",
    );
  });

  it("shows the count at half full", () => {
    const html = renderToStaticMarkup(
      <CharacterCount count={500} max={1000} />,
    );
    expect(html).toContain("500/1000");
    expect(html).toContain("is-normal");
  });

  it("warns past 80% and flags an over-limit count", () => {
    expect(
      renderToStaticMarkup(<CharacterCount count={900} max={1000} />),
    ).toContain("is-warning");
    expect(
      renderToStaticMarkup(<CharacterCount count={1001} max={1000} />),
    ).toContain("is-over");
  });
});
