import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { ProjectHeader as View } from "./ProjectHeader";

function ProjectHeader(props: ComponentProps<typeof View>) {
  return (
    <MemoryRouter>
      <View {...props} />
    </MemoryRouter>
  );
}

const base = {
  title: "Weekly revenue",
  canRename: false,
  onRename: async () => {},
};

describe("ProjectHeader view tabs", () => {
  it("offers only the views the build can show", () => {
    const html = renderToStaticMarkup(
      <ProjectHeader
        {...base}
        views={["agent", "notebook"]}
        onSelectView={() => {}}
      />,
    );
    expect(html).toContain("Agent");
    expect(html).toContain("Notebook");
    expect(html).not.toContain("App builder");
  });

  it("renders no dead tabs when there is nothing to switch to", () => {
    const html = renderToStaticMarkup(<ProjectHeader {...base} />);
    expect(html).not.toContain("App builder");
    expect(html).not.toContain(">Agent<");
  });
});
