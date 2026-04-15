import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";

interface HeaderActionsContextValue {
  title: ReactNode;
  setTitle: (node: ReactNode) => void;
  actions: ReactNode;
  setActions: (node: ReactNode) => void;
}

const HeaderActionsContext = createContext<HeaderActionsContextValue>({
  title: null,
  setTitle: () => {},
  actions: null,
  setActions: () => {},
});

export function HeaderActionsProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<ReactNode>(null);
  const [actions, setActions] = useState<ReactNode>(null);
  return (
    <HeaderActionsContext.Provider
      value={{ title, setTitle, actions, setActions }}
    >
      {children}
    </HeaderActionsContext.Provider>
  );
}

export function useHeaderActions() {
  return useContext(HeaderActionsContext);
}

/** Mount a custom title into the app header. Cleans up on unmount. */
export function useSetPageTitle(node: ReactNode) {
  const { setTitle } = useHeaderActions();
  useEffect(() => {
    setTitle(node);
    return () => setTitle(null);
  }, [node, setTitle]);
}

/** Mount ReactNode into the header's actions slot. Cleans up on unmount. */
export function useSetHeaderActions(node: ReactNode) {
  const { setActions } = useHeaderActions();
  useEffect(() => {
    setActions(node);
    return () => setActions(null);
  }, [node, setActions]);
}
