import { BuilderConnectPopover } from "./BuilderConnectPopover.js";
import type { BuilderConnectPopoverProps } from "./BuilderConnectPopover.js";

// OAuth opens a window from the trigger's user gesture, so this wrapper stays synchronous.
export function DeferredBuilderConnectPopover(
  props: BuilderConnectPopoverProps,
) {
  return <BuilderConnectPopover {...props} />;
}
