import { createContext, useContext, type ReactNode } from "react";

const NarrowContainerContext = createContext(false);

export function useInNarrowContainer(): boolean {
  return useContext(NarrowContainerContext);
}

export function NarrowContainerProvider({ children }: { children: ReactNode }) {
  return (
    <NarrowContainerContext.Provider value={true}>
      {children}
    </NarrowContainerContext.Provider>
  );
}
