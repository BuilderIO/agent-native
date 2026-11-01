import { createContext, useContext } from "react";

/**
 * True inside a dialog or sheet. Radix scroll-locks the page while one is open
 * and lets the wheel through only to the layers it knows about, so a
 * non-modal popover portalled to the body inside one cannot scroll, and a sheet
 * opened from one would sit under it.
 */
const ModalLayerContext = createContext(false);

export const ModalLayerProvider = ModalLayerContext.Provider;

export function useInModalLayer(): boolean {
  return useContext(ModalLayerContext);
}
