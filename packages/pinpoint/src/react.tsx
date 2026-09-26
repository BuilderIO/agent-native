
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
