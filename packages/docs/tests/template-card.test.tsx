import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { TemplateCard, templates } from "../app/components/TemplateCard";
import { getTemplateDocsPath } from "../app/components/template-docs";

describe("TemplateCard", () => {
  it("renders View Docs links to template docs pages", () => {
    for (const template of templates) {
      const html = renderToStaticMarkup(
        <MemoryRouter>
          <TemplateCard template={template} />
        </MemoryRouter>,
      );

      expect(html).toContain(`href="${getTemplateDocsPath(template)}"`);
      expect(html).not.toContain(
        `href="/templates/${template.slug}">View Docs`,
      );
    }
  });
});
