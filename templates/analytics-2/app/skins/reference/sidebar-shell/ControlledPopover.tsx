import type { NavigationEntry } from "@agent-native/toolkit/app-shell/sidebar-shell";
import type { ComponentProps } from "react";

import { Popover } from "../../../components/shell/Popover";
import { openBinding } from "./entry";

type ControlledPopoverProps = Omit<
  ComponentProps<typeof Popover>,
  "openBinding"
> & {
  entry: NavigationEntry;
};

export function ControlledPopover({ entry, ...props }: ControlledPopoverProps) {
  return <Popover {...props} openBinding={openBinding(entry)} />;
}
