import { createContext, useContext, type ReactNode } from "react";

export interface DispatchChatFirstPane {
  appId: string;
  path?: string;
  view?: string;
}

interface DispatchChatFirstPaneContextValue {
  pane: DispatchChatFirstPane | null;
  openPane: (pane: DispatchChatFirstPane) => void;
  closePane: () => void;
}

const DispatchChatFirstPaneContext =
  createContext<DispatchChatFirstPaneContextValue | null>(null);

export function DispatchChatFirstPaneProvider({
  value,
  children,
}: {
  value: DispatchChatFirstPaneContextValue;
  children: ReactNode;
}) {
  return (
    <DispatchChatFirstPaneContext.Provider value={value}>
      {children}
    </DispatchChatFirstPaneContext.Provider>
  );
}

export function useDispatchChatFirstPane(): DispatchChatFirstPaneContextValue {
  const value = useContext(DispatchChatFirstPaneContext);
  if (!value) {
    throw new Error(
      "useDispatchChatFirstPane must be used inside DispatchChatFirstPaneProvider",
    );
  }
  return value;
}
