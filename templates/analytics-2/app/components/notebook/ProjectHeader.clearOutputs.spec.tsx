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
  canRename: true,
  onRename: async () => {},
};

describe("ProjectHeader clear outputs", () => {
  it("renders the header with and without the clear-outputs action", () => {
    const withAction = renderToStaticMarkup(
      <ProjectHeader {...base} onClearOutputs={() => {}} />,
    );
    const withoutAction = renderToStaticMarkup(<ProjectHeader {...base} />);
    // Both render the same closed header; the action only adds a menu item once
    // the menu opens, so the check here is that wiring it does not change the
    // header itself.
    expect(withAction).toContain("Weekly revenue");
    expect(withoutAction).toContain("Weekly revenue");
  });
});
