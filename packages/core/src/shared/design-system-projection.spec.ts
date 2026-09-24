import { describe, expect, it } from "vitest";

import {
  designSystemReadinessGaps,
  legacyDesignSystemFoundations,
  projectDesignSystemFoundation,
} from "./design-system-projection.js";

describe("native foundation projection", () => {
  it("merges type scale without flattening or losing structural keys", () => {
    const data = {
      typography: {
        headingFont: "Existing",
        bodyFont: "Body",
        headingSizes: { h1: "60px", h2: "40px", h3: "28px" },
        lineHeight: "1.5",
      },
      notes: "Keep actual guidance",
    };
    const projected = projectDesignSystemFoundation(data, {
      id: "typography",
      values: { headingFont: "Revised", "headingSizes.h1": "64px" },
    });
    expect(projected).toEqual({
      ...data,
      typography: {
        ...data.typography,
        headingFont: "Revised",
        headingSizes: { h1: "64px", h2: "40px", h3: "28px" },
      },
    });
    expect(data.typography.headingSizes.h1).toBe("60px");
    expect(() =>
      projectDesignSystemFoundation(data, {
        id: "typography",
        values: { headingSizes: "wrong shape" },
      }),
    ).toThrow("headingSizes.h1");
  });

  it("preserves distinct app spacing and defaults while seeding absent aliases", () => {
    const data = {
      spacing: {
        pagePadding: "20px",
        slidePadding: "80px",
        elementGap: "12px",
      },
      defaults: { background: "white", labelStyle: "uppercase" },
      slideDefaults: { background: "black", padding: "80px" },
      borders: { radius: "8px", width: "1px" },
    };
    const spacing = projectDesignSystemFoundation(data, {
      id: "spacing",
      values: { pagePadding: "24px" },
    });
    expect(spacing.spacing).toEqual({
      pagePadding: "24px",
      slidePadding: "80px",
      elementGap: "12px",
    });
    const color = projectDesignSystemFoundation(data, {
      id: "colors",
      values: { background: "red" },
    });
    expect(color.defaults).toEqual(data.defaults);
    expect(color.slideDefaults).toEqual(data.slideDefaults);
    expect(
      projectDesignSystemFoundation(
        {},
        { id: "spacing", values: { pagePadding: "24px" } },
      ).spacing,
    ).toEqual({ pagePadding: "24px", slidePadding: "24px" });
    expect(
      projectDesignSystemFoundation(data, {
        id: "radius",
        values: { radius: "12px" },
      }).borders,
    ).toEqual({ radius: "12px", width: "1px" });
  });

  it("migrates actual legacy values only and cannot call a shell ready", () => {
    const artifacts = legacyDesignSystemFoundations(
      {
        colors: { primary: "#123456" },
        typography: { headingSizes: { h1: "64px" } },
        notes: "real notes",
      },
      "now",
    );
    expect(artifacts.map((artifact) => artifact.id)).toEqual([
      "colors",
      "typography",
    ]);
    expect(artifacts[1].values).toEqual({ "headingSizes.h1": "64px" });
    expect(designSystemReadinessGaps(artifacts)).toContain("button");
    expect(designSystemReadinessGaps(artifacts)).toContain("colors.secondary");
    expect(
      designSystemReadinessGaps([{ ...artifacts[0], id: "button" }]),
    ).toContain("button");
  });

  it("retains a real radius scale and uses md as the documented scalar default", () => {
    const values = {
      "radius.sm": "8px",
      "radius.md": "14px",
      "radius.lg": "22px",
      "radius.pill": "999px",
    };
    const artifact = legacyDesignSystemFoundations(
      { borders: values },
      "now",
    )[0];
    expect(
      projectDesignSystemFoundation({ borders: { width: "1px" } }, artifact)
        .borders,
    ).toEqual({ width: "1px", ...values, radius: "14px" });
    expect(
      designSystemReadinessGaps([artifact]).filter((gap) =>
        gap.startsWith("radius"),
      ),
    ).toEqual([]);
    expect(
      projectDesignSystemFoundation(
        {},
        { ...artifact, values: { ...values, radius: "6px" } },
      ).borders,
    ).toEqual({ ...values, radius: "6px" });
    expect(
      designSystemReadinessGaps([
        { ...artifact, values: { "radius.pill": "999px" } },
      ]),
    ).toContain("radius.radius-or-radius.md");
    expect(artifact.values).toEqual(values);
  });
});
