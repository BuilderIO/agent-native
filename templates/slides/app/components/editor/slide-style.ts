import type { DesignSystemData } from "@shared/api";

import type { InlineTextStyleKey } from "./rich-text-selection";

export interface SlideStyleSnapshot {
  /** Omitted snapshots are existing object snapshots for backward compatibility. */
  mode?: "object";
  selector: string;
  label: string;
  tagName: string;
  textPreview: string;
  isText: boolean;
  isImage: boolean;
  isAbsolute: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  slideWidth: number;
  slideHeight: number;
  color: string;
  backgroundColor: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  textDecoration: string;
  lineHeight: number;
  textAlign: string;
  opacity: number;
  borderRadius: number;
  borderWidth: number;
  borderColor: string;
  paddingX: number;
  paddingY: number;
  zIndex: number;
  textStyleScope?: "block" | "selection";
  mixedTextStyles?: InlineTextStyleKey[];
}

export type SlideStylePatch = Partial<{
  color: string;
  backgroundColor: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  textDecoration: string;
  lineHeight: string;
  textAlign: string;
  opacity: string;
  borderRadius: string;
  borderWidth: string;
  borderColor: string;
  paddingLeft: string;
  paddingRight: string;
  paddingTop: string;
  paddingBottom: string;
  left: string;
  top: string;
  width: string;
  height: string;
  transform: string;
  zIndex: string;
}>;

export function tokenPalette(
  designSystem: DesignSystemData | undefined,
  t: (key: string) => string,
) {
  const colors = designSystem?.colors;
  const base = colors
    ? [
        {
          label: t("styleInspector.primary"),
          value: colors.primary,
          color: colors.primary,
        },
        {
          label: t("styleInspector.secondary"),
          value: colors.secondary,
          color: colors.secondary,
        },
        {
          label: t("styleInspector.accent"),
          value: colors.accent,
          color: colors.accent,
        },
        {
          label: t("styleInspector.surface"),
          value: colors.surface,
          color: colors.surface,
        },
        {
          label: t("styleInspector.background"),
          value: colors.background,
          color: colors.background,
        },
        {
          label: t("styleInspector.text"),
          value: colors.text,
          color: colors.text,
        },
        {
          label: t("styleInspector.muted"),
          value: colors.textMuted,
          color: colors.textMuted,
        },
      ]
    : [];

  // Fixed swatches offered when a deck has no design system. These are
  // document colors the user paints onto slide content, so they must stay
  // literal — theming them would repaint finished decks on a theme switch.
  const presets: Array<[key: string, hex: string]> = [
    ["white", "#ffffff"], // guard:allow-raw-color
    ["black", "#000000"], // guard:allow-raw-color
    ["slate", "#1f2937"], // guard:allow-raw-color
    ["blue", "#609ff8"], // guard:allow-raw-color
    ["cyan", "#22d3ee"], // guard:allow-raw-color
    ["emerald", "#34d399"], // guard:allow-raw-color
    ["amber", "#fbbf24"], // guard:allow-raw-color
    ["rose", "#fb7185"], // guard:allow-raw-color
  ];

  return [
    ...base,
    ...presets.map(([key, hex]) => ({
      label: t(`styleInspector.${key}`),
      value: hex,
      color: hex,
    })),
  ];
}

// `slide.background` holds either a raw CSS value or a Tailwind arbitrary
// class (`bg-[...]`), which SlideRenderer applies as a class rather than
// an inline style. The picker only speaks CSS colors, so unwrap the arbitrary
// form and report anything else (named utilities, gradients) as unreadable
// rather than guessing a hex the slide is not actually using.
export function backgroundCssValue(
  background: string | undefined,
): string | null {
  // guard:allow-raw-color — mirrors SlideRenderer's own default slide fill
  if (!background) return "#000000";
  const arbitrary = background.match(/^bg-\[(.+)\]$/);
  if (arbitrary) return arbitrary[1].replace(/_/g, " ");
  return background.startsWith("bg-") ? null : background;
}

export function formatValue(value: number) {
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(2)));
}

export function rotationTransform(rotation: number) {
  return `rotate(${formatValue(rotation)}deg)`;
}

export function resolveHorizontalAlignment(snapshot: SlideStyleSnapshot) {
  if (snapshot.x <= 0) return "left";
  const centered = (snapshot.slideWidth - snapshot.width) / 2;
  return Math.abs(snapshot.x - centered) < 1 ? "center" : "right";
}

export function resolveVerticalAlignment(snapshot: SlideStyleSnapshot) {
  if (snapshot.y <= 0) return "top";
  const centered = (snapshot.slideHeight - snapshot.height) / 2;
  return Math.abs(snapshot.y - centered) < 1 ? "middle" : "bottom";
}

export function horizontalAlignPatch(
  snapshot: SlideStyleSnapshot,
  alignment: string,
): SlideStylePatch {
  const available = Math.max(0, snapshot.slideWidth - snapshot.width);
  const x =
    alignment === "left"
      ? 0
      : alignment === "center"
        ? available / 2
        : available;
  return { left: `${formatValue(x)}px` };
}

export function verticalAlignPatch(
  snapshot: SlideStyleSnapshot,
  alignment: string,
): SlideStylePatch {
  const available = Math.max(0, snapshot.slideHeight - snapshot.height);
  const y =
    alignment === "top"
      ? 0
      : alignment === "middle"
        ? available / 2
        : available;
  return { top: `${formatValue(y)}px` };
}
