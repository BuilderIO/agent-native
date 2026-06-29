import { AgentNativeI18nProvider } from "@agent-native/core/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { docsI18nCatalog } from "../i18n";
import TableOfContents from "./TableOfContents";

function renderToc(markdownUrl?: string) {
  return renderToStaticMarkup(
    <AgentNativeI18nProvider
      catalog={docsI18nCatalog}
      initialLocale="en-US"
      initialPreference="en-US"
      persistPreference={false}
    >
      <TableOfContents
        items={[{ id: "overview", label: "Overview", level: 2 }]}
        markdownUrl={markdownUrl}
      />
    </AgentNativeI18nProvider>,
  );
}

describe("TableOfContents", () => {
  it("renders the copy markdown button beside the On this page heading", () => {
    const html = renderToc("/docs/multi-app-workspace.md");

    expect(html).toContain("On this page");
    expect(html).toContain('aria-label="Copy doc as Markdown"');
    expect(html).toContain('type="button"');
  });

  it("omits the copy markdown button without a markdown URL", () => {
    const html = renderToc();

    expect(html).toContain("On this page");
    expect(html).not.toContain('aria-label="Copy doc as Markdown"');
  });
});
