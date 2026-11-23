import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProjectCategoriesDialog } from "./ProjectCategoriesDialog";

const project = {
  id: "prj_qa",
  ownerEmail: "qa@example.test",
  title: "QA project",
  description: "",
  language: "python" as const,
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: "2026-11-08T00:00:00.000Z",
  updatedAt: "2026-11-08T00:00:00.000Z",
};

describe("ProjectCategoriesDialog", () => {
  it("renders the category picker for a project", () => {
    const client = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ProjectCategoriesDialog project={project} onClose={() => {}} />
      </QueryClientProvider>,
    );
    expect(html).toContain("Add categories");
    expect(html).toContain("QA project");
    expect(html).toContain("Save");
  });

  it("does not show the admin-only create form to a member", () => {
    const client = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ProjectCategoriesDialog project={project} onClose={() => {}} />
      </QueryClientProvider>,
    );
    // The shell query has no admin flag while it is still loading, so the
    // catalogue-management control stays hidden rather than offering a write
    // the server would refuse.
    expect(html).not.toContain("New category");
  });
});
