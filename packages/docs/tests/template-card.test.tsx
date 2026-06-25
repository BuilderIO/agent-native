import { AgentNativeI18nProvider } from "@agent-native/core/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { getTemplateDocsPath } from "../app/components/template-docs";
import { TemplateCard, templates } from "../app/components/TemplateCard";
import { docsI18nCatalog } from "../app/i18n";

describe("TemplateCard", () => {
  it("renders View Docs links to template docs pages", () => {
    for (const template of templates) {
      const html = renderToStaticMarkup(
        <MemoryRouter>
          <AgentNativeI18nProvider
            catalog={docsI18nCatalog}
            initialLocale="en-US"
            initialPreference="en-US"
            persistPreference={false}
          >
            <TemplateCard template={template} />
          </AgentNativeI18nProvider>
        </MemoryRouter>,
      );

      expect(html).toContain(`href="${getTemplateDocsPath(template)}"`);
      expect(html).not.toContain(
        `href="/templates/${template.slug}">View Docs`,
      );
    }
  });
});
