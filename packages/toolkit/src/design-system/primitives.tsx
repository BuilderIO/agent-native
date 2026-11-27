import type { ComponentPropsWithRef, ComponentType } from "react";

import type {
  Button,
  ButtonLink,
  IconButton,
  IconButtonLink,
} from "../ui/base-ui/button.js";
import { useDesignSystem } from "./context.js";

type PrimitiveProps = Readonly<Record<string, unknown>>;

/** Base UI primitives a design system can replace, by export name. */
export interface DesignSystemPrimitives {
  Button: typeof Button;
  ButtonLink: typeof ButtonLink;
  IconButton: typeof IconButton;
  IconButtonLink: typeof IconButtonLink;
}

export type DesignSystemPrimitiveName = keyof DesignSystemPrimitives;

/** Replacements, each taking exactly the props of the primitive it replaces. */
export type DesignSystemPrimitiveOverrides = {
  readonly [Name in DesignSystemPrimitiveName]?: ComponentType<
    ComponentPropsWithRef<DesignSystemPrimitives[Name]>
  >;
};

/**
 * Wraps a primitive so the current design system can replace it. The replacement gets
 * the same props, ref included; with no replacement the primitive draws.
 */
export function swappable<Primitive extends ComponentType<never>>(
  name: DesignSystemPrimitiveName,
  primitive: Primitive,
): Primitive {
  const Default = primitive as unknown as ComponentType<PrimitiveProps>;
  function Swappable(props: PrimitiveProps) {
    const Replacement = useDesignSystem()?.primitives?.[name] as
      | ComponentType<PrimitiveProps>
      | undefined;
    const Component = Replacement ?? Default;
    return <Component {...props} />;
  }
  Swappable.displayName = name;
  return Swappable as unknown as Primitive;
}
