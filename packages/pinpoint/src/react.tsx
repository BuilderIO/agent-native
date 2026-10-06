// @agent-native/pinpoint — React component wrapper
// MIT License
//
// Thin lifecycle wrapper around mountPinpoint(). Renders nothing —
// the SolidJS overlay is mounted imperatively in Shadow DOM.
// Props are read on mount only ([] dependency).

import { useEffect } from "react";

import type { PinpointConfig } from "./types/index.js";
import { mountPinpoint } from "./ui/mount.js";

export type PinpointProps = Omit<PinpointConfig, "target">;

export function Pinpoint(props: PinpointProps) {
  useEffect(() => {
    const { dispose } = mountPinpoint(props);
    return dispose;
  }, []);
  return null;
}
