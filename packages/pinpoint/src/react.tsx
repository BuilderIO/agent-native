// @agent-native/pinpoint — React component wrapper
// MIT License
//
// Thin lifecycle wrapper around mountPinpoint(). Renders nothing —
// the SolidJS overlay is mounted imperatively in Shadow DOM.
// Props are read on mount only ([] dependency).

import { useEffect } from "react";
import type { PinpointConfig } from "./types/index.js";
import { mountPinpoint } from "./ui/mount.js";

/** Props for the <Pinpoint /> component. Same as PinpointConfig minus target. */
export type PinpointProps = Omit<PinpointConfig, "target">;

/**
 * Mount the Pinpoint overlay as a React component.
 *
 * ```tsx
 * import { Pinpoint } from "@agent-native/pinpoint/react";
 *
 * function App() {
 *   return (
 *     <>
 *       <Pinpoint author="Designer" endpoint="/api/pins" autoSubmit />
 *       <YourApp />
 *     </>
 *   );
 * }
 * ```
 */
export function Pinpoint(props: PinpointProps) {
  useEffect(() => {
    const { dispose } = mountPinpoint(props);
    return dispose;
  }, []);
  return null;
}
