import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AVAILABLE_SORT_OPTIONS, SORT_LABELS } from "./columnDefinitions";
import { SortMenu } from "./ProjectsListView";

describe("projects sort menu", () => {
  const html = renderToStaticMarkup(
    <SortMenu
      sort={{ option: "recentlyViewed", direction: "DESC" }}
      onSelect={() => {}}
      onClose={() => {}}
    />,
  );

  it("offers only the sort options the workspace contract exposes", () => {
    for (const option of AVAILABLE_SORT_OPTIONS) {
      expect(html).toContain(SORT_LABELS[option]);
    }
  });

  it("renders no disabled option and no 'not available' placeholder", () => {
    // A sort option we cannot honour is absent, never a dead button.
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("not available");
    const labels = [...html.matchAll(/ws-projects-menu-label">([^<]+)</g)].map(
      (match) => match[1],
    );
    expect(labels).toEqual(
      AVAILABLE_SORT_OPTIONS.map((option) => SORT_LABELS[option]),
    );
  });
});
