import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { sitePathForLocale } from "../app/components/docs-locale";
import { TemplateCard, templates } from "../app/components/TemplateCard";
import { docsI18nCatalog } from "../app/i18n";

describe("TemplateCard", () => {
  it("links the whole card to the app page", () => {
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

      expect(html).toContain(
        `href="${sitePathForLocale(`/apps/${template.slug}`)}"`,
      );
      expect(html).toContain('loading="lazy"');
      expect(html).toContain('decoding="async"');
      expect(html).not.toContain(`rel="preload" as="image"`);
    }
  });
});
