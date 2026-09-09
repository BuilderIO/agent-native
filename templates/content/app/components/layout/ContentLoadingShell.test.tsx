import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ContentLoadingShell } from "./ContentLoadingShell";

describe("ContentLoadingShell", () => {
  it("renders before client providers without exposing interactive page content", () => {
    const html = renderToStaticMarkup(<ContentLoadingShell />);

    expect(html).toContain('aria-busy="true"');
    expect(html).not.toMatch(/<(button|a|input|textarea)\b/);
    expect(html).not.toContain("contenteditable");
    expect(html).not.toContain("data-agent-native-loading-label");
  });
});
