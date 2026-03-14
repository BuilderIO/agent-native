import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";

interface HeaderActionsContextValue {
  actions: ReactNode;
  setActions: (node: ReactNode) => void;
}

const HeaderActionsContext = createContext<HeaderActionsContextValue>({
  actions: null,
  setActions: () => {},
});

export function HeaderActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null);
  return (
    <HeaderActionsContext.Provider value={{ actions, setActions }}>
      {children}
    </HeaderActionsContext.Provider>
  );
}

export function useHeaderActions() {
  return useContext(HeaderActionsContext);
}

/** Mount ReactNode into the header bar. Cleans up on unmount. */
export function useSetHeaderActions(node: ReactNode) {
  const { setActions } = useHeaderActions();
  useEffect(() => {
    setActions(node);
    return () => setActions(null);
  }, [node, setActions]);
}
