import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BuilderBodySyncingNotice } from "./BuilderBodySyncingNotice";

describe("BuilderBodySyncingNotice", () => {
  it("announces Page-body hydration as a polite status", () => {
    const html = renderToStaticMarkup(
      <BuilderBodySyncingNotice
        title="This page's content is still syncing from Builder"
        description="Editing is paused until the page body is safe."
      />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(
      "This page&#x27;s content is still syncing from Builder",
    );
    expect(html).toContain("Editing is paused until the page body is safe.");
  });

  it("can render generic copy without source provenance", () => {
    const html = renderToStaticMarkup(
      <BuilderBodySyncingNotice
        title="This page's content is still syncing"
        description="Editing is paused until the page body is safe."
      />,
    );

    expect(html).not.toContain("Builder");
  });
});
