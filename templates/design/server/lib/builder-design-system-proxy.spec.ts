import { describe, expect, it } from "vitest";

import { reconcileBuilderProxyData } from "./builder-design-system-proxy.js";

describe("reconcileBuilderProxyData", () => {
  const reference = {
    source: "builder" as const,
    builderDesignSystemId: "ds-1",
    builderJobId: "job-1",
    builderStatus: "in-progress",
    docs: [],
    tokenValues: {
      "--brand-primary": "#123456",
      "--brand-accent": "#abcdef",
      "--brand-surface": "#f8fafc",
      "--brand-text-muted": "#64748b",
      "--radius-card": "16px",
      "--space-element-gap": "20px",
    },
    docCount: 1,
  };

  it("replaces proxy placeholders with concrete Builder values", () => {
    const result = reconcileBuilderProxyData(
      JSON.stringify({
        source: "builder",
        builderStatus: "in-progress",
        colors: {
          primary: "var(--primary)",
          accent: "var(--accent)",
        },
        typography: { headingFont: "inherit", bodyFont: "inherit" },
        spacing: { pagePadding: "48px", elementGap: "24px" },
        borders: { radius: "12px", accentWidth: "1px" },
        defaults: { background: "var(--background)" },
        logos: [],
      }),
      reference,
      "2026-08-21T00:00:00.000Z",
    );

    expect(result).toMatchObject({ tokenCount: 6, rejectedTokenCount: 0 });
    const data = JSON.parse(result!.data) as Record<string, any>;
    expect(data.builderStatus).toBe("ready");
    expect(data.builderSyncedAt).toBe("2026-08-21T00:00:00.000Z");
    expect(data.colors).toMatchObject({
      primary: "#123456",
      accent: "#abcdef",
      surface: "#f8fafc",
      textMuted: "#64748b",
    });
    expect(data.borders.radius).toBe("16px");
    expect(data.spacing.elementGap).toBe("20px");
    expect(data.tokens).toHaveLength(6);
  });

  it("does not mark an incomplete Builder response as synchronized", () => {
    expect(
      reconcileBuilderProxyData(
        JSON.stringify({ source: "builder", builderStatus: "in-progress" }),
        { ...reference, tokenValues: {}, docCount: 0 },
        "2026-08-21T00:00:00.000Z",
      ),
    ).toBeNull();
  });

  it("rejects malformed local proxy data instead of overwriting it", () => {
    expect(() =>
      reconcileBuilderProxyData(
        "not-json",
        reference,
        "2026-08-21T00:00:00.000Z",
      ),
    ).toThrow("not valid JSON");
  });
});
