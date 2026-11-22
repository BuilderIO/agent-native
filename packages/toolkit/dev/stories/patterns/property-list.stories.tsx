import type { Meta, StoryObj } from "@storybook/react-vite";
import { useId } from "react";

import { Input } from "../../../src/ui/base-ui/input.js";
import {
  NumberField,
  NumberFieldScrubArea,
} from "../../../src/ui/base-ui/number-field.js";
import {
  PropertyList,
  PropertyRow,
  PropertyLabel,
  PropertyValue,
} from "../../../src/ui/base-ui/property-list.js";
import guide from "./property-list.docs.md?raw";

function Fields() {
  const name = useId(),
    size = useId();
  return (
    <PropertyList>
      <PropertyRow>
        <PropertyLabel htmlFor={name}>Layer name</PropertyLabel>
        <PropertyValue>
          <Input id={name} defaultValue="Frame" />
        </PropertyValue>
      </PropertyRow>
      <PropertyRow>
        <PropertyLabel render={<span />} id={size}>
          Dimensions
        </PropertyLabel>
        <PropertyValue role="group" aria-labelledby={size}>
          <NumberField aria-label="Width" defaultValue={240} min={1}>
            <NumberFieldScrubArea>W</NumberFieldScrubArea>
          </NumberField>
          <NumberField aria-label="Height" defaultValue={160} min={1}>
            <NumberFieldScrubArea>H</NumberFieldScrubArea>
          </NumberField>
        </PropertyValue>
      </PropertyRow>
    </PropertyList>
  );
}
export default {
  title: "Patterns/Property List",
  parameters: { docs: { description: { component: guide } } },
  component: PropertyList,
} satisfies Meta;
export const InspectorWidth: StoryObj = {
  render: () => (
    <div className="max-w-72">
      <Fields />
    </div>
  ),
};
export const Narrow: StoryObj = {
  render: () => (
    <div className="max-w-48">
      <Fields />
    </div>
  ),
};
