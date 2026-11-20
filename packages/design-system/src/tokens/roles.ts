import { at } from "./at.js";
import {
  CONTROL_HEIGHTS,
  CONTROL_ICON_SIZES,
  type TokenMap,
  type TokenName,
} from "./primitives.js";

/**
 * Semantic roles: what a value is for. Components and themes read these.
 * Each role is listed with its standard mapping onto the primitive scales;
 * the app themes map the same names onto their own values instead.
 */

export const ROLE_GROUPS = {
  surface: [
    "--surface-app",
    "--surface-nav",
    "--surface-canvas",
    "--surface-raised",
    "--surface-sunken",
    "--surface-overlay",
    "--surface-inverse",
  ],
  text: [
    "--fg-default",
    "--fg-muted",
    "--fg-subtle",
    "--fg-disabled",
    "--fg-on-brand",
    "--fg-on-danger",
    "--fg-brand",
    "--fg-danger",
    "--fg-inverse",
  ],
  line: ["--line-default", "--line-subtle", "--line-strong", "--line-focus"],
  fill: [
    "--fill-hover",
    "--fill-pressed",
    "--fill-selected",
    "--fill-neutral",
    "--fill-neutral-hover",
    "--fill-field",
    "--fill-brand",
    "--fill-brand-hover",
    "--fill-brand-subtle",
    "--fill-danger",
    "--fill-danger-hover",
    "--fill-danger-subtle",
  ],
  status: (["danger", "warning", "success", "info"] as const).flatMap(
    (status) =>
      (["solid", "subtle", "fg", "line"] as const).map(
        (kind) => `--status-${status}-${kind}` as const,
      ),
  ),
  elevation: [
    "--shadow-1",
    "--shadow-2",
    "--shadow-3",
    "--shadow-4",
    "--shadow-5",
    "--shadow-6",
  ],
  gradient: ["--gradient-brand", "--gradient-surface", "--gradient-glow"],
} as const satisfies Record<string, readonly TokenName[]>;

export type RoleToken = (typeof ROLE_GROUPS)[keyof typeof ROLE_GROUPS][number];

/**
 * Shape roles do not depend on appearance, so themes declare them once at the
 * theme root (`ThemeDefinition.tokens`), where a `data-radius` preset can
 * override them for a subtree.
 */
export const SHAPE_TOKEN_NAMES = [
  "--shape-control",
  "--shape-popup",
  "--shape-card",
  "--shape-panel",
  "--shape-dialog",
  "--shape-pill",
] as const;

export type ShapeToken = (typeof SHAPE_TOKEN_NAMES)[number];

export const STANDARD_SHAPE_TOKENS: Record<ShapeToken, string> = {
  "--shape-control": "var(--radius-3)",
  "--shape-popup": "var(--radius-4)",
  "--shape-card": "var(--radius-5)",
  "--shape-panel": "var(--radius-5)",
  "--shape-dialog": "var(--radius-6)",
  "--shape-pill": "var(--radius-full)",
};

export const FOCUS_RING_TOKENS: TokenMap = {
  "--focus-ring-width": "2px",
  "--focus-ring-offset": "2px",
};

/** Standard role mapping onto the generated scales, shared by both appearances. */
export const STANDARD_ROLES: Record<RoleToken, string> = {
  "--surface-app": "var(--gray-2)",
  "--surface-nav": "var(--gray-2)",
  "--surface-canvas": "var(--base-background)",
  "--surface-raised": "var(--base-panel)",
  "--surface-sunken": "var(--gray-3)",
  "--surface-overlay": "var(--base-overlay)",
  "--surface-inverse": "var(--gray-12)",

  "--fg-default": "var(--gray-12)",
  "--fg-muted": "var(--gray-11)",
  "--fg-subtle": "var(--gray-a10)",
  "--fg-disabled": "var(--gray-a8)",
  "--fg-on-brand": "var(--brand-contrast)",
  "--fg-on-danger": "var(--danger-contrast)",
  "--fg-brand": "var(--brand-text)",
  "--fg-danger": "var(--danger-text)",
  "--fg-inverse": "var(--gray-1)",

  "--line-default": "var(--gray-a6)",
  "--line-subtle": "var(--gray-a5)",
  "--line-strong": "var(--gray-a7)",
  "--line-focus": "var(--brand-8)",

  "--fill-hover": "var(--gray-a3)",
  "--fill-pressed": "var(--gray-a4)",
  "--fill-selected": "var(--brand-a3)",
  "--fill-neutral": "var(--gray-a3)",
  "--fill-neutral-hover": "var(--gray-a4)",
  "--fill-field": "var(--base-field)",
  "--fill-brand": "var(--brand-9)",
  "--fill-brand-hover": "var(--brand-10)",
  "--fill-brand-subtle": "var(--brand-a3)",
  "--fill-danger": "var(--danger-9)",
  "--fill-danger-hover": "var(--danger-10)",
  "--fill-danger-subtle": "var(--danger-a3)",

  "--status-danger-solid": "var(--danger-9)",
  "--status-danger-subtle": "var(--danger-a3)",
  "--status-danger-fg": "var(--danger-text)",
  "--status-danger-line": "var(--danger-a6)",
  "--status-warning-solid": "var(--warning-9)",
  "--status-warning-subtle": "var(--warning-a3)",
  "--status-warning-fg": "var(--warning-text)",
  "--status-warning-line": "var(--warning-a6)",
  "--status-success-solid": "var(--success-9)",
  "--status-success-subtle": "var(--success-a3)",
  "--status-success-fg": "var(--success-text)",
  "--status-success-line": "var(--success-a6)",
  "--status-info-solid": "var(--info-9)",
  "--status-info-subtle": "var(--info-a3)",
  "--status-info-fg": "var(--info-text)",
  "--status-info-line": "var(--info-a6)",

  "--shadow-1": "inset 0 0 0 1px var(--gray-a5)",
  "--shadow-2":
    "0 0 0 1px var(--gray-a3), 0 1px 1px 0 var(--shadow-tint-a1), 0 2px 1px -1px var(--shadow-tint-a2)",
  "--shadow-3":
    "0 0 0 1px var(--gray-a3), 0 2px 3px -2px var(--shadow-tint-a2), 0 3px 12px -4px var(--shadow-tint-a3)",
  "--shadow-4":
    "0 0 0 1px var(--gray-a3), 0 8px 40px var(--shadow-tint-a1), 0 12px 32px -16px var(--shadow-tint-a3)",
  "--shadow-5":
    "0 0 0 1px var(--gray-a3), 0 12px 60px var(--shadow-tint-a3), 0 12px 32px -16px var(--shadow-tint-a5)",
  "--shadow-6":
    "0 0 0 1px var(--gray-a3), 0 12px 60px var(--shadow-tint-a3), 0 16px 64px var(--shadow-tint-a2), 0 16px 36px -20px var(--shadow-tint-a7)",

  "--gradient-brand":
    "linear-gradient(135deg, var(--brand-8), var(--brand-10))",
  "--gradient-surface":
    "linear-gradient(180deg, var(--base-background), var(--gray-2))",
  "--gradient-glow":
    "radial-gradient(120% 80% at 50% 0%, var(--brand-a4), transparent 70%)",
};

export type Density = "compact" | "default" | "comfortable";
export const DENSITIES: readonly Density[] = [
  "compact",
  "default",
  "comfortable",
];

/** The control height scale behind the size names: 16, 20, 24 and 32px. */
export const CONTROL_HEIGHT_STEPS = ["1", "2", "3", "4"] as const;
export type ControlHeightStep = (typeof CONTROL_HEIGHT_STEPS)[number];

const CONTROL_TEXT_STEPS: Readonly<Record<ControlHeightStep, number>> = {
  "1": 1,
  "2": 1,
  "3": 1,
  "4": 1,
};

type Four = readonly [number, number, number, number];
type Nine = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

const DENSITY_SCALES: Record<
  Density,
  { padding: Four; gap: number; space: Nine }
> = {
  compact: {
    padding: [4, 4, 4, 8],
    gap: 4,
    space: [4, 8, 12, 16, 20, 24, 32, 40, 48],
  },
  default: {
    padding: [4, 4, 8, 12],
    gap: 4,
    space: [4, 8, 12, 16, 24, 32, 40, 48, 64],
  },
  comfortable: {
    padding: [8, 8, 12, 16],
    gap: 8,
    space: [8, 12, 16, 24, 32, 40, 48, 64, 80],
  },
};

export function densityTokens(density: Density): TokenMap {
  const scale = DENSITY_SCALES[density];
  const tokens: TokenMap = { "--density": density };
  scale.space.forEach((value, index) => {
    tokens[`--space-${index + 1}`] = `${value}px`;
  });
  CONTROL_HEIGHT_STEPS.forEach((size, index) => {
    tokens[`--control-height-${size}`] = `${at(CONTROL_HEIGHTS, index)}px`;
    tokens[`--control-padding-x-${size}`] = `${at(scale.padding, index)}px`;
    tokens[`--control-icon-size-${size}`] =
      `${at(CONTROL_ICON_SIZES, index)}px`;
  });
  tokens["--control-gap"] = `${scale.gap}px`;
  tokens["--control-font-size"] = "var(--font-size-1)";
  tokens["--control-line-height"] = "var(--line-height-1)";
  for (const size of CONTROL_HEIGHT_STEPS) {
    const step = CONTROL_TEXT_STEPS[size];
    tokens[`--control-font-size-${size}`] = `var(--font-size-${step})`;
    tokens[`--control-line-height-${size}`] = `var(--line-height-${step})`;
  }
  return tokens;
}

export type RadiusPreset = "none" | "small" | "medium" | "large" | "full";
export const RADIUS_PRESETS: readonly RadiusPreset[] = [
  "none",
  "small",
  "medium",
  "large",
  "full",
];

export function radiusTokens(preset: RadiusPreset): TokenMap {
  const factor = { none: 0, small: 0.75, medium: 1, large: 1.5, full: 1.5 }[
    preset
  ];
  const tokens: TokenMap = { "--radius-factor": String(factor) };
  if (preset === "full") {
    tokens["--shape-control"] = "var(--radius-full)";
    tokens["--shape-pill"] = "var(--radius-full)";
  }
  return tokens;
}
