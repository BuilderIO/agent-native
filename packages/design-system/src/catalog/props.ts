import {
  type ControlHeightStep,
  RADIUS_PRESETS,
  type RadiusPreset,
} from "../tokens/roles.js";

/** How a component applies its color, from the strongest fill to none. */
export const VARIANTS = [
  "solid",
  "soft",
  "surface",
  "outline",
  "ghost",
] as const;

/**
 * Which scale a component draws from. `accent` is the theme's brand scale;
 * the statuses are the palette's status scales.
 */
export const COLORS = [
  "accent",
  "gray",
  "danger",
  "warning",
  "success",
  "info",
] as const;

/** Text sizes, one per step of the type scale: 0 is 10px, 1 the 12px UI base, 2 13px. */
export const TEXT_SIZES = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
] as const;

/** Corner radius, overriding the theme's for one component: the radius presets. */
export const RADII = RADIUS_PRESETS;

export type Variant = (typeof VARIANTS)[number];
export type Color = (typeof COLORS)[number];
export type TextSize = (typeof TEXT_SIZES)[number];
export type Radius = RadiusPreset;

/** The palette scale each color reads: `accent` is the brand scale. */
export const COLOR_SCALES: Readonly<Record<Color, string>> = {
  accent: "brand",
  gray: "gray",
  danger: "danger",
  warning: "warning",
  success: "success",
  info: "info",
};

export interface EnumPropDef<V extends string = string> {
  type: "enum";
  values: readonly V[];
  default?: V;
  description: string;
}

export interface BooleanPropDef {
  type: "boolean";
  default?: boolean;
  description: string;
}

/** A prop the component passes through or renders, not written as an attribute. */
export interface ValuePropDef {
  type: "string" | "number" | "node" | "function";
  description: string;
}

export type PropDef = EnumPropDef | BooleanPropDef | ValuePropDef;

export type PropDefs = Readonly<Record<string, PropDef>>;

/** The value type a prop definition accepts. */
export type PropValue<D> =
  D extends EnumPropDef<infer V>
    ? V
    : D extends BooleanPropDef
      ? boolean
      : never;

/** The props a component's definitions give it, all optional. */
export type PropsOf<D extends PropDefs> = {
  -readonly [K in keyof D as D[K] extends EnumPropDef | BooleanPropDef
    ? K
    : never]?: PropValue<D[K]>;
};

export function enumProp<const V extends string>(
  values: readonly V[],
  description: string,
  defaultValue?: NoInfer<V>,
): EnumPropDef<V> {
  return defaultValue === undefined
    ? { type: "enum", values, description }
    : { type: "enum", values, default: defaultValue, description };
}

export function booleanProp(description: string): BooleanPropDef {
  return { type: "boolean", default: false, description };
}

/**
 * The two control sizes: `md` (24px), the standard, and `sm` (20px) for
 * dense rows and toolbars. Every other part has one size.
 */
export const CONTROL_SIZES = ["sm", "md"] as const;
export type ControlSize = (typeof CONTROL_SIZES)[number];

/** The step of the `--control-height-*` tokens each control size draws from. */
export const CONTROL_SIZE_STEPS: Readonly<
  Record<ControlSize, ControlHeightStep>
> = {
  sm: "2",
  md: "3",
};

/** `size` over a component's subset of the size names. */
export function sizeProp<const V extends ControlSize>(
  values: readonly V[],
  defaultValue: NoInfer<V>,
  measures = "Control height",
): EnumPropDef<V> {
  const heights = values
    .map((value) => `${value} is ${CONTROL_HEIGHT_PX[value]}px`)
    .join(", ");
  return enumProp(values, `${measures}: ${heights}.`, defaultValue);
}

const CONTROL_HEIGHT_PX: Readonly<Record<ControlSize, number>> = {
  sm: 20,
  md: 24,
};

/** `variant` over a component's subset of the variants. */
export function variantProp<const V extends Variant>(
  values: readonly V[],
  defaultValue: NoInfer<V>,
): EnumPropDef<V> {
  return enumProp(values, "How the component applies its color.", defaultValue);
}

export const colorProp: EnumPropDef<Color> = enumProp(
  COLORS,
  "The scale the component draws from. Unset, it inherits the nearest color, and the theme's accent at the root.",
);

/**
 * `color` for a popup's highlighted row: gray unless set, so menus and lists
 * keep the system's neutral highlight in every theme.
 */
export const popupColorProp: EnumPropDef<Color> = enumProp(
  COLORS,
  "The scale the highlighted row draws from; gray unless set.",
  "gray",
);

export const highContrastProp: BooleanPropDef = booleanProp(
  "Uses the scale's darkest steps, for text and fills that need more contrast.",
);

export const radiusProp: EnumPropDef<Radius> = enumProp<Radius>(
  RADII,
  "Overrides the theme's corner radius for this component.",
);

/** The data attribute a prop is written to: `highContrast` is `data-high-contrast`. */
export function propAttribute(name: string): string {
  if (!/[A-Z]/.test(name)) return `data-${name}`;
  return `data-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/**
 * The data attributes for a component's props, with each definition's
 * default filled in, so the CSS always sees a value. A boolean is written
 * only when true. A value outside the definition throws: a misspelled
 * variant must fail where it is written, not render as the default.
 */
export function propAttributes(
  defs: PropDefs,
  props: object,
): Record<string, string | undefined> {
  const values = props as Readonly<Record<string, unknown>>;
  const attributes: Record<string, string | undefined> = {};
  for (const [name, def] of Object.entries(defs)) {
    if (def.type !== "enum" && def.type !== "boolean") continue;
    const given = Object.prototype.propertyIsEnumerable.call(values, name)
      ? values[name]
      : undefined;
    if (def.type === "enum") {
      const value = given ?? def.default;
      if (value === undefined) continue;
      if (typeof value !== "string" || !def.values.includes(value)) {
        throw new TypeError(
          `${name}="${String(value)}" is not one of ${def.values.join(", ")}`,
        );
      }
      attributes[propAttribute(name)] = value;
    } else if (given === true) {
      attributes[propAttribute(name)] = "";
    }
  }
  return attributes;
}

/** Font weights, one per weight token. Radix Themes has all but semibold. */
export const TEXT_WEIGHTS = [
  "light",
  "regular",
  "medium",
  "semibold",
  "bold",
] as const;

export type TextWeight = (typeof TEXT_WEIGHTS)[number];

/** The props Radix Themes gives every text component. */
export const textProps = {
  weight: enumProp(TEXT_WEIGHTS, "Font weight, one of the weight tokens."),
  align: enumProp(["left", "center", "right"], "Text alignment."),
  trim: enumProp(
    ["normal", "start", "end", "both"],
    "Trims the leading above the first line, below the last, or both, so text sits flush with its box.",
  ),
  truncate: booleanProp("Truncates to one line with an ellipsis."),
  wrap: enumProp(
    ["wrap", "nowrap", "pretty", "balance"],
    "How lines break: `pretty` avoids orphans, `balance` evens line lengths.",
  ),
  color: colorProp,
  highContrast: highContrastProp,
} as const;
