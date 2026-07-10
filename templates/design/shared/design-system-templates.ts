import type { DesignSystemData } from "./api";

export const DESIGN_SYSTEM_TEMPLATE_IDS = [
  "material-3",
  "carbon-white",
  "primer-light",
] as const;

export type DesignSystemTemplateId =
  (typeof DESIGN_SYSTEM_TEMPLATE_IDS)[number];

export interface ProductionDesignSystemTemplate {
  id: DesignSystemTemplateId;
  title: string;
  organization: string;
  description: string;
  sourceLabel: string;
  sourceUrl: string;
  version: string;
  license: string;
  data: DesignSystemData;
  customInstructions: string;
}

/**
 * Source-linked snapshots of established public design systems. Keep values
 * aligned with the version/source named on each entry; these are working
 * systems for generated designs, not lookalike palettes.
 */
export const PRODUCTION_DESIGN_SYSTEM_TEMPLATES = [
  {
    id: "material-3",
    title: "Material Design 3",
    organization: "Google",
    description:
      "Baseline light color roles, Roboto type scale, 4 dp spacing, and the Material 3 shape system.",
    sourceLabel: "Material Design 3",
    sourceUrl: "https://m3.material.io/styles",
    version: "Baseline light",
    license: "Apache-2.0",
    data: {
      colors: {
        primary: "#6750A4",
        secondary: "#625B71",
        accent: "#7D5260",
        background: "#FFFBFE",
        surface: "#FFFBFE",
        text: "#1C1B1F",
        textMuted: "#49454F",
      },
      typography: {
        headingFont: "Roboto",
        bodyFont: "Roboto",
        headingWeight: "400",
        bodyWeight: "400",
        headingSizes: {
          h1: "57px",
          h2: "45px",
          h3: "36px",
        },
      },
      spacing: {
        pagePadding: "24px",
        elementGap: "16px",
      },
      borders: {
        radius: "12px",
        accentWidth: "1px",
      },
      defaults: {
        background: "#FFFBFE",
        labelStyle: "none",
      },
      logos: [],
      imageStyle: {
        referenceUrls: [],
        styleDescription:
          "Clear, inclusive product imagery with simple compositions, natural light, and purposeful color drawn from the active Material color roles.",
      },
      notes:
        "Material Design 3 baseline light snapshot. Source: https://m3.material.io/styles. Use semantic color roles and the complete type and shape scales; do not imply Google product branding.",
      customCSS: `:root {
  --md-sys-color-primary: #6750a4;
  --md-sys-color-on-primary: #ffffff;
  --md-sys-color-primary-container: #eaddff;
  --md-sys-color-on-primary-container: #21005d;
  --md-sys-color-secondary: #625b71;
  --md-sys-color-secondary-container: #e8def8;
  --md-sys-color-tertiary: #7d5260;
  --md-sys-color-tertiary-container: #ffd8e4;
  --md-sys-color-surface: #fffbfe;
  --md-sys-color-surface-variant: #e7e0ec;
  --md-sys-color-on-surface: #1c1b1f;
  --md-sys-color-on-surface-variant: #49454f;
  --md-sys-color-outline: #79747e;
  --md-sys-color-outline-variant: #cac4d0;
  --md-sys-color-error: #b3261e;
  --md-sys-shape-extra-small: 4px;
  --md-sys-shape-small: 8px;
  --md-sys-shape-medium: 12px;
  --md-sys-shape-large: 16px;
  --md-sys-shape-extra-large: 28px;
  --md-sys-shape-full: 9999px;
  --md-sys-typescale-display-large-size: 57px;
  --md-sys-typescale-display-large-line-height: 64px;
  --md-sys-typescale-headline-large-size: 32px;
  --md-sys-typescale-headline-large-line-height: 40px;
  --md-sys-typescale-title-large-size: 22px;
  --md-sys-typescale-title-large-line-height: 28px;
  --md-sys-typescale-body-large-size: 16px;
  --md-sys-typescale-body-large-line-height: 24px;
  --md-sys-typescale-label-large-size: 14px;
  --md-sys-typescale-label-large-line-height: 20px;
}`,
    },
    customInstructions:
      "Follow Material Design 3, using semantic color roles rather than decorative purple. Reserve primary for high-emphasis controls and active states; use containers for lower emphasis. Use the Roboto baseline type scale (display 57/64, headline large 32/40, title large 22/28, body large 16/24, label large 14/20). Build spacing on a 4 px grid. Use the official shape scale (4, 8, 12, 16, 28, full) by component role, visible focus states, minimum 48 px touch targets, and state layers for hover, focus, pressed, and disabled. Do not use Google logos or make the result look like a specific Google product.",
  },
  {
    id: "carbon-white",
    title: "Carbon Design System",
    organization: "IBM",
    description:
      "Carbon v11 White theme with IBM Plex, role-based enterprise color tokens, and the 2/4/8 spacing scale.",
    sourceLabel: "Carbon Design System",
    sourceUrl: "https://carbondesignsystem.com/",
    version: "@carbon/themes 11.76.1",
    license: "Apache-2.0",
    data: {
      colors: {
        primary: "#0F62FE",
        secondary: "#393939",
        accent: "#0F62FE",
        background: "#FFFFFF",
        surface: "#F4F4F4",
        text: "#161616",
        textMuted: "#525252",
      },
      typography: {
        headingFont: "IBM Plex Sans",
        bodyFont: "IBM Plex Sans",
        headingWeight: "400",
        bodyWeight: "400",
        headingSizes: {
          h1: "32px",
          h2: "28px",
          h3: "24px",
        },
      },
      spacing: {
        pagePadding: "32px",
        elementGap: "16px",
      },
      borders: {
        radius: "0px",
        accentWidth: "2px",
      },
      defaults: {
        background: "#FFFFFF",
        labelStyle: "none",
      },
      logos: [],
      imageStyle: {
        referenceUrls: [],
        styleDescription:
          "Technical, information-rich editorial imagery with strong grids, restrained color, crisp geometry, and documentary rather than decorative composition.",
      },
      notes:
        "IBM Carbon Design System v11 White theme snapshot from @carbon/themes 11.76.1. Sources: https://carbondesignsystem.com/elements/themes/overview/ and https://carbondesignsystem.com/elements/typography/type-sets/. Do not imply IBM endorsement.",
      customCSS: `:root {
  --cds-background: #ffffff;
  --cds-background-brand: #0f62fe;
  --cds-layer-01: #f4f4f4;
  --cds-layer-02: #ffffff;
  --cds-layer-accent-01: #e0e0e0;
  --cds-border-subtle-00: #e0e0e0;
  --cds-border-strong-01: #8d8d8d;
  --cds-border-interactive: #0f62fe;
  --cds-text-primary: #161616;
  --cds-text-secondary: #525252;
  --cds-text-helper: #6f6f6f;
  --cds-link-primary: #0f62fe;
  --cds-focus: #0f62fe;
  --cds-support-error: #da1e28;
  --cds-support-success: #24a148;
  --cds-support-warning: #f1c21b;
  --cds-spacing-01: 2px;
  --cds-spacing-02: 4px;
  --cds-spacing-03: 8px;
  --cds-spacing-04: 12px;
  --cds-spacing-05: 16px;
  --cds-spacing-06: 24px;
  --cds-spacing-07: 32px;
  --cds-spacing-08: 40px;
  --cds-spacing-09: 48px;
  --cds-spacing-10: 64px;
  --cds-spacing-11: 80px;
  --cds-spacing-12: 96px;
  --cds-spacing-13: 160px;
  --cds-heading-05-size: 32px;
  --cds-heading-05-line-height: 40px;
  --cds-body-01-size: 14px;
  --cds-body-01-line-height: 20px;
}`,
    },
    customInstructions:
      "Follow IBM Carbon Design System v11 White theme. Use IBM Plex Sans and productive type for application UI: heading-05 is 32/40 regular, body-01 is 14/20 regular, and compact headings are semibold. Use Carbon's 2, 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96, 160 px spacing tokens and a disciplined grid. Keep corners square, surfaces layered through white and gray 10, and blue 60 (#0F62FE) reserved for interactive emphasis. Use 48 px controls where Carbon specifies them, 2 px focus outlines, clear data density, and complete hover, active, selected, disabled, error, and skeleton states. Do not use IBM logos or imply IBM endorsement.",
  },
  {
    id: "primer-light",
    title: "Primer",
    organization: "GitHub",
    description:
      "Primer light tokens with Mona Sans, compact developer-tool density, semantic colors, and responsive spacing.",
    sourceLabel: "Primer Design System",
    sourceUrl: "https://primer.style/",
    version: "@primer/primitives 11.9.0",
    license: "MIT",
    data: {
      colors: {
        primary: "#0969DA",
        secondary: "#25292E",
        accent: "#0969DA",
        background: "#FFFFFF",
        surface: "#F6F8FA",
        text: "#1F2328",
        textMuted: "#59636E",
      },
      typography: {
        headingFont: "Mona Sans",
        bodyFont: "Mona Sans",
        headingWeight: "600",
        bodyWeight: "400",
        headingSizes: {
          h1: "40px",
          h2: "32px",
          h3: "20px",
        },
      },
      spacing: {
        pagePadding: "24px",
        elementGap: "16px",
      },
      borders: {
        radius: "6px",
        accentWidth: "1px",
      },
      defaults: {
        background: "#FFFFFF",
        labelStyle: "none",
      },
      logos: [],
      imageStyle: {
        referenceUrls: [],
        styleDescription:
          "Practical developer-focused diagrams and product imagery with crisp code-detail, restrained backgrounds, and semantic status color used only when informative.",
      },
      notes:
        "GitHub Primer light snapshot from @primer/primitives 11.9.0. Sources: https://primer.style/product/primitives/ and https://primer.style/product/getting-started/foundations/. Do not use GitHub or Octocat marks or imply GitHub endorsement.",
      customCSS: `:root {
  --bgColor-default: #ffffff;
  --bgColor-muted: #f6f8fa;
  --bgColor-emphasis: #25292e;
  --bgColor-accent-muted: #ddf4ff;
  --bgColor-accent-emphasis: #0969da;
  --fgColor-default: #1f2328;
  --fgColor-muted: #59636e;
  --fgColor-accent: #0969da;
  --fgColor-onEmphasis: #ffffff;
  --borderColor-default: #d1d9e0;
  --borderColor-muted: #d8dee4;
  --borderColor-accent-emphasis: #0969da;
  --base-size-4: 4px;
  --base-size-8: 8px;
  --base-size-16: 16px;
  --base-size-24: 24px;
  --base-size-32: 32px;
  --base-size-40: 40px;
  --base-size-48: 48px;
  --base-size-64: 64px;
  --text-body-size-medium: 1rem;
  --text-title-size-small: 1rem;
  --text-title-size-medium: 1.25rem;
  --text-title-size-large: 2rem;
  --text-display-size: 2.5rem;
  --text-display-lineHeight: 1.375;
  --text-display-weight: 500;
}`,
    },
    customInstructions:
      "Follow GitHub Primer using semantic tokens, not raw palette values. Use the Mona Sans stack with display 40 px/500, large title 32 px, medium title 20 px, and 16 px body text; keep dense application labels at 14 px only where hierarchy remains clear. Use the 4, 8, 16, 24, 32, 40, 48, 64 px spacing scale and restrained 6 px radii. Default backgrounds are white, muted grouping is #F6F8FA, primary text is #1F2328, muted text is #59636E, and accent emphasis is #0969DA. Pair emphasis backgrounds with on-emphasis foregrounds, preserve semantic status colors, support light/dark and high-contrast modes conceptually, and include visible focus, hover, active, selected, disabled, loading, empty, and error states. Do not use GitHub or Octocat marks or imply GitHub endorsement.",
  },
] satisfies readonly ProductionDesignSystemTemplate[];

export function getProductionDesignSystemTemplate(
  id: string,
): ProductionDesignSystemTemplate | undefined {
  return PRODUCTION_DESIGN_SYSTEM_TEMPLATES.find(
    (template) => template.id === id,
  );
}
