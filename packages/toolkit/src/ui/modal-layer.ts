import { createContext, useContext } from "react";

const ModalLayerContext = createContext(false);

export const ModalLayerProvider = ModalLayerContext.Provider;

export function useInModalLayer(): boolean {
  return useContext(ModalLayerContext);
}
