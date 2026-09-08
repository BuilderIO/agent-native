import { describe, expect, it } from "vitest";

import { resolveEmailPreviewAssets } from "./transactional-email-preview";

describe("resolveEmailPreviewAssets", () => {
  it("uses the canonical logo for browser previews", () => {
    expect(
      resolveEmailPreviewAssets(
        '<img src="cid:agent-native-logo" alt="Agent-Native" />',
      ),
    ).toBe('<img src="/favicon.png" alt="Agent-Native" />');
  });

  it("leaves explicit brand logos unchanged", () => {
    const html = '<img src="https://example.com/logo.png" />';

    expect(resolveEmailPreviewAssets(html)).toBe(html);
  });
});
