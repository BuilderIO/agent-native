import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
  type ComponentType,
} from "react";

import type { ButtonProps } from "./ui/button.js";

export interface ToolkitComponents {
  Button?: ComponentType<ButtonProps>;
}

interface ToolkitProviderProps {
  children: ReactNode;
  components?: ToolkitComponents;
}

const ToolkitComponentsContext = createContext<ToolkitComponents>({});

export function ToolkitProvider({
  children,
  components,
}: ToolkitProviderProps) {
  const parent = useContext(ToolkitComponentsContext);
  const value = useMemo(
    () => ({ ...parent, ...components }),
    [parent, components],
  );

  return (
    <ToolkitComponentsContext.Provider value={value}>
      {children}
    </ToolkitComponentsContext.Provider>
  );
}

export function useToolkitComponents(): ToolkitComponents {
  return useContext(ToolkitComponentsContext);
}

export function useToolkitComponent<Name extends keyof ToolkitComponents>(
  name: Name,
): ToolkitComponents[Name] {
  return useToolkitComponents()[name];
}
