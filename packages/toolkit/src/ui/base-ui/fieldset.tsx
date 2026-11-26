import { Fieldset as BaseFieldset } from "@base-ui/react/fieldset";
import * as React from "react";

import { partClassName } from "./part-class.js";

export type FieldsetProps = BaseFieldset.Root.Props;

/**
 * A group of related fields under one legend, on Base UI's Fieldset.
 * Disabling it disables every field inside.
 *
 * @import import { Fieldset, FieldsetLegend } from "@agent-native/toolkit/ui/base-ui/fieldset";
 */
const Fieldset = React.forwardRef<HTMLFieldSetElement, FieldsetProps>(
  ({ className, ...props }, ref) => (
    <BaseFieldset.Root
      ref={ref}
      className={partClassName("fieldset", className)}
      {...props}
    />
  ),
);
Fieldset.displayName = "Fieldset";

export type FieldsetLegendProps = BaseFieldset.Legend.Props;

/**
 * The heading that names a Fieldset's group of fields.
 *
 * @import import { FieldsetLegend } from "@agent-native/toolkit/ui/base-ui/fieldset";
 */
const FieldsetLegend = React.forwardRef<HTMLDivElement, FieldsetLegendProps>(
  ({ className, ...props }, ref) => (
    <BaseFieldset.Legend
      ref={ref}
      className={partClassName("fieldset-legend", className)}
      {...props}
    />
  ),
);
FieldsetLegend.displayName = "FieldsetLegend";

export { Fieldset, FieldsetLegend };
