import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProjectOutlinePanel } from "./ProjectOutlinePanel";

const cells = [
  { id: "cell_1", label: "Load orders", kind: "sql" },
  { id: "cell_2", label: "Orders by day", kind: "display-table" },
];

describe("ProjectOutlinePanel", () => {
  it("lists every cell in order with its label and kind", () => {
    const html = renderToStaticMarkup(
      <ProjectOutlinePanel
        cells={cells}
        onClose={() => {}}
        onJump={() => {}}
      />,
    );
    expect(html).toContain("Table of contents");
    expect(html.indexOf("Load orders")).toBeLessThan(
      html.indexOf("Orders by day"),
    );
    expect(html).toContain("SQL");
    expect(html).toContain("Table");
  });

  it("shows the empty state when the project has no cells", () => {
    const html = renderToStaticMarkup(
      <ProjectOutlinePanel cells={[]} onClose={() => {}} onJump={() => {}} />,
    );
    expect(html).toContain("No cells yet");
  });
});
