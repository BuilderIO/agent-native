import { describe, expect, it } from "vitest";

import {
  isBuilderDesignSystemReady,
  reconcileBuilderProxyData,
} from "./builder-design-system-proxy.js";

describe("isBuilderDesignSystemReady", () => {
  it("does not treat an in-progress DSI job as a usable default", () => {
    expect(isBuilderDesignSystemReady("in-progress")).toBe(false);
    expect(isBuilderDesignSystemReady("ready")).toBe(true);
    expect(isBuilderDesignSystemReady("complete")).toBe(true);
    expect(isBuilderDesignSystemReady("completed")).toBe(true);
  });
});

describe("reconcileBuilderProxyData", () => {
  const reference = {
    source: "builder" as const,
    builderDesignSystemId: "ds-1",
    builderJobId: "job-1",
    builderStatus: "in-progress",
    completionConfirmed: true,
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
        tokens: [
          {
            name: "Old Builder token",
            cssVar: "--old-builder-token",
            value: "#111111",
            source: "Builder DSI",
          },
          {
            name: "Local token",
            cssVar: "--local-token",
            value: "#222222",
            source: "Local",
          },
        ],
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
    expect(data.tokens).toHaveLength(7);
    expect(data.tokens).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cssVar: "--old-builder-token" }),
      ]),
    );
    expect(data.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cssVar: "--local-token" }),
      ]),
    );
  });

  it("does not mark an incomplete Builder response as synchronized", () => {
    expect(
      reconcileBuilderProxyData(
        JSON.stringify({ source: "builder", builderStatus: "in-progress" }),
        {
          ...reference,
          completionConfirmed: false,
          tokenValues: {},
          docCount: 0,
        },
        "2026-08-21T00:00:00.000Z",
      ),
    ).toBeNull();
  });

  it("marks an explicitly completed tokenless import as ready", () => {
    const result = reconcileBuilderProxyData(
      JSON.stringify({
        source: "builder",
        builderStatus: "in-progress",
        colors: { primary: "var(--primary)" },
      }),
      { ...reference, completionConfirmed: true, tokenValues: {} },
      "2026-08-21T00:00:00.000Z",
    );

    expect(result).toMatchObject({
      completionConfirmed: true,
      tokenCount: 0,
      rejectedTokenCount: 0,
    });
    const data = JSON.parse(result!.data) as Record<string, any>;
    expect(data.builderStatus).toBe("ready");
    expect(data.builderSyncedAt).toBe("2026-08-21T00:00:00.000Z");
    expect(data.colors.primary).toBe("var(--primary)");
  });

  it("keeps valid tokens in progress until Builder confirms completion", () => {
    const result = reconcileBuilderProxyData(
      JSON.stringify({ source: "builder", builderStatus: "in-progress" }),
      {
        ...reference,
        completionConfirmed: false,
        tokenValues: { "--brand-primary": "#123456" },
      },
      "2026-08-21T00:00:00.000Z",
    );

    expect(result).toMatchObject({
      completionConfirmed: false,
      tokenCount: 1,
      rejectedTokenCount: 0,
    });
    const data = JSON.parse(result!.data) as Record<string, any>;
    expect(data.builderStatus).toBe("in-progress");
    expect(data.builderSyncedAt).toBeUndefined();
  });

  it("chooses semantic color shades and explicit font-family tokens", () => {
    const result = reconcileBuilderProxyData(
      JSON.stringify({ source: "builder", builderStatus: "in-progress" }),
      {
        ...reference,
        tokenValues: {
          "--color-primary-50": "#f8fafc",
          "--color-primary-500": "#64748b",
          "--color-primary-900": "#0f172a",
          "--text-primary": "#111827",
          "--heading-size": "48px",
          "--heading-line-height": "1.2",
          "--heading-font-weight": "700",
          "--font-family-heading": "Inter",
          "--font-family-body": "Arial",
        },
      },
      "2026-08-21T00:00:00.000Z",
    );

    const data = JSON.parse(result!.data) as Record<string, any>;
    expect(data.colors.primary).toBe("#64748b");
    expect(data.colors.text).toBe("#111827");
    expect(data.typography).toMatchObject({
      headingFont: "Inter",
      bodyFont: "Arial",
    });
  });

  it("gives Builder semantic aliases precedence over local aliases", () => {
    const result = reconcileBuilderProxyData(
      JSON.stringify({
        source: "builder",
        builderStatus: "in-progress",
        tokens: [
          {
            name: "Local primary",
            cssVar: "--primary",
            value: "#111111",
            source: "Local",
          },
        ],
      }),
      {
        ...reference,
        tokenValues: {
          "--brand-primary": "#222222",
          "--primary": "#333333",
        },
      },
      "2026-08-21T00:00:00.000Z",
    );

    const data = JSON.parse(result!.data) as Record<string, any>;
    expect(data.colors.primary).toBe("#333333");
  });

  it("surfaces rejected Builder tokens instead of returning a ready proxy", () => {
    const result = reconcileBuilderProxyData(
      JSON.stringify({ source: "builder", builderStatus: "in-progress" }),
      {
        ...reference,
        tokenValues: { "--bad token": "#123456" },
      },
      "2026-08-21T00:00:00.000Z",
    );

    expect(result).toMatchObject({
      completionConfirmed: false,
      tokenCount: 0,
      rejectedTokenCount: 1,
    });
  });

  it("preserves local tokens stored only in custom CSS", () => {
    const result = reconcileBuilderProxyData(
      JSON.stringify({
        source: "builder",
        builderStatus: "in-progress",
        customCSS: ":root { --legacy-local: #334155; }",
      }),
      {
        ...reference,
        tokenValues: { "--brand-primary": "#123456" },
      },
      "2026-08-21T00:00:00.000Z",
    );

    expect(result!.data).toContain('"cssVar":"--legacy-local"');
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
