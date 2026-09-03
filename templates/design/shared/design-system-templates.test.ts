import { describe, expect, it } from "vitest";

import {
  DESIGN_SYSTEM_TEMPLATE_IDS,
  PRODUCTION_DESIGN_SYSTEM_TEMPLATES,
  getProductionDesignSystemTemplate,
} from "./design-system-templates";

describe("production design-system templates", () => {
  it("ships one complete, source-linked snapshot for every public template id", () => {
    expect(PRODUCTION_DESIGN_SYSTEM_TEMPLATES.map(({ id }) => id)).toEqual(
      DESIGN_SYSTEM_TEMPLATE_IDS,
    );

    for (const template of PRODUCTION_DESIGN_SYSTEM_TEMPLATES) {
      expect(template.sourceUrl).toMatch(/^https:\/\//);
      expect(template.version.length).toBeGreaterThan(3);
      expect(template.license.length).toBeGreaterThan(2);
      expect(template.customInstructions.length).toBeGreaterThan(300);
      expect(template.data.customCSS).toContain(":root");
      expect(template.data.typography.headingSizes).toEqual(
        expect.objectContaining({
          h1: expect.any(String),
          h2: expect.any(String),
          h3: expect.any(String),
        }),
      );
      expect(Object.values(template.data.colors)).toHaveLength(7);
    }
  });

  it("preserves critical values from the named upstream snapshots", () => {
    const material = getProductionDesignSystemTemplate("material-3");
    const carbon = getProductionDesignSystemTemplate("carbon-white");
    const primer = getProductionDesignSystemTemplate("primer-light");

    expect(material?.data.colors).toMatchObject({
      primary: "#6750A4",
      background: "#FFFBFE",
      text: "#1C1B1F",
    });
    expect(material?.data.borders.radius).toBe("12px");

    expect(carbon?.version).toBe("@carbon/themes 11.76.1");
    expect(carbon?.data.colors).toMatchObject({
      primary: "#0F62FE",
      surface: "#F4F4F4",
      text: "#161616",
    });
    expect(carbon?.data.customCSS).toContain("--cds-spacing-13: 160px");

    expect(primer?.version).toBe("@primer/primitives 11.9.0");
    expect(primer?.data.colors).toMatchObject({
      primary: "#0969DA",
      surface: "#F6F8FA",
      text: "#1F2328",
      textMuted: "#59636E",
    });
    expect(primer?.data.customCSS).toContain("--text-display-size: 2.5rem");
  });

  it("does not resolve unknown template ids", () => {
    expect(getProductionDesignSystemTemplate("lookalike")).toBeUndefined();
  });
});
