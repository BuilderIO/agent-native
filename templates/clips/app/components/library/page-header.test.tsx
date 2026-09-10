import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { PageBreadcrumb } from "./page-header";

describe("PageBreadcrumb", () => {
  it("renders linked ancestors and a current shadcn breadcrumb page", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <PageBreadcrumb
          items={[
            { label: "Spaces", to: "/spaces" },
            { label: "Design", to: "/spaces/design" },
            { label: "Research" },
          ]}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain('href="/spaces"');
    expect(markup).toContain('href="/spaces/design"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("Spaces / Design / Research");
    expect(markup.match(/role="presentation"/g)).toHaveLength(2);
  });
});
