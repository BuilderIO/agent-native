import { type DrawerOwnProps, drawerProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "../../../src/ui/base-ui/button.js";
import {
  Drawer,
  DrawerPopup,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  type DrawerSide,
} from "../../../src/ui/base-ui/drawer.js";
import { propControls } from "../prop-controls.js";

type DrawerProps = DrawerOwnProps;

const controls = propControls(drawerProps);

function DrawerExample({ side = "bottom" }: { side?: DrawerSide | undefined }) {
  return (
    <Drawer side={side}>
      <DrawerTrigger render={<Button variant="surface" color="gray" />}>
        Open {side} drawer
      </DrawerTrigger>
      <DrawerPopup>
        <DrawerHeader>
          <DrawerTitle>
            {side === "bottom" ? "Move to folder" : "History"}
          </DrawerTitle>
          <DrawerDescription>
            {side === "bottom"
              ? "Swipe down or press Escape."
              : `Anchored to the ${side} edge.`}
          </DrawerDescription>
        </DrawerHeader>
        {side === "bottom" ? (
          <DrawerFooter>
            <Button>Move</Button>
          </DrawerFooter>
        ) : null}
      </DrawerPopup>
    </Drawer>
  );
}

const meta = {
  title: "Components/Drawer",
  parameters: { layout: "fullscreen" },
  args: controls.args,
  argTypes: controls.argTypes,
} satisfies Meta<DrawerProps>;

export default meta;

type Story = StoryObj<DrawerProps>;

/** The drawer on the side from the controls. */
export const Playground: Story = {
  render: (args) => (
    <div className="p-4">
      <DrawerExample side={args.side} />
    </div>
  ),
};

/** A drawer for each side: side panels carry a close button, the bottom drawer a handle. */
export const Sides: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3 p-4">
      {drawerProps.side.values.map((side) => (
        <DrawerExample key={side} side={side} />
      ))}
    </div>
  ),
};
